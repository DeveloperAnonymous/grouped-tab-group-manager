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

## Permissions

- **`tabs`**: Read and manage open tabs
- **`storage`**: Save group snapshots across sessions
- **`sessions`**: Reserved for future session restore features
