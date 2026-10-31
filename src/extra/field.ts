/*
 * The widget field contract (UI sweep round 2: dev-plans/research/ui-sweep/zag.md). A widget whose
 * definition declares `field` stands for one form field named by its `name` prop:
 *
 *   defineWidget({ events: ['pick'], field: { event: 'pick', read: (fp) => fp.selectedDates[0] ?? null }, … })
 *   // view: <form><DatePicker className="due" name="due" value={state.form.values.due} /></form>
 *
 * - When the widget dispatches the field's event (`field.event`, else `value.event`, else
 *   'change'), its host also fires a bubbling `input` event marked with FIELD; while it is
 *   dispatched, the field's value is that event's detail (the value prop may not have caught up).
 * - The `form` behavior reads such an `input` as a change of the field (name, value); other
 *   `input` events on or inside the host don't count (its own nameless controls), and the focus
 *   leaving the host (not moving inside it) marks the field touched.
 * - processForm entries get the field's value (`field.read(instance, host)`, else the last value
 *   dispatched, else the `value` prop) over FormData's: a widget's own named fields (Select's
 *   hidden <select>) follow its value prop, which may not have caught up either.
 * - A field whose `disabled` prop is true has no entry.
 *
 * The host's record (`__sw`, src/extra/widget.ts) has `f()`: `{ name, value, disabled }`, and `h`,
 * the host. No import of widget.ts: the form behavior and processForm don't pull it in.
 */

/** Marks the `input` event a field widget's host fires for the field's value */
export const FIELD = Symbol.for('sygnal.field')

/** The record of the field widget an element is or is inside (the host's `__sw` with `f()`) */
export const fieldOf = (e: any): any => {
  for (; e; e = e.parentNode) { const s = e.__sw; if (s?.f) return s }
}
