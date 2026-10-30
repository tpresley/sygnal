/*
 * 'sygnal/api' (dev preview; index.ts adds contractFetch: this module imports no diagnostics, so
 * sygnal/vite can bundle it without a second copy of their state; research: dev-plans/research/fullstack-contracts/): typed clients
 * for an API whose contract the server already has. A client turns a call into plain data the
 * existing drivers understand, so effects stay data and replies come back as actions:
 *
 * - a GET endpoint → a FetchRequest (`resources`, the query cache, retry, `latest`), tagged
 *   `api:<id>` so `invalidates: [api.x]` / `{ invalidate: [api.x] }`-style tags can name it;
 * - any other method → a FetchRequest with a JSON body (reply actions);
 * - a stream (an oRPC event iterator, or `.sse(path)`) → an SseConnection for `connections`.
 *
 * Adapters (one per contract source), all over plain JSON on the wire:
 * - orpcClient(contract, options): an oRPC contract router served by oRPC's OpenAPIHandler
 *   (compact input: path params from `{name}` / `{+name}`, the rest in the query for GET with
 *   bracket notation, else the JSON body). The RPCHandler protocol ({ json, meta }) is not
 *   supported: its rich serialisation is what the network-calls research ruled out.
 * - openApiClient<paths>(options): openapi-typescript's `paths` (types only); input is
 *   openapi-fetch's `{ params: { path, query }, body }`; query arrays repeat the key (form,
 *   explode), objects use deepObject brackets.
 * - honoClient<ExtractSchema<typeof app>>(options): Hono routes (types only); input is hc's
 *   `{ param, query, json }`.
 *
 * Each endpoint is a function `(input?, options?) => request` with `id`, `kind`, `method`,
 * `path` and `match(request)` (renderComponent's t.respond / t.fail take an endpoint as target).
 * Requests carry `endpoint: id` (an app key: not sent). `options` are the request's own fields
 * (ok, error, key, latest, cache, retry, ...); `invalidates` takes endpoints or tags.
 *
 * Version skew (D: contract hash): contractHash(contract) is a stable hash of the contract (an
 * oRPC router: ids, routes, JSON Schemas of input/output, error codes; anything else: its
 * stable JSON). The app sends it in a header of its choice (`headers` option); on the server,
 * contractSkew(request, { hash, header }) answers a different one with 409 CONTRACT_SKEW (the
 * oRPC error shape). isContractSkew(failure) tells a reducer; contractFetch() wraps fetch for the
 * drivers and reports SYG690 once (and calls onSkew) when a reply says the contract changed.
 */

const SKEW = 'CONTRACT_SKEW';
export const SKEW_HEADER = 'x-contract-skew';
export const SERVER_HASH = 'x-contract-server';

// ── the shared builder ─────────────────────────────────────────────────

const isObj = (v: any) => v !== null && typeof v == 'object' && !Array.isArray(v) && !(v instanceof Date);
const scalar = (v: any) => (v instanceof Date ? v.toISOString() : v);

/** oRPC's bracket notation: `{ a: [1], b: { c: 2 } }` → `{ 'a[0]': 1, 'b[c]': 2 }` */
const brackets = (value: any, key = '', out: Record<string, any> = {}) => {
  if (Array.isArray(value)) value.forEach((v, i) => brackets(v, `${key}[${i}]`, out));
  else if (isObj(value)) Object.keys(value).forEach(k => brackets(value[k], key ? `${key}[${k}]` : k, out));
  else if (value !== undefined) out[key] = scalar(value);
  return out;
};
/** OpenAPI form/explode with deepObject for objects: arrays repeat the key (the driver's `query`) */
const form = (value: any, key = '', out: Record<string, any> = {}) => {
  if (isObj(value)) Object.keys(value).forEach(k => form(value[k], key ? `${key}[${k}]` : k, out));
  else if (Array.isArray(value)) out[key] = value.map(scalar);
  else if (value !== undefined) out[key] = scalar(value);
  return out;
};

/** `/quotes/{id}`, `/files/{+path}`, `/quotes/:id` with the values; the names used */
const fill = (path: string, params: any, colon: boolean) => {
  const used: string[] = [];
  const re = colon ? /:(\w+)\??(\{[^}]*\})?/g : /\{(\+?)(\w+)\}/g;
  const url = path.replace(re, (_m: string, a: string, b: string) => {
    const name = colon ? a : b;
    used.push(name);
    const v = params?.[name];
    if (v === undefined || v === null) throw new Error(`[Sygnal] sygnal/api: ${path} needs the path parameter '${name}'`);
    return !colon && a === '+' ? String(v).split('/').map(encodeURIComponent).join('/') : encodeURIComponent(String(scalar(v)));
  });
  return {url, used};
};

const qs = (query: Record<string, any>) => {
  const p = new URLSearchParams();
  Object.keys(query).forEach(k => [].concat(query[k]).forEach((v: any) => v != null && p.append(k, String(v))));
  const s = p.toString();
  return s ? '?' + s : '';
};

const join = (prefix: string | undefined, path: string) => (prefix ? prefix.replace(/\/+$/, '') : '') + (path[0] == '/' ? path : '/' + path);

/** `invalidates: [api.x, 'tag']` → tags */
const tags = (xs: any) => xs && [].concat(xs).map((x: any) => (typeof x == 'function' && x.id ? 'api:' + x.id : x));

const STREAM_KEYS = ['message', 'open', 'close', 'error', 'events', 'meta', 'resume', 'staleAfterMs', 'background', 'reconnect', 'share', 'withCredentials'];

type Built = {url: string; query?: Record<string, any>; json?: any; body?: boolean; headers?: Record<string, string>};

function endpoint(id: string, kind: 'query' | 'mutation' | 'stream', method: string, path: string,
  build: (input: any) => Built, client: any, extra: any = {}) {
  const shared = client.headers;
  const call = (input?: any, options: any = {}) => {
    const b = build(input);
    const headers = (shared || b.headers || options.headers) && {...shared, ...b.headers, ...options.headers};
    if (kind == 'stream') {
      const out: any = {sse: b.url + qs(b.query || {}), endpoint: id};
      if (headers) out.headers = headers;
      Object.keys(options).forEach(k => k != 'headers' && (out[k] = options[k]));
      return out;
    }
    const {invalidates, ...rest} = options;
    const req: any = {url: b.url, endpoint: id};
    if (method != 'GET') req.method = method;
    if (b.query && Object.keys(b.query).length) req.query = b.query;
    if (b.body) req.json = b.json === undefined ? null : b.json;
    if (kind == 'query') req.tags = ['api:' + id];
    if (client.validate && extra.output) req.validate = extra.output;
    Object.assign(req, rest);
    if (rest.tags) req.tags = [...new Set(['api:' + id, ...[].concat(rest.tags)])];
    if (invalidates) req.invalidates = tags(invalidates);
    if (headers) req.headers = headers;
    return req;
  };
  return Object.assign(call, {
    id, kind, method, path,
    /** whether a request (in its t.requests form) was made by this endpoint */
    match: (r: any) => !!r && (r.endpoint === id),
    ...extra,
  });
}

// ── oRPC (OpenAPIHandler) ──────────────────────────────────────────────

const isProcedure = (x: any) => !!x && typeof x == 'object' && '~orpc' in x && x['~orpc'] && 'route' in x['~orpc'];
/** the yields schema of an oRPC eventIterator() output schema, or undefined */
const eventYields = (schema: any) => {
  const std = schema?.['~standard'];
  if (!std) return undefined;
  const s = Object.getOwnPropertySymbols(std).find(s => s.description === 'ORPC_EVENT_ITERATOR_DETAILS');
  return s ? std[s].yields ?? {} : undefined;
};

/** every procedure of an oRPC contract router: [keys, procedure] */
const procedures = (router: any, keys: string[] = [], out: [string[], any][] = [], seen = new Set<any>()) => {
  if (isProcedure(router)) out.push([keys, router]);
  // a router is plain nested objects: not a schema (a contract module may export those too), no cycles
  else if (router && typeof router == 'object' && !router['~standard'] && !seen.has(router)) {
    seen.add(router);
    Object.keys(router).forEach(k => procedures(router[k], [...keys, k], out, seen));
  }
  return out;
};

const orpcRoute = (keys: string[], p: any) => {
  const def = p['~orpc'];
  const method = String(def.route.method || 'POST').toUpperCase();
  const path = def.route.path || '/' + keys.map(encodeURIComponent).join('/');
  // a manifest (a contract without its schemas, or a server function) says `stream` and `kind`
  const yields = def.stream ? def.outputSchema || {} : eventYields(def.outputSchema);
  const kind: 'query' | 'mutation' | 'stream' = yields ? 'stream' : def.kind || (method == 'GET' ? 'query' : 'mutation');
  return {id: keys.join('.'), def, method, path, yields, kind};
};

/** one procedure's endpoint (a contract's, a manifest's or a server function's) */
const orpcEndpoint = (keys: string[], p: any, options: any) => {
  const r = orpcRoute(keys, p);
  if (r.def.route.inputStructure === 'detailed') throw new Error(`[Sygnal] orpcClient: ${r.id} uses inputStructure: 'detailed', which sygnal/api doesn't support yet`);
  if (r.kind == 'stream' && r.method != 'GET') throw new Error(`[Sygnal] orpcClient: ${r.id} is an event iterator: give it .route({ method: 'GET' }) so it can be read as server-sent events`);
  if (options.validate && r.def.manifest) throw new Error(`[Sygnal] orpcClient: ${r.id} has no schemas in the client build (sygnal/vite's api.contracts replaced them): validate: true needs them, so leave that module out of api.contracts`);
  const build = (input: any): Built => {
    const {url, used} = fill(r.path, input, false);
    const rest = isObj(input) ? {...input} : input;
    if (isObj(rest)) used.forEach(n => delete rest[n]);
    const full = join(options.prefix, url);
    if (r.method == 'GET') return {url: full, query: isObj(rest) ? brackets(rest) : {}};
    return {url: full, body: true, json: isObj(rest) && !Object.keys(rest).length && used.length ? undefined : rest};
  };
  const errors: any = {};
  Object.keys(r.def.errorMap || {}).forEach(code => { errors[code] = {status: r.def.errorMap[code]?.status, data: r.def.errorMap[code]?.data}; });
  return endpoint(r.id, r.kind, r.method, r.path, build, options, {output: r.yields || r.def.outputSchema, errors});
};

export function orpcClient(contract: any, options: any = {}) {
  const walk = (node: any, keys: string[]): any => {
    if (isProcedure(node)) return orpcEndpoint(keys, node, options);
    const out: any = {};
    Object.keys(node || {}).forEach(k => { out[k] = walk(node[k], [...keys, k]); });
    return out;
  };
  return walk(contract, []);
}

// ── openapi-typescript paths ───────────────────────────────────────────

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

export function openApiClient(options: any = {}) {
  const api: any = {};
  METHODS.forEach(m => {
    api[m] = (path: string) => endpoint(`${m.toUpperCase()} ${path}`, m == 'get' ? 'query' : 'mutation', m.toUpperCase(), path, (input: any = {}) => {
      const {url} = fill(path, input.params?.path, false);
      const q = input.params?.query ? form(input.params.query) : undefined;
      return {url: join(options.prefix, url), query: q, body: m != 'get', json: input.body, headers: input.params?.header};
    }, options);
  });
  api.sse = (path: string) => endpoint(`SSE ${path}`, 'stream', 'GET', path, (input: any = {}) => ({
    url: join(options.prefix, fill(path, input.params?.path, false).url),
    query: input.params?.query ? form(input.params.query) : undefined,
    headers: input.params?.header,
  }), options);
  return api;
}

// ── Hono RPC types ─────────────────────────────────────────────────────

export function honoClient(options: any = {}) {
  const api: any = {};
  const build = (path: string, body: boolean) => (input: any = {}): Built => ({
    url: join(options.prefix, fill(path, input.param, true).url),
    query: input.query,
    body,
    json: input.json,
    headers: input.header,
  });
  METHODS.forEach(m => {
    api[m] = (path: string) => endpoint(`${m.toUpperCase()} ${path}`, m == 'get' ? 'query' : 'mutation', m.toUpperCase(), path, build(path, m != 'get'), options);
  });
  api.sse = (path: string) => endpoint(`SSE ${path}`, 'stream', 'GET', path, build(path, false), options);
  return api;
}

// ── contract hash and skew ─────────────────────────────────────────────

const stable = (v: any): string => {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v == 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return JSON.stringify(v) ?? 'null';
};
// cyrb53: a fast, well-distributed 53-bit string hash (not cryptographic: this only detects change)
const cyrb53 = (s: string) => {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
};
/** a schema's JSON Schema (Standard JSON Schema), else its vendor: what the hash can see of it */
const schemaShape = (s: any, io: 'input' | 'output') => {
  const std = s?.['~standard'];
  if (!std) return null;
  try {
    if (std.jsonSchema?.[io]) return std.jsonSchema[io]({target: 'draft-2020-12', libraryOptions: {unrepresentable: 'any'}});
  } catch (_) { /* a schema it can't represent: the vendor below */ }
  return std.vendor || 'schema';
};

export function contractHash(contract: any): string {
  // a manifest made at build time (sygnal/vite's api.contracts) carries its hash
  if (contract && typeof contract['~hash'] == 'string') return contract['~hash'];
  const ps = procedures(contract);
  if (!ps.length) return cyrb53(stable(contract));
  const shape = ps.map(([keys, p]) => {
    const r = orpcRoute(keys, p);
    return [r.id, r.method, r.path, r.kind, schemaShape(r.def.inputSchema, 'input'),
      r.yields ? schemaShape(r.yields, 'output') : schemaShape(r.def.outputSchema, 'output'),
      Object.keys(r.def.errorMap || {}).sort()];
  }).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return cyrb53(stable(shape));
}

/**
 * Server side, before the API handler: a request whose `header` carries another hash gets a 409
 * CONTRACT_SKEW (oRPC's error shape); undefined lets it through. A request without the header
 * passes unless `require` is set (curl, other services).
 */
export function contractSkew(request: Request, {hash, header, require}: {hash: string; header: string; require?: boolean}): Response | undefined {
  const sent = request.headers.get(header);
  if (sent === hash || (sent === null && !require)) return undefined;
  return skewResponse(sent, hash);
}

const skewResponse = (client: string | null, server: string | null) => new Response(JSON.stringify({
  defined: true, code: SKEW, status: 409,
  message: 'This client was built for another version of the API; reload to update it',
  data: {client, server},
}), {status: 409, headers: {'content-type': 'application/json', [SKEW_HEADER]: '1', [SERVER_HASH]: server ?? ''}});

/** whether an `error` reply (FetchFailure) is a contract skew answer */
export const isContractSkew = (failure: any) => failure?.status === 409 && failure?.body?.code === SKEW;

// ── build time: a contract without its schemas ─────────────────────────

/**
 * sygnal/vite's `api.contracts`: what a client needs of a contract (routes, kinds, error codes and
 * statuses) and its hash, so the client bundle has no schema library. Plain JSON (`~hash` aside).
 */
export function contractManifest(contract: any) {
  const count = procedures(contract).length;
  if (!count) return {manifest: undefined, hash: '', count};
  const walk = (node: any, keys: string[]): any => {
    if (isProcedure(node)) {
      const r = orpcRoute(keys, node);
      const errorMap: any = {};
      Object.keys(r.def.errorMap || {}).forEach(c => { errorMap[c] = {status: r.def.errorMap[c]?.status}; });
      const route: any = {method: r.method, path: r.path};
      if (r.def.route.inputStructure) route.inputStructure = r.def.route.inputStructure;
      return {'~orpc': {route, kind: r.kind, stream: r.kind == 'stream', manifest: true, errorMap}};
    }
    const out: any = {};
    Object.keys(node || {}).forEach(k => { if (procedures(node[k]).length) out[k] = walk(node[k], [...keys, k]); });
    return out;
  };
  return {manifest: walk(contract, []), hash: contractHash(contract), count};
}

// ── function-first: *.server.ts modules ────────────────────────────────

/*
 * A `*.server.ts` file exports query(input, fn), mutation(input, fn) and stream(input, fn). Its
 * path and export names are the contract: `src/quotes.server.ts` → `export const list` is
 * `quotes.list`, POST /quotes/list (a stream: GET, read as server-sent events). sygnal/vite
 * (`api: { functions: true }`) replaces the file in the client by stubs that build the requests,
 * so nothing of it but its export names, kinds and error codes reaches the bundle; on the
 * server, serverFunctions(import.meta.glob(...), { os }) makes the oRPC router to mount.
 * Input is always validated (a Standard Schema, or none: then only an empty input passes), the
 * wire is plain JSON (oRPC's OpenAPIHandler), and only module exports are functions (no closures
 * over component scope, no ids made from a closure).
 */

const FN = '~sygnal';
const FN_HEADER = 'x-api-functions';

/** "no input": undefined, null or {} pass */
const noInput = {'~standard': {version: 1, vendor: 'sygnal', validate: (v: any) => (v == null || (isObj(v) && !Object.keys(v).length) ? {value: undefined} : {issues: [{message: 'This function takes no input'}]})}};
const isSchema = (s: any) => !!s && typeof s['~standard']?.validate == 'function';

function serverFunction(kind: 'query' | 'mutation' | 'stream', args: any[]) {
  let [input, fn, opts] = args;
  if (typeof input == 'function' && !isSchema(input)) [input, fn, opts] = [undefined, input, fn];
  const sig = `${kind}(input, fn, options)`;
  if (input !== undefined && !isSchema(input)) throw new Error(`[Sygnal] ${sig}: input must be a Standard Schema (zod, Valibot, ArkType, ...): a server function always validates its input (leave it out to take none)`);
  if (typeof fn != 'function') throw new Error(`[Sygnal] ${sig}: fn must be a function`);
  if (opts?.output !== undefined && !isSchema(opts.output)) throw new Error(`[Sygnal] ${sig}: options.output must be a Standard Schema`);
  const meta: any = {kind, input: input || noInput, output: opts?.output, errors: opts?.errors || {}, fn};
  const call: any = (i?: any, o?: any) => {
    if (!meta.endpoint) throw new Error(`[Sygnal] this ${kind}() has no id: import it from its *.server.ts file with sygnal/vite's \`api: { functions: true }\`, or mount it with serverFunctions()`);
    return meta.endpoint(i, o);
  };
  call[FN] = meta;
  meta.call = call;
  return call;
}

/** A query (a POST that is a resource: tagged, invalidatable): `export const list = query(z.object({ tag: z.string() }), async ({ tag }) => ...)` */
export const query = (...args: any[]) => serverFunction('query', args);
/** A mutation (a POST with reply actions) */
export const mutation = (...args: any[]) => serverFunction('mutation', args);
/** A stream: an async generator read as server-sent events (a GET: its input comes from the query string) */
export const stream = (...args: any[]) => serverFunction('stream', args);

/** `src/admin/users.server.ts` (or `/src/...`, `../src/...`) → `admin/users` */
export const fnNamespace = (file: string, dir = 'src') => {
  let f = file.split('?')[0].replace(/\\/g, '/').replace(/^(\.{1,2}\/)+|^\/+/, '');
  const d = dir.replace(/^\.?\/+|\/+$/g, '');
  if (d && f.startsWith(d + '/')) f = f.slice(d.length + 1);
  return f.replace(/\.server\.[cm]?[jt]sx?$/, '');
};

const fnSpec = (id: string, kind: string, errors: any, schemas?: any) => ({'~orpc': {
  route: {method: kind == 'stream' ? 'GET' : 'POST', path: '/' + id.split('.').map(encodeURIComponent).join('/')},
  kind, stream: kind == 'stream', manifest: !schemas, errorMap: errors,
  inputSchema: schemas?.input, outputSchema: schemas?.output,
}});

/** each file's server functions: its namespace, its own contract tree (for the hash), [name, meta] */
export function fnFiles(modules: Record<string, any>, dir = 'src') {
  return Object.keys(modules).sort().map(file => {
    const ns = fnNamespace(file, dir);
    const keys = ns.split('/');
    const tree: any = {};
    let node = tree;
    keys.forEach(k => { node = node[k] = {}; });
    const fns: [string, any][] = [];
    Object.keys(modules[file] || {}).forEach(name => {
      const meta = modules[file][name]?.[FN];
      if (!meta) return;
      const id = [...keys, name].join('.');
      node[name] = Object.assign(fnSpec(id, meta.kind, meta.errors, meta), {[FN]: meta});
      fns.push([name, meta]);
    });
    return {file, ns, keys, tree, fns, hash: contractHash(tree)};
  });
}

/**
 * Generated code only (sygnal/vite): in the client, `spec` is `{ kind, errors }` and this is the
 * stub endpoint; in server and test code it gives a module's own server function its id.
 */
export function __serverFunction(id: string, value: any, client: any = {}) {
  const meta = value?.[FN];
  if (meta) {
    if (!meta.endpoint) {
      meta.id = id;
      meta.endpoint = orpcEndpoint(id.split('.'), fnSpec(id, meta.kind, meta.errors, meta), client);
      Object.assign(value, meta.endpoint);
    }
    return value;
  }
  if (value && typeof value.kind == 'string') return orpcEndpoint(id.split('.'), fnSpec(id, value.kind, value.errors || {}), client);
  return value;
}

const validated = async (schema: any, value: any) => {
  const r = await schema['~standard'].validate(value);
  if (r.issues) throw new Error(`[Sygnal] a stream event does not match its output schema: ${r.issues.map((i: any) => i.message).join('; ')}`);
  return r.value;
};

/**
 * On the server: the oRPC router of the `*.server.ts` modules, to mount with oRPC's
 * OpenAPIHandler (Sygnal has no server of its own, so `os` comes from '@orpc/server'):
 *   const fns = serverFunctions(import.meta.glob('/src/**\/*.server.ts', { eager: true }), { os })
 *   const handler = new OpenAPIHandler(fns.router)   // prefix: the plugin's api.prefix ('/api')
 * `fns.skew(request)` answers a request from a client built against another version of a file
 * with 409 CONTRACT_SKEW (the `x-api-functions` header: `<file>:<hash>`).
 */
export function serverFunctions(modules: Record<string, any>, {os, dir = 'src', header = FN_HEADER}: {os: any; dir?: string; header?: string}) {
  if (!os || typeof os.route != 'function') throw new Error("[Sygnal] serverFunctions(modules, { os }): pass oRPC's `os` (import { os } from '@orpc/server'); Sygnal has no server of its own");
  const files = fnFiles(modules, dir);
  const router: any = {};
  const contract: any = {};
  const hashes: Record<string, string> = {};
  files.forEach(f => {
    if (hashes[f.ns] !== undefined) throw new Error(`[Sygnal] serverFunctions: two modules are ${f.ns}`);
    hashes[f.ns] = f.hash;
    let r = router, c = contract;
    f.keys.forEach(k => { r = r[k] ??= {}; c = c[k] ??= {}; });
    f.fns.forEach(([name, meta]) => {
      const id = [...f.keys, name].join('.');
      if (r[name]) throw new Error(`[Sygnal] serverFunctions: ${id} is defined twice`);
      __serverFunction(id, meta.call);
      c[name] = fnSpec(id, meta.kind, meta.errors, meta);
      let b = os.route(c[name]['~orpc'].route).input(meta.input);
      if (Object.keys(meta.errors).length) b = b.errors(meta.errors);
      if (meta.output && meta.kind != 'stream') b = b.output(meta.output);
      r[name] = b.handler(meta.kind == 'stream'
        ? async function* (o: any) { for await (const v of meta.fn(o.input, o)) yield meta.output ? await validated(meta.output, v) : v; }
        : (o: any) => meta.fn(o.input, o));
    });
  });
  const skew = (request: Request): Response | undefined => {
    const sent = request.headers.get(header);
    if (sent === null) return undefined;
    const i = sent.lastIndexOf(':');
    const server = hashes[sent.slice(0, i)];
    return i > 0 && sent.slice(i + 1) === server ? undefined : skewResponse(sent, server === undefined ? null : sent.slice(0, i) + ':' + server);
  };
  return {router, contract, hashes, skew};
}

// ── test fixtures ──────────────────────────────────────────────────────

const check = (schema: any, value: any, what: string) => {
  const std = schema?.['~standard'];
  if (!std?.validate) return value;
  const r = std.validate(value);
  if (r && typeof r.then == 'function') throw new Error(`[Sygnal] ${what}: async schemas can't check a fixture`);
  if (r.issues) throw new Error(`[Sygnal] ${what} does not match the contract: ${r.issues.map((i: any) => `${(i.path || []).map((p: any) => p?.key ?? p).join('.') || '(root)'}: ${i.message}`).join('; ')}`);
  // the schema's output as it would cross the wire (JSON), the form the driver delivers
  return JSON.parse(JSON.stringify(r.value === undefined ? null : r.value));
};

/**
 * A reply body for t.respond / t.push, checked against the endpoint's output (an oRPC stream: one
 * event) when the contract has a runtime schema; returned as JSON would deliver it.
 */
export const fixture = (ep: any, data: any) => check(ep?.output, data, `fixture(${ep?.id})`);

/**
 * An error reply in oRPC's shape for `t.fail(sink, e.status, { body: e.body }, target)`:
 * `{ status, body: { defined: true, code, status, message, data } }`, its data checked against
 * the error's schema.
 */
export function errorFixture(ep: any, code: string, data?: any, message?: string) {
  const def = ep?.errors?.[code];
  if (ep?.errors && !def) throw new Error(`[Sygnal] errorFixture(${ep.id}): no error '${code}' in its contract (${Object.keys(ep.errors).join(', ') || 'none'})`);
  const status = def?.status ?? 500;
  const checked = def?.data ? check(def.data, data, `errorFixture(${ep.id}, '${code}')`) : data;
  return {status, body: {defined: true, code, status, message: message ?? code, data: checked}};
}
