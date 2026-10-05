// icon.jsx
// A Lucide icon (an array of [tag, attributes, children?]) as Sygnal SVG vnodes
const parts = (node) => node.map(([Tag, attrs, children]) => <Tag {...attrs}>{children && parts(children)}</Tag>)

export function icon(node, { label, size = 24 } = {}) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
      role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : 'true'}>
      {parts(node)}
    </svg>
  )
}
