// The intake form's catalog: field pieces a model assembles into a form for the task the user
// describes. Unlike a dashboard, the request almost never names a part ("I lost my laptop" asks for
// no field by name), so the model has to infer which pieces the task needs.
import { defineCatalog } from 'sygnal/ai'
import { z } from 'zod'
import { Contact, Dates, Amount, Device, Place, Details, Urgency, Approver, Attachments, Consent, Question, Section } from './fields.jsx'

const anywhere = ['page', 'section']

const label = (fallback, maxLength = 40) => ({ type: 'text', maxLength, default: fallback, label: 'the field label' })

export const catalog = defineCatalog({
  description: 'An intake form the user fills in for one task',
  parts: {
    contact: {
      render: Contact,
      in: anywhere,
      description: 'Contact (how to reach the person filing it: email, and a phone number)',
      params: { phone: { label: 'the phone field', default: 'optional', options: { optional: 'phone is optional', required: 'phone is required (someone must call back)', none: 'no phone field' } } },
    },
    dates: {
      render: Dates,
      in: anywhere,
      description: 'Dates (a date picker for when something happens or happened)',
      params: {
        mode: { label: 'one day or a range', default: 'single', options: { single: 'one day (when it happened, a due date)', range: 'a from–to range (leave, a trip)' } },
        label: label('When'),
      },
    },
    // a form can ask for several amounts ("flight and hotel budget"): each piece's values live
    // under its own node key ('amount', 'amount~2')
    amount: { render: Amount, in: anywhere, maxUses: 3, description: 'Amount (a money field with its currency)', params: { label: label('Amount') } },
    device: { render: Device, in: anywhere, description: 'Device (which company device: its kind and asset tag)' },
    place: { render: Place, in: anywhere, description: 'Place (a free-text location: where it happened, or where to go)', params: { label: label('Where') } },
    details: {
      render: Details,
      in: anywhere,
      description: 'Details (one long free-text answer)',
      params: { question: label('Anything else we should know?', 80) },
    },
    urgency: { render: Urgency, in: anywhere, description: 'Urgency (how soon it must be handled: whenever, this week, today)' },
    approver: { render: Approver, in: anywhere, description: 'Approver (pick the manager who has to sign off)' },
    attachments: { render: Attachments, in: anywhere, description: 'Attachments (upload photos, receipts or documents)', params: { label: label('Attachments') } },
    consent: {
      render: Consent,
      in: anywhere,
      description: 'Confirmation (a checkbox the person ticks to confirm one statement)',
      params: { statement: { type: 'text', maxLength: 100, required: true, label: 'what the person confirms' } },
    },
    question: {
      render: Question,
      in: anywhere,
      maxUses: 3,
      description: 'Custom question (one extra question that no other part asks)',
      params: {
        label: { type: 'text', maxLength: 60, required: true, label: 'the question' },
        answer: { label: 'the kind of answer', default: 'short', options: { short: 'a short text answer', long: 'a paragraph', yesno: 'yes or no' } },
      },
    },
  },
  containers: {
    section: {
      description: 'Section (a titled group of related fields)',
      maxUses: 3,
      params: { title: { type: 'text', maxLength: 40, required: true, label: 'the section title' } },
      render: Section,
    },
  },
  rows: false,
  guidance: [
    'Group the fields in sections only when there are more than five.',
    'Prefer a prepared part to a custom question; use a custom question only for something no part asks.',
  ],
  limits: { maxParts: 10, maxDepth: 2 },
})

/**
 * What the app sends as the request. The compose prompt's rules are written for requests that name
 * the parts they want ("Use only the parts the request asks for … do not add parts it does not ask
 * for"), so a bare task ("I lost my laptop") composes nothing. The app frames the task as a request
 * for the fields it needs.
 */
export const formRequest = (task) =>
  `A form to file this request: "${task}". It asks for every field the team handling it needs to act on it, and nothing else.`

/** the parts placed on the composed form: [{ key, part, params }] in page order */
export function placed(layout) {
  const out = []
  const walk = (key) => {
    const n = layout?.nodes?.[key]
    if (!n) return
    if (n.slots) for (const s in n.slots) n.slots[s].forEach(walk)
    else out.push({ key, part: n.part, params: n.params ?? {} })
  }
  walk(layout?.root ?? 'page')
  return out
}

const required = z.string().min(1, 'Required')

/**
 * What each piece adds to the form: its start value under its node key (one value, or an object of
 * them: the field names are `<node>` and `<node>.<field>`), and its rules. Every field on the form
 * is required unless its piece says otherwise (the contact's phone).
 */
export const PIECES = {
  contact: {
    start: (p) => (p.phone === 'none' ? { email: '' } : { email: '', phone: '' }),
    rules: (p) => z.object({
      email: z.email('Enter an email address'),
      ...(p.phone !== 'none' && { phone: p.phone === 'required' ? required : z.string() }),
    }),
  },
  dates: {
    start: (p) => (p.mode === 'range' ? { start: '', end: '' } : { start: '' }),
    rules: (p) => p.mode === 'range'
      ? z.object({ start: required, end: required }).refine((d) => !d.end || !d.start || d.end >= d.start, { message: 'Ends before it starts', path: ['end'] })
      : z.object({ start: required }),
  },
  amount: {
    start: () => ({ amount: '', currency: 'USD' }),
    rules: () => z.object({ amount: z.coerce.number().positive('Enter an amount above 0'), currency: z.string() }),
  },
  device: {
    start: () => ({ kind: '', assetTag: '' }),
    rules: () => z.object({ kind: required, assetTag: required.regex(/^AT-\d{4,6}$/, 'Asset tags look like AT-10442') }),
  },
  place: { start: () => '', rules: () => required },
  details: { start: () => '', rules: () => required },
  urgency: { start: () => '', rules: () => required },
  approver: { start: () => '', rules: () => required },
  attachments: { start: () => null, rules: () => z.any() },
  consent: { start: () => false, rules: () => z.literal(true, 'Required') },
  question: { start: () => '', rules: () => required },
}

/** the layout on screen (the streamed preview while the model writes) */
export const shown = (page) => page.preview ?? page.layout

/** the form's dynamic fields: each placed piece's start value under its node key */
export const formFields = (layout) => Object.fromEntries(placed(layout).map((p) => [p.key, PIECES[p.part].start(p.params)]))

// one schema per layout object (the form caches its results per schema: SYG239 otherwise)
const schemas = new WeakMap()
const EMPTY = z.object({})

/** the composed form's schema: each placed piece's rules under its node key */
export function formSchema(layout) {
  if (!layout) return EMPTY
  if (!schemas.has(layout)) schemas.set(layout, z.object(Object.fromEntries(placed(layout).map((p) => [p.key, PIECES[p.part].rules(p.params)]))))
  return schemas.get(layout)
}
