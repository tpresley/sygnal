import type { Component } from 'sygnal'
import type { StatusState } from './types'

const StatusBar: Component<StatusState, any> = ({ state }: { state: StatusState }) => (
  <footer className="status-bar">{state.message}</footer>
)

export default StatusBar
