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

// ─── Panel Controller ─────────────────────────────────────────────────────────

class SygnalPanel {
  constructor() {
    this.port = null
    this.components = new Map()
    this.history = []
    this.selectedId = null
    this.selectedTab = 'state'
    this.componentData = new Map() // componentId → {state, context, props}
    this.rewoundComponentId = null  // tracks which component is in rewound state
    this.showDiff = false           // toggle for diff view in history clicks

    this.treeView = new ComponentTreeView(this)
    this.inspectorView = new StateInspectorView(this)
    this.historyView = new StateHistoryView(this)

    this._initPort()
    this._initUI()
  }

  _initPort() {
    this.port = chrome.runtime.connect({ name: 'sygnal-devtools-panel' })
    this.port.postMessage({ type: 'INIT', tabId: chrome.devtools.inspectedWindow.tabId })

    this.port.onMessage.addListener((msg) => {
      if (msg.source !== PAGE_SOURCE) return
      this._handleMessage(msg)
    })

    this.port.onDisconnect.addListener(() => {
      // Try to reconnect
      setTimeout(() => this._initPort(), 1000)
    })
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

    // Refresh button
    document.getElementById('refresh-btn').addEventListener('click', () => {
      this._send('CONNECT', {})
    })

    // Clear history
    document.getElementById('clear-history-btn').addEventListener('click', () => {
      this.history = []
      this.rewoundComponentId = null
      this._updateRewoundBadge()
      this.historyView.render()
    })

    // Diff toggle
    const diffToggle = document.getElementById('diff-toggle-btn')
    if (diffToggle) {
      diffToggle.addEventListener('click', () => {
        this.showDiff = !this.showDiff
        diffToggle.classList.toggle('active', this.showDiff)
      })
    }
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
      case 'DEBUG_LOG':
        this._handleDebugLog(msg.payload)
        break
      case 'DEBUG_TOGGLED':
        this._handleDebugToggled(msg.payload)
        break
      case 'TIME_TRAVEL_APPLIED':
        this._handleTimeTravelApplied(msg.payload)
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

  _handleStateChanged({ componentId, componentName, state, historyIndex }) {
    const data = this.componentData.get(componentId) || { state: null, context: null, props: null }
    const prevState = data.state
    data.state = state
    this.componentData.set(componentId, data)

    // Clear rewound indicator when new state arrives for that component
    if (this.rewoundComponentId === componentId) {
      this.rewoundComponentId = null
      this._updateRewoundBadge()
    }

    this.history.push({
      componentId,
      componentName,
      state,
      prevState,
      historyIndex,
      timestamp: Date.now()
    })

    // Cap at 200
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

  _handleContextChanged({ componentId, componentName, context }) {
    const data = this.componentData.get(componentId) || { state: null, context: null, props: null }
    data.context = context
    this.componentData.set(componentId, data)
    if (this.selectedId === componentId && this.selectedTab === 'context') {
      this._renderInspector()
    }
  }

  _handleComponentState({ componentId, state, context, props }) {
    this.componentData.set(componentId, { state, context, props })
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

  _handleTimeTravelApplied({ historyIndex, componentId, componentName, state }) {
    this.rewoundComponentId = componentId
    this._updateRewoundBadge(componentName)

    // Select the component that was rewound
    if (componentId != null) {
      this.selectedId = componentId
      const data = this.componentData.get(componentId) || { state: null, context: null, props: null }
      data.state = state
      this.componentData.set(componentId, data)
      this.selectedTab = 'state'

      // Activate the state tab in the UI
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
      const stateTab = document.querySelector('.tab[data-tab="state"]')
      if (stateTab) stateTab.classList.add('active')

      this.treeView.render()
      this._renderInspector()
    }

    // Highlight the jumped-to history entry
    this.historyView.render()
    const entries = document.querySelectorAll('.history-entry')
    for (const el of entries) {
      if (el.dataset.historyIndex === String(historyIndex)) {
        el.classList.add('selected')
      }
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

    // Request fresh state
    this._send('GET_STATE', { componentId: id })

    // Render whatever we have cached
    this._renderInspector()
  }

  toggleDebug(componentId, enabled) {
    this._send('SET_DEBUG', { componentId, enabled })
  }

  timeTravel(historyIndex) {
    this._send('TIME_TRAVEL', { historyIndex })
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
    const data = this.componentData.get(this.selectedId)
    const value = data ? data[this.selectedTab] : null
    this.inspectorView.render(value)
  }

  _send(type, payload) {
    if (this.port) {
      this.port.postMessage({ type, payload })
    }
  }
}

// ─── Component Tree View ──────────────────────────────────────────────────────

class ComponentTreeView {
  constructor(panel) {
    this.panel = panel
    this.expanded = new Set()
    this.container = document.getElementById('tree-container')
  }

  render() {
    const { components } = this.panel
    this.container.innerHTML = ''

    // Find root nodes (no parent)
    const roots = []
    for (const [id, comp] of components) {
      if (comp.parentId === null || comp.parentId === undefined) {
        roots.push(comp)
      }
    }

    if (roots.length === 0) {
      this.container.innerHTML = '<div class="empty-state">No components detected</div>'
      return
    }

    for (const root of roots) {
      this.container.appendChild(this._buildNode(root))
    }
  }

  _buildNode(comp) {
    const el = document.createElement('div')
    el.className = 'tree-node'

    const hasChildren = comp.children && comp.children.length > 0
    const isExpanded = this.expanded.has(comp.id)

    // Row
    const row = document.createElement('div')
    row.className = 'tree-node-row'
    if (this.panel.selectedId === comp.id) row.classList.add('selected')

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

    // Name
    const name = document.createElement('span')
    name.className = 'tree-name'
    name.textContent = comp.name
    row.appendChild(name)

    // ID badge
    const idBadge = document.createElement('span')
    idBadge.className = 'tree-id'
    idBadge.textContent = `#${comp.id}`
    row.appendChild(idBadge)

    // Debug toggle
    const debug = document.createElement('span')
    debug.className = 'tree-debug-toggle' + (comp.debug ? ' active' : '')
    debug.textContent = comp.debug ? '\uD83D\uDC1B' : '\uD83D\uDC1B'
    debug.title = comp.debug ? 'Disable debug' : 'Enable debug'
    debug.addEventListener('click', (e) => {
      e.stopPropagation()
      this.panel.toggleDebug(comp.id, !comp.debug)
      comp.debug = !comp.debug
      this.render()
    })
    row.appendChild(debug)

    row.addEventListener('click', () => this.panel.selectComponent(comp.id))
    el.appendChild(row)

    // Children
    if (hasChildren) {
      const childContainer = document.createElement('div')
      childContainer.className = 'tree-children' + (isExpanded ? '' : ' collapsed')
      for (const childId of comp.children) {
        const childComp = this.panel.components.get(childId)
        if (childComp) {
          childContainer.appendChild(this._buildNode(childComp))
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
    const fragment = document.createDocumentFragment()

    if (value === null) {
      const span = document.createElement('span')
      if (key) span.innerHTML = `<span class="json-key">${this._escape(key)}</span>: `
      span.innerHTML += '<span class="json-null">null</span>'
      return span
    }

    if (typeof value === 'undefined') {
      const span = document.createElement('span')
      if (key) span.innerHTML = `<span class="json-key">${this._escape(key)}</span>: `
      span.innerHTML += '<span class="json-null">undefined</span>'
      return span
    }

    if (typeof value === 'string') {
      const span = document.createElement('span')
      if (key) span.innerHTML = `<span class="json-key">${this._escape(key)}</span>: `
      span.innerHTML += `<span class="json-string">"${this._escape(value)}"</span>`
      return span
    }

    if (typeof value === 'number') {
      const span = document.createElement('span')
      if (key) span.innerHTML = `<span class="json-key">${this._escape(key)}</span>: `
      span.innerHTML += `<span class="json-number">${value}</span>`
      return span
    }

    if (typeof value === 'boolean') {
      const span = document.createElement('span')
      if (key) span.innerHTML = `<span class="json-key">${this._escape(key)}</span>: `
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

    // Toggle line
    const toggleLine = document.createElement('span')
    toggleLine.className = 'json-toggle'
    let prefix = ''
    if (key) prefix = `<span class="json-key">${this._escape(key)}</span>: `
    toggleLine.innerHTML = `${prefix}<span class="json-bracket">${openBracket}</span><span class="json-count">${count} ${isArray ? 'items' : 'keys'}</span>`
    container.appendChild(toggleLine)

    // Children
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

    // Close bracket
    const closeLine = document.createElement('div')
    closeLine.innerHTML = `<span class="json-bracket">${closeBracket}</span>`
    container.appendChild(closeLine)

    // Toggle behavior
    toggleLine.addEventListener('click', () => {
      toggleLine.classList.toggle('collapsed')
      children.classList.toggle('hidden')
    })

    return container
  }

  _escape(str) {
    const div = document.createElement('div')
    div.textContent = str
    return div.innerHTML
  }
}

// ─── State History View ───────────────────────────────────────────────────────

class StateHistoryView {
  constructor(panel) {
    this.panel = panel
    this.container = document.getElementById('history-container')
  }

  render() {
    const { history } = this.panel
    this.container.innerHTML = ''

    if (history.length === 0) {
      this.container.innerHTML = '<div class="empty-state">No history yet</div>'
      return
    }

    // Show newest first
    for (let i = history.length - 1; i >= 0; i--) {
      const entry = history[i]
      const el = document.createElement('div')
      el.className = 'history-entry'
      el.dataset.historyIndex = typeof entry.historyIndex === 'number' ? String(entry.historyIndex) : ''

      // Dot
      const dot = document.createElement('span')
      dot.className = 'history-dot'
      if (entry.isAction) dot.style.background = '#f57c00'
      if (entry.isDebugLog) dot.style.background = '#7b1fa2'
      el.appendChild(dot)

      // Component name
      const comp = document.createElement('span')
      comp.className = 'history-component'
      comp.textContent = entry.componentName || '?'
      el.appendChild(comp)

      // Label
      const label = document.createElement('span')
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
      } else {
        label.textContent = 'state'
        label.style.color = '#666'
      }
      el.appendChild(label)

      // Diff indicator for state changes with previous state
      if (!entry.isAction && !entry.isDebugLog && entry.prevState) {
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
      ts.textContent = this._formatTime(entry.timestamp)
      el.appendChild(ts)

      // Jump button (only for state changes)
      if (!entry.isAction && !entry.isDebugLog && typeof entry.historyIndex === 'number') {
        const jump = document.createElement('button')
        jump.className = 'history-jump'
        jump.textContent = 'Jump'
        jump.title = 'Time-travel to this state'
        jump.addEventListener('click', (e) => {
          e.stopPropagation()
          this.panel.timeTravel(entry.historyIndex)
        })
        el.appendChild(jump)
      }

      // Click to view state/data in inspector (with diff support)
      el.addEventListener('click', () => {
        // Remove previous selection
        this.container.querySelectorAll('.history-entry').forEach(e => e.classList.remove('clicked'))
        el.classList.add('clicked')

        if (entry.isAction && entry.data) {
          this.panel.inspectorView.render(entry.data)
          document.getElementById('inspector-title').textContent = `Action: ${entry.actionType}`
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

  _formatTime(ts) {
    if (!ts) return ''
    const d = new Date(ts)
    const pad = (n) => String(n).padStart(2, '0')
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

const panel = new SygnalPanel()
