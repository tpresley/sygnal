import { z } from 'zod'
import { query, mutation } from 'sygnal/api'
import { DB_PASSWORD, rows } from '../server/db.js'
const API_TOKEN = 'token-in-a-server-file-5678'
export const search = query(z.object({ q: z.string() }), ({ q }) => rows().filter((r) => r.text.includes(q) && DB_PASSWORD && API_TOKEN))
export const save = mutation(z.object({ text: z.string() }), ({ text }) => ({ id: 2, text }), { errors: { FULL: { status: 507 } } })
export const helper = 'HELPER_EXPORT_MARKER'
