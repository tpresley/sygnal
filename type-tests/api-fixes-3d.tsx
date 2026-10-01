/**
 * Type tests for workstream 3D (G-054):
 * - `isolatedState` is part of the Component type (the SYG405 fix hint)
 * - `idfield` on Collection props
 */
import type { Component, CollectionProps } from 'sygnal'
import { Collection } from 'sygnal'

// ─── isolatedState ──────────────────────────────────────────────────────────

type PanelState = { open: boolean }
const Panel: Component<PanelState> = ({ state }) => <div>{String(state.open)}</div>
Panel.initialState = { open: false }
Panel.isolatedState = true

// @ts-expect-error isolatedState is a boolean
Panel.isolatedState = 'yes'

// ─── idfield ────────────────────────────────────────────────────────────────

type Row = { key: string; label: string }
type ListState = { rows: Row[] }
const RowView: Component<Row> = ({ state }) => <li>{state.label}</li>

const ok: CollectionProps<{}, ListState> = { of: RowView, from: 'rows', idfield: 'key' }
// @ts-expect-error idfield is a field name (string)
const bad: CollectionProps<{}, ListState> = { of: RowView, from: 'rows', idfield: 1 }
void ok; void bad

const List: Component<ListState> = () => <ul><Collection of={RowView} from="rows" idfield="key" /></ul>
void List
