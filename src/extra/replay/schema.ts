// sygnal/replay: the recording format, version 1, as a JSON Schema (draft 2020-12). Validates the
// structure; the meaning of each field is in ./recorder.ts and the guide (guide/record-replay).
// (no object spreads: they compile to helper calls a bundler can't drop from an app that doesn't use this)
const json = {}   // any JSON value
const path = {type: 'array', items: {type: ['string', 'integer']}}
const op = {type: 'array', prefixItems: [path], minItems: 1, maxItems: 2}
const HASH = '^[0-9a-f]{8}$'
const hash = {type: 'string', pattern: HASH}

export const RECORDING_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://sygnal.js.org/schemas/recording-v1.json',
  title: 'Sygnal recording (sygnal/replay), format version 1',
  type: 'object',
  required: ['kind', 'version', 'app', 'p', 'a', 'k'],
  properties: {
    kind: {const: 'sygnal-recording'},
    version: {const: 1},
    sygnal: {type: 'string', description: 'the Sygnal version that recorded it'},
    app: {type: 'string', description: "the root component's name"},
    recorded: {type: 'string', format: 'date-time'},
    redacted: {type: 'boolean'},
    components: {type: 'object', additionalProperties: {type: 'array', items: {type: 'string'}}, description: 'component name -> the action names its model handles'},
    sources: {type: 'object', additionalProperties: {enum: ['resources', 'timers', 'other']}},
    init: json,
    p: {type: 'array', items: {type: 'string'}, description: 'instance addresses'},
    a: {
      type: 'array', description: 'actions, in queue order',
      items: {
        type: 'object', required: ['s', 't', 'p', 'y', 'c'],
        properties: {
          s: {type: 'integer', description: 'sequence number'},
          t: {type: 'number', description: 'ms since the previous action kept'},
          p: {type: 'integer', description: 'index into p'},
          y: {type: 'string', description: 'action type'},
          c: {enum: ['i', 'r', 'n', 'a', 'B', 'g', 'S', 'b', 'p'], description: 'cause: i intent, r reply, n next, a simulateAction, B behavior, g agent, S setState (inputs); b built-in, p parent (consequences)'},
          r: {type: 'string', description: "a reply's source (driver name)"},
          d: {description: 'data (inputs only; events and elements as stubs)'},
          e: {type: 'array', items: {type: 'array', prefixItems: [{enum: ['now', 'random', 'uuid', 'perf']}, json], minItems: 2, maxItems: 2}, description: 'clock and randomness the handlers read, in order'},
          h: {type: 'string', pattern: HASH, description: "hash of the instance's new state"},
          f: {type: 'array', items: {type: 'array', prefixItems: [{type: 'string'}, hash], minItems: 2, maxItems: 2}, description: '[sink, hash of the value]'},
        },
      },
    },
    k: {
      type: 'array', description: 'checkpoints, one per patch',
      items: {type: 'object', required: ['s', 'v'], properties: {s: {type: 'integer'}, v: hash, o: {type: 'array', items: op}, html: {type: 'string'}}},
    },
    fx: {type: 'array', items: {type: 'array', prefixItems: [{type: 'integer'}, {type: 'string'}, hash], minItems: 3, maxItems: 3}},
    end: {type: 'object', properties: {s: {type: 'integer'}, ms: {type: 'number'}, dropped: {type: 'integer'}, o: {type: 'array', items: op}}},
  },
} as const
