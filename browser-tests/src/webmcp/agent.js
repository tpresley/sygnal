// PLAN-6 2-W (G-600): the test acting as the browser's agent, through the page's own testing
// surface (getTools / executeTool), with the differences between native Chrome 153 and
// @mcp-b/webmcp-polyfill normalized (spike 0-S3 §3):
// - native: RegisteredTool.inputSchema is a JSON string; executeTool takes the input as a JSON
//   string (an object rejects "Failed to parse input arguments"); consequentialHint is dropped;
// - polyfill: inputSchema is an object; executeTool takes an object; consequentialHint is kept.
// Both resolve executeTool with a string (the JSON of an object result). No CDP path (D271).
export const isNative = (mc) => /\[native code\]/.test(Function.prototype.toString.call(mc.executeTool))

export function agentClient(mc) {
  const native = isNative(mc)
  const parse = (s) => { try { return typeof s === 'string' ? JSON.parse(s) : s } catch { return s } }
  const raw = () => mc.getTools()
  const list = async () => (await raw()).map((t) => ({
    name: t.name, description: t.description,
    inputSchema: parse(t.inputSchema),
    // the hints both implementations keep (consequentialHint: the polyfill only)
    annotations: t.annotations ? { readOnlyHint: !!t.annotations.readOnlyHint, untrustedContentHint: !!t.annotations.untrustedContentHint } : null,
  }))
  const names = async (re = /./) => (await raw()).map((t) => t.name).filter((n) => re.test(n)).sort()
  const call = async (name, args = {}, opts) => {
    const t = (await raw()).find((x) => x.name === name)
    if (!t) throw new Error(`no tool ${name}; tools: ${(await raw()).map((x) => x.name).join(', ')}`)
    return parse(await mc.executeTool(t, native ? JSON.stringify(args) : args, opts))
  }
  /** polls getTools() until `pred(tools)` holds (toolchange on removal is asynchronous natively) */
  const until = async (pred, ms = 2000) => {
    const end = Date.now() + ms
    for (;;) {
      const ts = await list()
      if (pred(ts)) return ts
      if (Date.now() > end) throw new Error(`timed out; tools: ${ts.map((t) => t.name).join(', ')}`)
      await new Promise((r) => setTimeout(r, 10))
    }
  }
  return { native, list, names, call, until }
}
