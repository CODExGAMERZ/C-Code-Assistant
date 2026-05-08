/* output.js — Output rendering & C syntax highlighting (single-pass tokenizer) */

const Output = (() => {

  let _lastRaw   = '';
  let _charCount = 0;

  // ══════════════════════════════════════════════════════════════════════════
  // Single-pass C tokenizer — no placeholder system, no leaks possible.
  // Walks source left-to-right, emits HTML spans directly.
  // ══════════════════════════════════════════════════════════════════════════

  const KEYWORDS = new Set([
    'auto','break','case','char','const','continue','default','do','double',
    'else','enum','extern','float','for','goto','if','inline','int','long',
    'register','restrict','return','short','signed','sizeof','static','struct',
    'switch','typedef','union','unsigned','void','volatile','while',
    'NULL','true','false','_Bool','_Complex','_Imaginary','nullptr'
  ]);

  const TYPES = new Set([
    'size_t','ssize_t','ptrdiff_t','wchar_t','va_list','FILE','time_t',
    'uint8_t','uint16_t','uint32_t','uint64_t',
    'int8_t', 'int16_t', 'int32_t', 'int64_t',
    'uintptr_t','intptr_t','clock_t'
  ]);

  function _esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function _span(cls, text) {
    return '<span class="' + cls + '">' + text + '</span>';
  }

  function _highlightC(src) {
    let out = '';
    let i   = 0;
    const n = src.length;

    while (i < n) {
      const ch   = src[i];
      const ch2  = src[i + 1] || '';

      // ── Block comment /* ... */ ─────────────────────────────────────────
      if (ch === '/' && ch2 === '*') {
        let j = i + 2;
        while (j < n - 1 && !(src[j] === '*' && src[j+1] === '/')) j++;
        j += 2;
        out += _span('tk-cmt', _esc(src.slice(i, j)));
        i = j;
        continue;
      }

      // ── Line comment // ... ─────────────────────────────────────────────
      if (ch === '/' && ch2 === '/') {
        let j = i;
        while (j < n && src[j] !== '\n') j++;
        out += _span('tk-cmt', _esc(src.slice(i, j)));
        i = j;
        continue;
      }

      // ── Preprocessor directive #... ─────────────────────────────────────
      if (ch === '#') {
        let j = i;
        while (j < n) {
          if (src[j] === '\n' && src[j-1] !== '\\') break;
          j++;
        }
        out += _span('tk-pp', _esc(src.slice(i, j)));
        i = j;
        continue;
      }

      // ── String literal "..." ────────────────────────────────────────────
      if (ch === '"') {
        let j = i + 1;
        while (j < n) {
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === '"')  { j++;     break;   }
          j++;
        }
        out += _span('tk-str', _esc(src.slice(i, j)));
        i = j;
        continue;
      }

      // ── Char literal '.' ────────────────────────────────────────────────
      if (ch === "'") {
        let j = i + 1;
        while (j < n) {
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === "'")  { j++;     break;   }
          j++;
        }
        out += _span('tk-str', _esc(src.slice(i, j)));
        i = j;
        continue;
      }

      // ── Hex / binary / decimal number ───────────────────────────────────
      if (
        (ch >= '0' && ch <= '9') ||
        (ch === '.' && ch2 >= '0' && ch2 <= '9')
      ) {
        let j = i;
        if (ch === '0' && (ch2 === 'x' || ch2 === 'X')) {
          j += 2;
          while (j < n && /[0-9a-fA-F]/.test(src[j])) j++;
        } else if (ch === '0' && (ch2 === 'b' || ch2 === 'B')) {
          j += 2;
          while (j < n && (src[j] === '0' || src[j] === '1')) j++;
        } else {
          while (j < n && /[0-9]/.test(src[j])) j++;
          if (j < n && src[j] === '.') { j++; while (j < n && /[0-9]/.test(src[j])) j++; }
          if (j < n && (src[j] === 'e' || src[j] === 'E')) {
            j++;
            if (j < n && (src[j] === '+' || src[j] === '-')) j++;
            while (j < n && /[0-9]/.test(src[j])) j++;
          }
        }
        // suffix (f, l, u, etc.)
        while (j < n && /[fFlLuU]/.test(src[j])) j++;
        out += _span('tk-num', _esc(src.slice(i, j)));
        i = j;
        continue;
      }

      // ── Identifier: keyword / type / function / plain ───────────────────
      if (/[a-zA-Z_]/.test(ch)) {
        let j = i;
        while (j < n && /[a-zA-Z0-9_]/.test(src[j])) j++;
        const word = src.slice(i, j);
        // peek past whitespace to see if '(' follows → function call
        let k = j;
        while (k < n && (src[k] === ' ' || src[k] === '\t')) k++;
        const isFn = src[k] === '(';

        if (KEYWORDS.has(word)) {
          out += _span('tk-kw', _esc(word));
        } else if (TYPES.has(word)) {
          out += _span('tk-type', _esc(word));
        } else if (isFn) {
          out += _span('tk-fn', _esc(word));
        } else {
          out += _esc(word);
        }
        i = j;
        continue;
      }

      // ── Everything else (operators, whitespace, punctuation) ─────────────
      out += _esc(ch);
      i++;
    }

    return out;
  }

  // ── Markdown renderer ─────────────────────────────────────────────────────

  function _renderMarkdown(raw, highlight) {

    const FENCE = /```([\w]*)\n?([\s\S]*?)```/g;
    let   html  = '';
    let   last  = 0;
    let   match;

    while ((match = FENCE.exec(raw)) !== null) {
      const before = raw.slice(last, match.index);
      if (before.trim()) html += _renderText(before);

      const lang = (match[1] || 'c').toLowerCase().trim();
      const code = match[2].trimEnd();
      const body = (highlight && (lang === 'c' || lang === ''))
        ? _highlightC(code)
        : _esc(code);

      html += '<div class="code-block">'
            +   '<div class="code-block-hdr">'
            +     '<span class="code-block-lang">' + (lang || 'c') + '</span>'
            +     '<button class="copy-code-btn" onclick="Output._copyBlock(this)">copy</button>'
            +   '</div>'
            +   '<pre>' + body + '</pre>'
            + '</div>';

      last = match.index + match[0].length;
    }

    const tail = raw.slice(last);
    if (tail) {
      // Detect unclosed fence during streaming
      const unclosed = tail.match(/^```([\w]*)\n?([\s\S]*)$/);
      if (unclosed) {
        html += '<div class="code-block">'
              +   '<div class="code-block-hdr">'
              +     '<span class="code-block-lang">c</span>'
              +     '<span style="color:var(--muted);font-size:9px;margin-left:auto">streaming…</span>'
              +   '</div>'
              +   '<pre>' + _esc(unclosed[2]) + '</pre>'
              + '</div>';
      } else if (tail.trim()) {
        html += _renderText(tail);
      }
    }

    return html;
  }

  function _renderText(text) {
    const escaped = _esc(text)
      .replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--text)">$1</strong>')
      .replace(/`([^`\n]+)`/g,
        '<code style="background:var(--bg3);padding:1px 5px;border-radius:3px;'
        + 'font-family:var(--font-mono);font-size:11px;color:var(--cyan)">$1</code>');

    let html = '';
    for (const para of escaped.split(/\n{2,}/)) {
      const lines = para.split('\n').filter(l => l.trim());
      if (!lines.length) continue;
      if (lines.every(l => /^[-•*]\s/.test(l.trim()))) {
        html += '<ul style="margin:6px 0 6px 18px;color:var(--text2)">'
          + lines.map(l =>
              '<li style="margin:2px 0;font-family:var(--font-mono);font-size:12px">'
              + l.trim().replace(/^[-•*]\s/, '') + '</li>').join('')
          + '</ul>';
      } else {
        html += '<div class="out-text">' + lines.join('\n') + '</div>';
      }
    }
    return html;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  // Streaming: no syntax highlighting — prevents any possible leak
  function render(raw, withCursor) {
    _lastRaw   = raw;
    _charCount = raw.length;

    const placeholder = document.getElementById('output-placeholder');
    const content     = document.getElementById('output-content');
    const tc          = document.getElementById('token-count');

    if (placeholder) placeholder.classList.add('hidden');
    if (content) {
      content.classList.remove('hidden');
      content.innerHTML = _renderMarkdown(raw, false)
        + (withCursor ? '<span class="blink-cursor"></span>' : '');
      const body = document.getElementById('output-body');
      if (body) body.scrollTop = body.scrollHeight;
    }
    if (tc) tc.textContent = '~' + Math.round(_charCount / 4) + ' tok';
  }

  // Final: full syntax highlighting on the complete output
  function finalize(raw, quality) {
    _lastRaw   = raw;
    _charCount = raw.length;

    const placeholder = document.getElementById('output-placeholder');
    const content     = document.getElementById('output-content');
    const tc          = document.getElementById('token-count');

    if (placeholder) placeholder.classList.add('hidden');
    if (content) {
      content.classList.remove('hidden');
      content.innerHTML = _renderMarkdown(raw, true);
    }
    if (tc) tc.textContent = '~' + Math.round(_charCount / 4) + ' tok';

    const qi = document.getElementById('quality-indicator');
    if (qi) {
      qi.classList.remove('hidden', 'pass', 'fail');
      qi.classList.add(quality.pass ? 'pass' : 'fail');
      qi.title = quality.pass
        ? 'Quality: PASS (' + quality.attempts + ' attempt' + (quality.attempts > 1 ? 's' : '') + ')'
        : 'Best effort after ' + quality.attempts + ' attempt(s) — ' + quality.reason;
    }

    const body = document.getElementById('output-body');
    if (body) body.scrollTop = 0;
  }

  function clear() {
    _lastRaw = ''; _charCount = 0;
    document.getElementById('output-placeholder')?.classList.remove('hidden');
    const c = document.getElementById('output-content');
    if (c) { c.classList.add('hidden'); c.innerHTML = ''; }
    document.getElementById('quality-indicator')?.classList.add('hidden');
    const tc = document.getElementById('token-count');
    if (tc) tc.textContent = '';
  }

  function copy() {
    if (!_lastRaw) { UI.toast('Nothing to copy', 'warn'); return; }
    navigator.clipboard.writeText(_lastRaw)
      .then(() => UI.toast('Copied to clipboard', 'ok'))
      .catch(() => UI.toast('Copy failed', 'error'));
  }

  function getRaw() { return _lastRaw; }

  function _copyBlock(btn) {
    const pre = btn.closest('.code-block')?.querySelector('pre');
    if (!pre) return;
    navigator.clipboard.writeText(pre.innerText).then(() => {
      btn.textContent = '✓ copied';
      setTimeout(() => btn.textContent = 'copy', 1600);
    });
  }

  return { render, finalize, clear, copy, getRaw, _copyBlock };
})();
