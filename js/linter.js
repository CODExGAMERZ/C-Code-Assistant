/* linter.js — Code lint via backend, skips non-C modes */

const Linter = (() => {
  let _issues   = [];
  let _debounce = null;

  // Modes where input is C code (linting makes sense)
  const C_CODE_MODES = ['complete', 'fix', 'optimize', 'explain'];

  // Rough check: does this text look like C code?
  function _looksLikeC(text) {
    const trimmed = text.trim();
    return /^(#include|#define|\/\/|\/\*|int |void |char |float |double |struct |typedef |extern |static )/.test(trimmed)
        || /[{};]\s*$/.test(trimmed)
        || trimmed.includes('#include')
        || trimmed.includes('int main');
  }

  async function run() {
    const code = Editor.getValue();
    if (!code) { UI.toast('No code to lint', 'warn'); return; }
    if (!_looksLikeC(code)) {
      UI.toast('Lint skipped — input does not look like C code', 'info');
      return;
    }
    UI.toast('Linting…', 'info');
    await _fetchAndRender(code);
  }

  function scheduleAuto() {
    clearTimeout(_debounce);
    _debounce = setTimeout(() => {
      const mode = App.currentMode();
      // Only auto-lint in C code modes
      if (!C_CODE_MODES.includes(mode)) {
        _clear();
        return;
      }
      const code = Editor.getValue();
      if (code.length > 10 && _looksLikeC(code)) {
        _fetchAndRender(code);
      } else {
        _clear();
      }
    }, 1500);
  }

  async function _fetchAndRender(code) {
    try {
      const resp = await API.backendFetch('/api/lint', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ code }),
      });
      if (!resp.ok) throw new Error('Lint HTTP ' + resp.status);
      const data = await resp.json();
      _issues = data.issues || [];
      _renderBar();
      _renderOverlay();
    } catch (e) {
      console.warn('Lint error:', e.message);
    }
  }

  function _renderBar() {
    const bar      = document.getElementById('lint-bar');
    const summary  = document.getElementById('lint-summary');
    const issuesEl = document.getElementById('lint-issues');
    if (!_issues.length) { bar?.classList.add('hidden'); return; }

    bar?.classList.remove('hidden');

    const errors   = _issues.filter(i => i.severity === 'error').length;
    const warnings = _issues.filter(i => i.severity === 'warning').length;
    const notes    = _issues.length - errors - warnings;
    const parts    = [];
    if (errors)   parts.push('<span style="color:var(--red)">'   + errors   + ' error'   + (errors   > 1 ? 's' : '') + '</span>');
    if (warnings) parts.push('<span style="color:var(--amber)">' + warnings + ' warning' + (warnings > 1 ? 's' : '') + '</span>');
    if (notes)    parts.push('<span style="color:var(--cyan)">'  + notes    + ' note'    + (notes    > 1 ? 's' : '') + '</span>');

    if (summary)  summary.innerHTML  = '🔍 ' + parts.join(' · ');
    if (issuesEl) issuesEl.innerHTML = _issues.slice(0, 12).map(i =>
      '<div class="lint-issue">'
      + '<span class="lint-sev sev-' + i.severity + '">' + i.severity + '</span>'
      + '<span class="lint-line">L' + i.line + '</span>'
      + '<span class="lint-msg">'   + _esc(i.message) + '</span>'
      + '</div>'
    ).join('');
  }

  function _renderOverlay() {
    const overlay = document.getElementById('lint-overlay');
    const ta      = document.getElementById('code-input');
    if (!overlay || !ta) return;
    overlay.innerHTML = '';
    if (!_issues.length) return;
    const lineH  = parseFloat(getComputedStyle(ta).lineHeight) || 21.25;
    const padTop = parseFloat(getComputedStyle(ta).paddingTop)  || 14;
    _issues.forEach(issue => {
      if (!issue.line || issue.line < 1) return;
      const el = document.createElement('div');
      el.className = 'lint-squiggle ' + issue.severity;
      el.style.top = (padTop + (issue.line - 1) * lineH) + 'px';
      el.title     = '[' + issue.severity + '] ' + issue.message;
      overlay.appendChild(el);
    });
  }

  function _clear() {
    _issues = [];
    document.getElementById('lint-bar')?.classList.add('hidden');
    const o = document.getElementById('lint-overlay');
    if (o) o.innerHTML = '';
  }

  function _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return { run, scheduleAuto };
})();
