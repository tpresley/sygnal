/**
 * PLAN-4 GS-2: element command diagnostics (dev entry; the core carries no text).
 *
 * The core (src/extra/elementCommands.ts) calls `__SYGNAL_DIAGNOSTICS__.elementCommand(component,
 * command, element?)` when a command can't run:
 *   - no element (`element` falsy): SYG640 (warn): nothing in the sending instance's DOM scope
 *     matched the target within about 1 s;
 *   - an element, but neither the control's spec command nor a method of the element: SYG641
 *     (error). It names the control's declared commands. When the element is a widget's host
 *     (PLAN-5 W-1, `__sygnalWidget`): SYG142 (error), naming the widget's declared commands.
 * installElementCommandHooks() publishes it on the core bridge.
 *
 * When a command is sent (checkSentCommand, from the elementCommands check's onModel, which wraps
 * the instance's ELEMENT stream before the core subscribes it): SYG641 for a value that is not a
 * command object, and for a method that changes the DOM Sygnal renders (remove, append,
 * setAttribute...): the core runs any method the element has, and those break the next patch.
 *
 * renderComponent uses these functions too (mock DOM, and the real DOM without the dev entry), so
 * this module has no side effects and doesn't import ./shared (which registers codes when loaded).
 */
import type {DiagnosticCheck} from '../index'
import {DEV_CODE_SEVERITY} from '../codes'

/** The element commands Sygnal documents and types (the core runs any method of the element) */
export const NATIVE_COMMAND_NAMES = ['focus', 'blur', 'select', 'click', 'scrollIntoView', 'showModal', 'show', 'close', 'showPopover', 'hidePopover', 'togglePopover']

const core = (): any => (globalThis as any).__SYGNAL_DIAGNOSTICS__

const send = (code: string, details: any): void => {
  try {
    core()?.report(code, {severity: DEV_CODE_SEVERITY[code], ...details})
  } catch (err) {
    // 'error' mode: rethrown asynchronously (never into the caller)
    setTimeout(() => { throw err })
  }
}

const isControl = (x: any): boolean => typeof x == 'function' && !!x.__sygnalControl
const keyOf = (control: any): string => String(control).slice(15, -2)

/** a command as written: `{ focus: Email, preventScroll: true }` */
export const describeCommand = (cmd: any): string => {
  if (!cmd || typeof cmd != 'object') return JSON.stringify(cmd) ?? String(cmd)
  const parts = Object.keys(cmd).map(k => {
    const v = cmd[k]
    let text: string
    if (isControl(v)) text = keyOf(v)
    else try { text = JSON.stringify(v) ?? String(v) } catch (_) { text = String(v) }
    return `${k}: ${text}`
  })
  return `{ ${parts.join(', ')} }`
}

const distance = (a: string, b: string): number => {
  const row = Array.from({length: b.length + 1}, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] == b[j - 1] ? 0 : 1))
      prev = cur
    }
  }
  return row[b.length]
}

const closest = (name: string, names: string[]): string | undefined => {
  let best: string | undefined, d = 3
  for (const n of names) {
    const x = n.toLowerCase() == name.toLowerCase() ? 0 : distance(name, n)
    if (x < d) { d = x; best = n }
  }
  return best
}

const tagOf = (el: any): string => el && typeof el.tagName == 'string' ? `<${el.tagName.toLowerCase()}>` : 'element'

const notACommand = (component: any, name: string, cmd: any) => send('SYG641', {
  component,
  message: `${name} sent ${describeCommand(cmd)} to the ELEMENT sink, which is not a command`,
  fix: `Send { <method>: control or selector, ...options }, e.g. { focus: Email }, or an array of them`,
  data: {command: cmd},
})

/** SYG640 (no `el`) or SYG641 (an element, but no command of that name) for `cmd` sent by `component` */
export function reportElementCommand(component: any, cmd: any, el?: any): void {
  // a disposed instance's pending commands are dropped silently
  if (component && component._disposed) return
  const name = (component && component.name) || 'component'
  const method = cmd && typeof cmd == 'object' ? Object.keys(cmd)[0] : undefined
  if (method === undefined) return notACommand(component, name, cmd)
  const target = cmd[method]
  const what = `ELEMENT ${describeCommand(cmd)}`
  const control = isControl(target) ? keyOf(target) : undefined
  const data: any = {method, command: cmd, ...(control ? {control} : {selector: target == null ? target : String(target)})}
  if (!el) {
    const missing = target == null || target === ''
    return send('SYG640', {
      component,
      message: missing
        ? `${what} in ${name} has no target (${String(target)}), so the command was dropped`
        : `${what} in ${name} matched no element: nothing in ${name}'s own view matches ${control ? `the control ${control}` : `'${String(target)}'`} (waited 1 s), so the command was dropped`,
      fix: missing
        ? `Give the method a control or a selector: { ${method}: Email }`
        : `Render the element in ${name}'s view, or send the command from the component that renders it: a child component's elements are isolated from its parent, and a command reaches only its sender's own elements (in a Collection, each item sends its own)`,
      data,
    })
  }
  // PLAN-5 W-1: the matched element is a widget's host (selector or control target): SYG142 names
  // the widget's declared commands
  const widget = el.__sygnalWidget?.w
  if (widget) {
    const declared = Object.keys(widget.commands)
    const hint = closest(method, [...declared, ...NATIVE_COMMAND_NAMES])
    return send('SYG142', {
      component,
      message: `${what} in ${name}: the matched ${tagOf(el)} is a widget's host, and the widget declares no '${method}' command` +
        (hint ? ` (did you mean '${hint}'?)` : '') + (declared.length ? `; it declares: ${declared.join(', ')}` : '; it declares none'),
      fix: `Add '${method}' to the widget's commands (defineWidget({ commands: { ${method}: (instance, options) => … } })), or send one it declares`,
      data: {...data, element: tagOf(el), commands: declared},
    })
  }
  const commands = control && target.spec && typeof target.spec == 'object' && target.spec.commands
    ? Object.keys(target.spec.commands) : []
  data.element = tagOf(el)
  if (commands.length) data.commands = commands
  let message: string, fix: string
  if (NATIVE_COMMAND_NAMES.includes(method)) {
    message = `${what} in ${name}: the matched ${tagOf(el)} has no ${method}() method${commands.length ? `, and the control ${control}'s spec declares no '${method}' command (it declares: ${commands.join(', ')})` : ''}`
    fix = /^(show|showModal|close)$/.test(method)
      ? `${method}() works on a <dialog> element: render the target as a <dialog>`
      : /Popover$/.test(method)
        ? `The popover methods need an element with the popover attribute (attrs: { popover: 'auto' }) in a browser with the Popover API`
        : `Target an element that has ${method}()`
  } else {
    const hint = closest(method, [...commands, ...NATIVE_COMMAND_NAMES])
    message = `${what} in ${name}: '${method}' is not an element command` + (hint ? ` (did you mean '${hint}'?)` : '') +
      (el.tagName ? `: the matched ${tagOf(el)} has no such method` : '') +
      (commands.length ? `, and the control ${control}'s spec declares only: ${commands.join(', ')}` : '')
    fix = `Use ${commands.length ? `one of its commands (${commands.join(', ')}) or ` : ''}one of: ${NATIVE_COMMAND_NAMES.join(', ')} (or another method of the element, like play). The first key of a command is the method, the others are its options: { scrollIntoView: Row, block: 'nearest' }`
  }
  send('SYG641', {component, message, fix, data})
}

// methods that change the DOM snabbdom owns (the next patch undoes them or trips over them)
const DOM_MUTATORS = /^(remove|append|prepend|before|after|replaceWith|replaceChildren|appendChild|removeChild|insertBefore|replaceChild|insertAdjacent(Element|HTML|Text)|(set|remove|toggle)Attribute(NS|Node)?|attachShadow|setHTML(Unsafe)?|normalize)$/

/** SYG641 when it is sent: not a command object, or a method that changes the DOM Sygnal renders */
export function checkSentCommand(component: any, cmd: any): void {
  if (cmd == null) return
  const name = (component && component.name) || 'component'
  if (typeof cmd != 'object' || Array.isArray(cmd) || !Object.keys(cmd).length) return notACommand(component, name, cmd)
  const method = Object.keys(cmd)[0], target = cmd[method]
  if (!DOM_MUTATORS.test(method) || (isControl(target) && target.spec?.commands?.[method])) return
  send('SYG641', {
    component,
    message: `ELEMENT ${describeCommand(cmd)} in ${name}: ${method}() changes the DOM that ${name}'s view renders, so the next render undoes it or fails`,
    fix: `Change the state and render the result instead; element commands are for what a view can't express (focus, scrolling, dialogs, popovers, media)`,
    data: {method, command: cmd},
  })
}

/** The dev entry check: checkSentCommand runs on every ELEMENT value through the core's onElementCommand hook (checks/next.ts) */
export const elementCommandsCheck: DiagnosticCheck = {
  id: 'elementCommands',
}

/** Publish the element command hook on the core bridge. Returns an uninstall function. */
export function installElementCommandHooks(): () => void {
  const c = core()
  if (!c) return () => {}
  c.elementCommand = reportElementCommand
  return () => { if (c.elementCommand === reportElementCommand) c.elementCommand = undefined }
}
