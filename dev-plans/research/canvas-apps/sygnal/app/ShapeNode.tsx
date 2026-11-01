/**
 * The per-shape component (README §2's "one Collection item per shape" variant, `?render=collection`):
 * each shape is an element with its own intent, rendered into the Canvas's hidden children.
 */
import type {Shape} from './doc'

export function ShapeNode({state}: {state: Shape}) {
  const {type, text, ...rest} = state
  const Tag: any = type
  return <Tag className="shape" {...rest}>{type == 'text' ? text : null}</Tag>
}

// an intent on the shape itself: hovering reports the shape to the App
ShapeNode.intent = ({DOM}: any) => ({ENTER: DOM.select('.shape').events('pointerover')})
ShapeNode.model = {ENTER: {PARENT: (s: Shape) => ({hover: s.id})}}
