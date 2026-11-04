// What a filter is, shared by the pages and the wizard's steps

export const SOURCES = { logs: 'Log lines', metrics: 'A metric' }
export const METRICS = { cpu: 'CPU %', latency: 'Latency (ms)' }

/** The draft a new flow starts with */
export const BLANK = { name: '', source: 'logs', keywords: '', metric: 'cpu', above: '', created: null }

/** What a filter matches, in words */
export const condition = (f) => f.source === 'logs'
  ? `log lines with ${f.keywords.split(',').map((w) => `“${w.trim()}”`).filter((w) => w !== '“”').join(' or ')}`
  : `${METRICS[f.metric]} above ${f.above}`

/** The request body for a draft (only the fields its source uses) */
export const filterOf = (d) => d.source === 'logs'
  ? { name: d.name, source: 'logs', keywords: d.keywords }
  : { name: d.name, source: 'metrics', metric: d.metric, above: Number(d.above) }
