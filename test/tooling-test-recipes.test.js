// PLAN-5 3-G, G-441: scripts/test-recipes.mjs (npm run test:recipes) argument handling. The run
// itself (recipe vitest + docs-sync, optional browser engines) is the gate, not repeated here.
import { it, expect } from 'vitest'
import { parseArgs } from '../scripts/test-recipes.mjs'

it('defaults: no install, no browser run', () => {
  expect(parseArgs([], {})).toEqual({ install: false, engines: [] })
})

it('--install / TEST_RECIPES_INSTALL; --browser (all three) or a list; TEST_RECIPES_BROWSER', () => {
  expect(parseArgs(['--install'], {}).install).toBe(true)
  expect(parseArgs([], { TEST_RECIPES_INSTALL: '1' }).install).toBe(true)
  expect(parseArgs(['--browser'], {}).engines).toEqual(['chromium', 'firefox', 'webkit'])
  expect(parseArgs(['--browser=webkit,firefox'], {}).engines).toEqual(['webkit', 'firefox'])
  expect(parseArgs([], { TEST_RECIPES_BROWSER: '1' }).engines).toEqual(['chromium', 'firefox', 'webkit'])
  expect(parseArgs([], { TEST_RECIPES_BROWSER: 'chromium' }).engines).toEqual(['chromium'])
})

it('rejects an unknown engine or argument', () => {
  expect(() => parseArgs(['--browser=edge'], {})).toThrow(/unknown engine 'edge'/)
  expect(() => parseArgs(['--fast'], {})).toThrow(/unknown argument/)
})
