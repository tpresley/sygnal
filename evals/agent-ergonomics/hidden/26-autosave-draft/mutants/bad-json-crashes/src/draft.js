const KEY = 'note-draft'

/** The draft kept in localStorage, or empty fields when there is none (or it isn't valid JSON). */
export function loadDraft() {
  // MUTANT: no guard against a draft that isn't valid JSON
  const draft = JSON.parse(localStorage.getItem(KEY))
  return draft ? { title: draft.title, body: draft.body } : { title: '', body: '' }
}

export function storeDraft({ title, body }) {
  localStorage.setItem(KEY, JSON.stringify({ title, body }))
}
