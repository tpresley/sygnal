import { decideRaw } from './client.mjs'
const desc = 'Table of recent orders (customer, amount, status)'
const prompts = ['A long list of all recent orders', 'The promo banner above the full list of top customers', 'Top 5 refunded orders', 'Recent orders', 'Show me 20 orders', 'A few orders', 'Just the latest 3 orders']
const variants = {
  base: { instructions: `Consider this element: ${desc}. Which number of rows does user_request ask for it? Choose not_stated when user_request does not mention a number of rows.`, criteria: { not_stated: 'user_request does not mention a number of rows', 5: 'about 5 rows (a handful, a top 3 or top 5)', 10: 'about 10 rows', 25: 'about 25 rows (a long list, many, all)' } },
  length: { instructions: `Consider this element: ${desc}. How long a list does user_request ask for, by a number or by words like short, few, long, full or all? Choose not_stated when user_request says nothing about how long.`, criteria: { not_stated: 'user_request says nothing about how many or how long', 5: 'short: up to 5 rows (a few, a handful, top 3, top 5)', 10: 'medium: about 10 rows', 25: 'long: 25 rows (a long list, a full list, all of them, 20+)' } },
  keyword: { instructions: `Consider this element: ${desc}. Which list length does user_request ask for? Choose not_stated when user_request does not say how many or how long.`, criteria: { not_stated: 'not stated', 5: 'short list: up to 5 (few, handful, top 3, top 5)', 10: 'medium list: about 10', 25: 'long list: 25 or more (long, full, all, complete)' } },
}
for (const p of prompts) {
  const qs = Object.fromEntries(Object.entries(variants).map(([k, v]) => [k, { type: 'choice', ...v }]))
  const r = await decideRaw({ user_request: p }, qs)
  console.log(p.padEnd(55), Object.entries(r.answers).map(([k, a]) => `${k}=${a.choice}(${a.probabilities[a.choice]})`).join('  '))
}
