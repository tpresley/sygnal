export type NodeType = 'rect' | 'ellipse' | 'text' | 'frame';
export type Tool = 'select' | 'rect' | 'ellipse' | 'text' | 'frame';

interface BaseNode {
  id: string;
  type: NodeType;
  name: string;
  /** null for top-level nodes, else the id of the containing frame. */
  parentId: string | null;
  /** Position of the node's origin (top-left before rotation), in the parent's space. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees, clockwise, around the origin (Konva's convention). */
  rotation: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  cornerRadius: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
}

export interface RectNode extends BaseNode { type: 'rect' }
export interface EllipseNode extends BaseNode { type: 'ellipse' }
export interface TextNode extends BaseNode { type: 'text'; text: string; fontSize: number }
export interface FrameNode extends BaseNode { type: 'frame'; children: string[] }
export type SceneNode = RectNode | EllipseNode | TextNode | FrameNode;

/** Immutable document. Arrays are z-order, bottom first. */
export interface Doc {
  nodes: Readonly<Record<string, SceneNode>>;
  root: readonly string[];
}

/** Fields the properties panel edits. */
export type NodePatch = Partial<
  Pick<BaseNode, 'x' | 'y' | 'w' | 'h' | 'rotation' | 'fill' | 'stroke' | 'strokeWidth' | 'cornerRadius' | 'opacity' | 'name' | 'visible' | 'locked'>
> & { text?: string; fontSize?: number };

export const EMPTY_DOC: Doc = { nodes: {}, root: [] };
