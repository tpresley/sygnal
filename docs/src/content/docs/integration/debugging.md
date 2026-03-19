---
title: Debugging
description: Debug tools and techniques
---

## Per-Component Debug

Enable debug logging for a specific component:

```jsx
MyComponent.debug = true
```

## Global Debug

Set the environment variable:

```
SYGNAL_DEBUG=true
```

## Debug Output

When enabled, Sygnal logs:
- Component instantiation with a unique component number
- Action triggers and the data they carry
- State changes before and after reducers
- Driver interactions

Each log entry is prefixed with the component number and name (e.g., `3 | MyComponent`) for easy identification.
