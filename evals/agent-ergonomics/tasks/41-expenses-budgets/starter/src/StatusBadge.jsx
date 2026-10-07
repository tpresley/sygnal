import { STATUS_LABELS } from './expenses.js'

function StatusBadge({ status }) {
  return <span className={`status status-${status}`}>{STATUS_LABELS[status]}</span>
}

export default StatusBadge
