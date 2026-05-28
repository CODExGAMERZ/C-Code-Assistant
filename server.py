"""
C Code Assistant - Backend + Ollama Proxy v3.0
Run: python server.py
Open: http://localhost:5050

The browser NEVER talks to Ollama directly.
All Ollama traffic goes: Browser → Flask (5050) → Ollama (11434)
No OLLAMA_ORIGINS needed. Ollama stays on localhost only.
"""

import sys

try:
    from flask import Flask, request, jsonify, send_from_directory, send_file, Response, stream_with_context
    from flask_cors import CORS
    import requests as req_lib
except ImportError:
    print("\n  Run first: python -m pip install flask flask-cors requests\n")
    sys.exit(1)

import os, subprocess, tempfile, uuid, json

BASE_DIR     = os.path.dirname(os.path.abspath(__file__))
OLLAMA_BASE  = os.environ.get("OLLAMA_URL", "http://localhost:11434")

app = Flask(__name__, static_folder=BASE_DIR)
CORS(app, resources={r"/api/*": {"origins": "*"}},
     allow_headers=["Content-Type", "Accept"],
     methods=["GET", "POST", "OPTIONS"])

@app.after_request
def add_cors(response):
    response.headers["Access-Control-Allow-Origin"]  = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Accept"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response

MAX_RUN_SECS = 10
GCC_CMD      = "gcc"

# ── Serve frontend ─────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_file(os.path.join(BASE_DIR, "index.html"))

@app.route("/css/<path:f>")
def css(f): return send_from_directory(os.path.join(BASE_DIR, "css"), f)

@app.route("/js/<path:f>")
def js(f):  return send_from_directory(os.path.join(BASE_DIR, "js"), f)

# ── Helpers ────────────────────────────────────────────────────────────────

def cmd_exists(name):
    try:
        return subprocess.run([name, "--version"], capture_output=True, timeout=5).returncode == 0
    except (FileNotFoundError, OSError, subprocess.TimeoutExpired):
        return False

def tmp_c(code):
    path = os.path.join(tempfile.gettempdir(), "ca_" + uuid.uuid4().hex[:8] + ".c")
    with open(path, "w", encoding="utf-8") as f: f.write(code)
    return path

def rm(*paths):
    for p in paths:
        try: os.remove(p)
        except: pass

# ══════════════════════════════════════════════════════════════════════════
#  OLLAMA PROXY — browser hits /api/ollama/*, Flask forwards to Ollama
#  No OLLAMA_ORIGINS required on Ollama side.
# ══════════════════════════════════════════════════════════════════════════

@app.route("/api/ollama/tags", methods=["GET"])
def ollama_tags():
    """Return list of installed Ollama models."""
    try:
        r = req_lib.get(OLLAMA_BASE + "/api/tags", timeout=5)
        return jsonify(r.json()), r.status_code
    except req_lib.exceptions.ConnectionError:
        return jsonify({"error": "Ollama not running", "models": []}), 503
    except Exception as e:
        return jsonify({"error": str(e), "models": []}), 502


@app.route("/api/ollama/chat", methods=["POST"])
def ollama_chat():
    """
    Proxy streaming chat to Ollama.
    The browser sends JSON here; we stream Ollama's response back line by line.
    """
    body = request.get_json(force=True, silent=True) or {}

    try:
        ollama_resp = req_lib.post(
            OLLAMA_BASE + "/api/chat",
            json=body,
            stream=True,
            timeout=(5, 120)   # (connect timeout, read timeout)
        )

        def generate():
            for line in ollama_resp.iter_lines():
                if line:
                    yield line.decode("utf-8") + "\n"

        return Response(
            stream_with_context(generate()),
            status=ollama_resp.status_code,
            content_type="application/x-ndjson"
        )

    except req_lib.exceptions.ConnectionError:
        return jsonify({"error": "Ollama not running on " + OLLAMA_BASE}), 503
    except req_lib.exceptions.Timeout:
        return jsonify({"error": "Ollama connection timed out"}), 504
    except Exception as e:
        return jsonify({"error": str(e)}), 502


@app.route("/api/ollama/generate", methods=["POST"])
def ollama_generate():
    """Proxy non-streaming generate (used by quality checker)."""
    body = request.get_json(force=True, silent=True) or {}
    try:
        r = req_lib.post(
            OLLAMA_BASE + "/api/generate",
            json=body,
            timeout=(5, 90)
        )
        return jsonify(r.json()), r.status_code
    except req_lib.exceptions.ConnectionError:
        return jsonify({"error": "Ollama not running"}), 503
    except Exception as e:
        return jsonify({"error": str(e)}), 502

# ── Health ─────────────────────────────────────────────────────────────────

@app.route("/api/health", methods=["GET", "POST"])
def health():
    ollama_ok = False
    try:
        r = req_lib.get(OLLAMA_BASE + "/api/tags", timeout=3)
        ollama_ok = r.status_code == 200
    except:
        pass
    return jsonify({
        "ok":       True,
        "gcc":      cmd_exists(GCC_CMD),
        "cppcheck": cmd_exists("cppcheck"),
        "ollama":   ollama_ok,
        "version":  "3.0"
    })

@app.route("/api/<path:p>", methods=["OPTIONS"])
def preflight(p): return jsonify({"ok": True}), 200

# ── Compile ────────────────────────────────────────────────────────────────

@app.route("/api/compile", methods=["POST"])
def compile_run():
    body  = request.get_json(force=True, silent=True) or {}
    code  = (body.get("code") or "").strip()
    stdin = body.get("stdin") or ""
    flags = body.get("flags") or "-Wall -Wextra -std=c11"
    if not code:
        return jsonify({"ok": False, "error": "No code provided"}), 400

    src = tmp_c(code)
    exe = src.replace(".c", (".exe" if sys.platform == "win32" else ".out"))

    try:
        cp = subprocess.run(
            [GCC_CMD] + flags.split() + [src, "-o", exe, "-lm"],
            capture_output=True, text=True, timeout=15,
            encoding="utf-8", errors="replace")
    except FileNotFoundError:
        rm(src)
        return jsonify({"ok": False, "stage": "compile",
                        "error": "gcc not found. Install MinGW-w64."})
    except subprocess.TimeoutExpired:
        rm(src); return jsonify({"ok": False, "stage": "compile", "error": "Compile timeout"})

    if cp.returncode != 0:
        rm(src)
        return jsonify({"ok": False, "stage": "compile",
                        "stdout": cp.stdout, "stderr": cp.stderr,
                        "returncode": cp.returncode})
    try:
        rp = subprocess.run([exe], input=stdin, capture_output=True, text=True,
                            timeout=MAX_RUN_SECS, encoding="utf-8", errors="replace")
        return jsonify({"ok": True, "stdout": rp.stdout, "stderr": rp.stderr,
                        "returncode": rp.returncode, "compile_warnings": cp.stderr})
    except subprocess.TimeoutExpired:
        return jsonify({"ok": False, "stage": "run",
                        "error": f"Exceeded {MAX_RUN_SECS}s — infinite loop?"})
    except Exception as e:
        return jsonify({"ok": False, "stage": "run", "error": str(e)})
    finally:
        rm(src, exe)

# ── Lint ───────────────────────────────────────────────────────────────────

@app.route("/api/lint", methods=["POST"])
def lint():
    body = request.get_json(force=True, silent=True) or {}
    code = (body.get("code") or "").strip()
    if not code: return jsonify({"ok": True, "issues": []})

    src = tmp_c(code); issues = []
    try:
        if cmd_exists("cppcheck"):
            cp = subprocess.run(
                ["cppcheck","--enable=all","--language=c",
                 "--suppress=missingIncludeSystem",
                 "--template={line}||{severity}||{message}", src],
                capture_output=True, text=True, timeout=12,
                encoding="utf-8", errors="replace")
            for line in cp.stderr.splitlines():
                parts = line.split("||")
                if len(parts) != 3: continue
                ls, sev, msg = parts
                sev = sev.strip()
                if sev == "information": continue
                try: lineno = int(ls.strip())
                except: continue
                if lineno == 0: continue
                issues.append({"line": lineno, "severity": sev, "message": msg.strip()})
        else:
            cp = subprocess.run(
                [GCC_CMD,"-Wall","-Wextra","-fsyntax-only","-std=c11",src],
                capture_output=True, text=True, timeout=10,
                encoding="utf-8", errors="replace")
            for line in (cp.stderr+cp.stdout).splitlines():
                if ".c:" not in line: continue
                try:
                    rest = line.split(".c:",1)[1]; parts = rest.split(":",2)
                    lineno = int(parts[0]); tail = parts[2].strip() if len(parts)>2 else rest
                    sev = "error" if "error:" in tail else "warning" if "warning:" in tail else "note"
                    msg = tail.replace("error:","").replace("warning:","").replace("note:","").strip()
                    if msg: issues.append({"line":lineno,"severity":sev,"message":msg})
                except: pass
    except subprocess.TimeoutExpired: pass
    finally: rm(src)
    return jsonify({"ok": True, "issues": issues})

# ── Main ───────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5050))
    print("\n" + "="*55)
    print("  C Code Assistant v3.0")
    print(f"  Open: http://localhost:{port}")
    print(f"  Ollama proxied from: {OLLAMA_BASE}")
    print("  (No OLLAMA_ORIGINS needed)")
    print("="*55)

    gcc_ok      = cmd_exists(GCC_CMD)
    cppcheck_ok = cmd_exists("cppcheck")
    ollama_ok   = False
    try:
        r = req_lib.get(OLLAMA_BASE + "/api/tags", timeout=3)
        ollama_ok = r.status_code == 200
    except: pass

    print(f"  gcc      : {'OK' if gcc_ok else 'NOT FOUND — install MinGW-w64'}")
    print(f"  cppcheck : {'OK' if cppcheck_ok else 'not installed (optional)'}")
    print(f"  ollama   : {'OK — models ready' if ollama_ok else 'not running — start with: ollama serve'}")
    print()

    import webbrowser, threading
    def _open():
        import time; time.sleep(1.5)
        webbrowser.open(f"http://localhost:{port}")
    threading.Thread(target=_open, daemon=True).start()

    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
