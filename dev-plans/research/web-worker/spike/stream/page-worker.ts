import {startBridge} from '../src/bridge'

startBridge(new Worker(new URL('./worker.ts', import.meta.url), {type: 'module'}), document.getElementById('root')!, {stats: location.search.includes('stats')})
