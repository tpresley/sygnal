import { format, parse, partsIn, places } from '../composer.mjs'

export function score(catalog, got, wantText) {
  const want = parse(wantText)
  const g = format(got)
  const w = format(want)
  const gp = partsIn(got, catalog)
  const wp = partsIn(want, catalog)
  const rest = [...wp]
  let extra = 0
  for (const x of gp) { const i = rest.indexOf(x); if (i >= 0) rest.splice(i, 1); else extra++ }
  const partErrors = extra + rest.length
  const pg = places(got)
  const pw = places(want)
  const placeErrors = Object.keys(pw).filter((k) => k in pg && pg[k] !== pw[k]).length
  return { exact: g === w, got: g, want: w, partErrors, placeErrors, orderOnly: g !== w && !partErrors && !placeErrors }
}

