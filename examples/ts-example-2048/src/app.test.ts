// Smoke test: renders the whole game with the dev checks ('sygnal/diagnostics')
// and strict mode on, plays a few moves through the real intent, and asserts
// that no diagnostics were reported.
import { describe, it, expect, vi, afterEach } from 'vitest'
import 'sygnal/diagnostics'
import { renderComponent } from 'sygnal'
import BOARD from './app'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('2048 (smoke)', () => {
  it('starts, merges tiles, restarts, and reports no diagnostics', async () => {
    // Math.random() = 0 places new tiles in the first free slot with value 2,
    // so the opening board is [2, 2, _, _] on the top row
    vi.spyOn(Math, 'random').mockReturnValue(0)

    const t = renderComponent(BOARD, { strict: true })
    try {
      // BOOTSTRAP → RESTART → ADD_TILE ×2
      const start = await t.waitForState(s => s.tiles.length === 2 && !s.locked)
      expect(start.tiles.map((tile: any) => [tile.row, tile.column, tile.value])).toEqual([[0, 0, 2], [0, 1, 2]])
      expect(t.html()).toContain('Score: 0')

      // keys other than the arrows are ignored
      t.simulateEvent('document', 'keydown', { key: 'a' })

      // LEFT merges the two 2s into a 4, then a new tile is added after the move delay
      t.simulateEvent('document', 'keydown', { key: 'ArrowLeft' })
      const merged = await t.waitForState(s => s.score > 0 && !s.locked)
      const live = merged.tiles.filter((tile: any) => !tile.deleted)
      expect(live.map((tile: any) => tile.value).sort()).toEqual([2, 4])
      expect(merged.max).toBe(4)
      expect(t.html()).toContain('Largest: 4')

      // the merged-away tile removes itself from the Collection after its transition
      await t.waitForState(s => s.tiles.length === 2)

      // "Start Over" resets the score and deals a fresh board
      t.simulateEvent('.restart', 'click')
      const restarted = await t.waitForState(s => s.score === 0 && s.tiles.length === 2 && !s.locked)
      expect(restarted.max).toBe(2)

      t.expectNoDiagnostics()
    } finally {
      t.dispose()
    }
  })
})
