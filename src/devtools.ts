// 'sygnal/devtools' (D77): the DevTools bridge for the browser extension, a dev-only
// entry. Importing it installs window.__SYGNAL_DEVTOOLS__ (run() did this before 6.0),
// so import it before run(): components created earlier are not in the tree.
// sygnal/vite injects it in dev (`vite`, not `vite build`); opt out with
// sygnal({ devtools: false }). Production builds never contain it.
// PLAN-4 3-E (GS-10): it also records the action log (in a browser on import; elsewhere
// after recordActions()), and turns a session into a renderComponent test (copyAsTest).
import {installDevTools} from './extra/devtools'
import {getSession, isRecording} from './extra/devtoolsActions'
import type {SessionRecording} from './extra/devtoolsActions'
import {sessionToTest} from './extra/copyAsTest'
import type {CopyAsTestOptions, CopyAsTestResult} from './extra/copyAsTest'

installDevTools()

export {getDevTools, installDevTools} from './extra/devtools'
export {recordActions, clearActions, getActions, onAction, getSession, isRecording} from './extra/devtoolsActions'
export {connectReduxDevtools} from './extra/reduxDevtools'

const isSession = (x: any): x is SessionRecording => !!x && typeof x == 'object' && x.version === 1 && Array.isArray(x.actions)

/**
 * "Copy as test", with what was left out: the session of `target` (undefined: the newest root;
 * an instance id; a component; run()'s result; or a SessionRecording from getSession()).
 */
export function copyAsTestResult(target?: any, options?: CopyAsTestOptions): CopyAsTestResult {
  if (!isSession(target) && !isRecording()) throw new Error('[Sygnal DevTools] copyAsTest: nothing was recorded: import sygnal/devtools before run() (in a browser), or call recordActions() first')
  return sessionToTest(isSession(target) ? target : getSession(target), options)
}

/** "Copy as test": a Vitest + renderComponent test replaying the recorded session (see copyAsTestResult). */
export function copyAsTest(target?: any, options?: CopyAsTestOptions): string {
  return copyAsTestResult(target, options).code
}
