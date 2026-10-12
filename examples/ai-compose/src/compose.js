// Composing a UI from prepared parts with a decision model (the json-render + Jev idea, on decide()).
//
// The app owns every part: its component, its data and its wording. The decision model never writes
// UI; it answers two batches of multiple-choice questions, each one decide() request:
//
//   1. select: one `choice` per part (omit / use) and one `noul` per layout gate ("side by side?")
//   2. layout: (when 2+ parts) a choice per pair of parts ("which one comes higher on the page?"),
//      and, when the row is on, where each part goes (`place_<id>`: the page or the row)
//
// Everything else is deterministic code here: the selection, the order (summed pairwise probabilities),
// dropping a row with fewer than two parts.
import { decide, choice, noul } from 'sygnal/ai'

// each part is its own question; the request alone is the state (a list of every part there made
// the model drop parts the request named, in a labelled run)
const SELECT_INSTRUCTIONS = 'Does user_request ask for this element, by name or by what it shows? Every element user_request names must be used, wherever on the page it wants it. Omit elements user_request does not ask for, even when related to the topic.'

const ROW_GATE = 'Does user_request explicitly ask for some elements to be placed side by side, next to each other, beside each other or in a row?'

/** select: `use_<id>` (omit / use) for every part, `row` (a noul) for the side-by-side gate */
export function selectQuestions(parts) {
  const questions = {}
  for (const p of parts) {
    questions[`use_${p.id}`] = choice(SELECT_INSTRUCTIONS, {
      omit: 'None of these elements is needed.',
      use: p.description,
    })
  }
  questions.row = noul(ROW_GATE)
  return questions
}

/** the select answers → { ids, row }: the chosen parts (catalog order) and whether a row is wanted */
export function readSelection(parts, answers) {
  const ids = parts.filter((p) => answers[`use_${p.id}`]?.choice === 'use').map((p) => p.id)
  return { ids, row: ids.length > 1 && (answers.row?.noul ?? 0) >= 0.5 }
}

/** layout: `above_<a>__<b>` for every pair of parts, `place_<id>` for every part when there is a row */
export function layoutQuestions(parts, { ids, row }) {
  const chosen = ids.map((id) => parts.find((p) => p.id === id))
  const questions = {}
  if (row) {
    for (const p of chosen) {
      questions[`place_${p.id}`] = choice(`Where does this element go: ${p.description}? Follow user_request: only the elements it wants side by side go in the row.`, {
        page: 'On the page itself, full width, stacked vertically',
        row: 'In the row, side by side with the other row elements',
      })
    }
  }
  chosen.forEach((a, i) => chosen.slice(i + 1).forEach((b) => {
    questions[`above_${a.id}__${b.id}`] = choice(
      'Which of these two elements comes higher on the page? Follow user_request: an element it wants at the top, first or above comes higher, one it wants below, under or after comes lower. When user_request does not say, the one it mentions first comes higher.',
      { [a.id]: a.description, [b.id]: b.description },
    )
  }))
  return questions
}

/**
 * The order from the `above_<a>__<b>` answers: each part scores the summed probability that it
 * comes above each other part (a Borda-style count, so one shaky answer can't flip the order);
 * ties keep catalog order.
 */
export function bestOrder(ids, answers) {
  const wins = Object.fromEntries(ids.map((id) => [id, 0]))
  ids.forEach((a, i) => ids.slice(i + 1).forEach((b) => {
    const p = answers[`above_${a}__${b}`]?.probabilities
    if (!p) return
    wins[a] += p[a] ?? 0
    wins[b] += p[b] ?? 0
  }))
  return [...ids].sort((a, b) => wins[b] - wins[a] || ids.indexOf(a) - ids.indexOf(b))
}

/**
 * The layout answers → blocks, top to bottom: `{ id }` (a part on the page) or `{ row: [ids] }`.
 * A row sits where its first part ranks; a row of one is just that part.
 */
export function readLayout({ ids, row }, answers) {
  const ordered = bestOrder(ids, answers)
  const inRow = row ? ordered.filter((id) => answers[`place_${id}`]?.choice === 'row') : []
  if (inRow.length < 2) return ordered.map((id) => ({ id }))
  const blocks = []
  for (const id of ordered) {
    if (!inRow.includes(id)) blocks.push({ id })
    else if (id === inRow[0]) blocks.push({ row: inRow })
  }
  return blocks
}

/** the preview after the select step: the chosen parts in catalog order, before the layout arrives */
export const previewLayout = ({ ids }) => ids.map((id) => ({ id }))

/** the select step as a decide() request; the parts' descriptions are all the model sees of them */
export function selectRequest({ url, model, prompt, parts }) {
  return decide({
    url,
    model,
    state: { user_request: prompt },
    questions: selectQuestions(parts),
    key: 'compose',   // one lane for both steps: a new composition aborts the old one's request
    latest: true,
    ok: 'SELECTED',
    error: 'COMPOSE_FAILED',
  })
}

/** the layout step as a decide() request */
export function layoutRequest({ url, model, prompt, parts, selection }) {
  return decide({
    url,
    model,
    state: {
      user_request: prompt,
      selected_elements: selection.ids.map((id) => ({ id, content: parts.find((p) => p.id === id).description })),
    },
    questions: layoutQuestions(parts, selection),
    key: 'compose',
    latest: true,
    ok: 'ARRANGED',
    error: 'COMPOSE_FAILED',
  })
}
