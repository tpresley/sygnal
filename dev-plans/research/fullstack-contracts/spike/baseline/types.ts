// Baseline: the types the client and server agree on, kept in step by hand.
import { z } from 'zod'

export const Quote = z.object({ id: z.number(), text: z.string(), tag: z.string() })
export type Quote = z.infer<typeof Quote>
export const AddQuoteBody = z.object({ text: z.string().min(3), tag: z.string() })
export type AddQuoteBody = z.infer<typeof AddQuoteBody>
