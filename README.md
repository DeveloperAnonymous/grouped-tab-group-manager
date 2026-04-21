# Grouped — Tab Group Manager

Safari-style tab groups for Firefox. Organize your tabs into named groups and switch between them — inactive groups are fully unloaded from memory, so only the tabs you're using right now are ever open.

## How it works

Unlike Chrome/Firefox's built-in tab grouping (which just visually groups tabs but keeps them all loaded), **Grouped** works like Safari:

- Switching groups **closes** your current tabs and **reopens** the new group's tabs
- Inactive groups are stored as snapshots — URL lists only, zero memory cost
- Only one group's worth of tabs is ever live at a time

## Features

- ✦ Create unlimited tab groups with a custom name, emoji, and color
- ✦ Switch groups — current tabs are saved and closed, new group's tabs open fresh
- ✦ Tab count shown per group so you always know what's waiting
- ✦ UI locks during switching to prevent accidental double-switches
- ✦ Groups and snapshots persist across browser restarts
- ✦ Delete groups with a two-tap confirmation (no accidental deletions)

## Installation (Developer / Temporary)

1. Download and unzip `tab-groups-extension.zip`
2. Open Firefox and go to `about:debugging`
3. Click **This Firefox** → **Load Temporary Add-on…**
4. Select the `manifest.json` file inside the unzipped folder

> Note: Temporary add-ons are removed when Firefox closes. To install permanently, the extension would need to be signed via [addons.mozilla.org](https://addons.mozilla.org).

## Permissions

| Permission | Why |
|---|---|
| `tabs` | Read and manage open tabs |
| `storage` | Save group snapshots across sessions |
| `sessions` | Reserved for future session restore features |

## Limitations (extension vs. native)

Because this is a WebExtension, a few things aren't possible that would work in a full Firefox fork:

- **Privileged pages** (`about:debugging`, `about:addons`, `moz-extension://` pages) cannot be saved or restored — they're excluded from snapshots silently
- **The group switcher lives in the toolbar popup**, not inline in the tab bar like Safari
- **Per-window group state** isn't tracked separately — all windows share the same active group

These are all solvable at the native fork level.

## Roadmap (for the native fork)

- [ ] Group switcher strip inline in the browser chrome above the tab bar
- [ ] Per-window independent group state
- [ ] Restore privileged pages (full chrome privileges)
- [ ] Keyboard shortcut to switch groups
- [ ] Drag tabs between groups
- [ ] Group import/export
