<div align="center">

# C Code Assistant

**A fully local AI-powered C programming assistant.**  
No cloud. No API keys. Runs entirely on your machine via [Ollama](https://ollama.com).

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.8%2B-yellow.svg)](https://python.org)
[![Ollama](https://img.shields.io/badge/Powered%20by-Ollama-purple.svg)](https://ollama.com)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey.svg)]()

</div>

---

## What it does

C Code Assistant is a browser-based IDE companion for C programming, powered by locally running LLMs. It can complete, generate, explain, debug, and optimize C code — all without sending anything to the internet.

All Ollama traffic is routed through the Flask backend (localhost proxy), so Ollama never needs to be exposed to any external origin.

---

## Features

| Feature | Description |
|---|---|
| ⚡ **Complete** | Paste partial C code, get it finished |
| ✨ **Generate** | Describe in plain English, get working C |
| 📖 **Explain** | Understand any C code in plain English |
| 🔧 **Fix / Debug** | Finds and fixes every bug with explanations |
| 🚀 **Optimize** | Improves performance with Big-O analysis |
| ▶ **Compile & Run** | Compiles with GCC and runs in the browser |
| 🔍 **Lint** | Live linting with cppcheck or GCC fallback |
| 🔄 **Quality Retry** | Output is auto-checked and rewritten if wrong |
| 🤖 **Model Switcher** | Switch between any installed Ollama model |
| 🕘 **History** | Session history saved in localStorage |
| ⬇ **Export .c** | Download code as a `.c` file |

---

## Requirements

### Required
- [Python 3.8+](https://python.org)
- [Ollama](https://ollama.com) with at least one model pulled

### Optional (for Compile & Run)
- **GCC**
  - Windows: [MinGW-w64](https://winlibs.com) — download, extract, add `bin/` to PATH
  - Linux: `sudo apt install gcc`
  - macOS: `xcode-select --install`
- **cppcheck** (richer linting)
  - Windows: [cppcheck.sourceforge.io](https://cppcheck.sourceforge.io)
  - Linux: `sudo apt install cppcheck`
  - macOS: `brew install cppcheck`

---

## Recommended Models

| Model | Size | Pull Command |
|---|---|---|
| `qwen2.5-coder:1.5b` | ~1 GB | `ollama pull qwen2.5-coder:1.5b` |
| `deepseek-coder:1.3b` | ~776 MB | `ollama pull deepseek-coder:1.3b` |
| `qwen2.5-coder:7b` | ~4.7 GB | `ollama pull qwen2.5-coder:7b` |
| `deepseek-coder:6.7b` | ~3.8 GB | `ollama pull deepseek-coder:6.7b` |

---

## Installation

### 1. Clone the repo
```bash
git clone https://github.com/CODExGAMERZ/C-Code-Assistant.git
cd c-code-assistant
```

### 2. Install Python dependencies
```bash
python -m pip install flask flask-cors requests
```

### 3. Pull a model
```bash
ollama pull qwen2.5-coder:1.5b
```

### 4. Start the app

**Windows** — double-click `start.bat` or run:
```powershell
python server.py
```

**Linux / macOS:**
```bash
bash start.sh
```

### 5. Open in browser
```
http://localhost:5050
```

> ⚠️ Always open `http://localhost:5050` — never open `index.html` directly as a file.

---

## Architecture

```
Browser (localhost:5050)
    │
    ├── GET  /              → serves index.html
    ├── GET  /js/*.js       → serves JS files
    ├── GET  /css/*.css     → serves CSS files
    │
    ├── POST /api/compile   → GCC compile & run
    ├── POST /api/lint      → cppcheck / GCC lint
    │
    └── /api/ollama/*  ──proxy──▶  Ollama (localhost:11434)
            ├── GET  /api/ollama/tags
            ├── POST /api/ollama/chat      (streaming)
            └── POST /api/ollama/generate
```

The browser **never** contacts Ollama directly. All LLM traffic goes through the Flask proxy, so Ollama runs with default settings — no `OLLAMA_ORIGINS` flag required.

---

## Quality-Retry System

Every response goes through an automatic quality gate:

```
User clicks Run
      │
      ▼
LLM generates output (streamed live)
      │
      ▼
Quality checker reviews:
  - Valid C code in fenced block?
  - No unresolved TODO / placeholder?
  - No type errors (int passed as char*)?
  - All functions complete?
      │
   pass ──▶ Show output  ● green
      │
   fail ──▶ Retry with failure reason injected
            (up to 2 retries, configurable)
              │
              ▼
           Show best result  ● amber
```

---

## Project Structure

```
c-code-assistant/
├── index.html         ← App UI
├── server.py          ← Flask backend + Ollama proxy
├── start.bat          ← Windows launcher
├── start.sh           ← Linux/macOS launcher
├── LICENSE
├── README.md
├── .gitignore
├── css/
│   └── style.css      ← All styles
└── js/
    ├── config.js      ← Settings & model switcher
    ├── api.js         ← Ollama proxy calls + quality retry
    ├── app.js         ← Main controller
    ├── compiler.js    ← GCC compile & run
    ├── linter.js      ← Live linting
    ├── editor.js      ← Code editor (line nums, tab, indent)
    ├── output.js      ← C syntax highlighter + renderer
    └── history.js     ← Session history
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Enter` | Run |
| `Ctrl+L` | Clear editor |
| `Ctrl+S` | Export as `.c` file |
| `Tab` | Indent 4 spaces |
| `Shift+Tab` | De-indent |

---

## Troubleshooting

**Ollama shows offline**
- Make sure Ollama is running: `ollama serve`
- The app auto-retries every 12 seconds

**Model not found in dropdown**
- Pull it: `ollama pull <model-name>`
- Or select a model you already have

**Compile & Run not working**
- Install GCC and add it to PATH
- Test with: `gcc --version` in a terminal

**Output has bugs / wrong code**
- Try a larger model (`qwen2.5-coder:7b`)
- Lower temperature to `0.1` in settings
- Increase max retries to `3` in settings

---

## Acknowledgements

- [Ollama](https://ollama.com) — local LLM runtime
- [Qwen2.5-Coder](https://huggingface.co/Qwen) — by Alibaba Cloud
- [DeepSeek-Coder](https://github.com/deepseek-ai/DeepSeek-Coder) — by DeepSeek AI
- [Flask](https://flask.palletsprojects.com) — Python web framework
- [cppcheck](https://cppcheck.sourceforge.io) — C/C++ static analysis
- [IBM Plex Mono](https://fonts.google.com/specimen/IBM+Plex+Mono) — editor font

---

## License

MIT — see [LICENSE](LICENSE)
