// Sift friction (7.2): stream requests, { reset }, queryCache().clear() and failure headers
import { queryCache } from 'sygnal'
import type { FetchRequest, FetchFailure, FetchError, ResourceRequest } from 'sygnal'

export const streamed: FetchRequest = { url: '/api/copilot', json: { q: 'hi' }, stream: 'sse', chunk: 'DELTA', ok: 'DONE', error: 'FAILED', done: '[DONE]' }
export const byPredicate: FetchRequest = { url: '/rows', stream: 'ndjson', chunk: 'ROW', done: (p: any) => p.last === true }
// @ts-expect-error stream is 'sse' | 'ndjson' | 'text'
export const badMode: FetchRequest = { url: '/x', stream: 'xml' }

export const resetAll: FetchRequest = { reset: true }
export const resetTag: FetchRequest = { reset: 'session' }
export const resetSome: FetchRequest = { reset: ['/api/me', 'session'] }
export const resetFn: FetchRequest = { reset: (r: any) => r.url === '/api/me' }

export const polled: ResourceRequest = { url: '/api/prices', refetchEvery: Math.random() > 0.5 ? 5000 : undefined }

const cache = queryCache()
cache.clear()

export const retryAfter = (f: FetchFailure) => f.headers?.get('Retry-After')
export const requestId = (f: FetchError) => f.headers?.get('X-Request-Id')
