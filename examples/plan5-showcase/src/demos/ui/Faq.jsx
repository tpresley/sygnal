import { run } from 'sygnal'
import { accordion, accordionAttrs } from 'sygnal/ui'

const FAQ = [
  { id: 'shipping', question: 'How long does shipping take?', answer: 'Two to four working days.' },
  { id: 'returns', question: 'Can I return an item?', answer: 'Within 30 days, unused.' },
  { id: 'gifts', question: 'Do you gift-wrap?', answer: 'Yes, add a note at checkout.' },
]

export function Faq({ state, uid }) {
  const a = accordionAttrs(state.faq, uid)
  return (
    <div className="faq">
      {FAQ.map((item) => (
        <div className="faq-item">
          <h4><button className="faq-question" {...a.trigger(item.id)}>{item.question}</button></h4>
          <div className="faq-answer" {...a.panel(item.id)}><p>{item.answer}</p></div>
        </div>
      ))}
      <output>Open: {state.faq.expanded.join(', ') || 'none'}</output>
    </div>
  )
}

// one open at a time; Up / Down / Home / End move between the headers
Faq.uses = { faq: accordion({ trigger: '.faq-question', expanded: 'shipping' }) }

export const start = (mountPoint, uid) => run(Faq, {}, { mountPoint, uid })
