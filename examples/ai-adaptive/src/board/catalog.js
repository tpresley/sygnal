import { byId } from 'sygnal'
import { defineCatalog } from 'sygnal/ai'
import { IncidentCard, Services, Slo, Queue, Deploys, Reviews, Agenda, Oncall, Quiet } from './parts.jsx'

// every card: how big, and why it is where it is (the arranger writes both)
const card = {
  size: { label: 'size', default: 'compact', options: { full: 'full size, with its details (needs action now)', compact: 'one line (to watch, or normal)' } },
  why: { type: 'text', maxLength: 80, default: '', label: 'one short reason this card is here' },
}
const anywhere = ['page', 'quiet']

export const catalog = defineCatalog({
  description: 'An ops board that puts what needs attention first',
  parts: {
    incident: {
      component: IncidentCard,
      in: anywhere,
      maxUses: 6,
      description: 'Incident (card for one open incident: severity, age, acknowledge, notes)',
      params: {
        id: {
          label: 'which incident',
          from: (state) => state.incidents.map((i) => ({
            value: i.id,
            name: i.title,
            description: `SEV${i.sev} on ${i.service}, ${i.minutes} min old, ${i.acked ? 'acknowledged' : 'not acknowledged'}`,
          })),
        },
        ...card,
      },
      // the card edits its own incident record: acknowledge, notes
      state: (node) => byId('incidents', node.params.id),
      props: (params, state) => ({ ...params, pinned: state.pins.includes(`incident:${params.id}`) }),
    },
    services: { render: Services, in: anywhere, description: 'Services (health of each service)', params: card },
    slo: { render: Slo, in: anywhere, description: 'Error budget (how fast the SLO error budget burns)', params: card },
    queue: { render: Queue, in: anywhere, description: 'Job queue (jobs waiting to run)', params: card },
    deploys: { render: Deploys, in: anywhere, description: 'Deploys (recent deploys and rollbacks)', params: card },
    reviews: { render: Reviews, in: anywhere, description: 'Reviews (pull requests waiting on me)', params: card },
    agenda: { render: Agenda, in: anywhere, description: 'Agenda (my next meetings)', params: card },
    oncall: { render: Oncall, in: anywhere, description: 'On call (who is on call)', params: card },
  },
  containers: {
    quiet: { description: 'Quiet section (folded list at the bottom, for the normal parts)', render: Quiet, accepts: 'leaves' },
  },
  limits: { maxParts: 14, maxDepth: 2 },
})
