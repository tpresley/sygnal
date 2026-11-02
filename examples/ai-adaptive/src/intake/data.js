export const PEOPLE = [
  { id: 'mara', name: 'Mara Ortiz', role: 'Engineering manager' },
  { id: 'dev', name: 'Dev Patel', role: 'Finance lead' },
  { id: 'kim', name: 'Kim Lau', role: 'IT lead' },
]

export const TASKS = [
  'I left my work laptop on the train this morning',
  'Book time off for my sister’s wedding in March',
  'Expense the client dinner with Globex last night',
  'Report a broken badge reader on the 4th floor',
  'Request a second monitor for my desk',
]

// the start values: every name a field piece can write. The form behavior only takes names that
// are already in its values (an unknown name is skipped, SYG230), so even the model-written
// questions need theirs here: `extra` by node key, which is predictable ('question', then
// 'question~2', 'question~3' for the catalog's maxUses: 3).
export const EMPTY = {
  email: '',
  phone: '',
  start: '',
  end: '',
  amount: '',
  currency: 'USD',
  device: '',
  assetTag: '',
  place: '',
  details: '',
  urgency: '',
  approver: '',
  consent: false,
  attachments: null,
  extra: { question: '', 'question~2': '', 'question~3': '' },
}
