# Rollup build lifecycle fix

Follow-up to PLAN-12's combined-build limitation, investigated while the user tests the locally
linked Sygnal 7 package. All whole-project build experiments use a temporary checkout. The
linked checkout's `dist` is left untouched.

## Cause

Installed versions: Rollup 3.30.0, TypeScript 5.4.5, @rollup/plugin-typescript 11.1.6,
@rollup/plugin-terser 0.4.4, Node 24.14.0.

The TypeScript plugin uses `createWatchProgram` even for ordinary builds. Its non-watch
buildEnd calls `program.close()`, and the existing G-639 lazy wrapper drops the plugin at
closeBundle. However, TypeScript 5.4.5 does not cancel every pending program-update timer in
that close path. A later callback can recreate compiler file watchers, keeping closed programs
and their state alive. Dropping the plugin reference alone does not release that ownership.

A full private CLI reproduction wrote all 24 configurations, then failed to exit naturally.
After each later configuration it retained roughly 439 FSEventWrap resources and a timer.
Sampled JavaScript heap reached 3,886 MB (a separate traced run reached 3,773 MB). This
reproduces the hang and memory growth underlying the prior default-heap OOM reports; this
particular run was interrupted after writing its outputs rather than claimed to have OOM'd.
Filesystem-watch creation stacks point into TypeScript's watch host, not the Terser worker.

There was also a watch-mode lifecycle problem: Rollup closes each completed watch result.
The previous wrapper dropped its TypeScript instance on every such close without ending
that instance's watch program, rather than retaining it for incremental rebuilds.

## Fix

`rollup.config.mjs` now imports `scripts/rollup-typescript.mjs`:

- Keep the existing TypeScript plugin, compiler options, source maps, externals and outputs.
- Give ordinary builds a per-instance compiler facade whose watch host creates no filesystem
  watchers. A one-shot build has no reason to monitor subsequent file changes.
- Track compiler programs and their host timers. Cancel pending updates and guard late callbacks
  on close so a disposed program cannot reopen watchers.
- Drop the ordinary build's compiler after all output variants have been written.
- In watch mode, preserve the native TypeScript program across result.close() and release it
  explicitly at closeWatcher. Register known type-only program dependencies with Rollup too,
  since const-enum changes can alter emitted JavaScript after the import disappears.
- Delegate function and object-form hook handlers with their Rollup context.

No node_modules patches, compiler/plugin version upgrades, forced process exits, heap flags,
subprocess-per-config workaround, or runtime API changes are needed.

## Verification

- Exact **`npm run build`**, including clean, all 24 configurations, declarations and guide copy,
  succeeds and exits normally in a temporary checkout using the linked installed dependencies.
  A timed pass took about **40 seconds**; timing-tool RSS collection itself was unavailable in
  the sandbox, so the final command was rerun directly and returned exit code 0.
- All **90 Rollup runtime outputs**, including maps, are **byte-identical** to the baseline built
  in the same temporary path. All JavaScript/declaration/guide files also agree with the linked
  build; three maps differ from that other path because bundled dependencies resolve through
  its node_modules symlink. Same-path comparison avoids confusing relocation with code changes.
- Final sampled ordinary-build peak heap: **1,825 MB**, versus **3,886 MB** in the baseline.
  At the last config's close, heap was 732 MB and no compiler file watchers remained. These are
  sampled heap measurements, not maximum RSS measurements or universal memory guarantees.
- All **24 watch configurations** start and close successfully with the default heap, retaining
  native incremental programs (about 3.9 GB heap after the last config). Watch mode intentionally
  retains more state than an ordinary build. Shutdown exits naturally.
- **44/44 regression tests pass** across `rollup-build`, built CJS/native ESM apps, Vike packaging,
  and offline guides. The three new process-level cases verify multi-config/multi-output source
  maps with no ordinary-build watchers; real source and erased const-enum watch rebuilds after
  result.close(); cancellation of a pending update on watch shutdown; and clean compiler-error
  exit. Child processes must exit by themselves within a timeout; they do not call process.exit.
- Watch tests need native filesystem events. The restricted sandbox suppresses those events;
  the approved run outside it passes, consistent with existing repository watcher tests.
- `git diff --check` is clean. The user's global npm link still points to the same checkout;
  its built files were neither cleaned nor rewritten during this investigation.

Reproduce the focused regression with:

```sh
npx vitest run test/rollup-build.test.js test/dist-cjs-app.test.js test/vike-integration.test.js test/p5-4b-offline-guides.test.js
```
