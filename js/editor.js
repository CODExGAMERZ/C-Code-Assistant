/* ═══════════════════════════════════════════════
   editor.js — Code editor: line numbers, tab, samples
═══════════════════════════════════════════════ */

const Editor = (() => {

  const SAMPLES = {
    complete: `#include <stdio.h>
#include <stdlib.h>

// TODO: implement a function to reverse a string in-place
void reverse_string(char *str) {
    // complete this`,

    generate: `Write a C program that:
1. Reads N integers from stdin
2. Finds the maximum, minimum, and average
3. Prints results formatted neatly`,

    explain: `#include <stdio.h>
#include <string.h>

int kmp_search(const char *text, const char *pattern) {
    int n = strlen(text), m = strlen(pattern);
    int lps[m], len = 0, i = 1;
    lps[0] = 0;
    while (i < m) {
        if (pattern[i] == pattern[len]) lps[i++] = ++len;
        else if (len) len = lps[len-1];
        else lps[i++] = 0;
    }
    i = 0; int j = 0;
    while (i < n) {
        if (text[i] == pattern[j]) { i++; j++; }
        if (j == m) return i - j;
        else if (i < n && text[i] != pattern[j]) {
            if (j) j = lps[j-1]; else i++;
        }
    }
    return -1;
}`,

    fix: `#include <stdio.h>
#include <stdlib.h>

int* create_array(int n) {
    int arr[n];              // bug: returning stack memory
    for(int i=0; i<=n; i++) // bug: off-by-one
        arr[i] = i * 2;
    return arr;              // undefined behavior
}

int main() {
    int *a = create_array(5);
    for(int i=0; i<5; i++)
        printf("%d ", a[i]);
    // bug: no free
}`,

    optimize: `#include <string.h>

// Naive string matching - O(n*m)
int count_occurrences(const char *text, const char *pattern) {
    int count = 0, n = strlen(text), m = strlen(pattern);
    for (int i = 0; i <= n - m; i++) {
        int match = 1;
        for (int j = 0; j < m; j++) {
            if (text[i+j] != pattern[j]) { match = 0; break; }
        }
        if (match) count++;
    }
    return count;
}`,
  };

  function init() {
    const ta = document.getElementById('code-input');
    if (!ta) return;

    ta.addEventListener('input',   updateLineNumbers);
    ta.addEventListener('scroll',  syncScroll);
    ta.addEventListener('keydown', _handleKeydown);

    updateLineNumbers();
  }

  function updateLineNumbers() {
    const ta   = document.getElementById('code-input');
    const lnEl = document.getElementById('line-numbers');
    if (!ta || !lnEl) return;

    const lines = ta.value.split('\n').length;
    const nums  = Array.from({ length: lines }, (_, i) =>
      `<span>${i + 1}</span>`
    ).join('');
    lnEl.innerHTML = nums;
    syncScroll();
  }

  function syncScroll() {
    const ta   = document.getElementById('code-input');
    const lnEl = document.getElementById('line-numbers');
    if (ta && lnEl) lnEl.scrollTop = ta.scrollTop;
  }

  function _handleKeydown(e) {
    const ta = e.target;

    // Tab → 4 spaces
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = ta.selectionStart, end = ta.selectionEnd;
      const indent = '    ';

      if (s === end) {
        ta.value = ta.value.slice(0, s) + indent + ta.value.slice(end);
        ta.selectionStart = ta.selectionEnd = s + 4;
      } else {
        // indent selected lines
        const lines = ta.value.split('\n');
        let pos = 0, startLine = -1, endLine = -1;
        for (let i = 0; i < lines.length; i++) {
          if (pos + lines[i].length >= s && startLine === -1) startLine = i;
          if (pos + lines[i].length >= end - 1) { endLine = i; break; }
          pos += lines[i].length + 1;
        }
        if (e.shiftKey) {
          for (let i = startLine; i <= endLine; i++)
            if (lines[i].startsWith('    ')) lines[i] = lines[i].slice(4);
        } else {
          for (let i = startLine; i <= endLine; i++) lines[i] = indent + lines[i];
        }
        ta.value = lines.join('\n');
      }
      updateLineNumbers();
      return;
    }

    // Auto-close brackets
    const pairs = { '(': ')', '{': '}', '[': ']', '"': '"', "'": "'" };
    if (pairs[e.key] && !e.ctrlKey && !e.metaKey) {
      const s = ta.selectionStart, end = ta.selectionEnd;
      if (s === end) {
        e.preventDefault();
        const close = pairs[e.key];
        ta.value = ta.value.slice(0, s) + e.key + close + ta.value.slice(end);
        ta.selectionStart = ta.selectionEnd = s + 1;
        updateLineNumbers();
        return;
      }
    }

    // Enter: auto-indent
    if (e.key === 'Enter' && !e.ctrlKey) {
      const s   = ta.selectionStart;
      const line = ta.value.slice(0, s).split('\n').pop();
      const indent = line.match(/^(\s*)/)[1];
      const extraIndent = line.trimEnd().endsWith('{') ? '    ' : '';
      e.preventDefault();
      const ins = '\n' + indent + extraIndent;
      ta.value = ta.value.slice(0, s) + ins + ta.value.slice(ta.selectionEnd);
      ta.selectionStart = ta.selectionEnd = s + ins.length;
      updateLineNumbers();
      return;
    }

    // Ctrl+Enter → run
    if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); App.run(); }
    // Ctrl+L → clear
    if (e.ctrlKey && e.key === 'l')     { e.preventDefault(); clear(); }
    // Ctrl+S → export
    if (e.ctrlKey && e.key === 's')     { e.preventDefault(); Exporter.toC(); }
  }

  function clear() {
    const ta = document.getElementById('code-input');
    ta.value = '';
    updateLineNumbers();
    ta.focus();
  }

  function getValue() {
    return (document.getElementById('code-input')?.value || '').trim();
  }

  function setValue(code) {
    const ta = document.getElementById('code-input');
    if (ta) { ta.value = code; updateLineNumbers(); }
  }

  function loadSample() {
    const mode = App.currentMode();
    setValue(SAMPLES[mode] || SAMPLES.complete);
  }

  return { init, updateLineNumbers, syncScroll, clear, getValue, setValue, loadSample };
})();
