# Tracker: a full-screen terminal app

An issue tracker that runs in a terminal with `sygnal/terminal`:

```bash
npm install
npm run terminal          # q or Ctrl+C quits
```

```
TRACKER
[Issues] [New issue] [Help]
Filter [title, label, person] Show [open ▾]
╭─ Issues ────────────────────────╮ ╭──────────────────────────────────────────╮
│• #12 H Dark mode for the       ││ │ #14 Search ignores accents (2)           │
│  settings page (2)             █│ │ open · medium · @dara · feature          │
│• #13 L Typo in the README (2)  ││ │ [Show description]                       │
│• ▸#14 M Search ignores accents ││ │ [Close] [Delete]                         │
│  (2)                           ││ │                                          │
╰─────────────────────────────────╯ ╰──────────────────────────────────────────╯
Synced 32 shown / 40 ↑↓ issues · → detail · 3 help
Enter activate · Tab next · Ctrl+C quit
```

What it uses ([src/app.jsx](src/app.jsx)):

- **Layout**: a full-screen flex column with the status bar on the last row, and the issue list beside its detail pane, the list scrolling in its own box. All of it is in the terminal stylesheet, [src/styles.js](src/styles.js); the views are plain HTML.
- **Tabs and a disclosure** from `sygnal/ui` (`tabs`, `disclosure`), with a roving tabindex and the arrow keys.
- **Keyboard shortcuts** with `keymap()`: `/` search, `n` new, `j` / `k` next / previous, `x` close or reopen, `d` delete, `1`–`3` tabs, `q` quit (the `TERMINAL` sink's `'exit'`).
- **A modal confirm**: `sygnal/ui`'s `dialog` behavior on a native `<dialog>` (`dialogAttrs` for the Delete button's ARIA). `d` writes `open: true`; Escape and Cancel close it through the behavior, and the focus goes back to the row.
- **Toasts**: `<Toaster />` (with `makeTimerDriver()`) for "#2 deleted", "#41 created", "#3 closed", drawn at the top right.
- **A form with validation** (the `form` behavior): a text input, a textarea, checkboxes, a radio group and a native `<select>`, with errors after blur or submit and the server's 422 on its field.
- **Async data**: a fake API ([src/api.js](src/api.js)) behind `makeFetchDriver({ fetch })`, with latency, so it shows a loading state.

Tests ([src/app.test.js](src/app.test.js)) drive it with `createTerminal()` (`term.run(Tracker, drivers)`, `await term.settle()`): keys, typing, pastes, mouse clicks and the wheel go in, and plain-text frames come out. `runTerminal` is tested on fake TTY streams: `npm test`.

Guide: [Terminal apps](https://sygnal.js.org/renderers/terminal). The friction log of the spike that built it: [dev-plans/research/tui-spike](../../dev-plans/research/tui-spike/README.md).
