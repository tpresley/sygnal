// 'sygnal/api' (dev preview): typed clients for an API contract (oRPC, OpenAPI paths, Hono). The
// code lives in the main package (src/extra/api/), and this entry re-exports it from the external
// 'sygnal' (rollup maps './index' to it), as 'sygnal/ai' does: one copy of the diagnostics per app.
// Keep this list in sync with src/index.ts and src/api.d.ts.
export {orpcClient, openApiClient, honoClient} from './index'
export {contractHash, contractSkew, isContractSkew, contractFetch} from './index'
export {fixture, errorFixture} from './index'
