// ─────────────────────────────────────────────────────────────
//  Grouped — Popup Script
// ─────────────────────────────────────────────────────────────

let state = null;   // { groups, activeGroupId, snapshots, isSwitching }
let currentWindowId = null;
let settings = {
  warnAboutPages: true,
  warnDeleteTabs: true,
  keybindsEnabled: true,
  keybindNext: { modifiers: ['Ctrl', 'Alt'], key: 'ArrowDown' },
  keybindPrev: { modifiers: ['Ctrl', 'Alt'], key: 'ArrowUp' }
};
let isSwitching = false;
let selectedEmoji = '📁';
let selectedColor = '#6c63ff';
let pendingSwitch = null;
let pendingDelete = null;

// ── Helpers ───────────────────────────────────────────────────

async function send(msg) {
  return browser.runtime.sendMessage({ ...msg, windowId: currentWindowId });
}

function setStatus(text) {
  document.getElementById('status-text').textContent = text;
}

function setLocked(locked) {
  isSwitching = locked;
  const list = document.getElementById('groups-list');
  list.style.pointerEvents = locked ? 'none' : '';
  list.style.opacity = locked ? '0.5' : '';
  document.getElementById('btn-new-group').disabled = locked;
}

async function loadSettings() {
  const DEFAULTS = {
    warnAboutPages: true,
    warnDeleteTabs: true,
    keybindsEnabled: true,
    keybindNext: { modifiers: ['Ctrl', 'Alt'], key: 'ArrowDown' },
    keybindPrev: { modifiers: ['Ctrl', 'Alt'], key: 'ArrowUp' }
  };
  const result = await browser.storage.local.get('groupedSettings');
  settings = { ...DEFAULTS, ...(result.groupedSettings || {}) };
}

// ── Privileged URL detection ──────────────────────────────────

function isPrivilegedUrl(url) {
  if (!url) return false;
  return url.startsWith('about:') ||
    url.startsWith('moz-extension:') ||
    url.startsWith('chrome:');
}

async function getPrivilegedTabsInCurrentWindow() {
  const tabs = await browser.tabs.query({ windowId: currentWindowId });
  return tabs.filter(t => isPrivilegedUrl(t.url));
}

// ── Render ────────────────────────────────────────────────────

function renderGroups() {
  const list = document.getElementById('groups-list');
  list.textContent = '';

  if (!state || !state.groups || state.groups.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No groups yet. Press + to create your first group.';
    list.appendChild(empty);
    return;
  }

  for (const group of state.groups) {
    const isActive = group.id === state.activeGroupId;
    const snapCount = (group.snapshot || []).length;
    const tabCount = isActive ? '— active' : snapCount > 0 ? `${snapCount} tab${snapCount !== 1 ? 's' : ''}` : 'empty';

    const item = document.createElement('div');
    item.className = 'group-item' + (isActive ? ' active' : '');
    item.style.setProperty('--group-color', group.color);
    item.dataset.groupId = group.id;

    const dot = document.createElement('div');
    dot.className = 'group-dot';

    const emoji = document.createElement('div');
    emoji.className = 'group-emoji';
    emoji.textContent = group.emoji || '📁';

    const info = document.createElement('div');
    info.className = 'group-info';

    const name = document.createElement('div');
    name.className = 'group-name';
    name.textContent = group.name;

    const meta = document.createElement('div');
    meta.className = 'group-meta';
    meta.textContent = tabCount;

    info.appendChild(name);
    info.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'group-actions';

    if (state.groups.length > 1) {
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'group-action-btn delete';
      deleteBtn.dataset.action = 'delete';
      deleteBtn.dataset.id = group.id;
      deleteBtn.title = 'Delete';
      deleteBtn.textContent = '✕';
      actions.appendChild(deleteBtn);
    }

    const spinner = document.createElement('div');
    spinner.className = 'switching-indicator';

    item.appendChild(dot);
    item.appendChild(emoji);
    item.appendChild(info);
    item.appendChild(actions);
    item.appendChild(spinner);

    if (!isActive) {
      item.addEventListener('click', (e) => {
        if (e.target.closest('[data-action]')) return;
        if (isSwitching) return;
        handleSwitchGroup(group.id, item);
      });
    }

    const deleteBtn = actions.querySelector('[data-action="delete"]');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isSwitching) return;
        handleDeleteGroup(group.id);
      });
    }

    list.appendChild(item);
  }
}

// ── Warning modal (about: pages) ──────────────────────────────

function openWarnModal(skippedTabs, onConfirm) {
  pendingSwitch = onConfirm;

  const list = document.getElementById('warn-skipped-list');
  list.textContent = '';
  for (const t of skippedTabs) {
    const div = document.createElement('div');
    div.className = 'warn-skipped-item';
    div.textContent = t.url;
    list.appendChild(div);
  }

  document.getElementById('warn-dont-ask').checked = false;
  document.getElementById('warn-modal').classList.remove('hidden');
}

function closeWarnModal() {
  document.getElementById('warn-modal').classList.add('hidden');
  pendingSwitch = null;
}

// ── Delete warning modal ──────────────────────────────────────

function openDeleteWarnModal(title, messageParts, onConfirm) {
  pendingDelete = onConfirm;
  document.getElementById('delete-warn-title').textContent = title;

  const p = document.getElementById('delete-warn-text');
  p.textContent = '';
  for (const part of messageParts) {
    if (part.bold) {
      const strong = document.createElement('strong');
      strong.textContent = part.text;
      p.appendChild(strong);
    } else {
      p.appendChild(document.createTextNode(part.text));
    }
  }

  document.getElementById('delete-warn-dont-ask').checked = false;
  document.getElementById('delete-warn-modal').classList.remove('hidden');
}

function closeDeleteWarnModal() {
  document.getElementById('delete-warn-modal').classList.add('hidden');
  pendingDelete = null;
}

// ── Switch handler ────────────────────────────────────────────

async function handleSwitchGroup(groupId, itemEl) {
  if (isSwitching) return;
  await loadSettings();

  if (settings.warnAboutPages) {
    const skipped = await getPrivilegedTabsInCurrentWindow();
    if (skipped.length > 0) {
      openWarnModal(skipped, () => doSwitch(groupId, itemEl));
      return;
    }
  }

  doSwitch(groupId, itemEl);
}

async function doSwitch(groupId, itemEl) {
  setLocked(true);
  if (itemEl) itemEl.classList.add('switching');
  const targetGroup = state.groups.find(g => g.id === groupId);
  setStatus(`Loading "${targetGroup?.name || groupId}"…`);

  try {
    const response = await send({ type: 'SWITCH_GROUP', groupId });
    if (response?.state) state = response.state;
    if (response?.blocked) { setStatus('Already switching, please wait…'); return; }
    if (response?.error)   { setStatus('Error: ' + response.error); return; }
    setStatus(`Switched to "${targetGroup?.name || groupId}"`);
  } catch (err) {
    setStatus('Switch failed: ' + err.message);
  } finally {
    setLocked(false);
    renderGroups();
  }
}

// ── Delete handler ────────────────────────────────────────────

async function handleDeleteGroup(groupId) {
  const group = state.groups.find(g => g.id === groupId);
  if (!group || state.groups.length <= 1) {
    setStatus('Cannot delete the only group');
    return;
  }

  const isActive = groupId === state.activeGroupId;
  let tabCount = 0;
  if (isActive) {
    const tabs = await browser.tabs.query({ windowId: currentWindowId });
    tabCount = tabs.filter(t => t.url && !isPrivilegedUrl(t.url)).length;
  } else {
    tabCount = (group.snapshot || []).length;
  }

  const needsWarning = settings.warnDeleteTabs && (tabCount > 0 || isActive);

  if (needsWarning) {
    const tabLabel = tabCount === 1 ? '1 tab' : `${tabCount} tabs`;
    const title = isActive ? '⚠ Deleting current group' : '⚠ Group has saved tabs';
    const messageParts = isActive
      ? [
          { text: "You're about to delete " },
          { text: group.name, bold: true },
          { text: ', your currently active group.' },
          ...(tabCount > 0 ? [{ text: ` Its ${tabLabel} will be lost.` }] : []),
          { text: ' Are you sure you want to proceed?' }
        ]
      : [
          { text: group.name, bold: true },
          { text: ` has ${tabLabel} saved. Deleting it will permanently lose those tabs. Are you sure you want to proceed?` }
        ];

    openDeleteWarnModal(title, messageParts, () => doDelete(groupId, group, isActive));
    return;
  }

  doDelete(groupId, group, isActive);
}

async function doDelete(groupId, group, isActive) {
  if (isActive) {
    const currentIdx = state.groups.findIndex(g => g.id === groupId);
    const nextGroup = state.groups[currentIdx + 1] || state.groups[currentIdx - 1];
    if (nextGroup) {
      setLocked(true);
      setStatus('Switching before delete…');
      try {
        const response = await send({ type: 'SWITCH_GROUP', groupId: nextGroup.id });
        if (response?.state) state = response.state;
      } finally {
        setLocked(false);
      }
    }
  }

  const response = await send({ type: 'DELETE_GROUP', id: groupId });
  if (response?.state) {
    state = response.state;
    renderGroups();
    setStatus(`Deleted "${group.name}"`);
  }
}

// ── New group modal ───────────────────────────────────────────

function openModal() {
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('group-name-input').focus();
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden');
  document.getElementById('group-name-input').value = '';
  selectedEmoji = '📁';
  selectedColor = '#6c63ff';
  document.querySelectorAll('.emoji-btn').forEach(b => b.classList.toggle('active', b.dataset.emoji === selectedEmoji));
  document.querySelectorAll('.color-btn').forEach(b => b.classList.toggle('active', b.dataset.color === selectedColor));
}

async function handleCreateGroup() {
  const name = document.getElementById('group-name-input').value.trim();
  if (!name) { document.getElementById('group-name-input').focus(); return; }

  const response = await send({ type: 'CREATE_GROUP', name, color: selectedColor, emoji: selectedEmoji });
  if (response?.state) {
    state = response.state;
    renderGroups();
    setStatus(`Created "${name}"`);
    closeModal();
  }
}

// ── Keyboard navigation ───────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (!settings.keybindsEnabled || isSwitching || !state) return;

  const next = settings.keybindNext || { modifiers: ['Ctrl', 'Alt'], key: 'ArrowDown' };
  const prev = settings.keybindPrev || { modifiers: ['Ctrl', 'Alt'], key: 'ArrowUp' };

  function matches(combo) {
    if (e.key !== combo.key) return false;
    const mods = combo.modifiers || [];
    if (mods.includes('Ctrl')  !== e.ctrlKey)  return false;
    if (mods.includes('Shift') !== e.shiftKey) return false;
    if (mods.includes('Alt')   !== e.altKey)   return false;
    if (mods.includes('Meta')  !== e.metaKey)  return false;
    return true;
  }

  const isNext = matches(next);
  const isPrev = matches(prev);
  if (!isNext && !isPrev) return;

  e.preventDefault();
  const currentIdx = state.groups.findIndex(g => g.id === state.activeGroupId);
  const nextIdx = isNext
    ? (currentIdx + 1) % state.groups.length
    : (currentIdx - 1 + state.groups.length) % state.groups.length;

  const target = state.groups[nextIdx];
  if (target && target.id !== state.activeGroupId) {
    handleSwitchGroup(target.id, null);
  }
});

// ── Background events ─────────────────────────────────────────

browser.runtime.onMessage.addListener((msg) => {
  // Snapshot updated by another window — refresh tab counts silently
  if (msg.type === 'GROUP_SNAPSHOT_UPDATED') {
    // Re-fetch state so our counts are up to date
    send({ type: 'GET_STATE' }).then(response => {
      if (response?.state) {
        state = response.state;
        renderGroups();
      }
    });
    return;
  }

  // Only react to switching events for our own window
  if (msg.windowId && msg.windowId !== currentWindowId) return;

  if (msg.type === 'SWITCHING_STARTED') {
    setLocked(true);
    const target = state?.groups?.find(g => g.id === msg.targetGroupId);
    setStatus(`Loading "${target?.name || msg.targetGroupId}"…`);
    document.querySelectorAll('.group-item').forEach(el => {
      el.classList.toggle('switching', el.dataset.groupId === msg.targetGroupId);
    });
  }
  if (msg.type === 'SWITCHING_DONE') {
    state = msg.state;
    setLocked(false);
    renderGroups();
    const active = state.groups.find(g => g.id === state.activeGroupId);
    setStatus(`Switched to "${active?.name}"`);
  }
  if (msg.type === 'SWITCHING_ERROR') {
    setLocked(false);
    setStatus('Error: ' + msg.error);
    renderGroups();
  }
});

// ── Init ──────────────────────────────────────────────────────

async function init() {
  setStatus('Loading…');
  await loadSettings();

  // Get this popup's window ID via the current tab (no "windows" permission needed)
  const currentTab = await browser.tabs.getCurrent();
  currentWindowId = currentTab?.windowId ?? (await browser.windows.getLastFocused()).id;

  const response = await send({ type: 'GET_STATE' });
  if (response?.state) {
    state = response.state;
    if (state.isSwitching) setLocked(true);
    renderGroups();
    setStatus(state.isSwitching ? 'Switching…' : 'Ready');
  }

  // Emoji picker
  document.getElementById('emoji-picker').addEventListener('click', (e) => {
    const btn = e.target.closest('.emoji-btn');
    if (!btn) return;
    selectedEmoji = btn.dataset.emoji;
    document.querySelectorAll('.emoji-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });

  // Color picker
  document.getElementById('color-picker').addEventListener('click', (e) => {
    const btn = e.target.closest('.color-btn');
    if (!btn) return;
    selectedColor = btn.dataset.color;
    document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });

  document.getElementById('btn-new-group').addEventListener('click', openModal);
  document.getElementById('btn-settings').addEventListener('click', () => {
    browser.runtime.openOptionsPage();
  });

  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('btn-create-confirm').addEventListener('click', handleCreateGroup);
  document.getElementById('group-name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleCreateGroup();
    if (e.key === 'Escape') closeModal();
  });

  // Warning modal (about: pages)
  document.getElementById('warn-modal-close').addEventListener('click', closeWarnModal);
  document.getElementById('warn-cancel').addEventListener('click', closeWarnModal);
  document.getElementById('warn-confirm').addEventListener('click', async () => {
    if (document.getElementById('warn-dont-ask').checked) {
      const s = await browser.storage.local.get('groupedSettings');
      const updated = { ...(s.groupedSettings || {}), warnAboutPages: false };
      await browser.storage.local.set({ groupedSettings: updated });
      settings.warnAboutPages = false;
    }
    const fn = pendingSwitch;
    closeWarnModal();
    if (fn) fn();
  });

  // Delete warning modal
  document.getElementById('delete-warn-close').addEventListener('click', closeDeleteWarnModal);
  document.getElementById('delete-warn-cancel').addEventListener('click', closeDeleteWarnModal);
  document.getElementById('delete-warn-confirm').addEventListener('click', async () => {
    if (document.getElementById('delete-warn-dont-ask').checked) {
      const s = await browser.storage.local.get('groupedSettings');
      const updated = { ...(s.groupedSettings || {}), warnDeleteTabs: false };
      await browser.storage.local.set({ groupedSettings: updated });
      settings.warnDeleteTabs = false;
    }
    const fn = pendingDelete;
    closeDeleteWarnModal();
    if (fn) fn();
  });
}

init();
