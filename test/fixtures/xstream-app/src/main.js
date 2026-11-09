// An app that imports xstream directly, next to sygnal, with an npm extra. Evaluated in Node by
// test/xstream-compact.test.js
import xs, { Stream, MemoryStream } from 'xstream'
import dropRepeats from 'xstream/extra/dropRepeats'
import { xs as sygnalXs } from 'sygnal'

const seen = []
xs.of(1, 1, 2).compose(dropRepeats()).addListener({ next: v => seen.push(v) })

globalThis.__xstreamApp = {
  seen,
  sameXs: sygnalXs === xs,
  operatorIsStream: xs.of(1).map(x => x) instanceof Stream,
  extraIsStream: xs.of(1).compose(dropRepeats()) instanceof Stream,
  remembered: xs.of(1).remember() instanceof MemoryStream,
}
