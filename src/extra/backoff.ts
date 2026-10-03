/*
 * PLAN-3: the retry delay shared by makeSocketDriver's `reconnect` and makeFetchDriver's `retry`.
 * Delay of retry n (from 0): `min(maxDelayMs, delayMs * 2^n)`, varied by ±`jitter` (a fraction;
 * `false` = none). Defaults `{ delayMs: 500, maxDelayMs: 10000, jitter: 0.2 }`.
 */
export const backoff = (p: {delayMs?: number; maxDelayMs?: number; jitter?: number | boolean}, n: number) => {
  const j = p.jitter === false ? 0 : p.jitter == null || p.jitter === true ? 0.2 : +p.jitter;
  return Math.min(p.maxDelayMs ?? 10000, (p.delayMs ?? 500) * 2 ** n) * (1 + j * (2 * Math.random() - 1));
};
