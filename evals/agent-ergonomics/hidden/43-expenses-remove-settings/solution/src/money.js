// Amounts are stored in dollars (numbers with 2 decimals): 12.5 → "$12.50".
export function formatMoney(amount) {
  return `$${Number(amount).toFixed(2)}`
}
