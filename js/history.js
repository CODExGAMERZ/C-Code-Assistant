/* ═══════════════════════════════════════════════
   history.js — Session history with localStorage
═══════════════════════════════════════════════ */

const History = (() => {
  const MAX   = 60;
  const KEY   = 'c_assistant_history';
  let _items  = [];

  function load() {
    try {
      _items = JSON.parse(localStorage.getItem(KEY) || '[]');
    } catch { _items = []; }
    _render();
    _updateStat();
  }

  function push({ mode, input, output, quality, timestamp }) {
    _items.unshift({
      id: Date.now(),
      mode,
      input:     (input  || '').slice(0, 2000),
      output:    (output || '').slice(0, 4000),
      quality:   quality || 'unknown',
      timestamp: timestamp || Date.now(),
    });
    if (_items.length > MAX) _items = _items.slice(0, MAX);
    try { localStorage.setItem(KEY, JSON.stringify(_items)); } catch {}
    _render();
    _updateStat();
  }

  function clear() {
    if (!confirm('Clear all history?')) return;
    _items = [];
    try { localStorage.removeItem(KEY); } catch {}
    _render();
    _updateStat();
    UI.toast('History cleared', 'warn');
  }

  function _render() {
    const list = document.getElementById('history-list');
    if (!list) return;

    if (!_items.length) {
      list.innerHTML = '<div style="color:var(--muted);font-family:var(--font-mono);font-size:11px;padding:16px;text-align:center;">No history yet</div>';
      return;
    }

    list.innerHTML = _items.map(item => {
      const preview = (item.input || '').replace(/\s+/g, ' ').trim().slice(0, 55);
      const date    = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const qColor  = item.quality === 'pass' ? 'var(--green)' : item.quality === 'fail' ? 'var(--amber)' : 'var(--muted)';
      return `
        <div class="history-item" onclick="History.restore(${item.id})">
          <div class="history-item-mode">${item.mode}</div>
          <div class="history-item-preview">${escHtml(preview)}…</div>
          <div class="history-item-meta">
            <span>${date}</span>
            <span style="color:${qColor};font-size:9px;">● ${item.quality}</span>
          </div>
        </div>`;
    }).join('');
  }

  function restore(id) {
    const item = _items.find(i => i.id === id);
    if (!item) return;
    App.setMode(item.mode);
    const ta = document.getElementById('code-input');
    ta.value = item.input;
    Editor.updateLineNumbers();
    Output.render(item.output);
    UI.toast('History item restored', 'info');
    UI.closeHistory();
  }

  function _updateStat() {
    const el = document.getElementById('stat-history');
    if (el) el.textContent = _items.length;
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;');
  }

  return { load, push, clear, restore };
})();
