// Function-first (sygnal/vite's api.functions): these exports run on the server. In the client,
// the plugin replaces this file by stubs that build requests (`ideas.suggest` is POST
// /api/ideas/suggest), so its imports, the key and the function bodies stay on the server.
// Input is always validated; the server mounts the file with serverFunctions() (server/handler.ts).
import { z } from 'zod'
import { query } from 'sygnal/api'
import { IDEAS_KEY, pickIdea } from '../server/ideas'

let asked = 0

export const suggest = query(
  z.object({ tag: z.string() }),
  async ({ tag }, { errors }) => {
    const text = pickIdea(tag, IDEAS_KEY, asked++)
    if (!text) throw errors.NO_IDEAS({ data: { tag } })
    return { text }
  },
  { errors: { NO_IDEAS: { status: 404, message: 'No ideas for that tag', data: z.object({ tag: z.string() }) } } },
)
