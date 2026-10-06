export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const REGIONS = ['North', 'South', 'West']

// Units sold per month, January to December.
export const SALES = {
  North: [120, 95, 130, 110, 160, 150, 140, 120, 98, 110, 150, 170],
  South: [80, 85, 90, 120, 115, 100, 95, 105, 130, 125, 140, 160],
  West: [60, 70, 65, 80, 90, 85, 100, 110, 95, 120, 115, 130],
}

/** The shown months and their totals for a region ('all' = every region) and a range (6 or 12 months). */
export function salesFor(region, months) {
  const from = MONTHS.length - months
  const totals = MONTHS.map((_, i) => (region === 'all' ? REGIONS.reduce((sum, r) => sum + SALES[r][i], 0) : SALES[region][i]))
  return { labels: MONTHS.slice(from), values: totals.slice(from) }
}
