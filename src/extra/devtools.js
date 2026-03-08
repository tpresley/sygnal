'use strict'

const DEVTOOLS_SOURCE = '__SYGNAL_DEVTOOLS_PAGE__'
const EXTENSION_SOURCE = '__SYGNAL_DEVTOOLS_EXTENSION__'
const DEFAULT_MAX_HISTORY = 200

class SygnalDevTools {
  constructor() {
    this._connected = false
    this._components = new Map()
    this._stateHistory = []
    this._maxHistory = DEFAULT_MAX_HISTORY
  }

  get connected() {
    return this._connected && typeof window !== 'undefined'
  }

  // ─── Initialization ─────────────────────────────────────────────────────────

  init() {
    if (typeof window === 'undefined') return

    window.__SYGNAL_DEVTOOLS__ = this

    window.addEventListener('message', (event) => {
      if (event.source !== window) return
      if (event.data?.source === EXTENSION_SOURCE) {
        this._handleExtensionMessage(event.data)
      }
    })
  }

  _handleExtensionMessage(msg) {
    switch (msg.type) {
      case 'CONNECT':
        this._connected = true
        if (msg.payload?.maxHistory) this._maxHistory = msg.payload.maxHistory
        this._sendFullTree()
        break
      case 'DISCONNECT':
        this._connected = false
        break
      case 'SET_DEBUG':
        this._setDebug(msg.payload)
        break
      case 'TIME_TRAVEL':
        this._timeTravel(msg.payload)
        break
      case 'GET_STATE':
        this._sendComponentState(msg.payload.componentId)
        break
    }
  }

  // ─── Hooks (called from component.js) ────────────────────────────────────────

  onComponentCreated(componentNumber, name, instance) {
    const meta = {
      id: componentNumber,
      name: name,
      isSubComponent: instance.isSubComponent,
      hasModel: !!instance.model,
      hasIntent: !!instance.intent,
      hasContext: !!instance.context,
      hasCalculated: !!instance.calculated,
      components: Object.keys(instance.components || {}),
      parentId: null,
      children: [],
      debug: instance._debug,
      createdAt: Date.now(),
      _instanceRef: new WeakRef(instance),
    }
    this._components.set(componentNumber, meta)

    if (!this.connected) return
    this._post('COMPONENT_CREATED', this._serializeMeta(meta))
  }

  onStateChanged(componentNumber, name, state) {
    if (!this.connected) return

    const entry = {
      componentId: componentNumber,
      componentName: name,
      timestamp: Date.now(),
      state: this._safeClone(state),
    }

    this._stateHistory.push(entry)
    if (this._stateHistory.length > this._maxHistory) {
      this._stateHistory.shift()
    }

    this._post('STATE_CHANGED', {
      componentId: componentNumber,
      componentName: name,
      state: entry.state,
      historyIndex: this._stateHistory.length - 1,
    })
  }

  onActionDispatched(componentNumber, name, actionType, data) {
    if (!this.connected) return
    this._post('ACTION_DISPATCHED', {
      componentId: componentNumber,
      componentName: name,
      actionType: actionType,
      data: this._safeClone(data),
      timestamp: Date.now(),
    })
  }

  onSubComponentRegistered(parentNumber, childNumber) {
    const parent = this._components.get(parentNumber)
    const child = this._components.get(childNumber)
    if (parent && child) {
      child.parentId = parentNumber
      if (!parent.children.includes(childNumber)) {
        parent.children.push(childNumber)
      }
    }

    if (!this.connected) return
    this._post('TREE_UPDATED', {
      parentId: parentNumber,
      childId: childNumber,
    })
  }

  onContextChanged(componentNumber, name, context) {
    if (!this.connected) return
    this._post('CONTEXT_CHANGED', {
      componentId: componentNumber,
      componentName: name,
      context: this._safeClone(context),
    })
  }

  onDebugLog(componentNumber, message) {
    if (!this.connected) return
    this._post('DEBUG_LOG', {
      componentId: componentNumber,
      message: message,
      timestamp: Date.now(),
    })
  }

  // ─── Commands (from extension to page) ───────────────────────────────────────

  _setDebug({ componentId, enabled }) {
    if (typeof componentId === 'undefined' || componentId === null) {
      if (typeof window !== 'undefined') window.SYGNAL_DEBUG = enabled ? 'true' : false
      this._post('DEBUG_TOGGLED', { global: true, enabled })
      return
    }

    const meta = this._components.get(componentId)
    if (meta && meta._instanceRef) {
      const instance = meta._instanceRef.deref()
      if (instance) {
        instance._debug = enabled
        meta.debug = enabled
        this._post('DEBUG_TOGGLED', { componentId, enabled })
      }
    }
  }

  _timeTravel({ historyIndex }) {
    const entry = this._stateHistory[historyIndex]
    if (!entry) return

    const app = typeof window !== 'undefined' && window.__SYGNAL_DEVTOOLS_APP__
    if (app?.sinks?.STATE?.shamefullySendNext) {
      app.sinks.STATE.shamefullySendNext(() => ({ ...entry.state }))
      this._post('TIME_TRAVEL_APPLIED', {
        historyIndex,
        state: entry.state,
      })
    }
  }

  _sendComponentState(componentId) {
    const meta = this._components.get(componentId)
    if (meta && meta._instanceRef) {
      const instance = meta._instanceRef.deref()
      if (instance) {
        this._post('COMPONENT_STATE', {
          componentId,
          state: this._safeClone(instance.currentState),
          context: this._safeClone(instance.currentContext),
          props: this._safeClone(instance.currentProps),
        })
      }
    }
  }

  _sendFullTree() {
    const tree = []
    for (const [id, meta] of this._components) {
      const instance = meta._instanceRef?.deref()
      tree.push({
        ...this._serializeMeta(meta),
        state: instance ? this._safeClone(instance.currentState) : null,
        context: instance ? this._safeClone(instance.currentContext) : null,
      })
    }
    this._post('FULL_TREE', {
      components: tree,
      history: this._stateHistory,
    })
  }

  // ─── Transport ───────────────────────────────────────────────────────────────

  _post(type, payload) {
    if (typeof window === 'undefined') return
    window.postMessage({
      source: DEVTOOLS_SOURCE,
      type,
      payload,
    }, '*')
  }

  _safeClone(obj) {
    if (obj === undefined || obj === null) return obj
    try {
      return JSON.parse(JSON.stringify(obj))
    } catch (e) {
      return '[unserializable]'
    }
  }

  _serializeMeta(meta) {
    const { _instanceRef, ...rest } = meta
    return rest
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let instance = null

export function getDevTools() {
  if (!instance) instance = new SygnalDevTools()
  return instance
}

export default getDevTools
