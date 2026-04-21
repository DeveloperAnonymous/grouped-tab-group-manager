// ─────────────────────────────────────────────────────────────
//  Tab Groups — Background Script
// ─────────────────────────────────────────────────────────────

const DEFAULT_GROUP = {
  id: 'default',
  name: 'General',
  color: '#6c63ff',
  emoji: '🏠',
  snapshot: [],
  createdAt: Date.now()
};

let state = {
  groups: [DEFAULT_GROUP],
  activeGroupId: 'default',
  isSwitching: false
};

// ── Persistence ───────────────────────────────────────────────

async function saveState() {
  const { isSwitching, ...toSave } = state;
  await browser.storage.local.set({ tabGroupsState: toSave });
}

async function loadState() {
  const result = await browser.storage.local.get('tabGroupsState');
  if (result.tabGroupsState) {
    state = { ...result.tabGroupsState, isSwitching: false };
  }
}

// ── Tab helpers ───────────────────────────────────────────────

async function captureCurrentTabs(windowId) {
  const tabs = await browser.tabs.query({ windowId });
  return tabs
    .map(tab => ({
      url: tab.url,
      title: tab.title,
      pinned: tab.pinned,
      faviconUrl: tab.favIconUrl || ''
    }))
    .filter(t =>
      t.url &&
      !t.url.startsWith('about:') &&
      !t.url.startsWith('moz-extension:') &&
      !t.url.startsWith('chrome:')
    );
}

// ── Main switch ───────────────────────────────────────────────

async function switchToGroup(targetGroupId, windowId) {
  if (state.isSwitching) {
    console.log('[TabGroups] Blocked: already switching');
    return { blocked: true };
  }
  if (targetGroupId === state.activeGroupId) {
    return { alreadyActive: true };
  }

  state.isSwitching = true;
  broadcast({ type: 'SWITCHING_STARTED', targetGroupId });

  try {
    const currentGroup = state.groups.find(g => g.id === state.activeGroupId);
    const targetGroup  = state.groups.find(g => g.id === targetGroupId);
    if (!targetGroup) throw new Error('Target group not found: ' + targetGroupId);

    // 1. Snapshot current tabs
    if (currentGroup) {
      currentGroup.snapshot = await captureCurrentTabs(windowId);
    }

    // 2. Create newtab anchor — omit URL, Firefox defaults to about:newtab
    const anchor = await browser.tabs.create({
      windowId,
      active: true
    });

    // 3. Close every other tab one at a time
    const allTabs = await browser.tabs.query({ windowId });
    for (const tab of allTabs) {
      if (tab.id !== anchor.id) {
        try { await browser.tabs.remove(tab.id); } catch (_) {}
      }
    }

    // 4. Restore target group tabs
    const snap = targetGroup.snapshot || [];
    if (snap.length > 0) {
      // Reuse the anchor tab for the first URL — no newtab flash
      await browser.tabs.update(anchor.id, { url: snap[0].url, active: true });

      // Open the rest as new tabs
      for (let i = 1; i < snap.length; i++) {
        await browser.tabs.create({
          windowId,
          url: snap[i].url,
          pinned: snap[i].pinned || false,
          active: false
        });
      }
    }
    // If snapshot is empty, anchor stays open as a clean newtab

    // 5. Commit state
    state.activeGroupId = targetGroupId;
    await saveState();
    broadcast({ type: 'SWITCHING_DONE', state });
    return { success: true };

  } catch (err) {
    console.error('[TabGroups] Switch failed:', err);
    broadcast({ type: 'SWITCHING_ERROR', error: err.message });
    return { error: err.message };
  } finally {
    state.isSwitching = false;
  }
}

// ── Group CRUD ────────────────────────────────────────────────

function createGroup(name, color, emoji) {
  return {
    id: 'group_' + Date.now(),
    name:  name  || 'New Group',
    color: color || '#6c63ff',
    emoji: emoji || '📁',
    snapshot: [],
    createdAt: Date.now()
  };
}

function deleteGroup(id) {
  if (state.groups.length <= 1) return false; // never delete the last group
  state.groups = state.groups.filter(g => g.id !== id);
  // If somehow active group was deleted, fall back to first group
  if (!state.groups.find(g => g.id === state.activeGroupId)) {
    state.activeGroupId = state.groups[0].id;
  }
  return true;
}

// ── Broadcast ─────────────────────────────────────────────────

function broadcast(msg) {
  browser.runtime.sendMessage(msg).catch(() => {});
}

// ── Message handler ───────────────────────────────────────────

browser.runtime.onMessage.addListener((msg) => {
  return (async () => {
    switch (msg.type) {

      case 'GET_STATE':
        return { state };

      case 'SWITCH_GROUP': {
        let windowId = msg.windowId;
        if (!windowId) {
          const win = await browser.windows.getLastFocused();
          windowId = win.id;
        }
        const result = await switchToGroup(msg.groupId, windowId);
        return { ...result, state };
      }

      case 'CREATE_GROUP': {
        const group = createGroup(msg.name, msg.color, msg.emoji);
        state.groups.push(group);
        await saveState();
        return { state, newGroupId: group.id };
      }

      case 'UPDATE_GROUP': {
        const g = state.groups.find(g => g.id === msg.id);
        if (g) Object.assign(g, msg.changes);
        await saveState();
        return { state };
      }

      case 'DELETE_GROUP': {
        const ok = deleteGroup(msg.id);
        if (ok) await saveState();
        return { state, success: ok };
      }
    }
  })();
});

// ── Keyboard commands ─────────────────────────────────────────

browser.commands.onCommand.addListener(async (command) => {
  const result = await browser.storage.local.get('groupedSettings');
  const s = { keybindsEnabled: true, ...(result.groupedSettings || {}) };
  if (!s.keybindsEnabled || state.isSwitching) return;

  const groups = state.groups;
  const currentIdx = groups.findIndex(g => g.id === state.activeGroupId);
  let nextIdx;

  if (command === 'group-next') {
    nextIdx = (currentIdx + 1) % groups.length;
  } else if (command === 'group-prev') {
    nextIdx = (currentIdx - 1 + groups.length) % groups.length;
  } else {
    return;
  }

  const target = groups[nextIdx];
  if (!target || target.id === state.activeGroupId) return;

  const win = await browser.windows.getLastFocused({ populate: false });
  await switchToGroup(target.id, win.id);
});

// ── Init ──────────────────────────────────────────────────────

(async () => {
  await loadState();
  if (!state.groups.find(g => g.id === 'default')) {
    state.groups.unshift({ ...DEFAULT_GROUP });
    await saveState();
  }
  state.isSwitching = false;
})();
