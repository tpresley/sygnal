# SP-F3: per-page Switchable state

**Question.** Switchable binds one `state` for all its pages, so per-page slices need a lens host
per page (Temper #35). Should `state` take a per-page map (`state={{ projects: 'pages.projects' }}`,
each entry a key / path / lens / byId with its own cell and binding lifetime), and what does it
cost? Decide after F-1 (SP-F1): if pages read `route` from context, `share` of read-only keys is
not needed.

**Built** (branch `exp/p13-f3`, cut from the integration branch, without F-1):
- `src/core/hosts/switchable.ts`: `state` that is a plain object (not a lens, not a byId
  selection) is a map; each listed page gets its own cell (`keyCell` / `lensCell`, the code a tag
  child uses), unlisted pages share the owner's state. In `setProps`, a page whose own entry
  changed by 7.0's rule (`bindingChanged`, exported from `instance.ts`: a different key, a byId
  target; an opaque lens keeps its instance) is disposed and made again, the others keep theirs.
  The owner's reconcile sees two maps as the same binding, so it doesn't remount the whole host.
- `test/sp-f3-switchable-map.test.js`: pages a and b read and write `pages.a` / `pages.b`;
  rebinding a to `pages.a2` makes a again (a new BOOTSTRAP) and keeps b.

**Numbers.** kanban gzip (a): 42,844 B → **42,938 B (+94 B)**, 62 B headroom left (kanban imports
Switchable, whose host registers on import). With F-1's +19 B: 113 B of the 156 B headroom.
Full library suite: no regressions after a fix (5,156 passed).

**Not covered by the spike** (more bytes and work if built):
- the dying-target rule per page (a bound child whose slice is deleted is disposed at once,
  `Inst.notify` / `bound`): the owner tracks one binding per host, not one per page;
- types (`state?: string | Lens | { [page]?: string | Lens }`), dev checks (SYG409 / SYG410 per
  entry, a map key that isn't a page), sygnal-check (the same, and the graph's state edges per page).

**The alternative that works today, at 0 B.** A one-line wrapper page binds its page to a slice;
the wrapper takes the Switchable's state and its child gets the 7.0 binding rules as any tag child:

```jsx
const ProjectsPage = ({ state }) => <Projects state="pages.projects" />
const SettingsPage = () => <Settings state="pages.settings" />
<Switchable of={{ projects: ProjectsPage, settings: SettingsPage }} current={state.page} />
```

The second test in the spike runs the same scenario this way, with the same results (per-page
slices, only the rebound page made again). One difference: a wrapper page's view runs only when it
is first shown, so its inner page (and that page's intent and statics) starts then, not at mount;
for background work on a page never shown yet, put it on the page itself (`isolatedState`) or above
the Switchable.

**Recommendation: don't build F-3; document the wrapper pattern.** With F-1, pages read `route`
from context, which removes the main reason for `share`; per-page slices cost one line per page
today. The map costs 94 B of core (most of the size headroom, before its presence handling,
checks and types), for a saving of a few lines. Revisit if the size budget is raised for other
reasons. Docs: a "Per-page state" section in the Switchable guide, and a line in llms.txt / the
skill.
