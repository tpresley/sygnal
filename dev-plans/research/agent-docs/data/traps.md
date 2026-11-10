| Code | Severity | Reported by | Verdict | llms.txt B | SKILL B | Why |
|---|---|---|---|---|---|---|
| SYG101 | warn | dev-entry, static | go | 149 | 165 | Names the action and the two fixes; the anatomy shows the pairing |
| SYG102 | info | dev-entry, static | go | 149 | 165 | info: the message suggests the fix |
| SYG104 | warn | dev-entry, runtime, static | keep | 249 | 807 | Message is complete, but it decides where events are handled; one sentence in the model. The bubbling detail can go |
| SYG105 | info | dev-entry, static | go | 93 | 93 | info only, so `expectNoDiagnostics` misses it: a typo in an event name runs silently |
| SYG106 | warn | dev-entry | go | 220 | 160 | Names the prop and the rename |
| SYG110 | warn | static | go | 113 | 370 | Static |
| SYG111 | warn | static | short | 147 | 147 | Example comment carries it; the React habit (`value` + `onChange`) makes it likely |
| SYG112 | error | dev-entry, static | go | 163 | 0 | Names the closest entry |
| SYG115 | warn | dev-entry | go | 155 | 56 | Fix names the real event |
| SYG116 | error | dev-entry, static | go | 114 | 114 | Fix shows the form |
| SYG117 | warn | dev-entry, static | go | 347 | 236 | Names the ancestor that handles it |
| SYG118 | warn | dev-entry, static | go | 381 | 0 | Behavior-only |
| SYG127 | error | static, dev-entry | go | 91 | 53 | Error, names the key |
| SYG130 | error | dev-entry | go | 25 | 0 | Names the closest route |
| SYG132 | warn | dev-entry | go | 172 | 0 | Fix is one word |
| SYG140 | warn | dev-entry, static | go | 103 | 0 | Names the fix |
| SYG143 | warn | dev-entry, static | go | 59 | 0 | Fix shows the class form |
| SYG202 | warn | dev-entry | go | 0 | 44 | Warn; "no change" is shown in every example |
| SYG214 | error | runtime | go | 121 | 0 | It reports the thrown error; nothing to learn before it |
| SYG221 | error | dev-entry | go | 0 | 0 | Error, and the message writes the exact replacement |
| SYG222 | warn | dev-entry | short | 206 | 325 | Positive form ("return a new object") stays; a React habit |
| SYG224 | error | dev-entry, static | go | 481 | 0 | Error, says why |
| SYG230 | warn | dev-entry | go | 176 | 0 | Names the field and the fix |
| SYG237 | warn | dev-entry | go | 63 | 0 | Writes the fix |
| SYG256 | warn | static | keep | 9 | 9 | Static and only where provable; "guards read previousState" is the rule the model needs |
| SYG257 | info | dev-entry | go | 201 | 201 | Audit mode, upgrade only: migration guide, not the core |
| SYG258 | warn | static | short | 130 | 349 | Keep the `{ now, uuid }` line (tests depend on it); `--fix` rewrites the rest |
| SYG301 | error | dev-entry | go | 393 | 351 | Thrown, and it names the xstream form of 40 operators: the RxJS table (700 B) is a copy of the message |
| SYG302 | info | static | short | 147 | 147 | info only; the example import is the fix |
| SYG401 | warn | runtime, dev-entry, static | go | 71 | 71 | Fix shows the form |
| SYG402 | error | runtime | go | 0 | 45 | Error |
| SYG405 | error | runtime, static | keep | 267 | 164 | Thrown, but it decides where state lives: the most common React-shaped mistake. One clause in the model |
| SYG421 | error | dev-entry | go | 353 | 115 | Writes the fix |
| SYG425 | warn | dev-entry | go | 57 | 0 | Writes the fix |
| SYG429 | warn | dev-entry, static | go | 283 | 325 | Names the page |
| SYG430 | warn | dev-entry | keep | 0 | 227 | Layout only: never fires in a mock-DOM test. It belongs in the topic file, not the core |
| SYG454 | warn | static | go | 74 | 74 | Sygnal 6 only: version note, migration guide |
| SYG501 | error | static | go | 0 | 111 | Static, strict, removed form; nothing in training data teaches it |
| SYG503 | warn | static | go | 0 | 142 | Strict; `EFFECT` is shown |
| SYG504 | error | static | go | 0 | 104 | Strict, removed form |
| SYG505 | warn | static | go | 0 | 135 | Strict; `event()` is shown |
| SYG506 | error | static | go | 0 | 112 | Strict, removed form |
| SYG507 | info | static | go | 0 | 127 | info, strict |
| SYG508 | warn | dev-entry, static | go | 163 | 241 | Strict; reply actions are the example |
| SYG509 | warn | static | go | 130 | 349 | Strict; `--fix` |
| SYG610 | error | runtime | go | 163 | 101 | Error, request not sent; fix shows `ok` / `error` |
| SYG611 | error | runtime | go | 121 | 63 | Error |
| SYG612 | error | dev-entry, static | go | 531 | 108 | Error, names the guide section |
| SYG620 | error | runtime | go | 25 | 0 | Error |
| SYG635 | warn | dev-entry | go | 664 | 0 | Writes the fix |
| SYG637 | warn | static | go | 0 | 132 | Static |
| SYG640 | warn | dev-entry, static | go | 19 | 0 | Says it found nothing in that view |
| SYG641 | error | dev-entry, static | go | 24 | 0 | Error |
| SYG643 | warn | dev-entry, static | go | 86 | 57 | Fires for connections too: the core's "without it nothing reports it" is stale |
| SYG670 | error | runtime | keep | 123 | 0 | Security, fires only in a browser against a hosted URL; stays in `llms/ai.md` |
| SYG691 | warn | static | go | 0 | 389 | Names the closest procedure |
