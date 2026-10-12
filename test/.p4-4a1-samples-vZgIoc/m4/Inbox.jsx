import { selection, isSelected } from 'sygnal'
const pick = (state, id) => isSelected(state.sel, id)
export function Inbox({ state }) {
  return (
    <ul>
      {state.mails.map(mail => (
        <li><button className="pick" data-id={mail.id} aria-pressed={String(pick(state, mail.id))}>{mail.subject}</button></li>
      ))}
    </ul>
  )
}
Inbox.initialState = { mails: [{ id: 1, subject: 'Lunch?' }, { id: 2, subject: 'Invoice' }] }
Inbox.uses = { sel: selection({ multi: true, item: '.pick', from: 'mails' }) }
