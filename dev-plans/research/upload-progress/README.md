# Upload progress for `makeFetchDriver` (PLAN-11 S-1)

**Question:** what transport and what request/reply API give an app upload (and download)
progress through the existing HTTP driver?

**Probe:** [`probe.mjs`](probe.mjs) serves a page and a local server that reads uploads slowly
(so progress spreads out) and streams downloads, then runs each case in Chromium 153, Firefox 155
and WebKit 26.6 (the cached Playwright engines; `node dev-plans/research/upload-progress/probe.mjs`).

## Results (2026-10-17)

| Case | Chromium | Firefox | WebKit |
|---|---|---|---|
| XHR upload, `FormData` 4 MB: `upload` progress events | 6, `lengthComputable`, ends at total | 10 | 33 |
| XHR upload, `Blob` 4 MB | 6 | 4 | 32 |
| XHR download 1 MB with Content-Length | 3, computable | 3 | 3 |
| XHR download without Content-Length | 3, `total` 0, not computable | same | same |
| XHR GET: `upload` events | none | none | none |
| `new Response(xhr.response, {status, headers})` (404 JSON, 204) | parses, null body on 204 | same | same |
| abort mid-upload | `abort`, status 0, partial progress before | same | same |
| `xhr.timeout` | `timeout` | same | same |
| network error | `error`, status 0 | same | same |
| `fetch` with a `ReadableStream` body + `duplex: 'half'` over HTTP/1.1 | **fails** (`Failed to fetch`) | **sends the string `[object ReadableStream]`** (23 bytes) | **fails** (`Load failed`) |
| `fetch` download progress by reading `res.body` | 32 chunks | 35 | 4 |

## Findings

1. **XHR is the only cross-engine way to get upload progress.** Streamed `fetch` bodies need
   HTTP/2 in Chromium, fail in WebKit over HTTP/1.1, and Firefox silently uploads the wrong bytes.
   That rules out a fetch-based upload path (ky's `onUploadProgress` relies on it).
2. **XHR also gives download progress**, so one transport covers both phases. `total` is 0 and
   `lengthComputable` false without a Content-Length (compressed or chunked responses).
3. **An XHR result converts into a real `Response`** (`blob` response type, headers from
   `getAllResponseHeaders()`, a null body for 204). The driver's parsing, status, retry, cache and
   validation code can stay unchanged: the transport is a `fetch`-shaped function.
4. **Abort, timeout and network errors map 1:1** onto what the driver already handles: an
   `AbortSignal` calls `xhr.abort()` and rejects with an `AbortError`; an error rejects with a
   `TypeError` like fetch.
5. **Event rates differ a lot** (WebKit ~15 ms apart, Chromium/Firefox ~50–100 ms). Each progress
   reply is a state write and a render, so the driver should throttle (≥ 50 ms, the XHR spec's
   minimum, always keeping the first and the final event of a phase).
6. **What XHR can't do:** `keepalive`, `priority`, `integrity`, `cache`, `redirect: 'manual'`,
   `mode: 'no-cors'`, `referrerPolicy`, and `credentials: 'omit'` for same-origin. `credentials:
   'include'` maps to `withCredentials`. A progress request with those init keys should warn in dev.
7. **No XHR in Node or service workers.** A progress request there falls back to `fetch` with no
   progress events.

## API options

| Option | Verdict |
|---|---|
| **A. `progress` on the request**: `'ACTION'` (a reply action to the sender, like `ok`/`error`) or `true` (the plain path, a new `HTTP.progress(category?)` source, like `select()`/`errors()`) | **Recommended.** Same two delivery paths every Sygnal driver already has; data, not callbacks, so it stays testable and serialisable; works with `latest`, `abort`, `timeoutMs`, `retry`, isolation |
| B. Callbacks on the request (`onUploadProgress`, axios) | No: functions in sink values break the "model returns data" rule and the test fake's request matching |
| C. A separate `makeUploadDriver()` | No: duplicates replies, isolation, latest/abort, retry and the test fake |
| D. Fetch streams for upload | No: finding 1 |

**Event data** (both paths): `{ phase: 'upload' | 'download', loaded, total, fraction, request, category }`,
`total` and `fraction` `null` when the length is unknown. A request with a body reports `upload`
then `download`; a GET only `download`. A retry restarts at `loaded: 0`.

**Scope limits:** not for `resources` (reads) or `batch`; a progress request never shares an
in-flight fetch with another (D79 de-duplication) since each sender needs its own events.

**Transport options:** `makeFetchDriver({ XMLHttpRequest })` like the socket driver's
`WebSocket` / `EventSource` options (read at request time). A custom `fetch` option is not used
for progress requests (it can't report upload progress); put auth in `headers`, which apply to
both transports.

**Body (added 2026-10-18, D560):** a `multipart: { file, ... }` request field builds the
FormData in the driver, as `json` builds a JSON body, so models return plain data.

**Testing:** `renderComponent`'s HTTP fake answers progress requests from its in-memory fetch as
today, and a new `t.progress(target, { loaded, total, phase? })` emits a progress event for a
pending request (targets as `t.respond`).
