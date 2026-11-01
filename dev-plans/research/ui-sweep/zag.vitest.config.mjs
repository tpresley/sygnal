// The Zag parts sweep's probes (dev-plans/research/ui-sweep/zag.md): not in the root vitest (dev-plans/** is
// excluded). Run: npx vitest run --config dev-plans/research/ui-sweep/zag.vitest.config.mjs
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { root: new URL('../../..', import.meta.url).pathname, include: ['dev-plans/research/ui-sweep/zag-*.probe.js'] } })
