import * as signup from './Signup.jsx'
import signupSrc from './Signup.jsx?raw'
import * as expenses from './Expenses.jsx'
import expensesSrc from './Expenses.jsx?raw'
import serverSrc from '../../shared/fakeServer.js?raw'

export const section = {
  id: 'forms',
  title: 'Forms',
  intro: 'The form behavior: one entry in uses keeps values, errors and touched fields in state, validates with any Standard Schema (zod here), matches fields by name (no intent per field) and handles the submit, the pending state and the server\'s errors.',
  demos: [
    {
      id: 'form-signup',
      title: 'Validation, field-array rows, submit to HTTP, server errors',
      description: 'Errors show on blur, then follow the typing. Rows are inline (form.ADD / form.REMOVE, named by id). A valid submit posts the schema\'s output through makeFetchDriver (against an in-page fake server) and stays pending until form.DONE or form.ERRORS. Try email x@taken.com (422 map), a city "Atlantis" (422 issue list, mapped to its row) or the name "crash" (500, form-level error).',
      refs: 'F-1 · D193 · D199 · D231 · D233',
      files: { 'Signup.jsx': signupSrc, 'fakeServer.js': serverSrc },
      start: signup.start,
    },
    {
      id: 'form-reset-on-show',
      title: 'Local submit, resetOnShow and values as a function',
      description: 'Switchable pages share the parent\'s state and stay alive while hidden. The New expense form has resetOnShow: true, so it starts over each time it is shown, from a values function that reads the default category from state. Its submit has no request, so it completes at once.',
      refs: 'F-1 · D236 · D238 · D239 (G-578)',
      files: { 'Expenses.jsx': expensesSrc },
      start: expenses.start,
    },
  ],
}
