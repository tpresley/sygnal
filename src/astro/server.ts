import {renderToString} from '../extra/ssr'
// PLAN-4 GS-11 / D120: the integration's `onError` module (see client.ts)
// @ts-ignore — a virtual module
import onError from 'virtual:sygnal/astro-on-error'

function looksLikeSygnalComponent(Component: any): boolean {
  if (typeof Component !== 'function') return false
  return Boolean(
    Component.model ||
      Component.intent ||
      Component.initialState ||
      Component.componentName
  )
}

export function check(Component: any): boolean {
  return looksLikeSygnalComponent(Component)
}

export function renderToStaticMarkup(
  Component: any,
  props: Record<string, any> = {},
  _slotted?: any,
  _metadata?: any
): { html: string; attrs: Record<string, any> } {
  try {
    // Props are spread top-level by renderToString (`{ state, ...props }`);
    // `props` is also passed, as on the client, for `({ state, props })` views.
    const html = renderToString(Component, {
      state: props.initialState || Component.initialState,
      props: {...props, props},
      // PLAN-4 GS-11: the app-level error hook (as the client's run() gets)
      onError,
      // G-206: a `uid` island prop is its uid root (as on the client), for two islands on a page
      uid: props.uid,
    })
    return {html, attrs: {}}
  } catch (err: any) {
    console.error('[sygnal/astro] SSR error:', err.message || err)
    return {html: '', attrs: {}}
  }
}

export const supportsAstroStaticSlot = true

export default {
  check,
  renderToStaticMarkup,
  supportsAstroStaticSlot,
}
