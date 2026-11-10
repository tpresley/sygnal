import { closeTicket, postReply } from './api.js'
import { canSend } from './rules.js'

export function useTicketActions({ selected, draft, setTickets, setSelectedId, setDrafts, setNotice }) {
  async function run(action, onDone) {
    try {
      onDone(await action())
    } catch {
      setNotice('That did not go through.')
    }
  }

  function send() {
    if (!canSend(selected, draft)) return
    return run(() => postReply(selected.id, draft), () => {
      setDrafts((d) => ({ ...d, [selected.id]: '' }))
      setNotice('Reply sent.')
    })
  }

  function close() {
    return run(() => closeTicket(selected.id), (updated) => {
      setTickets((list) => list.map((t) => (t.id === updated.id ? updated : t)))
      setSelectedId(null)
      setNotice('Ticket closed.')
    })
  }

  return { send, close }
}
