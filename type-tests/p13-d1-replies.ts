/**
 * PLAN-13 D-1 type tests: makeReplies() / senderOf() for a hand-written driver.
 * Compiled by `npm run test:types`; never executed.
 */
import { makeReplies, senderOf, xs } from 'sygnal'
import type { ReplySender, ReplyChannel, Stream } from 'sygnal'

type Upload = { file: string; progress?: string; ok?: string; error?: string }

export function makeUploadDriver(send: (file: string, step: (f: number) => void) => Promise<string>) {
  return (sink$: Stream<Upload>) => {
    const ch: ReplyChannel = makeReplies((sender: ReplySender) => { void sender })
    const { replies, reply, listening } = ch
    sink$.addListener({
      next: (req) => {
        const sender = senderOf(req)
        if (sender === undefined) return
        const live: boolean = listening(sender)
        void live
        send(req.file, (f) => { if (req.progress) reply(sender, req.progress, f) })
          .then((v) => { if (req.ok) reply(sender, req.ok, v) })
      },
    })
    const flag: true = replies.__sygnalReplies
    void flag
    return { ...replies, select: () => xs.never() }
  }
}

// @ts-expect-error a sender is opaque: not any value
export const bad: ReplySender = 3
// @ts-expect-error reply() needs an action name
export const noType = (r: ReplyChannel, s: ReplySender) => r.reply(s)
