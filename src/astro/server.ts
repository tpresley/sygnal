import {renderToString} from '../extra/ssr'

function looksLikeSygnalComponent(Component: any): boolean {
  if (typeof Component !== 'function') return false
  return Boolean(
    Component.isSygnalComponent ||
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
    const html = renderToString(Component, {
      state: props.initialState || Component.initialState,
      props,
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
