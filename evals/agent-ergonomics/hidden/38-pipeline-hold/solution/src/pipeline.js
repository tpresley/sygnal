// The hiring pipeline's stages, roles and starting data, shared by every component.

/** The stages in board order. A candidate moves applied → interview → offer → hired; rejected ends it. */
export const STAGES = ['applied', 'interview', 'offer', 'hired', 'rejected']

export const STAGE_LABELS = {
  applied: 'Applied',
  interview: 'Interview',
  offer: 'Offer',
  hired: 'Hired',
  rejected: 'Rejected',
}

/** Where Advance takes a candidate from each stage that is still in progress. */
export const NEXT_STAGE = {
  applied: 'interview',
  interview: 'offer',
  offer: 'hired',
}

export const ROLES = ['Engineer', 'Designer', 'Product manager']

/** A candidate is active while still in progress (applied, interview or offer). */
export const isActive = (stage) => stage in NEXT_STAGE

/** How many candidates are in each stage, plus `all`, `active` and `onHold`. */
export function countStages(candidates) {
  const counts = { all: candidates.length, active: 0, onHold: 0 }
  for (const stage of STAGES) counts[stage] = 0
  for (const candidate of candidates) {
    counts[candidate.stage] += 1
    if (isActive(candidate.stage)) counts.active += 1
    if (candidate.onHold) counts.onHold += 1
  }
  return counts
}

export const SEED_CANDIDATES = [
  { id: 1, name: 'Ana Ruiz', role: 'Designer', stage: 'applied', notes: [] },
  { id: 2, name: 'Ben Ode', role: 'Engineer', stage: 'applied', notes: [] },
  { id: 3, name: 'Cy Lam', role: 'Product manager', stage: 'interview', notes: ['Great product sense'] },
  { id: 4, name: 'Dee Park', role: 'Engineer', stage: 'interview', notes: [] },
  { id: 5, name: 'Eli Stone', role: 'Designer', stage: 'offer', notes: ['Strong portfolio', 'Can start in May'] },
  { id: 6, name: 'Fay Wu', role: 'Engineer', stage: 'offer', notes: [] },
  { id: 7, name: 'Gus Hale', role: 'Product manager', stage: 'hired', notes: [] },
  { id: 8, name: 'Hana Kim', role: 'Engineer', stage: 'rejected', notes: [] },
]

/** How the list can be ordered: as on the board (oldest first) or newest first. */
export const SORTS = [
  { id: 'board', label: 'Board order' },
  { id: 'newest', label: 'Newest first' },
]

/** How many candidates there are for each role, in ROLES order: [{ role, count }]. */
export function countRoles(candidates) {
  return ROLES.map((role) => ({ role, count: candidates.filter((c) => c.role === role).length }))
}

/** Whether a candidate's name contains the search text (ignoring case and surrounding spaces). */
export const matchesSearch = (search) => (candidate) =>
  candidate.name.toLowerCase().includes(search.trim().toLowerCase())

/** "No notes", "1 note", "3 notes". */
export const noteLabel = (count) => (count === 0 ? 'No notes' : count === 1 ? '1 note' : `${count} notes`)
