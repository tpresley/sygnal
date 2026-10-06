/**
 * PLAN-5 0-A: the type side of the interfaces PLAN-4 promised to PLAN-5 (test/p5-0a-interfaces.test.js
 * covers the runtime side).
 * - I3: a widget-shaped spec object's props come from its `__props` phantom through controls()
 * - I4: a spec's `commands` signature (hostElement, options) (the ElementCommandRegistry side is in
 *   registry/element-commands-registry.tsx, compiled separately so its augmentation stays local)
 * - I5: 'widget' is an AppErrorPhase, and renderComponent's onError hook sees it
 */
import { controls, renderComponent } from 'sygnal'
import type { AppErrorInfo, AppErrorPhase, ControlH, ControlSpecObject, ElementCommand, VNode } from 'sygnal'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
function expectType<T extends true>(): void {}

// I3 ─ a widget spec built the way defineWidget would (kind 'widget', __props phantom)
type PickerProps = { value: string; min?: string }
function widgetSpec<P>(tag: string, commands: Record<string, (el: Element, o: Record<string, unknown>) => void>) {
  return {
    kind: 'widget',
    vnode: (props: P, _children: unknown[], h: ControlH): VNode => h(tag, null),
    commands,
    __props: undefined as P | undefined,
  } satisfies ControlSpecObject<P>
}
const picker = widgetSpec<PickerProps>('input', { open: (el, o) => { void el; void o } })
const { Due } = controls({ Due: picker })

const ok = <Due value="2026-10-05" min="2026-01-01" key="d" />
// @ts-expect-error `value` is required by the widget's props
const missing = <Due min="x" />
// @ts-expect-error `value` is a string
const wrongType = <Due value={3} />
void ok; void missing; void wrongType
expectType<Equal<typeof Due.kind, string>>()

// 0-A finding (D189 input): a spec object's props are exactly P & { key, children, ref }; class
// hooks (className, class, attrs, style) are not added, so a widget tag that takes `className`
// (D189's `<DatePicker className="due" />`) must put it in P (defineWidget's props type can)
// @ts-expect-error className is not a common control prop
const noClass = <Due value="x" className="due" />
void noClass

// I4 ─ a spec's commands take (hostElement, options); a built-in command accepts the widget's control
type Cmds = NonNullable<ControlSpecObject['commands']>
expectType<Equal<Parameters<Cmds[string]>, [elm: Element, options: Record<string, unknown>]>>()
const focusCmd: ElementCommand = { focus: Due }
void focusCmd

// I5 ─ the 'widget' phase
const phase: AppErrorPhase = 'widget'
const info: AppErrorInfo = { phase: 'widget', componentName: 'Planner' }
void phase; void info
renderComponent(() => ok, { onError: (_e, i) => { if (i.phase === 'widget') void i.componentName } })

// 3-V G-537 (D223): the 'patch' phase (a DOM patch threw)
const patchPhase: AppErrorPhase = 'patch'
void patchPhase
