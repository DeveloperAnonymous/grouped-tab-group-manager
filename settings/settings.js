// ─────────────────────────────────────────────────────────────
//  Grouped — Settings Page
// ─────────────────────────────────────────────────────────────

const DEFAULTS = {
  warnAboutPages:   true,
  warnDeleteTabs:   true,
  keybindsEnabled:  true,
  keybindNext: { display: 'Ctrl + Alt + ↓', modifiers: ['Ctrl', 'Alt'], key: 'ArrowDown' },
  keybindPrev: { display: 'Ctrl + Alt + ↑', modifiers: ['Ctrl', 'Alt'], key: 'ArrowUp'   }
};

let settings = { ...DEFAULTS };
let captureTarget = null;   // 'next' | 'prev'
let capturedCombo = null;   // { display, modifiers, key }

// ── Storage ───────────────────────────────────────────────────

async function loadSettings() {
  const result = await browser.storage.local.get('groupedSettings');
  settings = { ...DEFAULTS, ...(result.groupedSettings || {}) };
}

async function persistSettings() {
  await browser.storage.local.set({ groupedSettings: settings });
  showToast();
}

function showToast() {
  const toast = document.getElementById('saved-toast');
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 1800);
}

// ── Keybind display helpers ───────────────────────────────────

function renderKeybindDisplay(which, combo) {
  const el = document.getElementById(`keybind-display-${which}`);
  if (!el) return;
  el.textContent = '';
  const parts = [...(combo.modifiers || []), combo.key];
  parts.forEach((p, i) => {
    const kbd = document.createElement('kbd');
    kbd.textContent = p;
    el.appendChild(kbd);
    if (i < parts.length - 1) {
      el.appendChild(document.createTextNode(' + '));
    }
  });
}

function comboFromEvent(e) {
  // Ignore lone modifier keypresses
  if (['Control','Shift','Alt','Meta'].includes(e.key)) return null;

  const modifiers = [];
  if (e.ctrlKey)  modifiers.push('Ctrl');
  if (e.shiftKey) modifiers.push('Shift');
  if (e.altKey)   modifiers.push('Alt');
  if (e.metaKey)  modifiers.push('Meta');

  // Must have at least one modifier
  if (modifiers.length === 0) return null;

  // Format key name nicely
  const keyMap = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    ' ': 'Space', Escape: 'Esc', Enter: 'Enter',
    Backspace: '⌫', Delete: 'Del', Tab: 'Tab'
  };
  const keyDisplay = keyMap[e.key] || (e.key.length === 1 ? e.key.toUpperCase() : e.key);

  return {
    display: [...modifiers, keyDisplay].join(' + '),
    modifiers,
    key: e.key
  };
}

// ── Capture UI ────────────────────────────────────────────────

function openCapture(which) {
  captureTarget = which;
  capturedCombo = null;

  const capture = document.getElementById('keybind-capture');
  capture.classList.remove('hidden');
  document.getElementById('capture-preview').textContent = '—';
  document.getElementById('capture-save').disabled = true;

  // Scroll to capture box
  capture.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeCapture() {
  document.getElementById('keybind-capture').classList.add('hidden');
  captureTarget = null;
  capturedCombo = null;
}

// ── Init ──────────────────────────────────────────────────────

async function init() {
  await loadSettings();

  // Version
  const manifest = browser.runtime.getManifest();
  document.getElementById('about-version').textContent = 'v' + manifest.version;

  // Toggles
  const warnToggle      = document.getElementById('setting-warn-about-pages');
  const warnDeleteToggle = document.getElementById('setting-warn-delete-tabs');
  const keybindsToggle  = document.getElementById('setting-keybinds-enabled');
  const keybindList     = document.getElementById('keybind-list');

  warnToggle.checked      = settings.warnAboutPages;
  warnDeleteToggle.checked = settings.warnDeleteTabs;
  keybindsToggle.checked  = settings.keybindsEnabled;
  keybindList.classList.toggle('enabled', settings.keybindsEnabled);

  renderKeybindDisplay('next', settings.keybindNext);
  renderKeybindDisplay('prev', settings.keybindPrev);

  warnToggle.addEventListener('change', async () => {
    settings.warnAboutPages = warnToggle.checked;
    await persistSettings();
  });

  warnDeleteToggle.addEventListener('change', async () => {
    settings.warnDeleteTabs = warnDeleteToggle.checked;
    await persistSettings();
  });

  keybindsToggle.addEventListener('change', async () => {
    settings.keybindsEnabled = keybindsToggle.checked;
    keybindList.classList.toggle('enabled', settings.keybindsEnabled);
    await persistSettings();
  });

  // Edit buttons
  document.getElementById('keybind-edit-next').addEventListener('click', () => openCapture('next'));
  document.getElementById('keybind-edit-prev').addEventListener('click', () => openCapture('prev'));

  // Capture keydown
  document.addEventListener('keydown', (e) => {
    if (!captureTarget) return;
    e.preventDefault();
    e.stopPropagation();

    const combo = comboFromEvent(e);
    if (!combo) return;

    capturedCombo = combo;
    document.getElementById('capture-preview').textContent = combo.display;
    document.getElementById('capture-save').disabled = false;
  });

  // Cancel capture
  document.getElementById('capture-cancel').addEventListener('click', closeCapture);

  // Save capture
  document.getElementById('capture-save').addEventListener('click', async () => {
    if (!capturedCombo || !captureTarget) return;

    if (captureTarget === 'next') settings.keybindNext = capturedCombo;
    if (captureTarget === 'prev') settings.keybindPrev = capturedCombo;

    renderKeybindDisplay(captureTarget, capturedCombo);
    closeCapture();
    await persistSettings();
  });
}

init();
