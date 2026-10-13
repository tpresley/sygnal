// The schema the model fills: a zod object. Its JSON Schema (with every `.describe()` text) goes
// to the model with the request; the driver parses the reply and validates it with zod, so the
// component gets either a value of this shape or the schema's issues. Flat and small on purpose:
// small local models follow a schema less reliably the deeper it gets.
import { z } from 'zod'

const DAY = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export const Attendee = z.object({
  name: z.string().min(1).describe('The person\'s name as written; a role such as "the design team" if no name is given'),
  email: z.email().nullable().describe('Their email address if the email shows it, else null. Never invent one'),
  role: z.enum(['organizer', 'required', 'optional']).describe('organizer: who sets up the event; optional: only if the email says they may skip it; everyone else is required'),
})

export const Event = z.object({
  title: z.string().min(3).max(80).describe('A short title for the event, 3 to 8 words (not the email subject verbatim)'),
  date: z.string().regex(DAY).nullable().describe('The day the event takes place, YYYY-MM-DD. Resolve relative days ("next Thursday") against today\'s date given in the instructions. null if no day is settled'),
  start: z.string().regex(TIME).nullable().describe('Start time, 24-hour HH:MM, in the time zone of the `timeZone` field. null if no time is settled'),
  timeZone: z.string().nullable().describe('The time zone the start time is in, as written in the email (e.g. "PT", "CET", "Europe/Berlin"); null if none is mentioned'),
  durationMinutes: z.number().int().positive().max(24 * 60).nullable().describe('How long it lasts, in minutes (an hour is 60). null if unknown'),
  location: z.string().nullable().describe('The venue or address. null when the event is only online or no place is given'),
  online: z.boolean().describe('true when there is a video call link or the event is virtual'),
  attendees: z.array(Attendee).describe('Everyone invited, the organizer first'),
  agenda: z.array(z.string()).max(8).describe('The topics or plan, one short line each; empty if none'),
  priority: z.enum(['low', 'normal', 'high']).describe('high: a deadline, an executive, or "urgent"; low: social or optional; else normal'),
})
