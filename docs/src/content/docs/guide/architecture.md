---
title: Architecture
description: Understanding Sygnal's Model-View-Intent architecture
---

Sygnal is built on [Cycle.js](https://cycle.js.org/) and uses the **Model-View-Intent (MVI)** architecture. This pattern separates application logic into three concerns:

```
DOM Events ──→ Intent (WHEN) ──→ Model (WHAT) ──→ State ──→ View (HOW) ──→ DOM
                  ↑                                                          │
                  └──────────────────────────────────────────────────────────┘
```

- **Intent** — Determines *when* actions should happen by observing driver sources (DOM events, API responses, timers, etc.)
- **Model** — Determines *what* should happen by defining reducers that produce new state or commands for drivers
- **View** — Determines *how* things are displayed by rendering the current state as virtual DOM

All side effects (DOM updates, network calls, storage) are handled by **drivers**, keeping your component code 100% pure.

## Why This Matters

Pure components mean:
- No hidden mutations or surprise side effects
- Predictable, testable behavior
- Easy state restoration, undo/redo, and time-travel debugging
- Components can be safely re-created or hot-reloaded at any time
