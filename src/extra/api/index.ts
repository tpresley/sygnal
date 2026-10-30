import {warn} from '../diagnostics/legacy';

/*
 * 'sygnal/api' (dev preview; research: dev-plans/research/fullstack-contracts/): typed clients
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
const SKEW_HEADER = 'x-contract-skew';
const SERVER_HASH = 'x-contract-server';

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
const procedures = (router: any, keys: string[] = [], out: [string[], any][] = []) => {
  if (isProcedure(router)) out.push([keys, router]);
  else if (router && typeof router == 'object') Object.keys(router).forEach(k => procedures(router[k], [...keys, k], out));
  return out;
};

const orpcRoute = (keys: string[], p: any) => {
  const def = p['~orpc'];
  const method = String(def.route.method || 'POST').toUpperCase();
  const path = def.route.path || '/' + keys.map(encodeURIComponent).join('/');
  const yields = eventYields(def.outputSchema);
  return {id: keys.join('.'), def, method, path, yields, kind: yields ? 'stream' : method == 'GET' ? 'query' : 'mutation'} as const;
};

export function orpcClient(contract: any, options: any = {}) {
  const make = (keys: string[], p: any) => {
    const r = orpcRoute(keys, p);
    if (r.def.route.inputStructure === 'detailed') throw new Error(`[Sygnal] orpcClient: ${r.id} uses inputStructure: 'detailed', which sygnal/api doesn't support yet`);
    if (r.kind == 'stream' && r.method != 'GET') throw new Error(`[Sygnal] orpcClient: ${r.id} is an event iterator: give it .route({ method: 'GET' }) so it can be read as server-sent events`);
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
  const walk = (node: any, keys: string[]): any => {
    if (isProcedure(node)) return make(keys, node);
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
  return new Response(JSON.stringify({
    defined: true, code: SKEW, status: 409,
    message: 'This client was built for another version of the API; reload to update it',
    data: {client: sent, server: hash},
  }), {status: 409, headers: {'content-type': 'application/json', [SKEW_HEADER]: '1', [SERVER_HASH]: hash}});
}

/** whether an `error` reply (FetchFailure) is a contract skew answer */
export const isContractSkew = (failure: any) => failure?.status === 409 && failure?.body?.code === SKEW;

/**
 * A fetch for the drivers (`makeFetchDriver({ fetch: contractFetch() })`, `makeSocketDriver({
 * fetch })`) that notices skew answers: SYG690 once, and `onSkew({ server })` on each.
 */
export function contractFetch({fetch: f, onSkew}: {fetch?: typeof fetch; onSkew?: (info: {server: string | null; url: string}) => void} = {}) {
  let told = false;
  return async (input: any, init?: any) => {
    const res = await (f || globalThis.fetch)(input, init);
    if (res.status === 409 && res.headers.get(SKEW_HEADER)) {
      const info = {server: res.headers.get(SERVER_HASH), url: String(input?.url ?? input)};
      if (!told) {
        told = true;
        warn('SYG690', undefined, `sygnal/api: the server's API contract (${info.server}) is not the one this client was built with`, 'Reload the app (onSkew can prompt the user); a stale tab keeps failing with CONTRACT_SKEW', info);
      }
      onSkew?.(info);
    }
    return res;
  };
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
