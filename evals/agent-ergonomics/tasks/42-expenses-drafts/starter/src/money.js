// Amounts are stored in dollars (numbers with 2 decimals). The chosen currency only
// changes the symbol in front of the amount: 12.5 → "$12.50", "€12.50" or "£12.50".

export const CURRENCIES = [
  { code: 'USD', symbol: '$', label: '$ USD' },
  { code: 'EUR', symbol: '€', label: '€ EUR' },
  { code: 'GBP', symbol: '£', label: '£ GBP' },
]

export function formatMoney(amount, currency) {
  const symbol = (CURRENCIES.find((c) => c.code === currency) ?? CURRENCIES[0]).symbol
  return `${symbol}${Number(amount).toFixed(2)}`
}
