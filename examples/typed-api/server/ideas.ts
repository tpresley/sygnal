// Server-only: imported by src/ideas.server.ts, never by client code. The client build replaces
// that file by stubs, so nothing here (nor the key) reaches the bundle; Quotes.test.tsx checks it.
export const IDEAS_KEY = process.env.IDEAS_KEY ?? 'ideas-key-7f3a-server-only'

const IDEAS: Record<string, string[]> = {
  calm: ['Breathe out longer than you breathe in.', 'Nothing is urgent at the speed of a walk.'],
  work: ['Finish the smallest useful thing.', 'Write it down, then forget it.'],
}

/** a suggestion for a tag (a real app might call a paid API with IDEAS_KEY here) */
export function pickIdea(tag: string, key: string, n: number): string | undefined {
  if (key !== IDEAS_KEY) throw new Error('bad key')
  const list = IDEAS[tag]
  return list?.[n % list.length]
}
