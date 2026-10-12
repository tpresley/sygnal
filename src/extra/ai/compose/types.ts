/*
 * PLAN-9 (phase1-contract.md): the internal shapes shared by the compose modules (catalog, layout,
 * render, the behavior, the backends). Public, inferred types: src/ai.d.ts (`// ---- PLAN-9
 * compose`). Type-only: this module emits nothing.
 */

/**
 * a param declaration, normalized: the canonical form every module reads (layout's checks, render,
 * both backends). `kind` replaces the declaration's discriminator (`options` → 'options',
 * `type: 'number' | 'text' | 'list'` → that kind (`type` itself is not kept), `from` → 'record');
 * only the fields listed here are kept. An options param always has a `default` (its first option when none is
 * given); `required` is a boolean on text and list params.
 *
 *   options: { kind: 'options', options: { value: description }, default, label?, ask? }
 *   number:  { kind: 'number', min?, max?, default?, bins?: { number: description }, label? }
 *   text:    { kind: 'text', maxLength?, default?, required, label? }
 *   list:    { kind: 'list', items?: { maxLength? }, min?, max?, required, default?, label? }
 *   record:  { kind: 'record', from: (state) => [{ value, name?, aliases?, description? }], label? }
 */
export type Param =
  | {kind: 'options'; options: Record<string, string>; default?: any; label?: string; ask?: string}
  | {kind: 'number'; min?: number; max?: number; default?: number; bins?: Record<string, string>; label?: string}
  | {kind: 'text'; maxLength?: number; default?: string; required?: boolean; label?: string}
  | {kind: 'list'; items?: {maxLength?: number}; min?: number; max?: number; required?: boolean; default?: string[]; label?: string}
  | {kind: 'record'; from: (state: any) => any[]; label?: string; default?: undefined}

/** a catalog part, normalized */
export interface Part {
  id: string
  kind: 'part'
  component?: any
  render?: (props: any) => any
  props?: Record<string, any> | ((params: Record<string, any>, state: any) => Record<string, any>)
  description: string
  state?: string | {get: Function; set?: Function} | ((node: Node, key: string) => any)
  /** `local: init`: state kept at slice.local[nodeKey] */
  local?: any
  hasLocal: boolean
  params: Record<string, Param>
  /** the record param's name (at most one per part) */
  record?: string
  /** the places it may go: 'container:slot' entries (the root is 'page:default') */
  in: string[]
  group?: string
  maxUses: number
  required: boolean
  pin?: 'start' | 'end'
  companions: string[]
  category?: string
  result: boolean
  /** everything the declaration had, for backends that read extra fields */
  decl: Record<string, any>
}

/** a catalog container (a view function with named slots), normalized */
export interface Container {
  id: string
  kind: 'container'
  slots: Record<string, string | null>
  slotNames: string[]
  minSlots?: number
  /** children per slot: fewer than `min` unwraps it, more than `max` overflow (a row splits) */
  min?: number
  max?: number
  /** 'leaves': only parts in its slots (nested containers go after it) */
  accepts?: 'leaves'
  params: Record<string, Param>
  arranged: boolean
  direction?: 'row' | 'column'
  description?: string
  render: (a: any) => any
  /** where the container itself may go ('container:slot' entries) */
  in: string[]
  decl: Record<string, any>
}

export type Entry = Part | Container

/** one node of a layout */
export interface Node {
  part: string
  params?: Record<string, any>
  slots?: Record<string, string[]>
}

/** the layout: a node map with identity keys */
export interface Layout {
  root: 'page'
  nodes: Record<string, Node>
}

/** the nested form a model writes and tests use */
export type TreeNode = {part: string; params?: Record<string, any>; children?: Tree | Record<string, Tree>}
export type Tree = TreeNode[]

export interface Option {option: string; part: string; params?: Record<string, any>; description: string}

export interface Catalog {
  parts: Record<string, Part>
  containers: Record<string, Container>
  get(id: string): Entry | undefined
  options(state: any): Option[]
  /** a record part's records (validated `from`: SYG252) */
  records(part: Part | string, state: any): Array<{value: any; name?: string; aliases?: string[]; description?: string}>
  finish(layout: Layout, state?: any): Layout
  /** the page's label (B: `containers.page.description ?? catalog.description`) */
  description?: string
  categories: Record<string, string>
  /** false: the catalog opted out of the built-in row */
  rows: boolean
  guidance?: string
  /**
   * maxParts: leaves on the page (finish drops the last non-required ones). maxDepth: how deep a
   * CONTAINER may sit, counting the page as 0 and its children as 1: a container at depth d > maxDepth
   * moves to the page (finish; structure/composer.mjs's rule). Both backends follow it: decisions'
   * reading, and llm's schema and repair (a container is offered at depth d only when d <= maxDepth).
   * Leaves may sit one level below the deepest container. (The research llm-composer.mjs counted
   * leaves instead: its maxDepth m is this one's m - 1.)
   */
  limits: {maxParts: number; maxDepth: number}
  examples: any[]
  render(slice: any, state: any, opts?: RenderOptions): any
}

export interface RenderOptions {
  scope?: string
  frozen?: boolean
  answer?: {node: string; value: any} | null
  /** the slice's path in the host state (default: found by identity among the host's keys) */
  at?: string | Array<string | number>
}

/** the reply action names a backend's requests carry */
export interface Names {ok: string; error: string; delta: string; key: string}

/** a composition backend (phase1-contract.md: A defines it, B and C implement it) */
export interface Backend {
  sink: string
  start(a: {catalog: Catalog; state: any; prompt: string; previous: Layout | null; names: Names}): {request: any; pending: any}
  reply(a: {catalog: Catalog; state: any; pending: any; reply: any; names: Names}):
    {layout?: Layout | null; unavailable?: true; preview?: Layout; request?: any; pending?: any; decisions?: unknown; error?: string}
  delta?(a: {catalog: Catalog; state: any; pending: any; delta: any}): {preview?: Layout}
  fake(a: {catalog: Catalog; state: any; pending: any; target: Tree}): unknown
}

export type Status = 'idle' | 'composing' | 'preview' | 'done' | 'unavailable' | 'error'

/** the compose behavior's slice */
export interface ComposeSlice {
  prompt: string
  status: Status
  layout: Layout | null
  preview: Layout | null
  pending: any
  decisions: unknown
  error: string | null
  ui: Record<string, Record<string, any>>
  local: Record<string, any>
}
