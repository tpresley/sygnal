// What the model said about its last composition: its plan (`asked_for`) for a new page, or the
// operations of an edit, as the compose behavior keeps them in `decisions`.
const opText = (o) => [o.op, o.node, o.part !== o.node && o.part, o.params && JSON.stringify(o.params), o.where].filter(Boolean).join(' ')

export function modelPlan(decisions) {
  if (decisions?.asked_for) return <p className="plan"><b>Model's plan:</b> {decisions.asked_for.join(' · ') || 'nothing'}</p>
  if (decisions?.ops) return <p className="plan"><b>Model's edit:</b> {decisions.ops.map(opText).join(' · ') || 'no change'}</p>
  return null
}
