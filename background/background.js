// ─────────────────────────────────────────────────────────────
//  Grouped — Background Script
//
//  State model:
//    groups[]      — shared: id, name, color, emoji, snapshot[]
//    windowState{} — per-window: activeGroupId (null = ungrouped)
//
//  Key behaviours:
//    • New windows always start ungrouped (activeGroupId: null)
//    • Switching to a group: saves current tabs into current group
//      (or discards them if ungrouped), restores target group's tabs
//    • Switching to null (ungrouped): saves current group, restores
//      the window's free tabs (saved when it last went ungrouped)
//    • "Claim" create: snapshot current tabs, set group active,
//      don't touch the open tabs at all
// ─────────────────────────────────────────────────────────────

let groups = [];

// windowState: Map<windowId, { activeGroupId: string|null, freeTabs: Tab[], isSwitching }>
const windowState = new Map();

// ── Persistence ───────────────────────────────────────────────

async function saveState() {
  const windowsArray = [...windowState.entries()].map(([winId, ws]) => ({
    winId,
    activeGroupId: ws.activeGroupId,
    freeTabs:      ws.freeTabs || []
  }));
  await browser.storage.local.set({
    groupedVersion:  2,
    groupedGroups:   groups,
    groupedWindows:  windowsArray
  });
}

async function loadState() {
  const result = await browser.storage.local.get([
    'groupedVersion', 'groupedGroups', 'groupedWindows'
  ]);

  if (result.groupedGroups && result.groupedGroups.length > 0) {
    groups = result.groupedGroups;
    for (const g of groups) {
      if (!Array.isArray(g.snapshot)) g.snapshot = [];
    }
  }

  // Restore per-window state by index
  if (result.groupedWindows && result.groupedWindows.length > 0) {
    const realWindows = await browser.windows.getAll({ populate: false });
    result.groupedWindows.forEach((saved, i) => {
      const realWin = realWindows[i];
      if (!realWin) return;
      const activeGroupId = saved.activeGroupId && groups.find(g => g.id === saved.activeGroupId)
        ? saved.activeGroupId
        : null;
      windowState.set(realWin.id, {
        activeGroupId,
        freeTabs:    saved.freeTabs || [],
        isSwitching: false
      });
    });
  }
}

// ── Window state ──────────────────────────────────────────────

function getWindowState(windowId) {
  if (!windowState.has(windowId)) {
    windowState.set(windowId, {
      activeGroupId: null,   // always start ungrouped
      freeTabs:      [],
      isSwitching:   false
    });
  }
  return windowState.get(windowId);
}

function buildStateForWindow(windowId) {
  const ws = getWindowState(windowId);
  return {
    groups,
    activeGroupId: ws.activeGroupId,
    isSwitching:   ws.isSwitching
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

async function replaceTabs(windowId, snap) {
  const anchor = await browser.tabs.create({ windowId, active: true });
  const allTabs = await browser.tabs.query({ windowId });
  for (const tab of allTabs) {
    if (tab.id !== anchor.id) {
      try { await browser.tabs.remove(tab.id); } catch (_) {}
    }
  }
  if (snap.length > 0) {
    await browser.tabs.update(anchor.id, { url: snap[0].url, active: true });
    for (let i = 1; i < snap.length; i++) {
      await browser.tabs.create({ windowId, url: snap[i].url, pinned: snap[i].pinned || false, active: false });
    }
  }
}

// ── Switch group ──────────────────────────────────────────────

async function switchToGroup(targetGroupId, windowId) {
  // targetGroupId may be null (switch to ungrouped)
  const ws = getWindowState(windowId);

  if (ws.isSwitching) return { blocked: true };
  if (targetGroupId === ws.activeGroupId) return { alreadyActive: true };

  const targetGroup = targetGroupId ? groups.find(g => g.id === targetGroupId) : null;
  if (targetGroupId && !targetGroup) return { error: 'Group not found: ' + targetGroupId };

  ws.isSwitching = true;
  broadcast({ type: 'SWITCHING_STARTED', targetGroupId, windowId });

  try {
    const currentGroup = ws.activeGroupId ? groups.find(g => g.id === ws.activeGroupId) : null;

    // 1. Save current tabs
    const currentTabs = await captureWindowTabs(windowId);
    if (currentGroup) {
      // Leaving a group — save into that group's shared snapshot
      currentGroup.snapshot = currentTabs;
      broadcast({ type: 'GROUP_SNAPSHOT_UPDATED', groupId: currentGroup.id });
    } else {
      // Leaving ungrouped — save as free tabs for this window
      ws.freeTabs = currentTabs;
    }

    // 2. Restore target
    const snapToRestore = targetGroup ? (targetGroup.snapshot || []) : (ws.freeTabs || []);
    await replaceTabs(windowId, snapToRestore);

    // 3. Commit
    ws.activeGroupId = targetGroupId;
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

// ── Claim tabs (create group from existing tabs) ──────────────
// Snapshot the current tabs, set active group — don't touch open tabs

async function claimCurrentTabs(groupId, windowId) {
  const ws = getWindowState(windowId);
  const group = groups.find(g => g.id === groupId);
  if (!group) return { error: 'Group not found' };

  // Save any previously active group first
  const currentGroup = ws.activeGroupId ? groups.find(g => g.id === ws.activeGroupId) : null;
  if (currentGroup) {
    currentGroup.snapshot = await captureWindowTabs(windowId);
    broadcast({ type: 'GROUP_SNAPSHOT_UPDATED', groupId: currentGroup.id });
  }

  // Snapshot current tabs into the new group
  group.snapshot = await captureWindowTabs(windowId);

  // Activate the group without touching tabs
  ws.activeGroupId = groupId;
  await saveState();

  broadcast({ type: 'GROUP_SNAPSHOT_UPDATED', groupId });
  broadcast({ type: 'SWITCHING_DONE', windowId, state: buildStateForWindow(windowId) });
  return { success: true };
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
  for (const [, ws] of windowState.entries()) {
    if (ws.activeGroupId === id) ws.activeGroupId = null;
  }
  return true;
}

// ── Auto-save snapshot on tab changes ────────────────────────

async function saveGroupSnapshot(windowId) {
  const ws = windowState.get(windowId);
  if (!ws || ws.isSwitching || !ws.activeGroupId) return;
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

      case 'SWITCH_GROUP':
        // groupId: null means switch to ungrouped
        return { ...(await switchToGroup(msg.groupId, windowId)), state: buildStateForWindow(windowId) };

      case 'CREATE_GROUP': {
        const group = createGroup(msg.name, msg.color, msg.emoji);
        if (msg.claimCurrentTabs) {
          await claimCurrentTabs(group.id, windowId);
        } else {
          await saveState();
        }
        return { state: buildStateForWindow(windowId), newGroupId: group.id };
      }

      case 'UPDATE_GROUP': {
        const g = groups.find(g => g.id === msg.id);
        if (g) Object.assign(g, msg.changes);
        await saveState();
        broadcast({ type: 'GROUP_UPDATED', groupId: msg.id });
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

  // Include null (ungrouped) as position -1 before the first group
  const allPositions = [null, ...groups.map(g => g.id)];
  const currentIdx   = allPositions.indexOf(ws.activeGroupId);
  let nextIdx;
  if      (command === 'group-next') nextIdx = (currentIdx + 1) % allPositions.length;
  else if (command === 'group-prev') nextIdx = (currentIdx - 1 + allPositions.length) % allPositions.length;
  else return;

  const targetId = allPositions[nextIdx];
  if (targetId !== ws.activeGroupId) await switchToGroup(targetId, win.id);
});

// ── Init ──────────────────────────────────────────────────────

(async () => {
  await loadState();
  const openWindows = await browser.windows.getAll({ populate: false });
  for (const win of openWindows) getWindowState(win.id);
  await saveState();
})();
