/* config.js — Configuration, persistence, ModelSwitcher */

const Config = (() => {
  const DEFAULTS = {
    ollamaUrl:   'http://localhost:11434',
    model:       'qwen2.5-coder:1.5b',
    backendUrl:  '',
    temperature: 0.3,
    maxRetries:  2,
    gccFlags:    '-Wall -Wextra -std=c11',
  };

  let _cfg = { ...DEFAULTS };

  function load() {
    try {
      const saved = localStorage.getItem('c_assistant_cfg');
      if (saved) _cfg = { ...DEFAULTS, ...JSON.parse(saved) };
    } catch {}
    _applyToDOM();
    // Auto-fetch installed models after a short delay
    // (gives DOM time to settle)
    setTimeout(ModelSwitcher.fetchInstalled, 300);
  }

  function save() {
    _cfg = {
      ollamaUrl:   (document.getElementById('cfg-ollama-url')?.value  || '').trim() || DEFAULTS.ollamaUrl,
      model:       _cfg.model, // model is set via switcher only
      backendUrl:  (document.getElementById('cfg-backend-url')?.value || '').trim(),
      temperature: parseFloat(document.getElementById('cfg-temp')?.value)  || DEFAULTS.temperature,
      maxRetries:  parseInt(document.getElementById('cfg-retries')?.value) || DEFAULTS.maxRetries,
      gccFlags:    (document.getElementById('cfg-flags')?.value       || '').trim() || DEFAULTS.gccFlags,
    };
    _persist();
    // Re-fetch models in case URL changed
    ModelSwitcher.fetchInstalled();
    UI.toast('Config saved', 'ok');
  }

  function setModel(modelName) {
    _cfg.model = modelName;
    const cfgEl = document.getElementById('cfg-model');
    if (cfgEl) cfgEl.value = modelName;
    const statEl = document.getElementById('stat-model');
    if (statEl) statEl.textContent = modelName.split(':')[0];
    _persist();
  }

  function _persist() {
    try { localStorage.setItem('c_assistant_cfg', JSON.stringify(_cfg)); } catch {}
  }

  function _applyToDOM() {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    set('cfg-ollama-url',  _cfg.ollamaUrl);
    set('cfg-model',       _cfg.model);
    set('cfg-backend-url', _cfg.backendUrl);
    set('cfg-temp',        _cfg.temperature);
    set('cfg-retries',     _cfg.maxRetries);
    set('cfg-flags',       _cfg.gccFlags);
    const statEl = document.getElementById('stat-model');
    if (statEl) statEl.textContent = (_cfg.model || '').split(':')[0];
  }

  function get(key) { return _cfg[key]; }

  function backendBase() {
    const u = (_cfg.backendUrl || '').trim();
    return u === '' ? '' : u.replace(/\/$/, '');
  }

  return { load, save, get, setModel, backendBase, DEFAULTS };
})();


/* ── ModelSwitcher ─────────────────────────────────────────────────── */

const ModelSwitcher = (() => {
  let _prevValue  = null;
  let _allModels  = [];   // full list fetched from Ollama

  // Fetch installed models from Ollama and rebuild the dropdown
  async function fetchInstalled() {
    const sel = document.getElementById('model-select');
    if (!sel) return;

    const url = Config.get('ollamaUrl');

    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 5000);

      // Use Flask proxy — no OLLAMA_ORIGINS needed
      const r = await fetch('/api/ollama/tags', { signal: ctrl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);

      const data = await r.json();
      _allModels  = (data.models || []).map(m => m.name).sort();

      _rebuildDropdown(sel, _allModels);

    } catch (e) {
      // Ollama offline — keep whatever is in the dropdown, just add Custom option
      _rebuildDropdown(sel, _allModels);
      console.warn('Could not fetch Ollama models:', e.message);
    }
  }

  function _rebuildDropdown(sel, models) {
    const currentModel = Config.get('model');
    sel.innerHTML = '';   // clear all

    if (models.length === 0) {
      // Ollama offline — show current model as only option
      const opt = new Option(currentModel || 'No models found', currentModel || '');
      sel.appendChild(opt);
    } else {
      // Add each installed model as an option
      models.forEach(name => {
        const label = _friendlyLabel(name);
        const opt   = new Option(label, name);
        sel.appendChild(opt);
      });
    }

    // Always append Custom… at the end
    sel.appendChild(new Option('Custom…', '__custom__'));

    // Select current model, or first in list if current not found
    const exists = Array.from(sel.options).some(o => o.value === currentModel);
    if (exists) {
      sel.value = currentModel;
    } else if (models.length > 0) {
      // Auto-select first installed model and save it
      sel.value = models[0];
      Config.setModel(models[0]);
    }

    _updateTag(sel.value !== '__custom__');
  }

  // Make model names a bit more readable in the dropdown
  function _friendlyLabel(name) {
    const labels = {
      'qwen2.5-coder:1.5b': 'Qwen2.5-Coder 1.5B ★',
      'qwen2.5-coder:7b':   'Qwen2.5-Coder 7B',
      'qwen2.5:1.5b':       'Qwen2.5 1.5B',
      'qwen2.5:3b':         'Qwen2.5 3B',
      'deepseek-coder:1.3b':'DeepSeek-Coder 1.3B ★',
      'deepseek-coder:6.7b':'DeepSeek-Coder 6.7B',
      'codellama:7b':       'CodeLlama 7B',
      'llama3:8b':          'Llama 3 8B',
    };
    return labels[name] || name;
  }

  function onChange(value) {
    if (value === '__custom__') {
      _prevValue = Config.get('model');
      document.getElementById('custom-model-modal').classList.remove('hidden');
      document.getElementById('custom-model-input').value = '';
      setTimeout(() => document.getElementById('custom-model-input').focus(), 50);
      return;
    }
    _apply(value);
  }

  function confirmCustom() {
    const val = (document.getElementById('custom-model-input')?.value || '').trim();
    if (!val) { UI.toast('Model name cannot be empty', 'warn'); return; }

    // Add to dropdown before the Custom… option
    const sel = document.getElementById('model-select');
    const exists = Array.from(sel.options).some(o => o.value === val);
    if (!exists) {
      const opt = new Option(val, val);
      sel.insertBefore(opt, sel.options[sel.options.length - 1]);
    }
    sel.value = val;
    _apply(val);
    document.getElementById('custom-model-modal').classList.add('hidden');
  }

  function cancelCustom() {
    document.getElementById('custom-model-modal').classList.add('hidden');
    const sel = document.getElementById('model-select');
    if (sel && _prevValue) sel.value = _prevValue;
  }

  function _apply(modelName) {
    Config.setModel(modelName);
    _updateTag(true);
    UI.toast(`Model → ${modelName}`, 'ok');
    App.checkConnections();
  }

  function _updateTag(active) {
    const tag = document.getElementById('model-tag');
    if (!tag) return;
    if (active) {
      tag.textContent = 'active';
      tag.style.color      = 'var(--green)';
      tag.style.background = 'rgba(52,212,142,0.12)';
    } else {
      tag.textContent = '—';
      tag.style.color      = 'var(--muted)';
      tag.style.background = 'transparent';
    }
  }

  return { fetchInstalled, onChange, confirmCustom, cancelCustom };
})();
