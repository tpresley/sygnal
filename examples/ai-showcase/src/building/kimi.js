// Every step on this tab runs the same way: its Chat component, with one chat driver whose
// transport is locked to one model, Kimi K3 on Kindo (Open Responses). There is no model picker,
// so the components never name a model.
//
// The page never holds the API key: /api/kindo is this dev server's proxy, which adds it
// (server/providers.js). In production, point the transport at your own server instead.
import { run } from 'sygnal'
import { makeChatDriver, openResponses } from 'sygnal/ai'

const transport = openResponses({ baseURL: '/api/kindo/v1', model: 'moonshotai/Kimi-K3' })

export const start = (Chat, mountPoint, uid) => run(Chat, {
  LLM: makeChatDriver({ transport }),
}, { mountPoint, uid })
