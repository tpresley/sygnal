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

interface MviGraphData {
  sources: string[];
  actions: {name: string; sinks: string[]}[];
  contextProvides: string[];
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
  mviGraph: MviGraphData | null;
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
      case 'SNAPSHOT':
        this._takeSnapshot();
        break;
      case 'RESTORE_SNAPSHOT':
        this._restoreSnapshot(msg.payload);
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
      mviGraph: this._extractMviGraph(instance),
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
      contextTrace: this._buildContextTrace(componentNumber, context),
    });
  }

  onPropsChanged(componentNumber: number, name: string, props: any): void {
    if (!this.connected) return;
    this._post('PROPS_CHANGED', {
      componentId: componentNumber,
      componentName: name,
      props: this._safeClone(props),
    });
  }

  onBusEvent(event: {type: string; data?: any; __emitterId?: number; __emitterName?: string}): void {
    if (!this.connected) return;
    this._post('BUS_EVENT', {
      type: event.type,
      data: this._safeClone(event.data),
      componentId: event.__emitterId ?? null,
      componentName: event.__emitterName ?? null,
      timestamp: Date.now(),
    });
  }

  onCommandSent(type: string, data: any, targetComponentId?: number, targetComponentName?: string): void {
    if (!this.connected) return;
    this._post('COMMAND_SENT', {
      type,
      data: this._safeClone(data),
      targetComponentName: targetComponentName ?? null,
      timestamp: Date.now(),
    });
  }

  onReadyChanged(parentId: number, parentName: string, childKey: string, ready: boolean): void {
    if (!this.connected) return;
    this._post('READY_CHANGED', {
      parentId,
      parentName,
      childKey,
      ready,
      timestamp: Date.now(),
    });
  }

  onCollectionMounted(parentId: number, parentName: string, itemComponentName: string, stateField: string | null): void {
    const meta = this._components.get(parentId);
    if (meta) {
      (meta as any).collection = {itemComponent: itemComponentName, stateField};
    }
    if (!this.connected) return;
    this._post('COLLECTION_MOUNTED', {
      parentId,
      parentName,
      itemComponent: itemComponentName,
      stateField,
    });
  }

  onComponentDisposed(componentNumber: number, name: string): void {
    const meta = this._components.get(componentNumber);
    if (meta) {
      (meta as any).disposed = true;
      (meta as any).disposedAt = Date.now();
    }

    if (!this.connected) return;
    this._post('COMPONENT_DISPOSED', {
      componentId: componentNumber,
      componentName: name,
      timestamp: Date.now(),
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

  _timeTravel({componentId, componentName, state}: {componentId: number; componentName: string; state: any}): void {
    if (componentId == null || !state) {
      console.warn('[Sygnal DevTools] _timeTravel: missing componentId or state', {componentId, hasState: !!state});
      return;
    }

    if (typeof window === 'undefined') return;

    const newState = this._safeClone(state);

    // Try per-component time-travel via the component's STATE sink (reducer stream)
    const meta = this._components.get(componentId);
    if (meta) {
      const instance = meta._instanceRef?.deref();
      if (!instance) {
        console.warn(`[Sygnal DevTools] _timeTravel: WeakRef for component #${componentId} (${componentName}) has been GC'd`);
      } else {
        // sinks[stateSourceName] is the reducer stream — push a reducer that replaces state
        const stateSinkName = instance.stateSourceName || 'STATE';
        const stateSink = instance.sinks?.[stateSinkName];
        if (stateSink?.shamefullySendNext) {
          stateSink.shamefullySendNext(() => ({...newState}));
          this._post('TIME_TRAVEL_APPLIED', {
            componentId,
            componentName,
            state: newState,
          });
          return;
        }
        console.warn(`[Sygnal DevTools] _timeTravel: component #${componentId} (${componentName}) has no STATE sink with shamefullySendNext. sinkName=${stateSinkName}, hasSinks=${!!instance.sinks}, sinkKeys=${instance.sinks ? Object.keys(instance.sinks).join(',') : 'none'}`);
      }
    } else {
      console.warn(`[Sygnal DevTools] _timeTravel: no meta for componentId ${componentId}`);
    }

    // Fall back to root STATE sink for root-level components
    const app = window.__SYGNAL_DEVTOOLS_APP__;
    if (app?.sinks?.STATE?.shamefullySendNext) {
      app.sinks.STATE.shamefullySendNext(() => ({...newState}));
      this._post('TIME_TRAVEL_APPLIED', {
        componentId,
        componentName,
        state: newState,
      });
    } else {
      console.warn(`[Sygnal DevTools] _timeTravel: no fallback root STATE sink available`);
    }
  }

  _takeSnapshot(): void {
    const entries: {componentId: number; componentName: string; state: any}[] = [];
    for (const [id, meta] of this._components) {
      if ((meta as any).disposed) continue;
      const instance = meta._instanceRef?.deref();
      if (instance?.currentState != null) {
        entries.push({
          componentId: id,
          componentName: meta.name,
          state: this._safeClone(instance.currentState),
        });
      }
    }
    this._post('SNAPSHOT_TAKEN', {
      entries,
      timestamp: Date.now(),
    });
  }

  _restoreSnapshot(snapshot: {entries: {componentId: number; componentName: string; state: any}[]}): void {
    if (!snapshot?.entries) return;
    for (const entry of snapshot.entries) {
      this._timeTravel(entry);
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
          contextTrace: this._buildContextTrace(componentId, instance.currentContext),
          props: this._safeClone(instance.currentProps),
        });
      }
    }
  }

  _buildContextTrace(componentId: number, context: any): {field: string; providerId: number; providerName: string}[] {
    if (!context || typeof context !== 'object') return [];
    const trace: {field: string; providerId: number; providerName: string}[] = [];
    const fields = Object.keys(context);

    for (const field of fields) {
      // Walk up parent chain to find which component provides this field
      let currentId: number | null = componentId;
      let found = false;
      while (currentId != null) {
        const meta = this._components.get(currentId);
        if (!meta) break;
        if (meta.mviGraph?.contextProvides?.includes(field)) {
          trace.push({field, providerId: meta.id, providerName: meta.name});
          found = true;
          break;
        }
        currentId = meta.parentId;
      }
      if (!found) {
        trace.push({field, providerId: -1, providerName: 'unknown'});
      }
    }
    return trace;
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

  _extractMviGraph(instance: any): MviGraphData | null {
    if (!instance.model) return null;
    try {
      const sources = instance.sourceNames ? [...instance.sourceNames] : [];
      const actions: {name: string; sinks: string[]}[] = [];
      const model = instance.model;

      for (const key of Object.keys(model)) {
        let actionName = key;
        let entry = model[key];

        // Handle shorthand 'ACTION | SINK'
        if (key.includes('|')) {
          const parts = key.split('|').map((s: string) => s.trim());
          if (parts.length === 2 && parts[0] && parts[1]) {
            actionName = parts[0];
            actions.push({name: actionName, sinks: [parts[1]]});
            continue;
          }
        }

        // Function → targets STATE
        if (typeof entry === 'function') {
          actions.push({name: actionName, sinks: [instance.stateSourceName || 'STATE']});
          continue;
        }

        // Object → keys are sink names
        if (entry && typeof entry === 'object') {
          actions.push({name: actionName, sinks: Object.keys(entry)});
          continue;
        }
      }

      const contextProvides = instance.context && typeof instance.context === 'object'
        ? Object.keys(instance.context) : [];

      return {sources, actions, contextProvides};
    } catch (e) {
      return null;
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
