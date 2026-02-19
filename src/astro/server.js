function looksLikeSygnalComponent(Component) {
  if (typeof Component !== 'function') return false
  return Boolean(
    Component.isSygnalComponent ||
      Component.model ||
      Component.intent ||
      Component.initialState ||
      Component.componentName
  )
}

export function check(Component) {
  return looksLikeSygnalComponent(Component)
}

export function renderToStaticMarkup() {
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
