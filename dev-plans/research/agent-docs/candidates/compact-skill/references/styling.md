# Sygnal: Styling (CSS files, CSS Modules, Tailwind, `style`, `class`)

> A topic file of Sygnal's agent context. It assumes the core (`llms.txt`, or the sygnal-dev skill's `SKILL.md`: mental model, component anatomy, canonical forms, wiring rules, testing): read that first. Guide: https://sygnal.js.org/guide/styling/

## In short
- Sygnal has no styling system: import CSS (`import './styles.css'`), or use CSS Modules or Tailwind. No integration, no `.styles` static, no CSS-in-JS.
- A class is also the event hook. Keep a plain hook class next to generated ones: `` className={`save ${s.button} hover:underline`} `` + `DOM.click('.save')`.

## Details
- Classes: `className` and `class` take a string, array (nested, falsy skipped) or object (truthy keys; a key may hold several names): `class={['task', state.done && 'done', { urgent: state.urgent }]}`. `classes(...)` returns the same as a string.
- CSS Modules: `import s from './x.module.css'`; `className={s.save}` renders a hashed name, so `DOM.click('.save')` never fires (`sygnal-check` warns). Use a hook class beside it, `` DOM.click(`.${s.save}`) ``, or a control. For bare-element rules: `@scope (.card) to (.inner) { p { … } }` inside the module (root is a class; no automatic stop at child components).
- Tailwind v4: `plugins: [tailwindcss(), sygnal()]` in vite.config, `@import "tailwindcss"` in the CSS. Whole class names only (`state.on && 'bg-red-500'`, never `` `bg-${c}-500` ``). Never select a variant (`.hover:x` is an invalid selector: it throws on every event and stops the component's other listeners). `[hidden]` is `display: none !important`, so a `flex` utility won't show a `hidden` panel. cva and tailwind-merge need nothing.
- `style`: an object or a string. Values are CSS: a length needs its unit (`{ width: `${w}px` }`; `{ width: 10 }` does nothing, unlike React; `0` and unitless properties are fine). `null`, `undefined`, `''` and booleans clear the property. Pass dynamic values as custom properties: `style={{ '--hue': state.hue }}`, the rule stays in CSS.
- Named states: `data-state={state.open ? 'open' : 'closed'}`, `.panel[data-state='open']`, Tailwind `data-[state=open]:…`; `sygnal/ui` parts set `data-state`.
- `<Transition name="fade">` classes need CSS: `.fade-enter-active, .fade-leave-active { transition: opacity .3s }`, `.fade-enter-from, .fade-leave-to { opacity: 0 }` (`@apply` under Tailwind; or arbitrary variants on the element: `[&.fade-leave-to]:opacity-0`). It ends with the element's own CSS transition or animation, or `duration`; with none, at once.
- `<style>` in a view works, but not per row of a Collection (WebKit gets very slow), and needs a nonce under CSP. Server-rendered `style` attributes need `style-src-attr 'unsafe-inline'`; `style` on the client doesn't.
- Not DOM: the terminal and React Native take `[selector, style]` rules and numbers are cells / points; `sygnal/primitives` numbers become px.
