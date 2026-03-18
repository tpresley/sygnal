const DEVTOOLS_SOURCE = '__SYGNAL_DEVTOOLS_PAGE__';
const EXTENSION_SOURCE = '__SYGNAL_DEVTOOLS_EXTENSION__';
const DEFAULT_MAX_HISTORY = 200;

declare global {
  interface Window {
    __SYGNAL_DEVTOOLS__?: SygnalDevTools;
    __SYGNAL_DEVTOOLS_APP__?: {
      sinks?: { STATE?: { shamefullySendNext: (fn: any) => void } };
    };
    __SYGNAL_DEVTOOLS_PAGE__?: boolean;
    SYGNAL_DEBUG?: string | false;
    __SYGNAL_HMR_UPDATING?: boolean;
    __SYGNAL_HMR_STATE?: unknown;
    __SYGNAL_HMR_PERSISTED_STATE?: unknown;
    __SYGNAL_HMR_LAST_CAPTURED_STATE?: unknown;
    Cyclejs?: { sinks?: any };
    CyclejsDevTool_startGraphSerializer?: (sinks: any) => void;
  }
}

interface StateHistoryEntry {
  componentId: number;
  componentName: string;
  timestamp: number;
  state: any;
}

interface ComponentMeta {
  id: number;
  name: string;
  isSubComponent: boolean;
  hasModel: boolean;
  hasIntent: boolean;
  hasContext: boolean;
  hasCalculated: boolean;
  components: string[];
  parentId: number | null;
  children: number[];
  debug: boolean;
  createdAt: number;
  _instanceRef: WeakRef<any>;
}

interface ExtensionMessage {
  type: string;
  payload?: any;
  source?: string;
}

class SygnalDevTools {
  _connected: boolean;
  _components: Map<number, ComponentMeta>;
  _stateHistory: StateHistoryEntry[];
  _maxHistory: number;

  constructor() {
    this._connected = false;
    this._components = new Map();
    this._stateHistory = [];
    this._maxHistory = DEFAULT_MAX_HISTORY;
  }

  get connected(): boolean {
    return this._connected && typeof window !== 'undefined';
  }

  init(): void {
    if (typeof window === 'undefined') return;

    window.__SYGNAL_DEVTOOLS__ = this;

    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window) return;
      if (event.data?.source === EXTENSION_SOURCE) {
        this._handleExtensionMessage(event.data);
      }
    });
  }

  _handleExtensionMessage(msg: ExtensionMessage): void {
    switch (msg.type) {
      case 'CONNECT':
        this._connected = true;
        if (msg.payload?.maxHistory) this._maxHistory = msg.payload.maxHistory;
        this._sendFullTree();
        break;
      case 'DISCONNECT':
        this._connected = false;
        break;
      case 'SET_DEBUG':
        this._setDebug(msg.payload);
        break;
      case 'TIME_TRAVEL':
        this._timeTravel(msg.payload);
        break;
      case 'GET_STATE':
        this._sendComponentState(msg.payload.componentId);
        break;
    }
  }

  onComponentCreated(componentNumber: number, name: string, instance: any): void {
    const meta: ComponentMeta = {
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
    };
    this._components.set(componentNumber, meta);

    if (!this.connected) return;
    this._post('COMPONENT_CREATED', this._serializeMeta(meta));
  }

  onStateChanged(componentNumber: number, name: string, state: any): void {
    if (!this.connected) return;

    const entry: StateHistoryEntry = {
      componentId: componentNumber,
      componentName: name,
      timestamp: Date.now(),
      state: this._safeClone(state),
    };

    this._stateHistory.push(entry);
    if (this._stateHistory.length > this._maxHistory) {
      this._stateHistory.shift();
    }

    this._post('STATE_CHANGED', {
      componentId: componentNumber,
      componentName: name,
      state: entry.state,
      historyIndex: this._stateHistory.length - 1,
    });
  }

  onActionDispatched(componentNumber: number, name: string, actionType: string, data: any): void {
    if (!this.connected) return;
    this._post('ACTION_DISPATCHED', {
      componentId: componentNumber,
      componentName: name,
      actionType: actionType,
      data: this._safeClone(data),
      timestamp: Date.now(),
    });
  }

  onSubComponentRegistered(parentNumber: number, childNumber: number): void {
    const parent = this._components.get(parentNumber);
    const child = this._components.get(childNumber);
    if (parent && child) {
      child.parentId = parentNumber;
      if (!parent.children.includes(childNumber)) {
        parent.children.push(childNumber);
      }
    }

    if (!this.connected) return;
    this._post('TREE_UPDATED', {
      parentId: parentNumber,
      childId: childNumber,
    });
  }

  onContextChanged(componentNumber: number, name: string, context: any): void {
    if (!this.connected) return;
    this._post('CONTEXT_CHANGED', {
      componentId: componentNumber,
      componentName: name,
      context: this._safeClone(context),
    });
  }

  onDebugLog(componentNumber: number, message: string): void {
    if (!this.connected) return;
    this._post('DEBUG_LOG', {
      componentId: componentNumber,
      message: message,
      timestamp: Date.now(),
    });
  }

  _setDebug({componentId, enabled}: {componentId?: number; enabled: boolean}): void {
    if (typeof componentId === 'undefined' || componentId === null) {
      if (typeof window !== 'undefined') window.SYGNAL_DEBUG = enabled ? 'true' : false;
      this._post('DEBUG_TOGGLED', {global: true, enabled});
      return;
    }

    const meta = this._components.get(componentId);
    if (meta && meta._instanceRef) {
      const instance = meta._instanceRef.deref();
      if (instance) {
        instance._debug = enabled;
        meta.debug = enabled;
        this._post('DEBUG_TOGGLED', {componentId, enabled});
      }
    }
  }

  _timeTravel({historyIndex}: {historyIndex: number}): void {
    const entry = this._stateHistory[historyIndex];
    if (!entry) return;

    if (typeof window === 'undefined') return;
    const app = window.__SYGNAL_DEVTOOLS_APP__;
    if (app?.sinks?.STATE?.shamefullySendNext) {
      app.sinks.STATE.shamefullySendNext(() => ({...entry.state}));
      this._post('TIME_TRAVEL_APPLIED', {
        historyIndex,
        state: entry.state,
      });
    }
  }

  _sendComponentState(componentId: number): void {
    const meta = this._components.get(componentId);
    if (meta && meta._instanceRef) {
      const instance = meta._instanceRef.deref();
      if (instance) {
        this._post('COMPONENT_STATE', {
          componentId,
          state: this._safeClone(instance.currentState),
          context: this._safeClone(instance.currentContext),
          props: this._safeClone(instance.currentProps),
        });
      }
    }
  }

  _sendFullTree(): void {
    const tree: any[] = [];
    for (const [, meta] of this._components) {
      const instance = meta._instanceRef?.deref();
      tree.push({
        ...this._serializeMeta(meta),
        state: instance ? this._safeClone(instance.currentState) : null,
        context: instance ? this._safeClone(instance.currentContext) : null,
      });
    }
    this._post('FULL_TREE', {
      components: tree,
      history: this._stateHistory,
    });
  }

  _post(type: string, payload: any): void {
    if (typeof window === 'undefined') return;
    window.postMessage(
      {
        source: DEVTOOLS_SOURCE,
        type,
        payload,
      },
      '*'
    );
  }

  _safeClone(obj: any): any {
    if (obj === undefined || obj === null) return obj;
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch (e) {
      return '[unserializable]';
    }
  }

  _serializeMeta(meta: ComponentMeta): Omit<ComponentMeta, '_instanceRef'> {
    const {_instanceRef, ...rest} = meta;
    return rest;
  }
}

let instance: SygnalDevTools | null = null;

export function getDevTools(): SygnalDevTools {
  if (!instance) instance = new SygnalDevTools();
  return instance;
}

export default getDevTools;
