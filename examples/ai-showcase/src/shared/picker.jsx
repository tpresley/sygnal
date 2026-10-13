// The model picker every widget has: the same few statics, spread into each widget's own.
//
// The choices come from the dev server's GET /api/providers (a resource), and are read again
// when a key is added or forgotten in the Keys dialog (the shell fires `showcase:keys` on the
// document). `pickedModel(state, opts)` is the model in use: the user's pick, or the default
// (Kimi K3 on Kindo when a key is set, else qwen3:8b on Ollama).
import { ABORT } from 'sygnal'
import { modelChoices, defaultChoice, offline } from './providers.js'

export const providersResource = {
  providers: (state) => ({ url: `/api/providers?v=${state.keysVersion}`, keepPrevious: true }),
}

export const pickerState = { model: null, keysVersion: 0 }

export const choicesOf = (state, opts) => modelChoices(state.providers?.data, opts)

/** the model id in use: `route::model`, or null while nothing is available */
export function pickedModel(state, opts) {
  const choices = choicesOf(state, opts)
  return (state.model && choices.some((c) => c.id === state.model) ? state.model : defaultChoice(choices)?.id) ?? null
}

export const pickerIntent = (DOM) => ({
  PICK_MODEL: DOM.change('.model-pick').value(),
  KEYS_CHANGED: DOM.select('document').events('showcase:keys'),
})

export const pickerModel = {
  PICK_MODEL: (state, model) => (model ? { ...state, model } : ABORT),
  KEYS_CHANGED: (state) => ({ ...state, keysVersion: state.keysVersion + 1 }),
}

/** the picker's markup: grouped by provider and wire format */
export function modelPicker(state, opts, { label = 'Model', disabled = false } = {}) {
  const choices = choicesOf(state, opts)
  const picked = pickedModel(state, opts)
  const groups = [...new Set(choices.map((c) => c.group))]
  return (
    <label className="model-picker">
      <span>{label}</span>
      <select className="model-pick" disabled={disabled || choices.length === 0}>
        {choices.length === 0 && <option value="">{state.providers?.status === 'loading' ? 'Loading…' : 'No model'}</option>}
        {groups.map((g) => (
          <optgroup label={g}>
            {choices.filter((c) => c.group === g).map((c) => <option value={c.id} selected={c.id === picked}>{c.label}</option>)}
          </optgroup>
        ))}
      </select>
      {choices.length === 0 && state.providers?.status === 'success' && <small className="picker-note">{offline(state.providers.data)}</small>}
    </label>
  )
}
