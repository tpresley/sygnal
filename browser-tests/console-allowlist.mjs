/**
 * The browser runner's per-test console allowlist (G-503, G-528). `entries` are
 * { test, match: [regex...] }: a console error is expected only while the test named `test` runs
 * and when it matches every regex. The harness reports each test's start (`start(name)`) and end
 * (`start(null)`, G-528): an error between tests, or after the last, matches no entry.
 */
export function consoleAllowlist(entries) {
  let current = null;
  return {
    start(name) { current = name ?? null; },
    get current() { return current; },
    /** the entry that expects this console error text, or undefined */
    expected(text) {
      return current == null ? undefined : entries.find(e => e.test === current && e.match.every(re => re.test(text)));
    },
  };
}
