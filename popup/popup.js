// ─────────────────────────────────────────────────────────────
//  Grouped — Popup Script
// ─────────────────────────────────────────────────────────────

let state          = null;   // { groups, activeGroupId (null=ungrouped), isSwitching }
let currentWindowId = null;
let settings       = {
  warnAboutPages:  true,
  warnDeleteTabs:  true,
  keybindsEnabled: true,
  keybindNext: { modifiers: ['Ctrl', 'Alt'], key: 'ArrowDown' },
  keybindPrev: { modifiers: ['Ctrl', 'Alt'], key: 'ArrowUp'  }
};
let isSwitching   = false;
let pendingSwitch = null;
let pendingDelete = null;

// Group modal mode
let groupModalMode    = 'create';  // 'create' | 'edit'
let groupModalEditId  = null;
let selectedEmoji     = '📁';
let selectedColor     = '#6c63ff';

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
  list.style.opacity       = locked ? '0.5'  : '';
  document.getElementById('btn-new-group').disabled = locked;
}

async function loadSettings() {
  const DEFAULTS = {
    warnAboutPages:  true,
    warnDeleteTabs:  true,
    keybindsEnabled: true,
    keybindNext: { modifiers: ['Ctrl', 'Alt'], key: 'ArrowDown' },
    keybindPrev: { modifiers: ['Ctrl', 'Alt'], key: 'ArrowUp'  }
  };
  const result = await browser.storage.local.get('groupedSettings');
  settings = { ...DEFAULTS, ...(result.groupedSettings || {}) };
}

function isPrivilegedUrl(url) {
  if (!url) return false;
  return url.startsWith('about:') || url.startsWith('moz-extension:') || url.startsWith('chrome:');
}

async function getPrivilegedTabsInCurrentWindow() {
  const tabs = await browser.tabs.query({ windowId: currentWindowId });
  return tabs.filter(t => isPrivilegedUrl(t.url));
}

// ── Render ────────────────────────────────────────────────────

function renderGroups() {
  const list = document.getElementById('groups-list');
  list.textContent = '';

  // ── Ungrouped row ──
  const isUngrouped = state.activeGroupId === null;
  const ungrouped   = document.createElement('div');
  ungrouped.className = 'group-item ungrouped' + (isUngrouped ? ' active' : '');
  ungrouped.dataset.groupId = '__ungrouped__';

  const ugDot = document.createElement('div');
  ugDot.className = 'group-dot';
  ugDot.style.background = '#444';

  const ugEmoji = document.createElement('div');
  ugEmoji.className = 'group-emoji';
  ugEmoji.textContent = '🌐';

  const ugInfo = document.createElement('div');
  ugInfo.className = 'group-info';
  const ugName = document.createElement('div');
  ugName.className = 'group-name';
  ugName.textContent = 'No Group';
  const ugMeta = document.createElement('div');
  ugMeta.className = 'group-meta';
  ugMeta.textContent = isUngrouped ? '— active' : '';
  ugInfo.appendChild(ugName);
  ugInfo.appendChild(ugMeta);

  const ugSpin = document.createElement('div');
  ugSpin.className = 'switching-indicator';

  ungrouped.appendChild(ugDot);
  ungrouped.appendChild(ugEmoji);
  ungrouped.appendChild(ugInfo);
  ungrouped.appendChild(document.createElement('div')); // empty actions slot
  ungrouped.appendChild(ugSpin);

  if (!isUngrouped) {
    ungrouped.addEventListener('click', () => {
      if (isSwitching) return;
      handleSwitchGroup(null, ungrouped);
    });
  }

  list.appendChild(ungrouped);

  // ── Divider ──
  if (state.groups && state.groups.length > 0) {
    const divider = document.createElement('div');
    divider.className = 'group-divider';
    const divLabel = document.createElement('span');
    divLabel.textContent = 'Groups';
    divider.appendChild(divLabel);
    list.appendChild(divider);
  }

  // ── Group rows ──
  if (!state.groups || state.groups.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No groups yet. Press + to create one.';
    list.appendChild(empty);
    return;
  }

  for (const group of state.groups) {
    const isActive  = group.id === state.activeGroupId;
    const snapCount = (group.snapshot || []).length;
    const tabCount  = isActive
      ? '— active'
      : snapCount > 0 ? `${snapCount} tab${snapCount !== 1 ? 's' : ''}` : 'empty';

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

    // Edit button
    const editBtn = document.createElement('button');
    editBtn.className = 'group-action-btn edit';
    editBtn.title     = 'Edit';
    editBtn.textContent = '✎';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isSwitching) return;
      openGroupModal('edit', group);
    });
    actions.appendChild(editBtn);

    // Delete button (only if more than 0 groups remain)
    const deleteBtn = document.createElement('button');
    deleteBtn.className   = 'group-action-btn delete';
    deleteBtn.title       = 'Delete';
    deleteBtn.textContent = '✕';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isSwitching) return;
      handleDeleteGroup(group.id);
    });
    actions.appendChild(deleteBtn);

    const spinner = document.createElement('div');
    spinner.className = 'switching-indicator';

    item.appendChild(dot);
    item.appendChild(emoji);
    item.appendChild(info);
    item.appendChild(actions);
    item.appendChild(spinner);

    if (!isActive) {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.group-action-btn')) return;
        if (isSwitching) return;
        handleSwitchGroup(group.id, item);
      });
    } else {
      // Active group — clicking still allows edit via the button
      item.style.cursor = 'default';
    }

    list.appendChild(item);
  }
}

// ── Group modal (create & edit) ───────────────────────────────

function openGroupModal(mode, group = null) {
  groupModalMode   = mode;
  groupModalEditId = group?.id || null;

  const title      = document.getElementById('group-modal-title');
  const nameInput  = document.getElementById('group-name-input');
  const confirmBtn = document.getElementById('group-modal-confirm');
  const claimRow   = document.getElementById('use-current-tabs-row');

  if (mode === 'edit') {
    title.textContent      = 'Edit Group';
    nameInput.value        = group.name;
    confirmBtn.textContent = 'Save Changes';
    claimRow.style.display = 'none';
    setSelectedEmoji(group.emoji || '📁');
    setSelectedColor(group.color || '#6c63ff');
  } else {
    title.textContent      = 'New Group';
    nameInput.value        = '';
    confirmBtn.textContent = 'Create Group';
    claimRow.style.display = '';
    document.getElementById('use-current-tabs').checked = true;
    setSelectedEmoji('📁');
    setSelectedColor('#6c63ff');
  }

  document.getElementById('group-modal').classList.remove('hidden');
  nameInput.focus();
}

function closeGroupModal() {
  document.getElementById('group-modal').classList.add('hidden');
  groupModalMode   = 'create';
  groupModalEditId = null;
}

function setSelectedEmoji(emoji) {
  selectedEmoji = emoji;
  document.querySelectorAll('.emoji-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.emoji === emoji)
  );
}

function setSelectedColor(color) {
  selectedColor = color;
  document.querySelectorAll('.color-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.color === color)
  );
}

async function handleGroupModalConfirm() {
  const name = document.getElementById('group-name-input').value.trim();
  if (!name) { document.getElementById('group-name-input').focus(); return; }

  if (groupModalMode === 'edit') {
    const response = await send({
      type:    'UPDATE_GROUP',
      id:      groupModalEditId,
      changes: { name, emoji: selectedEmoji, color: selectedColor }
    });
    if (response?.state) {
      state = response.state;
      renderGroups();
      setStatus(`Updated "${name}"`);
    }
  } else {
    const claimTabs = document.getElementById('use-current-tabs').checked;
    const response  = await send({
      type:            'CREATE_GROUP',
      name,
      color:           selectedColor,
      emoji:           selectedEmoji,
      claimCurrentTabs: claimTabs
    });
    if (response?.state) {
      state = response.state;
      renderGroups();
      setStatus(claimTabs ? `Created "${name}" with current tabs` : `Created "${name}"`);
    }
  }

  closeGroupModal();
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
  const label = groupId === null ? 'No Group' : (state.groups.find(g => g.id === groupId)?.name || groupId);
  setStatus(`Loading "${label}"…`);

  try {
    const response = await send({ type: 'SWITCH_GROUP', groupId });
    if (response?.state) state = response.state;
    if (response?.blocked) { setStatus('Already switching, please wait…'); return; }
    if (response?.error)   { setStatus('Error: ' + response.error); return; }
    setStatus(`Switched to "${label}"`);
  } catch (err) {
    setStatus('Switch failed: ' + err.message);
  } finally {
    setLocked(false);
    renderGroups();
  }
}

// ── Warning modal (about: pages) ──────────────────────────────

function openWarnModal(skippedTabs, onConfirm) {
  pendingSwitch = onConfirm;
  const list = document.getElementById('warn-skipped-list');
  list.textContent = '';
  for (const t of skippedTabs) {
    const div = document.createElement('div');
    div.className   = 'warn-skipped-item';
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

// ── Delete handler ────────────────────────────────────────────

async function handleDeleteGroup(groupId) {
  const group = state.groups.find(g => g.id === groupId);
  if (!group) return;

  const isActive  = groupId === state.activeGroupId;
  let   tabCount  = 0;
  if (isActive) {
    const tabs = await browser.tabs.query({ windowId: currentWindowId });
    tabCount = tabs.filter(t => !isPrivilegedUrl(t.url)).length;
  } else {
    tabCount = (group.snapshot || []).length;
  }

  const needsWarning = settings.warnDeleteTabs && (tabCount > 0 || isActive);

  if (needsWarning) {
    const tabLabel  = tabCount === 1 ? '1 tab' : `${tabCount} tabs`;
    const title     = isActive ? '⚠ Deleting current group' : '⚠ Group has saved tabs';
    const messageParts = isActive
      ? [
          { text: "You're about to delete " },
          { text: group.name, bold: true },
          { text: ', your currently active group.' },
          ...(tabCount > 0 ? [{ text: ` Its ${tabLabel} will be lost.` }] : []),
          { text: ' Are you sure?' }
        ]
      : [
          { text: group.name, bold: true },
          { text: ` has ${tabLabel} saved. Deleting it will permanently lose those tabs. Are you sure?` }
        ];
    openDeleteWarnModal(title, messageParts, () => doDelete(groupId, group, isActive));
    return;
  }

  doDelete(groupId, group, isActive);
}

async function doDelete(groupId, group, isActive) {
  if (isActive) {
    // Switch to ungrouped first
    setLocked(true);
    setStatus('Switching before delete…');
    try {
      const response = await send({ type: 'SWITCH_GROUP', groupId: null });
      if (response?.state) state = response.state;
    } finally {
      setLocked(false);
    }
  }

  const response = await send({ type: 'DELETE_GROUP', id: groupId });
  if (response?.state) {
    state = response.state;
    renderGroups();
    setStatus(`Deleted "${group.name}"`);
  }
}

// ── Keyboard navigation ───────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (!settings.keybindsEnabled || isSwitching || !state) return;

  const next = settings.keybindNext || { modifiers: ['Ctrl', 'Alt'], key: 'ArrowDown' };
  const prev = settings.keybindPrev || { modifiers: ['Ctrl', 'Alt'], key: 'ArrowUp'  };

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
  const allPositions  = [null, ...(state.groups || []).map(g => g.id)];
  const currentIdx    = allPositions.indexOf(state.activeGroupId);
  const nextIdx       = isNext
    ? (currentIdx + 1) % allPositions.length
    : (currentIdx - 1 + allPositions.length) % allPositions.length;
  const targetId = allPositions[nextIdx];
  if (targetId !== state.activeGroupId) handleSwitchGroup(targetId, null);
});

// ── Background events ─────────────────────────────────────────

browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'GROUP_SNAPSHOT_UPDATED' || msg.type === 'GROUP_UPDATED') {
    send({ type: 'GET_STATE' }).then(r => {
      if (r?.state) { state = r.state; renderGroups(); }
    });
    return;
  }

  if (msg.windowId && msg.windowId !== currentWindowId) return;

  if (msg.type === 'SWITCHING_STARTED') {
    setLocked(true);
    const label = msg.targetGroupId === null
      ? 'No Group'
      : state?.groups?.find(g => g.id === msg.targetGroupId)?.name || msg.targetGroupId;
    setStatus(`Loading "${label}"…`);
    document.querySelectorAll('.group-item').forEach(el =>
      el.classList.toggle('switching', el.dataset.groupId === (msg.targetGroupId ?? '__ungrouped__'))
    );
  }
  if (msg.type === 'SWITCHING_DONE') {
    state = msg.state;
    setLocked(false);
    renderGroups();
    const label = state.activeGroupId === null ? 'No Group' : state.groups.find(g => g.id === state.activeGroupId)?.name;
    setStatus(`Switched to "${label}"`);
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

  const currentTab    = await browser.tabs.getCurrent();
  currentWindowId     = currentTab?.windowId ?? (await browser.windows.getLastFocused()).id;

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
    if (btn) setSelectedEmoji(btn.dataset.emoji);
  });

  // Color picker
  document.getElementById('color-picker').addEventListener('click', (e) => {
    const btn = e.target.closest('.color-btn');
    if (btn) setSelectedColor(btn.dataset.color);
  });

  document.getElementById('btn-new-group').addEventListener('click', () => openGroupModal('create'));
  document.getElementById('btn-settings').addEventListener('click', () => browser.runtime.openOptionsPage());

  // Group modal
  document.getElementById('group-modal-close').addEventListener('click', closeGroupModal);
  document.getElementById('group-modal-confirm').addEventListener('click', handleGroupModalConfirm);
  document.getElementById('group-name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  handleGroupModalConfirm();
    if (e.key === 'Escape') closeGroupModal();
  });

  // About-pages warning modal
  document.getElementById('warn-modal-close').addEventListener('click', closeWarnModal);
  document.getElementById('warn-cancel').addEventListener('click', closeWarnModal);
  document.getElementById('warn-confirm').addEventListener('click', async () => {
    if (document.getElementById('warn-dont-ask').checked) {
      const s = await browser.storage.local.get('groupedSettings');
      await browser.storage.local.set({ groupedSettings: { ...(s.groupedSettings || {}), warnAboutPages: false } });
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
      await browser.storage.local.set({ groupedSettings: { ...(s.groupedSettings || {}), warnDeleteTabs: false } });
      settings.warnDeleteTabs = false;
    }
    const fn = pendingDelete;
    closeDeleteWarnModal();
    if (fn) fn();
  });
}

init();
