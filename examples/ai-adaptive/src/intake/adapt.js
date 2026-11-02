// Follow-up edits the app makes on its own, from what the person types: the composed form grows
// while it is being filled in. Each rule fires once per form; the edit goes to the model as a
// follow-up ("Add …"), so the fields already there keep their node keys and what was typed in them.
// A rule reads the form's values by piece: `of('amount', 'amount')` is the amount of every amount
// piece on the form (each piece's values are under its node key).
import { placed } from './catalog.jsx'

export const RULES = [
  {
    id: 'approval',
    why: 'Critical requests need a manager to sign off',
    when: (of) => of('urgency').includes('critical') && !of('approver').length,
    prompt: 'Add the approver field right below the urgency',
  },
  {
    id: 'receipts',
    why: 'Amounts of 500 or more need a receipt',
    when: (of) => of('amount', 'amount').some((a) => Number(a) >= 500) && !of('attachments').length,
    prompt: 'Add an attachments field for the receipts, below the amount',
  },
  {
    id: 'device',
    why: 'The details mention a device',
    when: (of) => of('details').some((d) => /\b(laptop|phone|monitor|headset)\b/i.test(d)) && !of('device').length,
    prompt: 'Add the device field above the details',
  },
]

/** the first rule that applies now and hasn't fired for this form, or null */
export function nextRule(state) {
  if (!state.page.layout || state.page.status === 'composing' || state.page.status === 'preview') return null
  const pieces = placed(state.page.layout), values = state.intake.values
  const of = (part, field) => pieces.filter((p) => p.part === part).map((p) => (field ? values[p.key]?.[field] : values[p.key]))
  return RULES.find((r) => !state.adapted.includes(r.id) && r.when(of)) ?? null
}
