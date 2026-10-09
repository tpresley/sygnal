// PROTOTYPE exposeToAgents(app, { modelContext, mode }): a running Sygnal app's model actions
// as WebMCP-shaped tools (navigator.modelContext.registerTool), generated from the runtime API:
// every live instance's Def.handlers is its action table, InstanceView.state its state, and
// api.dispatch + api.flushed() run an action to completion (one flush, one patch).
//
// mode 'annotated': only components with an `agent` static, only the actions it lists, with
//   their descriptions and JSON Schema inputs; `agent.state(state)` projects what agents read.
// mode 'bare': every model action of every component, no descriptions, any input.
const BUILTIN = /^(BOOTSTRAP|INITIALIZE|HYDRATE|DISPOSE|READY|RESOURCE)$/;

export function exposeToAgents(app, {modelContext, mode = 'annotated'} = {}) {
  const api = app.__runtime;
  const registered = new Map(); // tool name → registration
  const walk = (iv, out = []) => { out.push(iv); iv.children().forEach(c => walk(c, out)); return out; };
  const toolName = (iv, action, dup) => `${iv.name}${dup ? `_${iv.id}` : ''}_${action}`.replace(/[^\w-]/g, '_');
  const annotated = mode !== 'bare';
  const project = iv => (annotated && iv.def.view.agent?.state ? iv.def.view.agent.state(iv.state) : iv.state);

  const sync = () => {
    const ivs = walk(api.root).filter(iv => !iv.disposed && (!annotated || iv.def.view.agent));
    const counts = {};
    ivs.forEach(iv => { counts[iv.name] = (counts[iv.name] || 0) + 1; });
    const want = new Map();
    for (const iv of ivs) {
      const meta = iv.def.view.agent;
      const dup = counts[iv.name] > 1;
      want.set(toolName(iv, 'read_state', dup), {
        description: annotated ? `Read the current state of ${meta.description ?? iv.name}` : `read_state of ${iv.name}`,
        inputSchema: {type: 'object', properties: {}},
        annotations: {readOnlyHint: true},
        execute: async () => text(project(iv)),
      });
      const actions = annotated ? Object.keys(meta.actions ?? {}) : [...iv.def.handlers.keys()].filter(a => !BUILTIN.test(a));
      for (const action of actions) {
        const a = annotated ? meta.actions[action] : {};
        // the action's data: a non-object schema is wrapped as { value } (tool inputs are objects)
        const wrap = a.input && a.input.type !== 'object';
        want.set(toolName(iv, action, dup), {
          description: a.description ?? `${iv.name} action ${action}`,
          inputSchema: !a.input ? {type: 'object', properties: {data: {}}} : wrap ? {type: 'object', properties: {value: a.input}, required: ['value']} : a.input,
          annotations: a.destructive ? {destructiveHint: true} : undefined,
          execute: async input => {
            const data = !a.input ? input?.data : wrap ? input?.value : input;
            if (a.confirm && !(await a.confirm(data, iv.state))) return text({refused: 'the user declined'});
            // 'validated': check the input against the schema and report an action that changed
            // nothing (reducers are pure and immutable: same reference = no-op), so the model retries
            if (mode === 'validated' && a.input) {
              const bad = check(a.input, data);
              if (bad) return text({ok: false, error: `invalid input: ${bad}`, state: project(iv)});
            }
            const before = iv.state;
            api.dispatch(iv.id, action, data, 'agent');
            await api.flushed();
            if (mode === 'validated' && iv.state === before) return text({ok: false, error: `${action} changed nothing: check the input against the current state`, state: project(iv)});
            return text({ok: true, state: project(iv)});
          },
        });
      }
    }
    for (const [name, ac] of registered) if (!want.has(name)) { ac.abort(); registered.delete(name); }
    // current WebMCP draft: registerTool(tool, { signal }); aborting the signal unregisters
    for (const [name, tool] of want) if (!registered.has(name)) { const ac = new AbortController(); modelContext.registerTool({name, ...tool}, {signal: ac.signal}); registered.set(name, ac); }
  };
  sync();
  // instances come and go (Collections, Switchable pages): resync after each flush that changed the tree
  const off = api.addHooks({onCreate: () => queueMicrotask(sync), onDispose: () => queueMicrotask(sync)});
  return () => { off(); registered.forEach(ac => ac.abort()); registered.clear(); };
}
// a tiny JSON Schema check (type / enum / required): enough for the experiment
const check = (sc, v) => {
  const t = sc.type, ok = {string: x => typeof x == 'string', integer: Number.isInteger, number: x => typeof x == 'number', boolean: x => typeof x == 'boolean', object: x => x && typeof x == 'object'};
  if (t && ok[t] && !ok[t](v)) return `expected ${t}${sc.description ? ` (${sc.description})` : ''}, got ${JSON.stringify(v)}`;
  if (sc.enum && !sc.enum.includes(v)) return `expected one of ${sc.enum.join(', ')}`;
  for (const k of sc.required ?? []) if (v?.[k] === undefined) return `missing ${k}`;
};
const text = v => ({content: [{type: 'text', text: JSON.stringify(v)}]});

/** a minimal navigator.modelContext stand-in (registerTool / unregister, listTools / callTool for the agent side) */
export function fakeModelContext() {
  const tools = new Map();
  return {
    registerTool(tool, {signal} = {}) { tools.set(tool.name, tool); signal?.addEventListener('abort', () => tools.delete(tool.name)); },
    listTools: () => [...tools.values()],
    callTool: (name, input) => tools.get(name)?.execute(input ?? {}, {}) ?? Promise.resolve(text({error: `no tool ${name}`})),
  };
}
