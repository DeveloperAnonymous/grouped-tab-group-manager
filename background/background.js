// ─────────────────────────────────────────────────────────────
//  Grouped — Background Script
//
//  State model:
//    groups[]       — shared: id, name, color, emoji, snapshot[]
//    windowState{}  — per-window: activeGroupId, isSwitching
//    lastActiveGroupId — default group for new windows
//
//  Snapshot ownership:
//    A group's snapshot is always updated by whichever window
//    switches away from it. Last writer wins — this is intentional.
//    All windows share the same snapshot per group.
// ─────────────────────────────────────────────────────────────

let groups = [
  { id: 'default', name: 'General', color: '#6c63ff', emoji: '🏠', snapshot: [], createdAt: Date.now() }
];

// windowState: Map<windowId, { activeGroupId, isSwitching }>
const windowState = new Map();

let lastActiveGroupId = 'default';

// ── Persistence ───────────────────────────────────────────────

async function saveState() {
  const windowsArray = [...windowState.entries()].map(([winId, ws]) => ({
    winId,
    activeGroupId: ws.activeGroupId
  }));

  await browser.storage.local.set({
    groupedGroups:      groups,
    groupedWindows:     windowsArray,
    groupedLastActive:  lastActiveGroupId
  });
}

async function loadState() {
  const result = await browser.storage.local.get([
    'groupedGroups',
    'groupedWindows',
    'groupedLastActive'
  ]);

  if (result.groupedGroups && result.groupedGroups.length > 0) {
    groups = result.groupedGroups;
    // Ensure all groups have a snapshot array (migration safety)
    for (const g of groups) {
      if (!Array.isArray(g.snapshot)) g.snapshot = [];
    }
  }

  if (result.groupedLastActive) {
    lastActiveGroupId = result.groupedLastActive;
    if (!groups.find(g => g.id === lastActiveGroupId)) {
      lastActiveGroupId = groups[0].id;
    }
  }

  // Restore per-window active group by window index
  if (result.groupedWindows && result.groupedWindows.length > 0) {
    const realWindows = await browser.windows.getAll({ populate: false });
    result.groupedWindows.forEach((saved, i) => {
      const realWin = realWindows[i];
      if (!realWin) return;
      const activeGroupId = groups.find(g => g.id === saved.activeGroupId)
        ? saved.activeGroupId
        : lastActiveGroupId;
      windowState.set(realWin.id, { activeGroupId, isSwitching: false });
    });
  }
}

// ── Window state ──────────────────────────────────────────────

function getWindowState(windowId) {
  if (!windowState.has(windowId)) {
    windowState.set(windowId, {
      activeGroupId: lastActiveGroupId,
      isSwitching: false
    });
  }
  return windowState.get(windowId);
}

function buildStateForWindow(windowId) {
  const ws = getWindowState(windowId);
  return {
    groups,
    activeGroupId: ws.activeGroupId,
    isSwitching:   ws.isSwitching,
    lastActiveGroupId
  };
}

// ── Tab capture ───────────────────────────────────────────────

async function captureWindowTabs(windowId) {
  const tabs = await browser.tabs.query({ windowId });
  return tabs
    .map(tab => ({
      url:        tab.url,
      title:      tab.title,
      pinned:     tab.pinned,
      faviconUrl: tab.favIconUrl || ''
    }))
    .filter(t =>
      t.url &&
      !t.url.startsWith('about:') &&
      !t.url.startsWith('moz-extension:') &&
      !t.url.startsWith('chrome:')
    );
}

// ── Switch group ──────────────────────────────────────────────

async function switchToGroup(targetGroupId, windowId) {
  const ws = getWindowState(windowId);

  if (ws.isSwitching)                     return { blocked: true };
  if (targetGroupId === ws.activeGroupId) return { alreadyActive: true };

  const currentGroup = groups.find(g => g.id === ws.activeGroupId);
  const targetGroup  = groups.find(g => g.id === targetGroupId);
  if (!targetGroup) return { error: 'Group not found: ' + targetGroupId };

  ws.isSwitching = true;
  broadcast({ type: 'SWITCHING_STARTED', targetGroupId, windowId });

  try {
    // 1. Save current tabs into the shared group snapshot
    if (currentGroup) {
      currentGroup.snapshot = await captureWindowTabs(windowId);
      // Notify all other windows that this group's snapshot updated
      broadcast({ type: 'GROUP_SNAPSHOT_UPDATED', groupId: currentGroup.id });
    }

    // 2. Anchor tab to keep window alive
    const anchor = await browser.tabs.create({ windowId, active: true });

    // 3. Close all other tabs
    const allTabs = await browser.tabs.query({ windowId });
    for (const tab of allTabs) {
      if (tab.id !== anchor.id) {
        try { await browser.tabs.remove(tab.id); } catch (_) {}
      }
    }

    // 4. Restore target group's shared snapshot
    const snap = targetGroup.snapshot || [];
    if (snap.length > 0) {
      await browser.tabs.update(anchor.id, { url: snap[0].url, active: true });
      for (let i = 1; i < snap.length; i++) {
        await browser.tabs.create({
          windowId,
          url:    snap[i].url,
          pinned: snap[i].pinned || false,
          active: false
        });
      }
    }
    // Empty snapshot — anchor stays as clean new tab

    // 5. Commit
    ws.activeGroupId    = targetGroupId;
    lastActiveGroupId   = targetGroupId;
    await saveState();

    broadcast({ type: 'SWITCHING_DONE', windowId, state: buildStateForWindow(windowId) });
    return { success: true };

  } catch (err) {
    console.error('[Grouped] Switch failed:', err);
    broadcast({ type: 'SWITCHING_ERROR', windowId, error: err.message });
    return { error: err.message };
  } finally {
    ws.isSwitching = false;
  }
}

// ── Group CRUD ────────────────────────────────────────────────

function createGroup(name, color, emoji) {
  const group = {
    id:        'group_' + Date.now(),
    name:      name  || 'New Group',
    color:     color || '#6c63ff',
    emoji:     emoji || '📁',
    snapshot:  [],
    createdAt: Date.now()
  };
  groups.push(group);
  return group;
}

function deleteGroup(id) {
  if (groups.length <= 1) return false;
  groups = groups.filter(g => g.id !== id);

  // Any window that was on the deleted group falls back to first available
  for (const [, ws] of windowState.entries()) {
    if (ws.activeGroupId === id) {
      ws.activeGroupId = groups[0].id;
    }
  }
  if (lastActiveGroupId === id) {
    lastActiveGroupId = groups[0].id;
  }
  return true;
}

// ── Auto-save snapshot on tab changes ────────────────────────
// Keeps the shared snapshot fresh so window-close always persists

async function saveGroupSnapshot(windowId) {
  const ws = windowState.get(windowId);
  if (!ws || ws.isSwitching) return;
  const group = groups.find(g => g.id === ws.activeGroupId);
  if (!group) return;
  group.snapshot = await captureWindowTabs(windowId);
  await saveState();
  broadcast({ type: 'GROUP_SNAPSHOT_UPDATED', groupId: group.id });
}

browser.tabs.onRemoved.addListener((tabId, info) => {
  if (!info.isWindowClosing) saveGroupSnapshot(info.windowId);
});
browser.tabs.onCreated.addListener((tab) => {
  saveGroupSnapshot(tab.windowId);
});
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) saveGroupSnapshot(tab.windowId);
});

browser.windows.onRemoved.addListener((windowId) => {
  windowState.delete(windowId);
});

// ── Broadcast ─────────────────────────────────────────────────

function broadcast(msg) {
  browser.runtime.sendMessage(msg).catch(() => {});
}

// ── Message handler ───────────────────────────────────────────

browser.runtime.onMessage.addListener((msg) => {
  return (async () => {
    const windowId = msg.windowId || (await browser.windows.getLastFocused()).id;

    switch (msg.type) {

      case 'GET_STATE':
        return { state: buildStateForWindow(windowId) };

      case 'SWITCH_GROUP': {
        const result = await switchToGroup(msg.groupId, windowId);
        return { ...result, state: buildStateForWindow(windowId) };
      }

      case 'CREATE_GROUP': {
        const group = createGroup(msg.name, msg.color, msg.emoji);
        await saveState();
        return { state: buildStateForWindow(windowId), newGroupId: group.id };
      }

      case 'UPDATE_GROUP': {
        const g = groups.find(g => g.id === msg.id);
        if (g) Object.assign(g, msg.changes);
        await saveState();
        return { state: buildStateForWindow(windowId) };
      }

      case 'DELETE_GROUP': {
        const ok = deleteGroup(msg.id);
        if (ok) await saveState();
        return { state: buildStateForWindow(windowId), success: ok };
      }
    }
  })();
});

// ── Commands ──────────────────────────────────────────────────

browser.commands.onCommand.addListener(async (command) => {
  const result = await browser.storage.local.get('groupedSettings');
  const s = { keybindsEnabled: true, ...(result.groupedSettings || {}) };
  if (!s.keybindsEnabled) return;

  const win = await browser.windows.getLastFocused({ populate: false });
  const ws  = getWindowState(win.id);
  if (ws.isSwitching) return;

  const currentIdx = groups.findIndex(g => g.id === ws.activeGroupId);
  let nextIdx;
  if      (command === 'group-next') nextIdx = (currentIdx + 1) % groups.length;
  else if (command === 'group-prev') nextIdx = (currentIdx - 1 + groups.length) % groups.length;
  else return;

  const target = groups[nextIdx];
  if (target && target.id !== ws.activeGroupId) {
    await switchToGroup(target.id, win.id);
  }
});

// ── Init ──────────────────────────────────────────────────────

(async () => {
  await loadState();

  if (groups.length === 0) {
    groups = [{ id: 'default', name: 'General', color: '#6c63ff', emoji: '🏠', snapshot: [], createdAt: Date.now() }];
  }

  const openWindows = await browser.windows.getAll({ populate: false });
  for (const win of openWindows) {
    getWindowState(win.id);
  }

  await saveState();
})();
