// PLAN-11 S-1: which transport gives upload / download progress in real browsers?
// node dev-plans/research/upload-progress/probe.mjs [chromium,firefox,webkit]
// Uses the cached Playwright engines from browser-tests (never downloads browsers).
import http from 'node:http';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../../../browser-tests/package.json'));
const pw = require('playwright');

const page = `<!doctype html><meta charset="utf-8"><title>probe</title><script>
const now = () => Math.round(performance.now());
const blob = mb => new Blob([new Uint8Array(mb * 1024 * 1024)]);
const form = mb => { const f = new FormData(); f.append('name', 'x'); f.append('file', blob(mb), 'a.bin'); return f; };

// XHR: upload + download progress, then a real Response built from the result
window.xhr = (method, url, body, {abortAfter, timeout, type = 'blob'} = {}) => new Promise(res => {
  const ev = [], t0 = now(), x = new XMLHttpRequest();
  const log = phase => e => ev.push({phase, type: e.type, loaded: e.loaded, total: e.total, lc: e.lengthComputable, t: now() - t0});
  x.open(method, url);
  x.responseType = type;
  if (timeout) x.timeout = timeout;
  ['loadstart', 'progress', 'load', 'loadend'].forEach(k => { x.upload.addEventListener(k, log('upload')); x.addEventListener(k, log('download')); });
  x.onerror = () => res({ev, error: 'error', status: x.status});
  x.onabort = () => res({ev, error: 'abort', status: x.status});
  x.ontimeout = () => res({ev, error: 'timeout', status: x.status});
  x.onload = async () => {
    const headers = new Headers();
    x.getAllResponseHeaders().trim().split(/[\\r\\n]+/).filter(Boolean).forEach(l => { const i = l.indexOf(':'); headers.append(l.slice(0, i).trim(), l.slice(i + 1).trim()); });
    let r, parsed, err;
    try { r = new Response(x.status == 204 ? null : x.response, {status: x.status, statusText: x.statusText, headers}); parsed = await r.text(); } catch (e) { err = String(e); }
    res({ev, status: x.status, ct: headers.get('content-type'), responseURL: x.responseURL, body: parsed && parsed.slice(0, 80), err});
  };
  x.send(body);
  if (abortAfter) setTimeout(() => x.abort(), abortAfter);
});

// fetch with a streamed request body (the only fetch route to upload progress)
window.fetchStream = async mb => {
  const total = mb * 1024 * 1024, chunk = 64 * 1024; let sent = 0; const ev = [];
  const stream = new ReadableStream({pull(c) { if (sent >= total) return c.close(); c.enqueue(new Uint8Array(chunk)); sent += chunk; ev.push(sent); }});
  try {
    const r = await fetch('/upload', {method: 'POST', body: stream, duplex: 'half'});
    return {ok: true, status: r.status, pulls: ev.length, body: await r.text()};
  } catch (e) { return {ok: false, error: String(e)}; }
};
// does the browser even accept a stream body? (the feature test ky / others use)
window.duplexSupported = () => { let d = false; try { const h = new Request('/x', {method: 'POST', body: new ReadableStream(), get duplex() { d = true; return 'half'; }}).headers.has('Content-Type'); return d && !h; } catch (e) { return 'throws: ' + e; } };

// fetch download progress by reading the body
window.fetchDownload = async url => {
  const r = await fetch(url), total = +r.headers.get('content-length') || 0, ev = [], t0 = now();
  const rd = r.body.getReader(); let loaded = 0;
  for (;;) { const {done, value} = await rd.read(); if (done) break; loaded += value.length; ev.push({loaded, total, t: now() - t0}); }
  return {ev: ev.length, loaded, total, first: ev[0], last: ev[ev.length - 1]};
};
window.form = form; window.blob = blob;
</script>`;

// the server reads uploads slowly (backpressure, so progress spreads out) and streams downloads
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname == '/') return res.end(page);
  if (u.pathname == '/upload') {
    let n = 0;
    req.on('data', c => { n += c.length; req.pause(); setTimeout(() => req.resume(), 15); });
    req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({bytes: n, ct: req.headers['content-type'], te: req.headers['transfer-encoding'] || null})); });
    return;
  }
  if (u.pathname == '/download') {
    const size = +(u.searchParams.get('mb') || 2) * 1024 * 1024, chunk = 64 * 1024, len = u.searchParams.has('nolen');
    res.setHeader('content-type', 'application/octet-stream');
    if (!len) res.setHeader('content-length', size);
    let sent = 0;
    const tick = () => { if (sent >= size) return res.end(); res.write(Buffer.alloc(chunk)); sent += chunk; setTimeout(tick, 5); };
    return tick();
  }
  if (u.pathname == '/status') { res.statusCode = +u.searchParams.get('s'); res.setHeader('content-type', 'application/json'); return res.end(res.statusCode == 204 ? undefined : '{"error":"nope"}'); }
  if (u.pathname == '/slow') return setTimeout(() => res.end('late'), 2000);
  res.statusCode = 404; res.end();
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const summarize = r => {
  if (!r.ev) return r;
  const up = r.ev.filter(e => e.phase == 'upload' && e.type == 'progress'), down = r.ev.filter(e => e.phase == 'download' && e.type == 'progress');
  return {status: r.status, error: r.error, err: r.err, ct: r.ct, body: r.body,
    upload: {progressEvents: up.length, lc: up.some(e => e.lc), last: up.at(-1) && `${up.at(-1).loaded}/${up.at(-1).total}`, spanMs: up.length ? up.at(-1).t - up[0].t : 0,
      types: [...new Set(r.ev.filter(e => e.phase == 'upload').map(e => e.type))].join(',')},
    download: {progressEvents: down.length, lc: down.some(e => e.lc), last: down.at(-1) && `${down.at(-1).loaded}/${down.at(-1).total}`}};
};

const engines = (process.argv[2] || 'chromium,firefox,webkit').split(',');
const out = {};
for (const name of engines) {
  const b = await pw[name].launch();
  const p = await b.newPage();
  await p.goto(base + '/');
  const o = out[name] = {version: b.version()};
  o.xhrUploadForm = summarize(await p.evaluate(() => xhr('POST', '/upload', form(4), {type: 'text'})));
  o.xhrUploadBlob = summarize(await p.evaluate(() => xhr('POST', '/upload', blob(4), {type: 'text'})));
  o.xhrUploadEmptyGet = summarize(await p.evaluate(() => xhr('GET', '/download?mb=1')));
  o.xhrDownloadNoLen = summarize(await p.evaluate(() => xhr('GET', '/download?mb=1&nolen')));
  o.xhr404 = summarize(await p.evaluate(() => xhr('GET', '/status?s=404', null, {type: 'blob'})));
  o.xhr204 = summarize(await p.evaluate(() => xhr('GET', '/status?s=204')));
  o.xhrAbortMidUpload = summarize(await p.evaluate(() => xhr('POST', '/upload', blob(8), {abortAfter: 300})));
  o.xhrTimeout = summarize(await p.evaluate(() => xhr('GET', '/slow', null, {timeout: 300})));
  o.xhrNetworkError = summarize(await p.evaluate(() => xhr('GET', 'http://127.0.0.1:1/')));
  o.duplexSupported = await p.evaluate(() => duplexSupported());
  o.fetchStreamUpload = await p.evaluate(() => fetchStream(2));
  o.fetchDownloadReader = await p.evaluate(() => fetchDownload('/download?mb=2'));
  await b.close();
}
server.close();
console.log(JSON.stringify(out, null, 1));
