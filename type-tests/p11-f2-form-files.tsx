/**
 * PLAN-11 F-2 type tests: file fields, `progress` and `resets` on the form slice, form.PROGRESS.
 * Compiled by `npm run test:types`; never executed.
 */
import { form } from 'sygnal'
import type { Component, UsesState, UsesActions, FormOutput } from 'sygnal'
import { z } from 'zod'

const schema = z.object({ name: z.string(), avatar: z.instanceof(File) })
const uses = { form: form(schema, { values: { name: '', avatar: null as unknown as File }, submit: 'SAVE' }) }
type State = UsesState<typeof uses>
type Actions = UsesActions<typeof uses> & { SAVE: FormOutput<typeof uses.form> }

export const Profile: Component<State, {}, {}, Actions> = ({ state }) => {
  const f: File = state.form.fields.avatar.value
  const fraction: number | null | undefined = state.form.progress?.fraction
  const k: string = 'avatar' + state.form.resets
  return <form><input type="file" name="avatar" key={k} /><p>{f.name}{fraction}</p></form>
}
Profile.uses = uses
Profile.model = {
  SAVE: { HTTP: (_state, data) => ({ url: '/api/profile', multipart: data, progress: 'form.PROGRESS', ok: 'form.DONE', error: 'form.ERRORS' }) },
}
