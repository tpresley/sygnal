| first attempt | reported as | repair turns | outcome | detected after (ms) | request (chars) | what the model reads (first 90 chars) |
|---|---|---:|---|---:|---:|---|
| syntax: an unclosed element | compile | 1 | fixed | 176 | 3029 | `compile: Transform failed with 1 error: <stdin>:10:31: ERROR: Expected "}" but found ":"` |
| reaches for document in the view | runtime | 1 | fixed | 182 | 3049 | `runtime: view threw (SYG406): ReferenceError: 'document' is not defined` |
| imports a library | error | 1 | fixed | 196 | 3062 | `error: sandbox: 'date-fns' can't be imported here` |
| React habits: useState | runtime | 1 | fixed | 180 | 3062 | `runtime: view threw (SYG406): ReferenceError: 'useState' is not defined` |
| React habits: onClick in JSX (silent at run time; caught by the pre-mount check) | compile | 1 | fixed | 63 | 3379 | `compile: line 7: JSX event handlers (onClick) don't run in a Sygnal view; read the event i` |
| wiring: an intent action without a model entry (silent; sygnal-check SYG101/SYG102) | compile | 1 | fixed | 67 | 3468 | `compile: line 13: SYG101 intent action 'PICK' has no model entry, so it does nothing line ` |
| an event payload of the wrong shape (customerId for id) | rejected | 1 | fixed | 208 | 3486 | `the app dropped an event OPEN_CUSTOMER: invalid (id: Invalid input: expected number, recei` |
| an undeclared event type | rejected | 1 | fixed | 203 | 3469 | `the app dropped an event SELECT_CUSTOMER: undeclared (it takes only OPEN_CUSTOMER, FILTER_` |
| an endless loop in the view (i-- for i++) | timeout | 1 | fixed | 612 | 3057 | `timeout: the component ran into the 500 ms boot deadline (an endless loop?)` |
| a lookup table far over the memory cap (ArrayBuffer) | runtime | 1 | fixed | 194 | 3058 | `runtime: view threw (SYG406): InternalError: out of memory` |
| recursion without a base case | runtime | 1 | fixed | 191 | 3077 | `runtime: view threw (SYG406): InternalError: stack overflow` |
| renders nothing (waits for a flag nothing sets) | empty | 1 | fixed | 429 | 3018 | `empty: the component rendered nothing` |
| over the size limit | compile | 1 | fixed | 51 | 3986 | `compile: the code is over the limit of 1500 characters; write a shorter part` |
| two mistakes: the fix of the first reveals the second (2 turns) | error | 2 | fixed | 176 | 3044 | `error: sandbox: 'lodash' can't be imported here` |
| a model that does not fix it: gives up after maxAttempts (2), the part shows a fallback | runtime | 2 | gave up (fallback shown) | 203 | 3048 | `runtime: view threw (SYG406): ReferenceError: 'window' is not defined` |
