
export const nullv = (v) => v === null

export const undefinedv = (v) => v === undefined

export const number = (v) => typeof v === 'number'

export const string = (v) => typeof v === 'string'

export const text = (v) => string(v) || number(v)

export const array = (v) => Array.isArray(v)

export const object = (v) => typeof v === 'object' && v !== null

export const fun = (v) => typeof v === 'function'

export const vnode = (v) => object(v) && 'sel' in v && 'data' in v && 'children' in v && 'text' in v

const svgPropsMap = {
  // Container / structural
  svg: 1, g: 1, defs: 1, symbol: 1, use: 1,
  // Shape
  circle: 1, ellipse: 1, line: 1, path: 1, polygon: 1, polyline: 1, rect: 1,
  // Text  (no HTML collision: HTML has no <text>, <tspan>, or <textPath>)
  text: 1, tspan: 1, textPath: 1,
  // Gradient / paint
  linearGradient: 1, radialGradient: 1, stop: 1, pattern: 1,
  // Clipping / masking
  clipPath: 1, mask: 1,
  // Marker
  marker: 1,
  // Filter primitives
  filter: 1, feBlend: 1, feColorMatrix: 1, feComponentTransfer: 1,
  feComposite: 1, feConvolveMatrix: 1, feDiffuseLighting: 1,
  feDisplacementMap: 1, feDropShadow: 1, feFlood: 1, feGaussianBlur: 1,
  feImage: 1, feMerge: 1, feMergeNode: 1, feMorphology: 1, feOffset: 1,
  fePointLight: 1, feSpecularLighting: 1, feSpotLight: 1, feTile: 1,
  feTurbulence: 1, feFuncR: 1, feFuncG: 1, feFuncB: 1, feFuncA: 1,
  // Descriptive  (excluding 'title' — collides with HTML <title>)
  desc: 1, metadata: 1,
  // Other  (excluding 'a', 'image', 'style', 'script' — collide with HTML)
  foreignObject: 1, switch: 1,
  // Animation
  animate: 1, animateMotion: 1, animateTransform: 1, set: 1, mpath: 1,
}

export const svg = (v) => v.sel in svgPropsMap
