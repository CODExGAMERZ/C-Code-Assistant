/* api.js — All Ollama calls go through the Flask proxy at /api/ollama/* */

const API = (() => {

  let _abort = null;

  // ── Mode prompts ──────────────────────────────────────────────────────────

  const MODE_PROMPTS = {
    complete: (code) => ({
      system: `You are a senior C programmer. Complete the given partial C code.
STRICT RULES:
1. Output ONLY a single \`\`\`c ... \`\`\` fenced block — nothing else before it.
2. The block must contain the FULL compilable program, keeping all original lines.
3. All variables must be declared and properly used — no type mismatches.
4. Use snprintf/sprintf correctly — never pass an int where char* is expected.
5. All #include headers must be present.
6. No TODO, no placeholder, no "..." — every function must be fully implemented.
7. Must compile with: gcc -Wall -Wextra -std=c11 with ZERO errors.`,
      user: `Complete this C code (output ONLY the fenced code block):\n\`\`\`c\n${code}\n\`\`\``
    }),
    generate: (desc) => ({
      system: `You are a senior C programmer. Generate correct, complete, well-commented C code.
STRICT RULES:
1. Output a SINGLE \`\`\`c ... \`\`\` fenced block followed by a brief explanation.
2. Every function must be fully implemented — no stubs, no TODO, no "...".
3. Include every required #include.
4. Type correctness is MANDATORY — never pass int where char* is needed.
5. The code must compile with: gcc -Wall -Wextra -std=c11 with ZERO errors.`,
      user: `Generate C code for: ${desc}`
    }),
    explain: (code) => ({
      system: `You are an expert C programming teacher.
Explain what the code does, how each part works, any bugs or issues,
memory management, and edge cases. Be specific about C types and semantics.`,
      user: `Explain this C code:\n\`\`\`c\n${code}\n\`\`\``
    }),
    fix: (code) => ({
      system: `You are an expert C debugger.
1. List EVERY bug with: line number, bug type, explanation.
2. Output the FULLY corrected code in a single \`\`\`c ... \`\`\` block.
3. Fix ALL: type errors, pointer misuse, memory leaks, off-by-one, UB.
4. Corrected code must compile with: gcc -Wall -Wextra -std=c11 ZERO errors.`,
      user: `Find and fix ALL bugs:\n\`\`\`c\n${code}\n\`\`\``
    }),
    optimize: (code) => ({
      system: `You are a C performance engineer.
List optimizations, then provide improved code in a \`\`\`c block.
Explain time/space complexity improvements.`,
      user: `Optimize:\n\`\`\`c\n${code}\n\`\`\``
    }),
  };

  // ── Quality check prompt ──────────────────────────────────────────────────

  function _qualityPrompt(mode, input, output) {
    const isCode = ['complete','generate','fix','optimize'].includes(mode);
    return {
      system: `You are a meticulous C code reviewer. Respond ONLY with a single JSON object — no prose, no markdown.
Format: {"pass":true/false,"reason":"specific issue if failing","suggestion":"exact fix needed"}
${isCode ? `PASS only if: contains a \`\`\`c fenced block, no unresolved TODO/FIXME, no obvious type errors, every function is complete.` : `PASS if: non-empty, relevant, not just repeating the input.`}
ALWAYS fail if: output is empty, is just an apology, or repeats input unchanged.`,
      user: `Mode: ${mode}\nInput: ${input.slice(0,400)}\nOutput: ${output.slice(0,900)}\nJSON:`
    };
  }

  // ── Fetch with timeout ────────────────────────────────────────────────────

  function _fetchTimeout(url, opts, ms) {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms || 8000);
    return fetch(url, Object.assign({}, opts, { signal: ctrl.signal }))
      .finally(() => clearTimeout(timer));
  }

  // ── Proxy base URL (always same origin — no CORS needed) ─────────────────

  function _proxyBase() {
    // Always use same-origin proxy — never talk to Ollama directly
    return '';
  }

  // ── Streaming chat via proxy ──────────────────────────────────────────────

  async function _streamCall(system, user, onChunk) {
    const model = Config.get('model');
    const temp  = parseFloat(Config.get('temperature')) || 0.3;

    const resp = await fetch(_proxyBase() + '/api/ollama/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  _abort ? _abort.signal : undefined,
      body: JSON.stringify({
        model,
        stream:  true,
        options: {
          temperature:    temp,
          repeat_penalty: 1.18,
          repeat_last_n:  128,
          num_predict:    2048,
        },
        messages: [
          { role: 'system', content: system },
          { role: 'user',   content: user   },
        ],
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText }));
      throw new Error(err.error || 'Proxy error ' + resp.status);
    }

    const reader  = resp.body.getReader();
    const decoder = new TextDecoder();
    let   full    = '';
    let   buf     = 0;

    function isLooping(text) {
      if (text.length < 90) return 0;
      const tail = text.slice(-500);
      for (let len = 15; len <= 130; len++) {
        if (tail.length < len * 3) continue;
        const c = tail.slice(-len), b = tail.slice(-(len*2),-len), a = tail.slice(-(len*3),-(len*2));
        if (c === b && b === a) return len;
      }
      return 0;
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const line of decoder.decode(value, { stream: true }).split('\n')) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          const tok = (obj.message && obj.message.content) || obj.response || '';
          if (tok) {
            full += tok; buf++;
            const lw = isLooping(full);
            if (lw) {
              full = full.slice(0, -(lw * 2)) + '\n\n[⚠ Stopped: repetition loop detected]';
              onChunk(full); return full;
            }
            if (buf >= 8) { onChunk(full); buf = 0; }
          }
          if (obj.done) { onChunk(full); return full; }
        } catch (_) {}
      }
    }
    onChunk(full);
    return full;
  }

  // ── Non-streaming for quality check ──────────────────────────────────────

  async function _quickCall(system, user) {
    const resp = await _fetchTimeout(_proxyBase() + '/api/ollama/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:   Config.get('model'),
        stream:  false,
        options: { temperature: 0.05 },
        messages: [
          { role: 'system', content: system },
          { role: 'user',   content: user   },
        ],
      }),
    }, 45000);
    if (!resp.ok) throw new Error('Quality check HTTP ' + resp.status);
    const data = await resp.json();
    return (data.message && data.message.content) || data.response || '';
  }

  // ── Quality gate ──────────────────────────────────────────────────────────

  async function _checkQuality(mode, input, output) {
    try {
      const { system, user } = _qualityPrompt(mode, input, output);
      const raw   = await _quickCall(system, user);
      const clean = raw.replace(/```[^`]*```/gs, '').replace(/```/g, '').trim();
      const match = clean.match(/\{[\s\S]*?\}/);
      if (!match) return { pass: true, reason: 'parse-fail' };
      const r = JSON.parse(match[0]);
      return { pass: !!r.pass, reason: r.reason || '', suggestion: r.suggestion || '' };
    } catch (e) {
      return { pass: true, reason: 'check-skipped: ' + e.message };
    }
  }

  // ── Backend fetch (same origin) ───────────────────────────────────────────

  async function backendFetch(path, opts) {
    return _fetchTimeout(path, opts, 20000);
  }

  // ── Public run with quality-retry ─────────────────────────────────────────

  async function run(mode, input, callbacks) {
    const onChunk = callbacks.onChunk || function(){};
    const onRetry = callbacks.onRetry || function(){};
    const onDone  = callbacks.onDone  || function(){};
    const onError = callbacks.onError || function(){};

    if (_abort) { try { _abort.abort(); } catch(_){} }
    _abort = new AbortController();

    const maxRetries = parseInt(Config.get('maxRetries')) || 2;
    const promptFn   = MODE_PROMPTS[mode];
    if (!promptFn) { onError('Unknown mode: ' + mode); return; }

    const { system, user: baseUser } = promptFn(input);
    let attempt = 0, lastOutput = '', qualityResult = { pass: false, suggestion: '' };
    let retryUsed = 0;

    while (attempt <= maxRetries) {
      try {
        const userPrompt = attempt === 0 ? baseUser
          : baseUser + '\n\n[Previous attempt failed: ' + (qualityResult.suggestion || qualityResult.reason)
            + '. Please fix and retry.]';

        lastOutput = await _streamCall(system, userPrompt, p => onChunk(p, attempt));

        onRetry(attempt, maxRetries, 'checking');
        qualityResult = await _checkQuality(mode, input, lastOutput);

        if (qualityResult.pass) {
          onDone(lastOutput, { pass: true, attempts: attempt + 1 });
          _setStat('stat-retries', retryUsed);
          return;
        }

        attempt++; retryUsed++;
        _setStat('stat-retries', retryUsed);
        if (attempt > maxRetries) break;
        onRetry(attempt, maxRetries, 'retrying');

      } catch (e) {
        if (e.name === 'AbortError') return;
        onError(e.message || String(e));
        return;
      }
    }

    onDone(lastOutput, { pass: false, attempts: attempt, reason: qualityResult.reason });
    _setStat('stat-retries', retryUsed);
  }

  function _setStat(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function abort() {
    if (_abort) { try { _abort.abort(); } catch(_){} _abort = null; }
  }

  // ── Connection checks (via proxy — no direct Ollama contact) ─────────────

  async function checkOllama() {
    try {
      const r = await _fetchTimeout('/api/ollama/tags', { method: 'GET' }, 5000);
      if (!r.ok) return { ok: false, reason: 'HTTP ' + r.status };
      const data = await r.json();
      if (data.error) return { ok: false, reason: data.error };
      return { ok: true, models: (data.models || []).map(m => m.name) };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }

  async function checkBackend() {
    try {
      const r = await _fetchTimeout('/api/health', { method: 'GET' }, 5000);
      if (!r.ok) return { ok: false, reason: 'HTTP ' + r.status };
      return await r.json();
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }

  return { run, abort, checkOllama, checkBackend, backendFetch };
})();
