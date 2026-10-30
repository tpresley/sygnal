| first attempt | reported as | repair turns | outcome | detected after (ms) | request (chars) | what the model reads (first 90 chars) |
|---|---|---:|---|---:|---:|---|
| syntax: an unclosed element | compile | 1 | fixed | 157 | 3029 | `compile: Transform failed with 1 error: <stdin>:10:31: ERROR: Expected "}" but found ":"` |
| reaches for document in the view | runtime | 1 | fixed | 175 | 3049 | `runtime: view threw (SYG406): ReferenceError: 'document' is not defined` |
| imports a library | error | 1 | fixed | 171 | 3062 | `error: sandbox: 'date-fns' can't be imported here` |
| React habits: useState | runtime | 1 | fixed | 168 | 3062 | `runtime: view threw (SYG406): ReferenceError: 'useState' is not defined` |
| React habits: onClick in JSX (silent at run time; caught by the pre-mount check) | compile | 1 | fixed | 59 | 3379 | `compile: line 7: JSX event handlers (onClick) don't run in a Sygnal view; read the event i` |
| wiring: an intent action without a model entry (silent; sygnal-check SYG101/SYG102) | compile | 1 | fixed | 64 | 3468 | `compile: line 13: SYG101 intent action 'PICK' has no model entry, so it does nothing line ` |
| an event payload of the wrong shape (customerId for id) | rejected | 1 | fixed | 181 | 3486 | `the app dropped an event OPEN_CUSTOMER: invalid (id: Invalid input: expected number, recei` |
| an undeclared event type | rejected | 1 | fixed | 179 | 3469 | `the app dropped an event SELECT_CUSTOMER: undeclared (it takes only OPEN_CUSTOMER, FILTER_` |
| an endless loop in the view (i-- for i++) | timeout | 1 | fixed | 607 | 3057 | `timeout: the component ran into the 500 ms boot deadline (an endless loop?)` |
| a lookup table far over the memory cap (ArrayBuffer) | runtime | 1 | fixed | 163 | 3058 | `runtime: view threw (SYG406): InternalError: out of memory` |
| recursion without a base case | runtime | 1 | fixed | 188 | 3077 | `runtime: view threw (SYG406): InternalError: stack overflow` |
| renders nothing (waits for a flag nothing sets) | empty | 1 | fixed | 426 | 3018 | `empty: the component rendered nothing` |
| over the size limit | compile | 1 | fixed | 49 | 3986 | `compile: the code is over the limit of 1500 characters; write a shorter part` |
| two mistakes: the fix of the first reveals the second (2 turns) | error | 2 | fixed | 170 | 3044 | `error: sandbox: 'lodash' can't be imported here` |
| a model that does not fix it: gives up after maxAttempts (2), the part shows a fallback | runtime | 2 | gave up (fallback shown) | 182 | 3048 | `runtime: view threw (SYG406): ReferenceError: 'window' is not defined` |
