# What Sygnal is for, in words a newcomer accepts

Spike, 2026-11-09, on `claude/spike-thesis-demo-09b7aa`, on top of 7.4.1. No paid model runs, nothing published.

**The demonstration:** open [`review-this-change/index.html`](review-this-change/index.html) in a browser. It is one self-contained file. No install, no network.

## The recommendation

**One sentence:**

> A front-end framework where what a change does to your app (the requests it sends, the state it writes, the checks it drops) is computed from the code, not described by whoever wrote it.

**One paragraph:**

> Agents now write more front-end code than anyone can read carefully, and the description on the pull request comes from the same place as the bug. In Sygnal, every action, every request and every state write is declared in a shape a tool can read without running the app, so a pull request can arrive with a list, computed from the code, of what it newly sends, newly writes and no longer checks. That list does not tell you the logic is right. A logic slip in a helper gets past it, and agents know React better, so Sygnal costs more to write. What you get for that is that "did this change send something new, reach into another feature, or drop a check?" stops being something you hope you noticed. Try it on five pull requests, in three minutes, before you read any of our API.

**Do not use that paragraph yet.** It is true of a prototype. Two things have to ship first (section 6, gaps 1 and 2): the behaviour report, and a rule that flags side effects outside declared outputs. Until the second exists, "every request is declared" is a convention, and I broke it in one line (section 4).

Short form for a headline, once those ship: **"Don't take the pull request's word for it."**

## 1. What the current pitch claims

Read: `README.md`, the docs landing (`docs/.../index.mdx`, `HomeFeatures.astro`), `ai/why-sygnal.md`, the kanban, filter-wizard and ai-showcase examples.

There are two pitches, and they disagree. The README has the better one: "every change in your app has a name, a cause, and one place to read it". The docs landing is about AI: "What if a front end framework was built for the AI age?", and five of its six feature panels are about putting AI features into your app. A visitor deciding on a stack sees a list of capabilities and no reason to change framework.

| Claim | Where | Evidence |
|---|---|---|
| "helps coding agents build with confidence" | docs landing | **Not supported as worded.** Sygnal costs agents more: 1.3–3× cost across eval runs and +32–35k tokens of context. Parity on pass rate is the most the data gives. |
| "What if your coding agent had a framework it could reason about?" | docs landing | Unmeasured. The read-side eval is designed to test it and has not run. |
| "how much application code the feature needs", "less coordination code" | `why-sygnal.md` | **True only where a built-in replaces hand-written code** (resources, forms, timers, persistence: about 0.5×). In general, diffs are not smaller, and files touched are 1.1–1.3× *more*. The page should say which features. |
| "There's no fetch in the component, no flag to guard against stale responses, and no cleanup function" | README | True of that example. It sits in a section that implies less code in general. |
| "your app stays readable, by you, by your tools and by your coding agents, however big it gets" | README | "By your tools" holds: the graph covers large apps. The rest is unmeasured. |
| "It's a small, slightly unusual way… with a payoff that keeps growing" | README | Unmeasured. |
| "automatic state management" | docs landing | Vague. Means nothing to a sceptic. |
| "`--graph` … every action, what triggers it and which state it writes" | README | Supported, and the strongest thing on the page. It gives actions and sinks. It does not give URLs (gap 5). |
| "You can catch that in code review without opening the app" | README | Supported for wiring orphans. In this spike `--graph --base` says "no changes" on a state leak and a logic slip, so it should not be read as general. |
| "Your agent has to learn it… about 20% more tokens and 1.3–1.5× the time" | README | Honest and well placed. It is one app. The evals are worse (1.3–3×), and a reader should see that range. |

## 2. Candidate framings

Tested against the demo in section 4. A framing survives if a sceptical senior React developer cannot dismiss it in one sentence.

### A. "Every thing an app can do has a name, so behaviour can be listed."

In a Sygnal app, each thing that can happen is an entry in a table: the action, what triggers it, what it writes and what it sends. Point a tool at an app nobody has explained and you get that table without running it. It took 250 ms on the 9-component filter wizard, 420 ms on the 31-component AI showcase (353 actions, 20 requests).

**You can:** ask "what can this app do?" of code you have never read and get an answer with no setup.

**Objection:** "Redux has named actions. And on a small app, I can read it, or write a Babel script. Besides, who needs a list?" **Survives in part.** Redux names state transitions but not triggers or effects, and a thunk hides what it fetches. An AST script works until the next custom hook; Sygnal's list comes from a shape every component must have. But "who needs a list?" lands: a list is a feature, not a reason to change framework. It needs a job to do. This is the mechanism, not the pitch.

### B. "Review the behaviour, not the code."

The tool shows what changed in behaviour, so you read less code. A reviewer can look at the inventory instead of the diff. The diff becomes the appendix.

**You can:** nothing you can actually do. You cannot skip the code.

**Objection:** "The behaviour *is* the code. What's in the reducer?" **Does not survive. This is a slogan.** PR 5 in the demo is a one-token logic slip, and the report says only "helper changed". The report spike's own table of false-calm cases says the same. Saying this would teach reviewers the exact habit that lets PR 5 through.

### C. "The app is its own audit trail."

Every input is a named action, so a session is a log. Time and randomness are injected, so the log replays. You can see what happened and why.

**You can:** replay a recorded session and see the first action whose result changed.

**Objection:** "Audit means a retained, tamper-evident record in production. This is a dev tool. And for sessions I have Sentry Replay and OpenTelemetry." **Does not survive.** The word promises compliance that does not exist. `sygnal/replay` is experimental and has no production story. The underlying property is real and is framing F below.

### D. "A framework where 'what does this change do?' has a checkable answer."

The agent's description is a claim. Sygnal can compute, from the code, every request a change adds, every state key an action newly writes, every guard it removes and who reads what it touched. You compare the claim with the list.

**You can:** have a pull request that says "UI only" and see, on the first line of a report, `App.SELECT now sends to HTTP: POST https://metrics…`, tied to the click that fires it.

**Objection:** "Checkable *what*? It checks that a request exists, not that the feature is correct. A Semgrep rule finds new `fetch` calls, and an LLM reviewer gives me a summary for free." **Survives once narrowed, and this is the recommendation.** It must say *what* is checkable: effects, writes, guards. On Semgrep: it finds calls you wrote a rule for, and has no concept of "guard" or "which action writes this state". On LLM reviewers: they read logic better than this tool ever will (PR 5), but their summary is another claim, and unfaithful PR descriptions are the documented problem. The two are complements, and the pitch should say so. It holds only if the list is complete, which is gap 2.

### E. "Side effects are a manifest."

Mobile apps declare their permissions, and you see the list before you install. A Sygnal component declares its outputs the same way: if it isn't in the sink list, it doesn't happen.

**You can:** fail CI on a new network host, or review the list of hosts an app talks to.

**Objection:** "Nothing enforces it. I can call `fetch` wherever I want." **Fails today, and the sceptic is right.** A `sendBeacon` in the view gets a report that says "Nothing here needs special attention" (section 4). After gap 2 is fixed it becomes the most immediately graspable analogy. I would use it as the explanation under D, and only after the rule ships.

### F. "A bug report that is a test."

Everything nondeterministic comes in through a named door, so a recorded session is a deterministic test. A user's bug becomes a failing test without anyone writing one.

**You can:** turn a session into a test that names the first action that diverged.

**Objection:** "Playwright codegen, Replay.io." **Survives, narrowly.** It is a real difference in cost and determinism. It addresses debugging, a pain people already have tools for, and is experimental. A strong second demo, not the thesis.

### Rejected outright

- **"Less code."** The data does not support it (section 1).
- **"Built for the AI age" / "the framework for agents."** Says nothing checkable, and the honest write-side numbers contradict the obvious reading.
- **"Agents write better code in Sygnal."** Unmeasured, and on cost the evidence points the other way.

## 3. Who feels this most, and what they would need to see

**The person approving agent-written pull requests**: a tech lead or senior front-end engineer who merges more code than they can read. Review is the measured bottleneck, trust in AI output is low and the top complaint is code that is "almost right". They are also the person who has to overrule the agent's default of React/Next/Tailwind, which makes them the only audience that matters for adoption.

What they would need to see, in order:

1. **A defect of a kind that has burned them**, caught on a change that looks fine. Not a counter.
2. **What it missed.** Someone who has been sold tools before believes a list of limits sooner than a list of wins. The demo includes a defect the tool cannot see, and four attempts to fool it.
3. **The false-alarm rate.** The report spike has the first number: median 0 attention items on incremental commits, 31 of 55 with none. But PR 3 here shows real noise on refactors.
4. **Comparison with what they actually run**: lint rules, TypeScript, an AI reviewer. Not a bare diff.
5. **What it costs**, stated before they ask.
6. **A way to try it that risks one screen.** `fromReact` and web components exist for that.

## 4. The demonstration: "Review this change"

A small support inbox (folders, search, per-ticket reply drafts, send, close) in Sygnal (114 lines) and in idiomatic React with hooks (147 lines). Five agent-style pull requests applied to both. The reader approves or rejects each one, with the React diff or (their choice) the Sygnal diff plus report, and then sees the defect, what each reviewer had and what shipped tooling says.

**Run it:** open `review-this-change/index.html`.
**Regenerate it** (needs `npm run build`, `sygnal-check` and root `node_modules`, and the local commit `caabfc3e`, from which the unmerged report prototype is unpacked to a temp directory):

```bash
node dev-plans/research/thesis/review-this-change/build.mjs
```

**One spec, both apps.** `checks/behaviour.test.js` is a single black-box spec: jsdom, real DOM events, a stubbed network, each app's real entry. It runs against both base apps (8 of 8 pass) and against each change, and fails on the same tests in each framework. Everything on the page is generated from the real apps and tools.

| PR | Defect | Spec fails | `--graph --base` (ships today) | `--report` (prototype) |
|---|---|---|---|---|
| 1 Open count | None (control) | none | `+calculated openCount, +reads openCount` | calm |
| 2 Priority badge | New request nobody asked for: customer email to a third-party host | selecting sends nothing | `+sink SELECT:HTTP` | **Names the action and URL** |
| 3 Extract actions, "no behaviour change" | Guard lost in a refactor | refuses to close with unsent reply | `-sink CLOSE:STATE` (a hint) | **Names the guard**, plus 2 false alarms |
| 4 Clear search on folder switch | State write leaks: all unsent drafts cleared | keeps unsent reply | **"no changes"** | **Names `drafts`, `notice`, `query`** and who reads them |
| 5 Spell out the send rule | De Morgan slip in a shared helper (byte-identical in both apps) | blank reply, closed ticket | **"no changes"** | "helper changed", low confidence: **no real help** |

Timing: the report took about 200 ms per change, both sides (slowest seen, 320 ms).

### Where this is not like-for-like

- **The React app is plain hooks with an `api.js`.** It is what an agent writes by default, but a real team has more: lint, TypeScript, CODEOWNERS, an AI reviewer, maybe Redux Toolkit. The page says so. No such setup was built or measured.
- **I wrote everything.** The apps, the changes and the defects are mine, chosen knowing what the report can see. PR 5 and the fooling table are the counterweight, and they are not a study.
- **A careful reader finds every defect here in the plain diff.** All are short. The claim is about attention at volume, which this page does not measure.
- **Line counts are not evidence.** The base apps are 114 and 147 lines, and that gap should not be quoted: on the real eval tasks, Sygnal diffs are not smaller in general. The change diffs are about equal (PR 2: 13+/2− vs 12+/2−; PR 3: 35+/29− vs 36+/36−). Files touched favour Sygnal here (PR 2: 1 vs 3) because requests are inline where React has an `api.js`. That is unrepresentative: across real tasks Sygnal touches 1.1–1.3× more.
- **Two different tools are on show.** Only `--graph --base` ships.
- PR 4 uses inline written keys. See the fourth row below for the variant where they are hidden.

### Trying to fool it

The same defects, written the ways that dodge a declared output (`changes/adversarial/`, real output on the page):

| Written as | `--report` | `--strict` lint |
|---|---|---|
| `fetch()` in an `EFFECT` | Flags "touches `fetch`" | 0 warnings |
| `fetch()` in an imported helper, called from a `STATE` reducer | Flags "touches `fetch`" | 0 warnings |
| `navigator.sendBeacon()` in the view | **"Nothing here needs special attention."** | 0 warnings |
| Writes behind `...VIEW_DEFAULTS` | "Writes unknown", does not name `drafts` | 0 warnings |

The third row is the most important result in this spike. The core claim rests on effects being declared, and today nothing makes that so.

### The others

**"What can this app do?" is built**, as the second section of the page: the full action table for the app in under 600 ms, next to what `grep` gives you on the React version. It works by running the prototype against an empty commit, so everything counts as added. That is a hack and it is gap 5.

**"A bug report that is a test", sketch (not run).** A recording is a snapshot of behaviour, and that decides which demo works. Replaying a recording of the buggy session passes against the buggy build, because nothing diverged, so a recording alone is not a failing test. The two-minute version therefore runs the other way, and uses PR 3. Record a good session on the base app: type a reply, click Close, see "Send or discard your reply first". Commit the `replayTest(recording)` test it generates. Apply PR 3. The test fails and names `CLOSE` as the first action whose state differs, with `notice` as the difference, and nobody wrote an assertion. Fix the guard and it passes. `bugReport(recording, r, { expected })` covers the user-reported direction. The honest limit: it only catches a path somebody recorded, and an intended change also diverges.

**README section for a human choosing a stack**, leading with the demonstration:

> ## Don't take the pull request's word for it
>
> *(A real report, cropped: `App.SELECT now sends to HTTP: POST https://metrics…`, under a PR titled "Show a priority badge on each ticket. No change to how tickets are handled.")*
>
> Every action, request and state write in a Sygnal app is declared in a shape that tools can read. So when an agent opens a pull request, you can see what it newly sends, newly writes and no longer checks, computed from the code. [Review five pull requests yourself](…): one is clean, three hide defects the report catches, and one hides a defect it doesn't.
>
> It doesn't tell you the logic is right. It costs more to write than React, because agents know React. Here is exactly how much, and here is what it can't see.

## 5. Honesty: what Sygnal does worse today

| What a newcomer will hit | How the pitch should handle it |
|---|---|
| **Costs agents more.** 1.3–3× on eval cost, +32–35k tokens of context. | Say so before they find it, with the range rather than the kindest number. The trade is explicit: more to write, less to take on trust. |
| **More files per change**, 1.1–1.3×. | State it next to the review claim, because it directly contradicts an easy reading. The reviewer opens more files; the report tells them which to open first. |
| **Unfamiliar.** No hooks, MVI, xstream in intents. | Do not lead with the API. A newcomer should see what the structure buys before they see what it costs. The current README opens with a Counter. |
| **A single maintainer.** | Say it. Then point at the mitigations that exist: MIT, keyless releases, 2,583 tests, and adopting one screen rather than the whole app. Bus factor is a real reason not to adopt, and pretending otherwise loses the reader. |
| **A large experimental surface.** Eight features in preview or experimental. | The pitch names one thing. Shrink the front page: AI features, canvas, three.js, sandbox and the worker are real, but they dilute the reason to care. Keep them one click down. |
| **Small ecosystem, models trained on React.** | Agents will reach for React by default. Say that a human has to choose, and that `llms.txt` and the checker exist because of it. |
| **The report sees structure, not meaning.** | Keep the report's own wording rule: never "safe". Show a miss in every demo. |

### What would make the claim provable

The claim to prove: *given the same agent-written changes, reviewers with the report catch more side-effect, write and guard defects than reviewers with a diff and today's normal tooling, without more false alarms.*

| Evidence | Source | State |
|---|---|---|
| Defect catch rate and false alarms, Sygnal vs React | Read-side eval, `claude/musing-tu-93ce47`, measurement (a) | Built, not run. Paid run is the maintainer's decision. |
| Does the inventory catch a false PR description? | The same eval, measurement (d) | Designed. **It should get a third arm with `--report`**, and one with an LLM reviewer on React, which is the real competitor. |
| False-alarm and noise rate on real PRs | Behaviour report, `claude/modest-almeida-601fe1` | 103 commits in this repo. Needs an application repo. |
| Logic slips, the class the report cannot see | State explorer, `claude/hopeful-boyd-2a2a7d` | Prototype finds planted bugs and needs properties written by the author. PR 5 is a good test of it. |
| Humans, not models | **This page** is close to an instrument: add a timer and a randomised starting arm. | Not started. 20 reviewers would be more persuasive than any eval. |

I would treat the claim as proven at a catch-rate gain of 20 points or more on those three defect classes, against React with lint and an LLM reviewer, with false alarms flat. That is my threshold, offered for discussion. If the gain only shows against a bare diff, the claim is not worth making.

## 6. Gaps that weakened the demonstration (product findings)

1. **`--report` does not ship.** `--graph --base` says "no changes" on the state leak and the logic slip, so the shipped tool cannot carry this demo.
2. **Nothing flags side effects outside declared outputs.** `sygnal-check --strict` reports 0 warnings for `fetch()` in a reducer and for `navigator.sendBeacon()` in a view, and the report says "Nothing here needs special attention" for the view case. SYG258 already does this for `Date.now()` in reducers. A rule for network and storage globals in views, reducers and calculated fields, followed through imports, turns the inventory from convention into guarantee. **This is the highest-value item here.**
3. **The report raises false alarms on helper-built requests.** PR 3 prints `ticketUrl(state, path) → ok ok` as a "new side effect", twice. A one-function indirection should be followed, as `reducerWrites` already follows helpers to depth 3.
4. **A spread of a module constant makes writes unknown.** The report says it cannot list them and does not name `drafts`, and the blast radius is lost. Constant objects could be resolved statically.
5. **There is no "what can this app do?" command.** `--graph` shows `SEND (intent → HTTP)` with no URL. The complete list only exists by running `--report` against an empty commit.
6. **"Refuse and say why" needs the guard written twice.** `CLOSE` has `if (draft) return ABORT` in `HTTP` and the inverse in `STATE`, because a `STATE` `ABORT` does not cancel other sinks. The inventory lists both conditions. An action-level guard would be one fact, easier to review and harder to half-remove.
7. **The checker can't run in the browser**, so the page is pre-rendered. The strongest version of this demo lets a reader edit the agent's diff and watch the report change. It needs a browser build of `sygnal-check` for the docs' live system.
8. **`README.md` opens with an API sample and the docs landing with AI features.** Neither leads with the thing this spike found to be distinctive.
