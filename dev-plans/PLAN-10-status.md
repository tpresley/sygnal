# PLAN-10 Status Tracker

Tracks progress for [PLAN-10.md](PLAN-10.md) (an interactive view of the app graph).

**Numbering:** a reserved block, decisions **D500–D549**, gaps **G-800–G-849**.

**Integration branch:** `plan10-integration`, cut on 2026-10-16 from the spike branch `claude/sygnal-check-html-viz-spike-a7f154` (main `55c0e9b3` + the spike and this plan), in the worktree `.claude/worktrees/sygnal-ai-helpers-c2d7fd`.

**State:** Phase 0 in progress. The spike is done ([`research/graph-viz/`](research/graph-viz/README.md)). Questions answered (D508–D514). Phase 0 started 2026-10-16. Reservations confirmed: SYG170–179 free in `codes.ts` and `explanations.js` (2026-10-16).

## Decisions

| # | Date | Decision |
|---|---|---|
| D500 | 2026-10-16 | `sygnal-check --graph=html`: a self-contained page in the temp dir, opened in the default browser; `--out` / `--open`; never opens under `CI` or without a TTY (user) |
| D501 | 2026-10-16 | Fix the graph data gaps (A-1…A-6) before the viewer ships (user) |
| D502 | 2026-10-16 | Live mode `--graph=html --watch` (user) |
| D503 | 2026-10-16 | One renderer for the CLI page, a VS Code panel and the devtools panel (user) |
| D504 | 2026-10-16 | `--graph=mermaid` (user) |
| D505 | 2026-10-16 | `--base <ref>` diff mode, in a later phase (user) |
| D506 | 2026-10-16 | No CDN, no bundled graph library; an optional dependency only on S-1's numbers (user) |
| D507 | 2026-10-16 | Research large-app strategies (S-1) before building them; the user decides on the results (user) |
| D508 | 2026-10-16 | P10-Q1: `--graph=html` / `--graph=mermaid` only, no `--viz` (user) |
| D509 | 2026-10-16 | P10-Q2: the OS temp dir, path printed; `--out` to keep a file (user) |
| D510 | 2026-10-16 | P10-Q3: no new `llms.txt` line; the skill mentions the page (user) |
| D511 | 2026-10-16 | P10-Q4: new fields additive at `version: 1`, all optional (user) |
| D512 | 2026-10-16 | P10-Q5: graph-wide checks become rules (SYG170–179) only when measured clean on the examples and docs samples (user) |
| D513 | 2026-10-16 | P10-Q6: sygnal-check 0.10.0 after Phase 1; live mode, VS Code panel and devtools tab in later minors; sygnal only if `inspect()` or devtools change (user) |
| D514 | 2026-10-16 | P10-Q7: no large real app supplied: S-1 uses the synthetic corpus and all examples together (user) |

## Items

| Item | Phase | Status | Notes |
|---|---|---|---|
| S-1 Large apps research | 0 | 🔄 `p10-s1-large-apps` | output `research/graph-viz/large-apps.md` |
| S-2 Runtime graphs in the renderer | 0 | 🔄 `p10-s2-s3-design` | |
| S-3 Live transport design | 0 | 🔄 `p10-s2-s3-design` | includes the `sygnal/vite` dev route question |
| A-1 View-only components | 1 | 🔄 `p10-graph-data` | |
| A-2 Package components | 1 | 🔄 `p10-graph-data` | node vs child-entry field: a D-number in Phase 0 |
| A-3 Ids on links | 1 | 🔄 `p10-graph-data` | |
| A-4 Source locations | 1 | 🔄 `p10-graph-data` | |
| A-5 `PARENT` receivers | 1 | 🔄 `p10-graph-data` | |
| A-6 Entries | 1 | 🔄 `p10-graph-data` | |
| A-7 State writes and reads | 2 | ⏳ | |
| A-8 Schema, text, MCP, runtime parity | 1 | 🔄 `p10-graph-data` | static parts; runtime parity after S-2 |
| V-1 Renderer module | 1 | 🔄 `p10-viewer-cli` | from the spike's `template.html` |
| V-2 Use the new data | 1 | ⏳ | |
| V-3 Runtime graphs | 2 | ⏳ | |
| V-4 Large-app strategies | 1–2 | ⏳ | after S-1's decision |
| V-5 Accessibility and polish | 1 | 🔄 `p10-viewer-cli` | |
| V-6 Diff rendering | 3 | ⏳ | |
| C-1 `--graph=html` | 1 | 🔄 `p10-viewer-cli` | |
| C-2 `--graph=mermaid` | 1 | 🔄 `p10-viewer-cli` | |
| C-3 `--base <ref>` | 3 | ⏳ | |
| W-1 `--watch` | 2 | ⏳ | |
| W-2 `sygnal/vite` dev route | 3 | ⏳ | if S-3 recommends it |
| E-1 LSP `sygnal/graph` | 2 | ⏳ | |
| E-2 VS Code panel | 2 | ⏳ | |
| P-1 Devtools app graph tab | 2 | ⏳ | |
| P-2 Static + runtime together | 3 | ⏳ | if W-2 ships |
| X-1 Graph-wide rules (SYG170–179) | 2 | ⏳ | if P10-Q5 says yes |
| T-1 Unit tests | 1 | 🔄 `p10-viewer-cli` | |
| T-2 Browser smoke | 1 | 🔄 `p10-viewer-cli` | |
| T-3 Graph data fixtures | 1 | 🔄 `p10-graph-data` | |
| T-4 Size and speed | 2 | ⏳ | warn-only |
| D-1 Docs page | 1 | ⏳ | |
| D-2 Docs and agent context updates | 2 | ⏳ | |

## Questions

| # | Status | Answer |
|---|---|---|
| P10-Q1 Flag names | answered | accepted (D508) |
| P10-Q2 Default output path | answered | accepted (D509) |
| P10-Q3 `llms.txt` budget | answered | accepted (D510) |
| P10-Q4 Schema version | answered | accepted (D511) |
| P10-Q5 Graph-wide rules | answered | accepted (D512) |
| P10-Q6 Release grouping | answered | accepted (D513) |
| P10-Q7 A large real app for S-1 | answered | accepted (D514) |

## Gaps

None yet.
