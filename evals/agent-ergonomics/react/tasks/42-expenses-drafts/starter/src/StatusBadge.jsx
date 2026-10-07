import { STATUS_LABELS } from './expenses.js'

export default function StatusBadge({ status }) {
  return <span className={`status status-${status}`}>{STATUS_LABELS[status]}</span>
}
