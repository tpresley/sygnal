import { oc } from '@orpc/contract'
import { z } from 'zod'
export const Note = z.object({ id: z.number(), text: z.string().describe('SCHEMA_ONLY_MARKER') })
export const contract = { notes: { list: oc.route({ method: 'GET', path: '/notes' }).output(z.array(Note)) } }
