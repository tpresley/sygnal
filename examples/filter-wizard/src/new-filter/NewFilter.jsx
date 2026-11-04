import { wizard, Outlet } from 'sygnal'
import { BLANK } from '../filters.js'
import Describe from './Describe.jsx'
import { Keywords, Threshold } from './Configure.jsx'
import Review from './Review.jsx'
import Created from './Created.jsx'

const STEPS = { describe: Describe, keywords: Keywords, threshold: Threshold, review: Review, created: Created }

// The wizard's host: the stepper, the current step (the outlet), Back / Next / Start over, and the
// leave dialog. The steps are ordinary components; only the current one exists.
function NewFilter({ state }) {
  const w = state.wizard
  return (
    <section className="new-filter">
      <h1>New filter</h1>
      <ol className="stepper" aria-label="Progress">
        {w.stepper.map((s) => (
          <li aria-current={s.current ? 'step' : undefined} data-status={s.status}>
            {/* a group's entry goes to the member that applies (s.step), not to the group (s.name) */}
            {s.reachable && !s.current && !w.outcome
              ? <button type="button" className="goto" data-step={s.step}>{s.label}</button>
              : <span>{s.label}</span>}
            {s.status === 'done' && <span className="visually-hidden"> (completed)</span>}
          </li>
        ))}
      </ol>

      <Outlet of={STEPS} from="wizard" />

      {!w.outcome && (
        <p className="moves">
          <button type="button" className="back" disabled={!w.canBack}>Back</button>
          {/* the last step (Review) has its own Create button */}
          {!w.last && <button type="button" className="next" disabled={!w.canNext}>Next</button>}
          <button type="button" className="start-over">Start over</button>
        </p>
      )}

      <dialog className="leave-dialog" aria-labelledby="leave-title">
        <h2 id="leave-title">{w.dialog?.title}</h2>
        <p>{w.dialog?.body}</p>
        <div className="actions">
          <button type="button" className="discard">Discard</button>
          <button type="button" className="stay">Keep editing</button>
        </div>
      </dialog>
    </section>
  )
}

NewFilter.uses = {
  wizard: wizard({
    steps: {
      describe: { label: 'Describe', valid: (step) => step.draft.name.trim() !== '' },
      // two alternatives for one place in the flow: `when` picks the one that applies, and the
      // stepper shows one entry, "Configure", for both
      keywords: {
        label: 'Keywords', group: 'configure',
        when: (step) => step.draft.source === 'logs',
        valid: (step) => step.draft.keywords.trim() !== '',
      },
      threshold: {
        label: 'Threshold', group: 'configure',
        when: (step) => step.draft.source === 'metrics',
        valid: (step) => Number(step.draft.above) > 0,
      },
      // scratch, set again on each entry: a request in flight or an error doesn't outlive the visit
      review: {
        label: 'Review',
        visit: { creating: false, error: null },
        dialog: { title: 'Discard this filter?', body: 'It isn’t created yet: what you entered will be lost.' },
      },
      // the final screen: entered by Review's GOTO once the filter exists; nothing left to lose
      created: { outcome: true, dirty: () => false },
    },
    groups: { configure: { label: 'Configure' } },
    draft: BLANK,
    // the flow key is the filter the flow created: none until Review creates it (?filter=7 then)
    // (the root writes the route into this state; `?.`: before its first ROUTE)
    key: (state) => state.route?.query.filter ?? null,
    url: {
      route: 'newFilterStep', param: 'step', key: 'filter',
      // /filters/new is the first step's URL
      from: (state) => (state.route?.name === 'newFilter' ? { ...state.route, name: 'newFilterStep', params: { step: 'describe' } } : state.route),
    },
    resetTo: { to: 'newFilter' },
    // the leave guard: a link, a router command or the back button out of the flow asks first
    dirty: (step) => step.draft.name.trim() !== '',
    dialog: { title: 'Discard this filter?', body: 'What you entered so far will be lost.' },
    next: '.next', back: '.back', reset: '.start-over', goto: '.goto',
    confirm: '.leave-dialog', leave: '.discard', stay: '.stay',
  }),
}

export default NewFilter
