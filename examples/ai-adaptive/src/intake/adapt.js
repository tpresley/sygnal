// Follow-up edits the app makes on its own, from what the person types: the composed form grows
// while it is being filled in. Each rule fires once per form; the edit goes to the model as a
// follow-up ("Add …"), so the fields already there keep their node keys and what was typed in them.
import { placed } from './catalog.jsx'

export const RULES = [
  {
    id: 'approval',
    why: 'Critical requests need a manager to sign off',
    when: (v, parts) => v.urgency === 'critical' && !parts.has('approver'),
    prompt: 'Add the approver field right below the urgency',
  },
  {
    id: 'receipts',
    why: 'Amounts of 500 or more need a receipt',
    when: (v, parts) => Number(v.amount) >= 500 && !parts.has('attachments'),
    prompt: 'Add an attachments field for the receipts, below the amount',
  },
  {
    id: 'device',
    why: 'The details mention a device',
    when: (v, parts) => /\b(laptop|phone|monitor|headset)\b/i.test(v.details) && !parts.has('device'),
    prompt: 'Add the device field above the details',
  },
]

/** the first rule that applies now and hasn't fired for this form, or null */
export function nextRule(state) {
  if (!state.page.layout || state.page.status === 'composing' || state.page.status === 'preview') return null
  const parts = new Set(placed(state.page.layout).map((p) => p.part))
  return RULES.find((r) => !state.adapted.includes(r.id) && r.when(state.intake.values, parts)) ?? null
}
