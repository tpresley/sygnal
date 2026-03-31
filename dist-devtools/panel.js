'use strict'

const PAGE_SOURCE = '__SYGNAL_DEVTOOLS_PAGE__'
const EXT_SOURCE = '__SYGNAL_DEVTOOLS_EXTENSION__'

// ─── Diff Engine ───────────────────────────────────────────────────────────────

function computeDiff(prev, next, path) {
  path = path || ''
  const diffs = []

  if (prev === next) return diffs
  if (prev === null || prev === undefined || next === null || next === undefined) {
    if (prev == null && next != null) {
      diffs.push({ path: path || '(root)', type: 'added', oldValue: prev, newValue: next })
    } else if (prev != null && next == null) {
      diffs.push({ path: path || '(root)', type: 'removed', oldValue: prev, newValue: next })
    } else if (prev !== next) {
      diffs.push({ path: path || '(root)', type: 'changed', oldValue: prev, newValue: next })
    }
    return diffs
  }

  const prevType = typeof prev
  const nextType = typeof next

  if (prevType !== nextType || prevType !== 'object') {
    if (prev !== next) {
      diffs.push({ path: path || '(root)', type: 'changed', oldValue: prev, newValue: next })
    }
    return diffs
  }

  const prevIsArray = Array.isArray(prev)
  const nextIsArray = Array.isArray(next)

  if (prevIsArray !== nextIsArray) {
    diffs.push({ path: path || '(root)', type: 'changed', oldValue: prev, newValue: next })
    return diffs
  }

  if (prevIsArray) {
    const maxLen = Math.max(prev.length, next.length)
    for (let i = 0; i < maxLen; i++) {
      const itemPath = path ? `${path}[${i}]` : `[${i}]`
      if (i >= prev.length) {
        diffs.push({ path: itemPath, type: 'added', oldValue: undefined, newValue: next[i] })
      } else if (i >= next.length) {
        diffs.push({ path: itemPath, type: 'removed', oldValue: prev[i], newValue: undefined })
      } else {
        diffs.push(...computeDiff(prev[i], next[i], itemPath))
      }
    }
    return diffs
  }

  // Objects
  const allKeys = new Set([...Object.keys(prev), ...Object.keys(next)])
  for (const key of allKeys) {
    const keyPath = path ? `${path}.${key}` : key
    if (!(key in prev)) {
      diffs.push({ path: keyPath, type: 'added', oldValue: undefined, newValue: next[key] })
    } else if (!(key in next)) {
      diffs.push({ path: keyPath, type: 'removed', oldValue: prev[key], newValue: undefined })
    } else {
      diffs.push(...computeDiff(prev[key], next[key], keyPath))
    }
  }

  return diffs
}

function formatValue(val) {
  if (val === undefined) return 'undefined'
  if (val === null) return 'null'
  if (typeof val === 'string') return `"${val}"`
  if (typeof val === 'object') {
    try { return JSON.stringify(val) } catch { return String(val) }
  }
  return String(val)
}

function escapeHtml(str) {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

function formatRelativeTime(ts) {
  const diff = Date.now() - ts
  if (diff < 1000) return 'just now'
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  return `${Math.floor(diff / 3600000)}h ago`
}

function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

// ─── Panel Controller ─────────────────────────────────────────────────────────

class SygnalPanel {
  constructor() {
    this.port = null
    this.components = new Map()
    this.history = []
    this.busEvents = []
    this.commands = []
    this.snapshots = []
    this.selectedId = null
    this.selectedTab = 'state'
    this.componentData = new Map()
    this.rewoundComponentId = null
    this.showDiff = false
    this.activeView = 'history' // 'history', 'events', or 'commands'
    this.showDisposed = false

    this.treeView = new ComponentTreeView(this)
    this.inspectorView = new StateInspectorView(this)
    this.historyView = new StateHistoryView(this)
    this.eventsView = new EventsMonitorView(this)
    this.commandsView = new CommandsView(this)

    this._initPort()
    this._initUI()
  }

  _initPort() {
    try {
      this.port = chrome.runtime.connect({ name: 'sygnal-devtools-panel' })
    } catch (e) {
      // Extension context invalidated (extension was reloaded while panel was open)
      this.port = null
      console.warn('[Sygnal DevTools] Extension context invalidated — close and reopen DevTools to reconnect.')
      this._showReloadBanner()
      return
    }

    this.port.postMessage({ type: 'INIT', tabId: chrome.devtools.inspectedWindow.tabId })

    this.port.onMessage.addListener((msg) => {
      if (msg.source !== PAGE_SOURCE) return
      this._handleMessage(msg)
    })

    this.port.onDisconnect.addListener(() => {
      this.port = null
      setTimeout(() => this._initPort(), 1000)
    })
  }

  _showReloadBanner() {
    let banner = document.getElementById('reload-banner')
    if (banner) return
    banner = document.createElement('div')
    banner.id = 'reload-banner'
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;padding:8px 12px;background:#d32f2f;color:#fff;font-size:13px;text-align:center;z-index:9999;'
    banner.textContent = 'Extension was reloaded — close and reopen DevTools to reconnect.'
    document.body.prepend(banner)
  }

  _initUI() {
    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
        tab.classList.add('active')
        this.selectedTab = tab.dataset.tab
        this._renderInspector()
      })
    })

    // Debug all toggle
    document.getElementById('debug-all').addEventListener('change', (e) => {
      this._send('SET_DEBUG', { componentId: null, enabled: e.target.checked })
    })

    // Show disposed toggle
    document.getElementById('show-disposed').addEventListener('change', (e) => {
      this.showDisposed = e.target.checked
      this.treeView.render()
    })

    // Refresh button
    document.getElementById('refresh-btn').addEventListener('click', () => {
      this._send('CONNECT', {})
    })

    // Clear history/events/commands
    document.getElementById('clear-history-btn').addEventListener('click', () => {
      if (this.activeView === 'history') {
        this.history = []
        this.rewoundComponentId = null
        this._updateRewoundBadge()
        this.historyView.render()
      } else if (this.activeView === 'events') {
        this.busEvents = []
        this.eventsView.render()
      } else if (this.activeView === 'commands') {
        this.commands = []
        this.commandsView.render()
      }
    })

    // Snapshot button
    document.getElementById('snapshot-btn').addEventListener('click', () => {
      this._send('SNAPSHOT', {})
    })

    // Diff toggle
    const diffToggle = document.getElementById('diff-toggle-btn')
    if (diffToggle) {
      diffToggle.addEventListener('click', () => {
        this.showDiff = !this.showDiff
        diffToggle.classList.toggle('active', this.showDiff)
      })
    }

    // History/Events/Commands view toggle
    const setActiveView = (view) => {
      this.activeView = view
      document.getElementById('view-history-btn').classList.toggle('active', view === 'history')
      document.getElementById('view-events-btn').classList.toggle('active', view === 'events')
      document.getElementById('view-cmds-btn').classList.toggle('active', view === 'commands')
      document.getElementById('history-filter-bar').style.display = view === 'history' ? '' : 'none'
      document.getElementById('history-container').style.display = view === 'history' ? '' : 'none'
      document.getElementById('events-container').style.display = view === 'events' ? '' : 'none'
      document.getElementById('commands-container').style.display = view === 'commands' ? '' : 'none'
      document.getElementById('diff-toggle-btn').style.display = view === 'history' ? '' : 'none'
      if (view === 'events') this.eventsView.render()
      if (view === 'commands') this.commandsView.render()
    }
    document.getElementById('view-history-btn').addEventListener('click', () => setActiveView('history'))
    document.getElementById('view-events-btn').addEventListener('click', () => setActiveView('events'))
    document.getElementById('view-cmds-btn').addEventListener('click', () => setActiveView('commands'))

    // History filter toggles
    this.historyView._initFilters()
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case 'FULL_TREE':
        this._handleFullTree(msg.payload)
        break
      case 'COMPONENT_CREATED':
        this._handleComponentCreated(msg.payload)
        break
      case 'STATE_CHANGED':
        this._handleStateChanged(msg.payload)
        break
      case 'ACTION_DISPATCHED':
        this._handleActionDispatched(msg.payload)
        break
      case 'TREE_UPDATED':
        this._handleTreeUpdated(msg.payload)
        break
      case 'CONTEXT_CHANGED':
        this._handleContextChanged(msg.payload)
        break
      case 'COMPONENT_STATE':
        this._handleComponentState(msg.payload)
        break
      case 'PROPS_CHANGED':
        this._handlePropsChanged(msg.payload)
        break
      case 'BUS_EVENT':
        this._handleBusEvent(msg.payload)
        break
      case 'COMPONENT_DISPOSED':
        this._handleComponentDisposed(msg.payload)
        break
      case 'DEBUG_LOG':
        this._handleDebugLog(msg.payload)
        break
      case 'DEBUG_TOGGLED':
        this._handleDebugToggled(msg.payload)
        break
      case 'TIME_TRAVEL_APPLIED':
        this._handleTimeTravelApplied(msg.payload)
        break
      case 'COMMAND_SENT':
        this._handleCommandSent(msg.payload)
        break
      case 'READY_CHANGED':
        this._handleReadyChanged(msg.payload)
        break
      case 'COLLECTION_MOUNTED':
        this._handleCollectionMounted(msg.payload)
        break
      case 'SNAPSHOT_TAKEN':
        this._handleSnapshotTaken(msg.payload)
        break
    }
  }

  _handleFullTree({ components, history }) {
    this.components.clear()
    this.componentData.clear()
    for (const comp of components) {
      this.components.set(comp.id, comp)
      this.componentData.set(comp.id, {
        state: comp.state,
        context: comp.context,
        props: comp.props || null
      })
    }
    this.history = history || []
    this.treeView.render()
    this.historyView.render()
    if (this.selectedId !== null) {
      this._renderInspector()
    }
  }

  _handleComponentCreated(comp) {
    this.components.set(comp.id, comp)
    this.treeView.render()
  }

  _handleStateChanged({ componentId, componentName, state }) {
    const data = this.componentData.get(componentId) || { state: null, context: null, props: null }
    const prevState = data.state
    data.state = state
    this.componentData.set(componentId, data)

    if (this.rewoundComponentId === componentId) {
      this.rewoundComponentId = null
      this._updateRewoundBadge()
    }

    this.history.push({
      componentId,
      componentName,
      state,
      prevState,
      timestamp: Date.now()
    })

    if (this.history.length > 200) this.history.shift()

    if (this.selectedId === componentId) {
      this._renderInspector()
    }
    this.historyView.render()
  }

  _handleActionDispatched({ componentId, componentName, actionType, data, timestamp }) {
    this.history.push({
      componentId,
      componentName,
      actionType,
      data,
      timestamp,
      isAction: true
    })
    if (this.history.length > 200) this.history.shift()
    this.historyView.render()
  }

  _handleTreeUpdated({ parentId, childId }) {
    const parent = this.components.get(parentId)
    const child = this.components.get(childId)
    if (parent && child) {
      child.parentId = parentId
      if (!parent.children) parent.children = []
      if (!parent.children.includes(childId)) parent.children.push(childId)
    }
    this.treeView.render()
  }

  _handleContextChanged({ componentId, componentName, context, contextTrace }) {
    const data = this.componentData.get(componentId) || { state: null, context: null, props: null }
    data.context = context
    data.contextTrace = contextTrace || null
    this.componentData.set(componentId, data)
    if (this.selectedId === componentId && this.selectedTab === 'context') {
      this._renderInspector()
    }
  }

  _handleComponentState({ componentId, state, context, contextTrace, props }) {
    this.componentData.set(componentId, { state, context, contextTrace: contextTrace || null, props })
    if (this.selectedId === componentId) {
      this._renderInspector()
    }
  }

  _handlePropsChanged({ componentId, componentName, props }) {
    const data = this.componentData.get(componentId) || { state: null, context: null, props: null }
    data.props = props
    this.componentData.set(componentId, data)
    if (this.selectedId === componentId && this.selectedTab === 'props') {
      this._renderInspector()
    }
  }

  _handleBusEvent({ type, data, componentId, componentName, timestamp }) {
    this.busEvents.push({ type, data, componentId, componentName, timestamp })
    if (this.busEvents.length > 500) this.busEvents.shift()
    if (this.activeView === 'events') {
      this.eventsView.render()
    }
  }

  _handleReadyChanged({ parentId, parentName, childKey, ready, timestamp }) {
    this.history.push({
      componentId: parentId,
      componentName: parentName,
      isReady: true,
      childKey,
      ready,
      timestamp,
    })
    if (this.history.length > 2000) this.history.shift()
    this.historyView.render()
  }

  _handleSnapshotTaken({ entries, timestamp }) {
    this.snapshots.push({ entries, timestamp })
    if (this.snapshots.length > 20) this.snapshots.shift()

    // Add to history as a special entry
    this.history.push({
      componentName: 'Global',
      isSnapshot: true,
      snapshotIndex: this.snapshots.length - 1,
      entryCount: entries.length,
      timestamp,
    })
    if (this.history.length > 2000) this.history.shift()
    this.historyView.render()
  }

  _handleCollectionMounted({ parentId, parentName, itemComponent, stateField }) {
    const comp = this.components.get(parentId)
    if (comp) {
      comp.collection = { itemComponent, stateField }
      this.treeView.render()
    }
  }

  _handleCommandSent({ type, data, targetComponentName, timestamp }) {
    this.commands.push({ type, data, targetComponentName, timestamp })
    if (this.commands.length > 500) this.commands.shift()
    if (this.activeView === 'commands') {
      this.commandsView.render()
    }
  }

  _handleComponentDisposed({ componentId, componentName, timestamp }) {
    const comp = this.components.get(componentId)
    if (comp) {
      comp.disposed = true
      comp.disposedAt = timestamp

      // Remove from parent's children
      if (comp.parentId != null) {
        const parent = this.components.get(comp.parentId)
        if (parent && parent.children) {
          parent.children = parent.children.filter(id => id !== componentId)
        }
      }
    }

    // Add disposal entry to history
    this.history.push({
      componentId,
      componentName,
      timestamp,
      isDisposal: true
    })
    if (this.history.length > 200) this.history.shift()

    this.treeView.render()
    this.historyView.render()
  }

  _handleDebugLog({ componentId, message, timestamp }) {
    this.history.push({
      componentId,
      componentName: this.components.get(componentId)?.name || '?',
      message,
      timestamp,
      isDebugLog: true
    })
    if (this.history.length > 200) this.history.shift()
    this.historyView.render()
  }

  _handleDebugToggled({ componentId, global, enabled }) {
    if (global) {
      document.getElementById('debug-all').checked = enabled
    } else {
      const comp = this.components.get(componentId)
      if (comp) {
        comp.debug = enabled
        this.treeView.render()
      }
    }
  }

  _handleTimeTravelApplied({ componentId, componentName, state }) {
    this.rewoundComponentId = componentId
    this._updateRewoundBadge(componentName)

    if (componentId != null) {
      this.selectedId = componentId
      const data = this.componentData.get(componentId) || { state: null, context: null, props: null }
      data.state = state
      this.componentData.set(componentId, data)
      this.selectedTab = 'state'

      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
      const stateTab = document.querySelector('.tab[data-tab="state"]')
      if (stateTab) stateTab.classList.add('active')

      this.treeView.render()
      this._renderInspector()
    }
  }

  _updateRewoundBadge(componentName) {
    const badge = document.getElementById('rewound-badge')
    if (!badge) return
    if (this.rewoundComponentId != null) {
      badge.textContent = `Rewound: ${componentName || '?'}`
      badge.style.display = 'inline-block'
    } else {
      badge.style.display = 'none'
    }
  }

  selectComponent(id) {
    this.selectedId = id
    this.treeView.render()
    this._send('GET_STATE', { componentId: id })
    this._renderInspector()
  }

  toggleDebug(componentId, enabled) {
    this._send('SET_DEBUG', { componentId, enabled })
  }

  timeTravel(entry) {
    this._send('TIME_TRAVEL', {
      componentId: entry.componentId,
      componentName: entry.componentName,
      state: entry.state,
    })
  }

  _renderInspector() {
    const comp = this.components.get(this.selectedId)
    const title = document.getElementById('inspector-title')
    if (!comp) {
      title.textContent = 'Select a component'
      document.getElementById('inspector-json').innerHTML = ''
      return
    }

    title.textContent = `${comp.name} #${comp.id}`

    if (this.selectedTab === 'meta') {
      this._renderMeta(comp)
      return
    }

    if (this.selectedTab === 'graph') {
      this._renderGraph(comp)
      return
    }

    if (this.selectedTab === 'context') {
      this._renderContext()
      return
    }

    const data = this.componentData.get(this.selectedId)
    const value = data ? data[this.selectedTab] : null
    this.inspectorView.render(value)
  }

  _renderContext() {
    const container = document.getElementById('inspector-json')
    container.innerHTML = ''
    const data = this.componentData.get(this.selectedId)
    if (!data?.context) {
      container.innerHTML = '<div class="empty-state">No context</div>'
      return
    }

    const trace = data.contextTrace
    if (!trace || trace.length === 0) {
      // Fall back to flat JSON view
      this.inspectorView.render(data.context)
      return
    }

    // Group fields by provider
    const groups = new Map()
    for (const entry of trace) {
      const key = `${entry.providerName}#${entry.providerId}`
      if (!groups.has(key)) {
        groups.set(key, { providerId: entry.providerId, providerName: entry.providerName, fields: [] })
      }
      groups.get(key).fields.push(entry.field)
    }

    const wrapper = document.createElement('div')
    wrapper.className = 'meta-grid'

    for (const [, group] of groups) {
      const section = document.createElement('div')
      section.className = 'meta-section'

      const title = document.createElement('div')
      title.className = 'meta-section-title'
      if (group.providerId >= 0) {
        title.innerHTML = `From: <span class="tree-name" style="cursor:pointer">${escapeHtml(group.providerName)}</span> <span class="tree-id">#${group.providerId}</span>`
        title.querySelector('.tree-name').addEventListener('click', () => this.selectComponent(group.providerId))
      } else {
        title.textContent = 'From: unknown'
      }
      section.appendChild(title)

      for (const field of group.fields) {
        const row = document.createElement('div')
        row.className = 'meta-info-row'
        const value = data.context[field]
        const valStr = value === null ? 'null' : value === undefined ? 'undefined' : typeof value === 'object' ? JSON.stringify(value) : String(value)
        row.innerHTML = `<span class="meta-info-key">${escapeHtml(field)}</span><span class="meta-info-value">${escapeHtml(valStr)}</span>`
        section.appendChild(row)
      }

      wrapper.appendChild(section)
    }

    container.appendChild(wrapper)
  }

  _renderMeta(comp) {
    const container = document.getElementById('inspector-json')
    container.innerHTML = ''

    const grid = document.createElement('div')
    grid.className = 'meta-grid'

    const capabilities = [
      ['Model', comp.hasModel],
      ['Intent', comp.hasIntent],
      ['Context', comp.hasContext],
      ['Calculated', comp.hasCalculated],
    ]

    // Capability badges
    const capSection = document.createElement('div')
    capSection.className = 'meta-section'
    capSection.innerHTML = '<div class="meta-section-title">Capabilities</div>'
    const badgeRow = document.createElement('div')
    badgeRow.className = 'meta-badge-row'
    for (const [label, active] of capabilities) {
      const badge = document.createElement('span')
      badge.className = 'meta-badge ' + (active ? 'active' : 'inactive')
      badge.textContent = (active ? '\u2713 ' : '\u2014 ') + label
      badgeRow.appendChild(badge)
    }
    capSection.appendChild(badgeRow)
    grid.appendChild(capSection)

    // Info section
    const infoSection = document.createElement('div')
    infoSection.className = 'meta-section'
    infoSection.innerHTML = '<div class="meta-section-title">Info</div>'
    const infoPairs = [
      ['ID', `#${comp.id}`],
      ['Sub-component', comp.isSubComponent ? 'Yes' : 'No (root)'],
      ['Debug', comp.debug ? 'Enabled' : 'Disabled'],
      ['Created', formatRelativeTime(comp.createdAt)],
    ]
    if (comp.disposed) {
      infoPairs.push(['Disposed', formatRelativeTime(comp.disposedAt)])
    }
    for (const [key, val] of infoPairs) {
      const row = document.createElement('div')
      row.className = 'meta-info-row'
      row.innerHTML = `<span class="meta-info-key">${escapeHtml(key)}</span><span class="meta-info-value">${escapeHtml(val)}</span>`
      infoSection.appendChild(row)
    }
    grid.appendChild(infoSection)

    // Sub-components section
    if (comp.components && comp.components.length > 0) {
      const subSection = document.createElement('div')
      subSection.className = 'meta-section'
      subSection.innerHTML = '<div class="meta-section-title">Registered Sub-components</div>'
      for (const name of comp.components) {
        const item = document.createElement('div')
        item.className = 'meta-sub-component'
        item.textContent = name
        subSection.appendChild(item)
      }
      grid.appendChild(subSection)
    }

    // Children section
    if (comp.children && comp.children.length > 0) {
      const childSection = document.createElement('div')
      childSection.className = 'meta-section'
      childSection.innerHTML = `<div class="meta-section-title">Active Children (${comp.children.length})</div>`
      for (const childId of comp.children) {
        const child = this.components.get(childId)
        if (child) {
          const item = document.createElement('div')
          item.className = 'meta-sub-component'
          item.innerHTML = `<span class="tree-name">${escapeHtml(child.name)}</span> <span class="tree-id">#${child.id}</span>`
          item.style.cursor = 'pointer'
          item.addEventListener('click', () => this.selectComponent(childId))
          childSection.appendChild(item)
        }
      }
      grid.appendChild(childSection)
    }

    container.appendChild(grid)
  }

  _renderGraph(comp) {
    const container = document.getElementById('inspector-json')
    container.innerHTML = ''

    const graph = comp.mviGraph
    if (!graph) {
      container.innerHTML = '<div class="empty-state">No MVI graph data</div>'
      return
    }

    const wrapper = document.createElement('div')
    wrapper.className = 'graph-container'

    // Collect unique sinks from all actions
    const allSinks = new Set()
    for (const action of graph.actions) {
      for (const sink of action.sinks) allSinks.add(sink)
    }
    const sinks = [...allSinks]

    // Sink colors
    const sinkColors = {
      STATE: '#1a73e8', DOM: '#2e7d32', EVENTS: '#7b1fa2',
      EFFECT: '#f57c00', PARENT: '#00897b', HTTP: '#ff8f00',
      READY: '#0097a7',
    }
    const defaultColor = '#757575'

    // Build three columns
    const cols = document.createElement('div')
    cols.className = 'graph-columns'

    // Sources column
    const srcCol = document.createElement('div')
    srcCol.className = 'graph-column'
    srcCol.innerHTML = '<div class="graph-column-title">Sources</div>'
    for (const src of graph.sources) {
      const node = document.createElement('div')
      node.className = 'graph-node graph-source'
      node.textContent = src
      srcCol.appendChild(node)
    }
    cols.appendChild(srcCol)

    // Actions column
    const actCol = document.createElement('div')
    actCol.className = 'graph-column'
    actCol.innerHTML = '<div class="graph-column-title">Actions</div>'
    for (const action of graph.actions) {
      const node = document.createElement('div')
      node.className = 'graph-node graph-action'
      node.textContent = action.name

      // Show sink targets as colored dots
      const dots = document.createElement('span')
      dots.className = 'graph-action-sinks'
      for (const sink of action.sinks) {
        const dot = document.createElement('span')
        dot.className = 'graph-sink-dot'
        dot.style.background = sinkColors[sink] || defaultColor
        dot.title = sink
        dots.appendChild(dot)
      }
      node.appendChild(dots)
      actCol.appendChild(node)
    }
    cols.appendChild(actCol)

    // Sinks column
    const sinkCol = document.createElement('div')
    sinkCol.className = 'graph-column'
    sinkCol.innerHTML = '<div class="graph-column-title">Sinks</div>'
    for (const sink of sinks) {
      const node = document.createElement('div')
      node.className = 'graph-node graph-sink'
      node.style.borderLeftColor = sinkColors[sink] || defaultColor
      node.style.color = sinkColors[sink] || defaultColor
      node.textContent = sink
      sinkCol.appendChild(node)
    }
    cols.appendChild(sinkCol)

    wrapper.appendChild(cols)

    // Context provides
    if (graph.contextProvides && graph.contextProvides.length > 0) {
      const ctxSection = document.createElement('div')
      ctxSection.className = 'graph-context-section'
      ctxSection.innerHTML = '<div class="graph-column-title">Context Provides</div>'
      for (const field of graph.contextProvides) {
        const node = document.createElement('div')
        node.className = 'graph-node graph-context'
        node.textContent = field
        ctxSection.appendChild(node)
      }
      wrapper.appendChild(ctxSection)
    }

    container.appendChild(wrapper)
  }

  _send(type, payload) {
    if (!this.port) {
      console.warn(`[Sygnal DevTools] Cannot send ${type} — port disconnected`)
      return
    }
    try {
      this.port.postMessage({ type, payload })
    } catch (e) {
      console.warn(`[Sygnal DevTools] Failed to send ${type}:`, e.message)
      this.port = null
      this._showReloadBanner()
    }
  }
}

// ─── Component Tree View ──────────────────────────────────────────────────────

class ComponentTreeView {
  constructor(panel) {
    this.panel = panel
    this.expanded = new Set()
    this.container = document.getElementById('tree-container')
    this.filterText = ''

    const searchInput = document.getElementById('tree-search')
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.filterText = e.target.value.toLowerCase()
        this.render()
      })
    }
  }

  render() {
    const { components } = this.panel
    this.container.innerHTML = ''

    // Compute matching IDs for search filter
    let matchingIds = null
    if (this.filterText) {
      matchingIds = new Set()
      for (const [id, comp] of components) {
        if (comp.name.toLowerCase().includes(this.filterText)) {
          matchingIds.add(id)
          // Include all ancestors so the path is visible
          let parentId = comp.parentId
          while (parentId != null) {
            matchingIds.add(parentId)
            const parent = components.get(parentId)
            parentId = parent ? parent.parentId : null
          }
        }
      }
    }

    // Find root nodes (no parent, not disposed unless showing disposed)
    const roots = []
    for (const [id, comp] of components) {
      if (comp.parentId === null || comp.parentId === undefined) {
        if (comp.disposed && !this.panel.showDisposed) continue
        if (matchingIds && !matchingIds.has(id)) continue
        roots.push(comp)
      }
    }

    if (roots.length === 0) {
      this.container.innerHTML = '<div class="empty-state">No components detected</div>'
      return
    }

    for (const root of roots) {
      this.container.appendChild(this._buildNode(root, matchingIds))
    }
  }

  _getCollectionItemCount(comp) {
    if (!comp.collection?.stateField) return null
    const data = this.panel.componentData.get(comp.id)
    const state = data?.state
    if (state && typeof state === 'object' && Array.isArray(state[comp.collection.stateField])) {
      return state[comp.collection.stateField].length
    }
    return null
  }

  _buildNode(comp, matchingIds) {
    const el = document.createElement('div')
    el.className = 'tree-node'

    const isDisposed = comp.disposed
    const activeChildren = (comp.children || []).filter(childId => {
      const child = this.panel.components.get(childId)
      if (!child) return false
      if (child.disposed && !this.panel.showDisposed) return false
      if (matchingIds && !matchingIds.has(childId)) return false
      return true
    })
    const hasChildren = activeChildren.length > 0
    const isExpanded = this.expanded.has(comp.id) || (matchingIds && this.filterText)

    // Row
    const row = document.createElement('div')
    row.className = 'tree-node-row'
    if (this.panel.selectedId === comp.id) row.classList.add('selected')
    if (isDisposed) row.classList.add('disposed')

    // Arrow
    const arrow = document.createElement('span')
    arrow.className = 'tree-arrow ' + (hasChildren ? (isExpanded ? 'expanded' : 'collapsed') : 'leaf')
    if (hasChildren) {
      arrow.addEventListener('click', (e) => {
        e.stopPropagation()
        if (this.expanded.has(comp.id)) {
          this.expanded.delete(comp.id)
        } else {
          this.expanded.add(comp.id)
        }
        this.render()
      })
    }
    row.appendChild(arrow)

    // Name (with search highlight)
    const name = document.createElement('span')
    name.className = 'tree-name' + (isDisposed ? ' disposed' : '')
    if (this.filterText && comp.name.toLowerCase().includes(this.filterText)) {
      const idx = comp.name.toLowerCase().indexOf(this.filterText)
      const before = comp.name.slice(0, idx)
      const match = comp.name.slice(idx, idx + this.filterText.length)
      const after = comp.name.slice(idx + this.filterText.length)
      name.innerHTML = `${escapeHtml(before)}<mark>${escapeHtml(match)}</mark>${escapeHtml(after)}`
    } else {
      name.textContent = comp.name
    }
    row.appendChild(name)

    // ID badge
    const idBadge = document.createElement('span')
    idBadge.className = 'tree-id'
    idBadge.textContent = `#${comp.id}`
    row.appendChild(idBadge)

    // Collection badge
    if (comp.collection) {
      const badge = document.createElement('span')
      badge.className = 'tree-collection-badge'
      const itemCount = this._getCollectionItemCount(comp)
      badge.textContent = `[${comp.collection.itemComponent}${itemCount != null ? ': ' + itemCount : ''}]`
      badge.title = `Collection of ${comp.collection.itemComponent}${comp.collection.stateField ? ' from state.' + comp.collection.stateField : ''}`
      row.appendChild(badge)
    }

    // Debug toggle (not for disposed)
    if (!isDisposed) {
      const debug = document.createElement('span')
      debug.className = 'tree-debug-toggle' + (comp.debug ? ' active' : '')
      debug.textContent = '\uD83D\uDC1B'
      debug.title = comp.debug ? 'Disable debug' : 'Enable debug'
      debug.addEventListener('click', (e) => {
        e.stopPropagation()
        this.panel.toggleDebug(comp.id, !comp.debug)
        comp.debug = !comp.debug
        this.render()
      })
      row.appendChild(debug)
    }

    row.addEventListener('click', () => this.panel.selectComponent(comp.id))
    el.appendChild(row)

    // Children
    if (hasChildren) {
      const childContainer = document.createElement('div')
      childContainer.className = 'tree-children' + (isExpanded ? '' : ' collapsed')
      for (const childId of activeChildren) {
        const childComp = this.panel.components.get(childId)
        if (childComp) {
          childContainer.appendChild(this._buildNode(childComp, matchingIds))
        }
      }
      el.appendChild(childContainer)
    }

    return el
  }
}

// ─── State Inspector View ─────────────────────────────────────────────────────

class StateInspectorView {
  constructor(panel) {
    this.panel = panel
    this.container = document.getElementById('inspector-json')
  }

  render(value) {
    this.container.innerHTML = ''
    if (value === null || value === undefined) {
      this.container.innerHTML = '<span class="json-null">null</span>'
      return
    }
    if (typeof value === 'string' && value === '[unserializable]') {
      this.container.innerHTML = '<span class="json-null">[unserializable]</span>'
      return
    }
    this.container.appendChild(this._buildJsonTree(value, '', true))
  }

  renderDiff(prevState, nextState) {
    this.container.innerHTML = ''
    if (!prevState && !nextState) {
      this.container.innerHTML = '<span class="json-null">No data</span>'
      return
    }
    if (!prevState) {
      this.container.innerHTML = '<div class="diff-view"><div class="diff-added">Initial state (no previous)</div></div>'
      this.container.appendChild(this._buildJsonTree(nextState, '', true))
      return
    }

    const diffs = computeDiff(prevState, nextState)
    if (diffs.length === 0) {
      this.container.innerHTML = '<div class="diff-view" style="color: #888; font-style: italic;">No changes</div>'
      return
    }

    const diffContainer = document.createElement('div')
    diffContainer.className = 'diff-view'

    for (const diff of diffs) {
      const line = document.createElement('div')
      line.className = 'diff-line'

      const pathSpan = document.createElement('span')
      pathSpan.className = 'diff-path'
      pathSpan.textContent = diff.path

      if (diff.type === 'added') {
        line.classList.add('diff-added')
        line.appendChild(pathSpan)
        line.appendChild(document.createTextNode(': '))
        const val = document.createElement('span')
        val.className = 'diff-value'
        val.textContent = formatValue(diff.newValue)
        line.appendChild(val)
      } else if (diff.type === 'removed') {
        line.classList.add('diff-removed')
        line.appendChild(pathSpan)
        line.appendChild(document.createTextNode(': '))
        const val = document.createElement('span')
        val.className = 'diff-value'
        val.textContent = formatValue(diff.oldValue)
        line.appendChild(val)
      } else {
        line.classList.add('diff-changed')
        line.appendChild(pathSpan)
        line.appendChild(document.createTextNode(': '))
        const oldVal = document.createElement('span')
        oldVal.className = 'diff-old-value'
        oldVal.textContent = formatValue(diff.oldValue)
        line.appendChild(oldVal)
        const arrow = document.createElement('span')
        arrow.className = 'diff-arrow'
        arrow.textContent = ' \u2192 '
        line.appendChild(arrow)
        const newVal = document.createElement('span')
        newVal.className = 'diff-new-value'
        newVal.textContent = formatValue(diff.newValue)
        line.appendChild(newVal)
      }

      diffContainer.appendChild(line)
    }

    this.container.appendChild(diffContainer)
  }

  _buildJsonTree(value, key, isRoot) {
    if (value === null) {
      const span = document.createElement('span')
      if (key) span.innerHTML = `<span class="json-key">${escapeHtml(key)}</span>: `
      span.innerHTML += '<span class="json-null">null</span>'
      return span
    }

    if (typeof value === 'undefined') {
      const span = document.createElement('span')
      if (key) span.innerHTML = `<span class="json-key">${escapeHtml(key)}</span>: `
      span.innerHTML += '<span class="json-null">undefined</span>'
      return span
    }

    if (typeof value === 'string') {
      const span = document.createElement('span')
      if (key) span.innerHTML = `<span class="json-key">${escapeHtml(key)}</span>: `
      span.innerHTML += `<span class="json-string">"${escapeHtml(value)}"</span>`
      return span
    }

    if (typeof value === 'number') {
      const span = document.createElement('span')
      if (key) span.innerHTML = `<span class="json-key">${escapeHtml(key)}</span>: `
      span.innerHTML += `<span class="json-number">${value}</span>`
      return span
    }

    if (typeof value === 'boolean') {
      const span = document.createElement('span')
      if (key) span.innerHTML = `<span class="json-key">${escapeHtml(key)}</span>: `
      span.innerHTML += `<span class="json-boolean">${value}</span>`
      return span
    }

    if (Array.isArray(value)) {
      return this._buildCollapsible(value, key, true, isRoot)
    }

    if (typeof value === 'object') {
      return this._buildCollapsible(value, key, false, isRoot)
    }

    const span = document.createElement('span')
    span.textContent = String(value)
    return span
  }

  _buildCollapsible(obj, key, isArray, isRoot) {
    const container = document.createElement('div')
    const entries = isArray ? obj : Object.keys(obj)
    const count = isArray ? obj.length : entries.length
    const openBracket = isArray ? '[' : '{'
    const closeBracket = isArray ? ']' : '}'

    const toggleLine = document.createElement('span')
    toggleLine.className = 'json-toggle'
    let prefix = ''
    if (key) prefix = `<span class="json-key">${escapeHtml(key)}</span>: `
    toggleLine.innerHTML = `${prefix}<span class="json-bracket">${openBracket}</span><span class="json-count">${count} ${isArray ? 'items' : 'keys'}</span>`
    container.appendChild(toggleLine)

    const children = document.createElement('div')
    children.className = 'json-children'

    if (isArray) {
      for (let i = 0; i < obj.length; i++) {
        const line = document.createElement('div')
        line.appendChild(this._buildJsonTree(obj[i], String(i), false))
        if (i < obj.length - 1) {
          const comma = document.createElement('span')
          comma.className = 'json-comma'
          comma.textContent = ','
          line.appendChild(comma)
        }
        children.appendChild(line)
      }
    } else {
      const keys = Object.keys(obj)
      for (let i = 0; i < keys.length; i++) {
        const line = document.createElement('div')
        line.appendChild(this._buildJsonTree(obj[keys[i]], keys[i], false))
        if (i < keys.length - 1) {
          const comma = document.createElement('span')
          comma.className = 'json-comma'
          comma.textContent = ','
          line.appendChild(comma)
        }
        children.appendChild(line)
      }
    }

    container.appendChild(children)

    const closeLine = document.createElement('div')
    closeLine.innerHTML = `<span class="json-bracket">${closeBracket}</span>`
    container.appendChild(closeLine)

    toggleLine.addEventListener('click', () => {
      toggleLine.classList.toggle('collapsed')
      children.classList.toggle('hidden')
    })

    return container
  }
}

// ─── State History View ───────────────────────────────────────────────────────

class StateHistoryView {
  constructor(panel) {
    this.panel = panel
    this.container = document.getElementById('history-container')
    this.filterText = ''
    this.showState = true
    this.showActions = true
    this.showDebug = true
    this.showReady = true
  }

  _initFilters() {
    const textInput = document.getElementById('history-filter-text')
    if (textInput) {
      textInput.addEventListener('input', (e) => {
        this.filterText = e.target.value.toLowerCase()
        this.render()
      })
    }

    const typeButtons = {
      'filter-state-btn': 'state',
      'filter-action-btn': 'action',
      'filter-debug-btn': 'debug',
      'filter-ready-btn': 'ready',
    }
    for (const [btnId, type] of Object.entries(typeButtons)) {
      const btn = document.getElementById(btnId)
      if (btn) {
        btn.addEventListener('click', () => {
          if (type === 'state') this.showState = !this.showState
          else if (type === 'action') this.showActions = !this.showActions
          else if (type === 'debug') this.showDebug = !this.showDebug
          else if (type === 'ready') this.showReady = !this.showReady
          btn.classList.toggle('active')
          this.render()
        })
      }
    }
  }

  _matchesFilter(entry) {
    // Type filter
    if (entry.isAction && !this.showActions) return false
    if (entry.isDebugLog && !this.showDebug) return false
    if (entry.isDisposal && !this.showState) return false
    if (entry.isReady && !this.showReady) return false
    if (entry.isSnapshot) return this.showState // show snapshots with state filter
    if (!entry.isAction && !entry.isDebugLog && !entry.isDisposal && !entry.isReady && !this.showState) return false

    // Text filter
    if (this.filterText) {
      const name = (entry.componentName || '').toLowerCase()
      const action = (entry.actionType || '').toLowerCase()
      const message = (entry.message || '').toLowerCase()
      if (!name.includes(this.filterText) && !action.includes(this.filterText) && !message.includes(this.filterText)) {
        return false
      }
    }

    return true
  }

  render() {
    const { history } = this.panel
    this.container.innerHTML = ''

    const filtered = history.filter(e => this._matchesFilter(e))

    // Update count
    const countEl = document.getElementById('history-count')
    if (countEl) {
      if (filtered.length !== history.length) {
        countEl.textContent = `${filtered.length}/${history.length}`
      } else {
        countEl.textContent = ''
      }
    }

    if (filtered.length === 0) {
      this.container.innerHTML = '<div class="empty-state">' + (history.length === 0 ? 'No history yet' : 'No matching entries') + '</div>'
      return
    }

    // Show newest first
    for (let i = filtered.length - 1; i >= 0; i--) {
      const entry = filtered[i]
      const el = document.createElement('div')
      el.className = 'history-entry'

      // Dot
      const dot = document.createElement('span')
      dot.className = 'history-dot'
      if (entry.isAction) dot.style.background = '#f57c00'
      if (entry.isDebugLog) dot.style.background = '#7b1fa2'
      if (entry.isDisposal) dot.style.background = '#d32f2f'
      if (entry.isReady) dot.style.background = '#0097a7'
      if (entry.isSnapshot) dot.style.background = '#4caf50'
      el.appendChild(dot)

      // Component name (clickable to filter)
      const comp = document.createElement('span')
      comp.className = 'history-component'
      comp.textContent = entry.componentName || '?'
      comp.title = 'Click to filter by this component'
      comp.addEventListener('click', (e) => {
        e.stopPropagation()
        const input = document.getElementById('history-filter-text')
        if (input) {
          input.value = entry.componentName || ''
          this.filterText = (entry.componentName || '').toLowerCase()
          this.render()
        }
      })
      el.appendChild(comp)

      // Label
      const label = document.createElement('span')
      label.className = 'history-label'
      if (entry.isAction) {
        label.textContent = entry.actionType || 'action'
        label.style.color = '#f57c00'
      } else if (entry.isDebugLog) {
        label.textContent = entry.message || 'log'
        label.style.color = '#7b1fa2'
        label.style.flex = '1'
        label.style.overflow = 'hidden'
        label.style.textOverflow = 'ellipsis'
        label.style.whiteSpace = 'nowrap'
      } else if (entry.isDisposal) {
        label.textContent = 'disposed'
        label.style.color = '#d32f2f'
      } else if (entry.isReady) {
        label.textContent = entry.ready ? 'ready' : 'loading'
        label.style.color = '#0097a7'
      } else if (entry.isSnapshot) {
        label.textContent = `snapshot (${entry.entryCount} components)`
        label.style.color = '#4caf50'
      } else {
        label.textContent = 'state'
        label.style.color = '#666'
      }
      el.appendChild(label)

      // Diff indicator for state changes with previous state
      if (!entry.isAction && !entry.isDebugLog && !entry.isDisposal && entry.prevState) {
        const diffCount = computeDiff(entry.prevState, entry.state)
        if (diffCount.length > 0) {
          const diffBadge = document.createElement('span')
          diffBadge.className = 'history-diff-badge'
          diffBadge.textContent = `${diffCount.length}\u0394`
          diffBadge.title = `${diffCount.length} change${diffCount.length !== 1 ? 's' : ''}`
          el.appendChild(diffBadge)
        }
      }

      // Timestamp
      const ts = document.createElement('span')
      ts.className = 'history-time'
      ts.textContent = formatTime(entry.timestamp)
      el.appendChild(ts)

      // Jump button (only for state changes)
      if (!entry.isAction && !entry.isDebugLog && !entry.isDisposal && !entry.isSnapshot && entry.state) {
        const jump = document.createElement('button')
        jump.className = 'history-jump'
        jump.textContent = 'Jump'
        jump.title = 'Time-travel to this state'
        jump.addEventListener('click', (e) => {
          e.stopPropagation()
          this.panel.timeTravel(entry)
        })
        el.appendChild(jump)
      }

      // Restore button (for snapshots)
      if (entry.isSnapshot && typeof entry.snapshotIndex === 'number') {
        const restore = document.createElement('button')
        restore.className = 'history-jump'
        restore.style.borderColor = '#4caf50'
        restore.style.color = '#4caf50'
        restore.textContent = 'Restore'
        restore.title = 'Restore all components to this snapshot'
        restore.addEventListener('click', (e) => {
          e.stopPropagation()
          const snapshot = this.panel.snapshots[entry.snapshotIndex]
          if (snapshot) {
            this.panel._send('RESTORE_SNAPSHOT', { entries: snapshot.entries })
          }
        })
        el.appendChild(restore)
      }

      // Click to view state/data in inspector
      el.addEventListener('click', () => {
        this.container.querySelectorAll('.history-entry').forEach(e => e.classList.remove('clicked'))
        el.classList.add('clicked')

        if (entry.isAction && entry.data) {
          this.panel.inspectorView.render(entry.data)
          document.getElementById('inspector-title').textContent = `Action: ${entry.actionType}`
        } else if (entry.isDisposal) {
          // Show last known state for disposed component
          const data = this.panel.componentData.get(entry.componentId)
          if (data?.state) {
            this.panel.inspectorView.render(data.state)
          } else {
            this.panel.inspectorView.render(null)
          }
          document.getElementById('inspector-title').textContent = `${entry.componentName} (disposed)`
        } else if (entry.state) {
          if (this.panel.showDiff && entry.prevState) {
            this.panel.inspectorView.renderDiff(entry.prevState, entry.state)
            document.getElementById('inspector-title').textContent = `${entry.componentName} (diff)`
          } else {
            this.panel.inspectorView.render(entry.state)
            document.getElementById('inspector-title').textContent = `${entry.componentName} (snapshot)`
          }
        }
      })

      this.container.appendChild(el)
    }
  }
}

// ─── Events Monitor View ──────────────────────────────────────────────────────

class EventsMonitorView {
  constructor(panel) {
    this.panel = panel
    this.container = document.getElementById('events-list')
    this.filterText = ''

    const filterInput = document.getElementById('events-filter-text')
    if (filterInput) {
      filterInput.addEventListener('input', (e) => {
        this.filterText = e.target.value.toLowerCase()
        this.render()
      })
    }
  }

  render() {
    if (!this.container) return
    this.container.innerHTML = ''

    const events = this.panel.busEvents
    const filtered = this.filterText
      ? events.filter(e => e.type.toLowerCase().includes(this.filterText))
      : events

    if (filtered.length === 0) {
      this.container.innerHTML = '<div class="empty-state">' + (events.length === 0 ? 'No events yet' : 'No matching events') + '</div>'
      return
    }

    // Show newest first
    for (let i = filtered.length - 1; i >= 0; i--) {
      const entry = filtered[i]
      const el = document.createElement('div')
      el.className = 'event-entry'

      // Purple dot
      const dot = document.createElement('span')
      dot.className = 'history-dot'
      dot.style.background = '#7b1fa2'
      el.appendChild(dot)

      // Emitter component name
      if (entry.componentName) {
        const emitter = document.createElement('span')
        emitter.className = 'history-component'
        emitter.textContent = entry.componentName
        emitter.style.cursor = 'pointer'
        emitter.addEventListener('click', (e) => {
          e.stopPropagation()
          if (entry.componentId != null) {
            this.panel.selectComponent(entry.componentId)
          }
        })
        el.appendChild(emitter)
      }

      // Event type
      const typeSpan = document.createElement('span')
      typeSpan.className = 'event-type'
      typeSpan.textContent = entry.type
      el.appendChild(typeSpan)

      // Data preview
      if (entry.data != null) {
        const preview = document.createElement('span')
        preview.className = 'event-data-preview'
        const str = typeof entry.data === 'object' ? JSON.stringify(entry.data) : String(entry.data)
        preview.textContent = str.length > 60 ? str.slice(0, 60) + '\u2026' : str
        el.appendChild(preview)
      }

      // Timestamp
      const ts = document.createElement('span')
      ts.className = 'history-time'
      ts.textContent = formatTime(entry.timestamp)
      el.appendChild(ts)

      // Click to inspect
      el.addEventListener('click', () => {
        this.container.querySelectorAll('.event-entry').forEach(e => e.classList.remove('clicked'))
        el.classList.add('clicked')
        this.panel.inspectorView.render(entry.data)
        document.getElementById('inspector-title').textContent = `Event: ${entry.type}${entry.componentName ? ' from ' + entry.componentName : ''}`
      })

      this.container.appendChild(el)
    }
  }
}

// ─── Commands View ───────────────────────────────────────────────────────────

class CommandsView {
  constructor(panel) {
    this.panel = panel
    this.container = document.getElementById('commands-list')
    this.filterText = ''

    const filterInput = document.getElementById('commands-filter-text')
    if (filterInput) {
      filterInput.addEventListener('input', (e) => {
        this.filterText = e.target.value.toLowerCase()
        this.render()
      })
    }
  }

  render() {
    this.container.innerHTML = ''
    const cmds = this.panel.commands

    const filtered = this.filterText
      ? cmds.filter(c => c.type.toLowerCase().includes(this.filterText) || (c.targetComponentName || '').toLowerCase().includes(this.filterText))
      : cmds

    if (filtered.length === 0) {
      this.container.innerHTML = '<div class="empty-state">' + (cmds.length === 0 ? 'No commands yet' : 'No matching commands') + '</div>'
      return
    }

    for (let i = filtered.length - 1; i >= 0; i--) {
      const entry = filtered[i]
      const el = document.createElement('div')
      el.className = 'event-entry'

      // Teal dot
      const dot = document.createElement('span')
      dot.className = 'history-dot'
      dot.style.background = '#00897b'
      el.appendChild(dot)

      // Command type
      const typeSpan = document.createElement('span')
      typeSpan.className = 'event-type'
      typeSpan.style.color = '#00897b'
      typeSpan.textContent = entry.type
      el.appendChild(typeSpan)

      // Target component
      if (entry.targetComponentName) {
        const target = document.createElement('span')
        target.className = 'command-target'
        target.textContent = '\u2192 ' + entry.targetComponentName
        el.appendChild(target)
      }

      // Data preview
      if (entry.data != null) {
        const preview = document.createElement('span')
        preview.className = 'event-data-preview'
        const str = typeof entry.data === 'object' ? JSON.stringify(entry.data) : String(entry.data)
        preview.textContent = str.length > 60 ? str.slice(0, 60) + '\u2026' : str
        el.appendChild(preview)
      }

      // Timestamp
      const ts = document.createElement('span')
      ts.className = 'history-time'
      ts.textContent = formatTime(entry.timestamp)
      el.appendChild(ts)

      // Click to inspect
      el.addEventListener('click', () => {
        this.container.querySelectorAll('.event-entry').forEach(e => e.classList.remove('clicked'))
        el.classList.add('clicked')
        this.panel.inspectorView.render(entry.data)
        document.getElementById('inspector-title').textContent = `Command: ${entry.type}${entry.targetComponentName ? ' \u2192 ' + entry.targetComponentName : ''}`
      })

      this.container.appendChild(el)
    }
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

const panel = new SygnalPanel()
