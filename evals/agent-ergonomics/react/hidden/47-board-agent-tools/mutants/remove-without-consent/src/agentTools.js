import { z } from 'zod'
import { COLUMNS } from './columns.js'

const COLUMN_IDS = COLUMNS.map((c) => c.id)
const column = z.enum(COLUMN_IDS).describe('The column: todo (To do), doing (Doing) or done (Done)')
const id = z.number().int().describe("The card's id (board_read lists them)")

/**
 * The board's WebMCP tools. `board` gives the cards now and changes them:
 * { cards(), add(title, column), move(id, column), remove(id), confirm(card) -> Promise<boolean> }.
 */
export function boardTools(board) {
  const missing = (cardId) => ({ ok: false, error: `no card with id ${cardId}; ids: ${board.cards().map((c) => c.id).join(', ')}` })
  const tool = (name, description, schema, run, annotations) => ({
    name,
    description,
    inputSchema: z.toJSONSchema(schema),
    ...(annotations && { annotations }),
    async execute(input) {
      const parsed = schema.safeParse(typeof input === 'string' ? JSON.parse(input) : input ?? {})
      if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ') }
      try {
        return await run(parsed.data)
      } catch (e) {
        return { ok: false, error: String(e?.message ?? e) }
      }
    },
  })
  return [
    tool('board_read', 'Read the board: every card with its id, title and column (todo, doing or done)', z.object({}),
      () => ({ ok: true, cards: board.cards() }), { readOnlyHint: true }),
    tool('board_add_card', 'Add a card with this title to a column of the board',
      z.object({ title: z.string().trim().min(1).describe('The card title'), column }),
      ({ title, column: to }) => ({ ok: true, card: board.add(title, to) })),
    tool('card_move', 'Move the card with this id to another column', z.object({ id, column }),
      ({ id: cardId, column: to }) => {
        const card = board.cards().find((c) => c.id === cardId)
        if (!card) return missing(cardId)
        board.move(cardId, to)
        return { ok: true, card: { ...card, column: to } }
      }),
    tool('card_remove', 'Remove the card with this id from the board (the user is asked first)', z.object({ id }),
      async ({ id: cardId }) => {
        const card = board.cards().find((c) => c.id === cardId)
        if (!card) return missing(cardId)
                board.remove(cardId)
        return { ok: true, removed: card }
      }),
  ]
}

/** Register the tools on the page's model context; returns the unregister function. */
export function exposeTools(tools) {
  const mc = globalThis.document?.modelContext ?? globalThis.navigator?.modelContext
  if (!mc?.registerTool) return () => {}
  const controller = new AbortController()
  for (const t of tools) {
    try {
      Promise.resolve(mc.registerTool(t, { signal: controller.signal })).catch((e) => console.warn(`WebMCP: could not register ${t.name}`, e))
    } catch (e) {
      console.warn(`WebMCP: could not register ${t.name}`, e)
    }
  }
  return () => controller.abort()
}
