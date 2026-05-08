/* compiler.js — GCC compile & run via backend */

const Compiler = (() => {

  function _getCode() {
    const editorCode = Editor.getValue();
    if (editorCode) return editorCode;
    const pre = document.querySelector('#output-content .code-block pre');
    return pre ? pre.innerText : '';
  }

  async function run() {
    const code = _getCode();
    if (!code) { UI.toast('No C code to compile', 'warn'); return; }

    const stdin  = (document.getElementById('stdin-input')?.value || '').trim();
    const flags  = Config.get('gccFlags');
    const badge  = document.getElementById('compile-badge');
    const outEl  = document.getElementById('compile-output');
    const body   = document.getElementById('compile-body');

    outEl.classList.remove('hidden');
    if (badge) badge.classList.remove('hidden');
    body.innerHTML = `<div class="compile-info"><span class="spinner"></span>Compiling…</div>`;

    try {
      const resp = await API.backendFetch('/api/compile', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ code, stdin, flags }),
      });
      const data = await resp.json();
      if (badge) badge.classList.add('hidden');
      _render(data, body);
    } catch (e) {
      if (badge) badge.classList.add('hidden');
      body.innerHTML = `<div class="compile-err">Cannot reach backend: ${_esc(e.message)}</div>
        <div class="compile-info" style="margin-top:6px;font-size:11px">
          Make sure you opened the app via <strong>http://localhost:5050</strong> (not as a file://)
        </div>`;
      UI.toast('Backend error: ' + e.message, 'error');
    }
  }

  function _render(data, container) {
    let html = '';
    if (!data.ok) {
      html += `<div class="compile-err" style="font-weight:700">✗ ${data.stage === 'compile' ? 'Compilation Error' : 'Runtime Error'}</div>`;
      if (data.stderr) html += `<div class="compile-label">GCC Output</div><div class="compile-err" style="white-space:pre-wrap">${_esc(data.stderr)}</div>`;
      if (data.stdout) html += `<div class="compile-label">stdout</div><div class="compile-info" style="white-space:pre-wrap">${_esc(data.stdout)}</div>`;
      if (data.error)  html += `<div class="compile-err">${_esc(data.error)}</div>`;
    } else {
      html += `<div class="compile-ok" style="font-weight:700">✓ Compiled & ran successfully</div>`;
      if (data.compile_warnings)
        html += `<div class="compile-label">Warnings</div><div class="compile-warn" style="white-space:pre-wrap">${_esc(data.compile_warnings)}</div>`;
      html += `<div class="compile-label">Output</div>`;
      html += data.stdout
        ? `<div class="compile-info" style="white-space:pre-wrap">${_esc(data.stdout)}</div>`
        : `<div style="color:var(--muted);font-style:italic;font-size:11px">(no output)</div>`;
      if (data.stderr)
        html += `<div class="compile-label">stderr</div><div class="compile-warn" style="white-space:pre-wrap">${_esc(data.stderr)}</div>`;
      const c = data.returncode ?? '?';
      html += `<span class="exit-code" style="color:${c===0?'var(--green)':'var(--amber)'}">exit: ${c}</span>`;
    }
    container.innerHTML = html;
  }

  function clear() {
    document.getElementById('compile-output')?.classList.add('hidden');
  }

  function _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return { run, clear };
})();
