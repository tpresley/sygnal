/*
 * PLAN-4 GS-2: element commands, the built-in ELEMENT sink.
 *
 *   SUBMIT:    { STATE: validate, ELEMENT: (s) => (s.errors.email ? { focus: Email } : ABORT) },
 *   OPEN_HELP: { ELEMENT: { showModal: HelpDialog } },
 *
 * A command is `{ <method>: target, ...options }`: the FIRST key is the method, the other keys
 * are its options (D118); an array sends several, in order. The target (a control or a
 * selector) is resolved in the SENDING instance's own DOM source, so isolation applies (a
 * Collection item reaches only its own elements; a parent doesn't reach its children's).
 *
 * The method: D102 first, a control whose spec object declares `commands` runs
 * `commands[method](element, options)` (it overrides a native method of the same name; only the
 * control itself carries a spec, a template-string selector doesn't). Then the element's own
 * method: `close` gets `returnValue` as its argument (D118), `togglePopover` its `force` (a
 * boolean, or no argument: a browser that only takes a boolean treats an object as true), every
 * other method the options object (focus { preventScroll }, scrollIntoView { block, inline,
 * behavior }, blur, select, click, showModal, show, showPopover, hidePopover; also play, pause, showPicker,
 * requestSubmit, reset...). The core runs any method the element has (no list: it
 * would cost ~60 B); the dev entry reports the ones that change the DOM Sygnal renders (SYG641).
 *
 * Timing: a command runs once the render it may depend on is on the page. The instance's DOM
 * source emits after every DOM mutation of the app (a patch), so the command runs in a microtask
 * after the next patch at which its target exists. When no patch comes (the action changed
 * nothing that renders), it runs at the first 16 ms check instead; the checks repeat every 16 ms
 * while the target is missing, about 1 s, then it is given up (SYG640 in dev). A disposed
 * instance's pending commands are dropped. Without a DOM source nothing runs (SSR renders views
 * without instances); a null command is skipped (ABORT is the way to send nothing).
 *
 * Failures (no match: SYG640; neither a spec command nor an element method: SYG641) go to the
 * 'sygnal/diagnostics' dev entry through the core bridge (`elementCommand`), which words them;
 * the core carries no message text. In production a failed command does nothing.
 */
export function runElementCommands(c: any, cmds: any): void {
  const dom = c.sources[c.DOMSourceName];
  if (dom) for (const cmd of ([] as any[]).concat(cmds)) if (cmd) {
    const m = Object.keys(cmd)[0], {[m]: t, ...o} = cmd, s = dom.select('' + t).elements();
    let els: any, n = 0, k = 0, l: any;
    const run = (last?: any) => {
      const e = !c._disposed && els?.[0], f = t?.spec?.commands?.[m];
      if (!l || !e && !last) return;
      s.removeListener(l);
      clearInterval(i);
      l = 0;
      e && (f || e[m]) ? f ? f(e, o) : e[m](m == 'close' ? o.returnValue : m == 'togglePopover' ? o.force : o)
        : (globalThis as any).__SYGNAL_DIAGNOSTICS__?.elementCommand?.(c, cmd, e);
    }, i = setInterval(() => run(++k > 62), 16);
    // the first value (the DOM as it is now) is skipped; the next ones follow a patch
    s.addListener(l = {next: (x: any) => { els = x; n++ && queueMicrotask(run); }});
  }
}
