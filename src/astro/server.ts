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

export function renderToStaticMarkup(): { html: string; attrs: Record<string, any> } {
  return {
    html: '',
    attrs: {},
  }
}

export const supportsAstroStaticSlot = true

export default {
  check,
  renderToStaticMarkup,
  supportsAstroStaticSlot,
}
