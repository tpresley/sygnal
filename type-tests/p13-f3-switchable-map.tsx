/**
 * PLAN-13 F-3 type tests: Switchable's per-page state map. Compiled by `npm run test:types`;
 * never executed.
 */
import { Switchable, byId } from 'sygnal'
import type { SwitchableProps } from 'sygnal'

declare const Projects: (p: any) => any
declare const Settings: (p: any) => any

export const a = <Switchable of={{ projects: Projects, settings: Settings }} current="projects" state={{ projects: 'pages.projects', settings: byId('teams', 2) }} />
export const b = <Switchable of={{ projects: Projects, settings: Settings }} current="projects" state={{ projects: { get: (s: any) => s.p, set: (s: any, v: any) => ({ ...s, p: v }) } }} />
export const c = <Switchable of={{ projects: Projects }} current="projects" state="pages" />
// @ts-expect-error a map key must be one of the pages
export const d = <Switchable of={{ projects: Projects }} current="projects" state={{ setings: 'x' }} />
export const e: SwitchableProps = { of: { x: Projects }, current: 'x', state: { x: 'y' } }
