// 'sygnal/yjs' (experimental): part of the state tree shared between clients through a Yjs
// document. Needs yjs (and y-protocols for presence), optional peer dependencies.
// Guide: https://sygnal.js.org/guide/collaborative-state
import type { Behavior } from 'sygnal'
import type { Doc } from 'yjs'
import type { Stream } from 'xstream'

/** A field's kind in a `shape`: Y.Text, Y.Array of JSON values, an id-keyed collection, a Y.Map, a plain JSON value (last writer wins) */
export type ShapeKind = 'text' | 'list' | 'collection' | 'map' | 'value'
/** An id-keyed collection whose items' fields have these shapes (from `collection()`) */
export interface CollectionShape { readonly __collection: true }
/** A slice's shape: a field's kind, `collection({ ... })`, or an object of the fields of a map */
export type Shape = ShapeKind | CollectionShape | { [field: string]: Shape }

/**
 * `shape: { items: collection({ text: 'text' }) }`: an array of items with `id` (string or number),
 * stored by id with a fractional order key, so concurrent adds, edits, moves and removes of
 * different items merge. The argument shapes the items' fields.
 */
export declare function collection(item?: { [field: string]: Shape }): CollectionShape

export interface SharedOptions {
  /** the driver's name (default 'SHARED') */
  driver?: string;
  /** the state key that gets the other clients' presence states (`Peer[]`) */
  presence?: string;
  /** the state key that gets `{ canUndo, canRedo }` of this client's own history */
  history?: string;
  /**
   * The slice's shape; fields it leaves out are inferred from their values. Declare an empty
   * array's kind here: without a shape it is a guess (a collection), and dev reports SYG261.
   */
  shape?: { [field: string]: Shape };
  /**
   * 'whenSynced' (default): after the provider's first sync, an empty document is seeded from
   * state[key], else the document's content replaces it (edits made before the sync are written
   * onto it). 'ifEmpty': seed at once (a local-only document).
   */
  seed?: 'whenSynced' | 'ifEmpty';
}

/** The actions `shared()` adds under its key (LOCAL and REMOTE are built-in: DevTools hides them) */
export interface SharedActions<SLICE = any> {
  LOCAL: SLICE;
  REMOTE: { value: SLICE; base: SLICE };
  PRESENCE: PresencePeer[];
  HISTORY: SharedHistory;
}

/** `shared()`'s use: the host's initialState keeps state[key] (`ownsState: false`) */
export interface SharedBehavior<SLICE = any> extends Behavior<SLICE, SharedActions<SLICE>, {}, SharedOptions> {
  readonly ownsState: false;
}

/**
 * `uses = { board: shared() }`: state.board lives in the Yjs driver's document. Reducers are
 * unchanged: each new value of state.board is written to the document as a diff (`board.LOCAL`,
 * once per flush), and changes from other clients arrive as `board.REMOTE`, which applies only
 * while state.board has no unsynced local edit. Undo per user: `UNDO: { SHARED: { undo: 'board' } }`
 * (not `undo()`, which would revert other users' changes: SYG260).
 */
export declare function shared<SLICE = any>(options?: SharedOptions): SharedBehavior<SLICE>

/** Another client's awareness state, with its Yjs client id */
export type PresencePeer = { id: number } & Record<string, any>

export interface SharedHistory { canUndo: boolean; canRedo: boolean }

export interface YjsDriverOptions {
  /** the document (one per room); the app's provider keeps it in sync */
  doc: Doc;
  /** a y-protocols Awareness for presence (default: `provider.awareness`) */
  awareness?: any;
  /**
   * The provider (y-websocket, Hocuspocus, y-webrtc, y-indexeddb, a `createNetwork()` peer): its
   * first sync (`synced` / `whenSynced` / the 'sync' and 'synced' events) gates seeding, its
   * `awareness` is the default, and `{ connect }` calls its `connect()` / `disconnect()`
   */
  provider?: any;
  /** resolves once the document has synced (instead of the provider's events) */
  synced?: PromiseLike<unknown>;
  /** field names whose strings are Y.Text: concurrent typing merges by character (else last writer wins) */
  text?: string[];
  /** a Y.UndoManager per slice, tracking this client's changes only (default true) */
  undo?: boolean;
  /** ms within which this client's edits form one undo step (default 500) */
  captureTimeout?: number;
}

/** A command to the driver (a model entry's value for its sink) */
export type YjsCommand =
  | { key: string; value: any; shape?: any; seed?: 'whenSynced' | 'ifEmpty' }
  | { undo: string }
  | { redo: string }
  | { presence: Record<string, any> }
  | { connect: boolean }

export interface YjsSource {
  /** remote content for state[key] */
  remote(key: string): Stream<{ value: any; base: any }>;
  /** the other clients' presence states, on every awareness change */
  presence(): Stream<PresencePeer[]>;
  /** this client's undo history for state[key] */
  history(key: string): Stream<SharedHistory>;
  readonly doc: Doc;
}

/** The driver that owns the document for `shared()` slices: `drivers = { SHARED: makeYjsDriver({ doc, provider }) }` */
export declare function makeYjsDriver(options: YjsDriverOptions): (sink$: Stream<YjsCommand>) => YjsSource
