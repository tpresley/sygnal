const KEY = 'note-draft'

/** The draft kept in localStorage, or empty fields when there is none (or it isn't valid JSON). */
export function loadDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(KEY))
    if (draft && typeof draft === 'object') {
      return {
        title: typeof draft.title === 'string' ? draft.title : '',
        body: typeof draft.body === 'string' ? draft.body : '',
      }
    }
  } catch {
    // not valid JSON: start empty
  }
  return { title: '', body: '' }
}

export function storeDraft({ title, body }) {
  localStorage.setItem(KEY, JSON.stringify({ title, body }))
}
