---
title: Peer Components
description: Sibling components sharing sources
---

Peers are sibling components that share the same sources as your component. They're useful for breaking up complex UIs into manageable pieces while keeping them tightly coupled.

## Defining Peers

```jsx
Dashboard.peers = {
  Sidebar: SidebarComponent,
  Toolbar: ToolbarComponent
}
```

## Using Peers in the View

Peer component output is available by name in the view's destructured arguments:

```jsx
function Dashboard({ state, Sidebar, Toolbar }) {
  return (
    <div className="dashboard">
      {Toolbar}
      <div className="main-area">
        {Sidebar}
        <div className="content">{state.content}</div>
      </div>
    </div>
  )
}
```
