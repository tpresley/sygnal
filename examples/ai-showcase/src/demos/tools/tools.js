// The tools the model is offered, and the app's own implementation of each: pure functions of
// the call's input. The driver doesn't validate a call's input against `inputSchema` (the model
// may send anything), so each tool checks it and returns an Error when it's wrong: the model sees
// the message and can try again.

const number = { type: 'number' }
const string = (description, extra) => ({ type: 'string', description, ...extra })

// ---- convert_units: a fixed table per kind, in a base unit ------------------------------
const UNITS = {
  mass: { g: 1, kg: 1000, mg: 0.001, oz: 28.349523, lb: 453.59237 },
  volume: { ml: 1, l: 1000, tsp: 4.928922, tbsp: 14.786765, cup: 236.588237, fl_oz: 29.573530, pint: 473.176473, gallon: 3785.411784 },
  length: { mm: 1, cm: 10, m: 1000, km: 1e6, in: 25.4, ft: 304.8, mi: 1609344 },
}
const TEMPERATURE = ['C', 'F', 'K']
// grams per US cup, for converting an ingredient between volume and mass
const DENSITY = { flour: 125, sugar: 200, 'brown sugar': 220, butter: 227, water: 237, milk: 245, rice: 185, honey: 340, oats: 90 }

const ALIASES = {
  gram: 'g', grams: 'g', kilogram: 'kg', kilograms: 'kg', ounce: 'oz', ounces: 'oz', pound: 'lb', pounds: 'lb', lbs: 'lb',
  milliliter: 'ml', milliliters: 'ml', liter: 'l', liters: 'l', litre: 'l', litres: 'l', teaspoon: 'tsp', teaspoons: 'tsp',
  tablespoon: 'tbsp', tablespoons: 'tbsp', cups: 'cup', 'fl oz': 'fl_oz', pints: 'pint', gallons: 'gallon',
  inch: 'in', inches: 'in', foot: 'ft', feet: 'ft', mile: 'mi', miles: 'mi', meter: 'm', meters: 'm', km: 'km',
  celsius: 'C', c: 'C', '°c': 'C', fahrenheit: 'F', f: 'F', '°f': 'F', kelvin: 'K', k: 'K',
}
const unit = (u) => ALIASES[String(u).trim().toLowerCase()] ?? String(u).trim()
const kindOf = (u) => (TEMPERATURE.includes(u) ? 'temperature' : Object.keys(UNITS).find((k) => u in UNITS[k]))
const round = (n, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits

const toCelsius = { C: (v) => v, F: (v) => (v - 32) * 5 / 9, K: (v) => v - 273.15 }
const fromCelsius = { C: (v) => v, F: (v) => v * 9 / 5 + 32, K: (v) => v + 273.15 }

function convertUnits({ value, from, to, ingredient }) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return new Error('`value` must be a number')
  const [a, b] = [unit(from), unit(to)]
  const [ka, kb] = [kindOf(a), kindOf(b)]
  if (!ka) return new Error(`Unknown unit "${from}". Known: ${[...Object.values(UNITS).flatMap(Object.keys), ...TEMPERATURE].join(', ')}`)
  if (!kb) return new Error(`Unknown unit "${to}"`)
  if (ka === 'temperature' || kb === 'temperature') {
    if (ka !== kb) return new Error(`Can't convert ${ka} to ${kb}`)
    return { value: round(fromCelsius[b](toCelsius[a](value)), 1), unit: b }
  }
  if (ka === kb) return { value: round(value * UNITS[ka][a] / UNITS[kb][b]), unit: b }
  // volume <-> mass needs the ingredient's density
  const density = DENSITY[String(ingredient ?? '').trim().toLowerCase()]
  if (!(ka in { mass: 1, volume: 1 } && kb in { mass: 1, volume: 1 })) return new Error(`Can't convert ${ka} to ${kb}`)
  if (!density) return new Error(`Converting ${ka} to ${kb} needs an \`ingredient\`, one of: ${Object.keys(DENSITY).join(', ')}`)
  const grams = ka === 'mass' ? value * UNITS.mass[a] : value * UNITS.volume[a] / UNITS.volume.cup * density
  const result = kb === 'mass' ? grams / UNITS.mass[b] : grams / density * UNITS.volume.cup / UNITS.volume[b]
  return { value: round(result), unit: b, ingredient, gramsPerCup: density }
}

// ---- exchange_rate: fixed demo rates, units per US dollar ----------------------------------
const PER_USD = { USD: 1, EUR: 0.92, GBP: 0.79, JPY: 149.5, CAD: 1.37, AUD: 1.53, CHF: 0.88, MXN: 18.2 }

function exchangeRate({ amount, from, to }) {
  const [a, b] = [String(from).toUpperCase(), String(to).toUpperCase()]
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return new Error('`amount` must be a number')
  if (!(a in PER_USD) || !(b in PER_USD)) return new Error(`Unknown currency. Known: ${Object.keys(PER_USD).join(', ')}`)
  const rate = PER_USD[b] / PER_USD[a]
  return { amount: round(amount * rate), currency: b, rate: round(rate, 4) }
}

// ---- calculate: + - * / and parentheses on decimals, parsed by hand (no eval) ---------------
function calculate({ expression }) {
  if (typeof expression !== 'string') return new Error('`expression` must be a string')
  const tokens = expression.replace(/\s+/g, '').match(/\d+(?:\.\d+)?|\.\d+|[-+*/()]|./g) ?? []
  let i = 0
  const fail = (why) => { throw new Error(`${why} in "${expression}"`) }
  // expr := term (('+' | '-') term)* ; term := factor (('*' | '/') factor)* ; factor := '-' factor | number | '(' expr ')'
  const factor = () => {
    const t = tokens[i++]
    if (t === '-') return -factor()
    if (t === '(') { const v = expr(); if (tokens[i++] !== ')') fail('Missing ")"'); return v }
    if (t !== undefined && /^[\d.]/.test(t)) return Number(t)
    return fail(t === undefined ? 'Unexpected end' : `Unexpected "${t}"`)
  }
  const term = () => {
    let v = factor()
    while (tokens[i] === '*' || tokens[i] === '/') {
      const op = tokens[i++], r = factor()
      if (op === '/' && r === 0) fail('Division by zero')
      v = op === '*' ? v * r : v / r
    }
    return v
  }
  const expr = () => {
    let v = term()
    while (tokens[i] === '+' || tokens[i] === '-') v = tokens[i++] === '+' ? v + term() : v - term()
    return v
  }
  try {
    const result = expr()
    if (i < tokens.length) fail(`Unexpected "${tokens[i]}"`)
    return { result: round(result, 6) }
  } catch (e) {
    return e
  }
}

/** The tools, as the request offers them: a description and a JSON Schema for the input */
export const TOOLS = {
  convert_units: {
    description: `Convert a quantity between units of mass (${Object.keys(UNITS.mass).join(', ')}), volume (${Object.keys(UNITS.volume).join(', ')}; US cups), length (${Object.keys(UNITS.length).join(', ')}) or temperature (C, F, K). Between volume and mass, give the ingredient (${Object.keys(DENSITY).join(', ')}).`,
    inputSchema: {
      type: 'object',
      properties: {
        value: number,
        from: string('The unit of the value, e.g. "lb", "cup", "F"'),
        to: string('The unit to convert to'),
        ingredient: string('For volume <-> mass only: what is being measured', { enum: Object.keys(DENSITY) }),
      },
      required: ['value', 'from', 'to'],
    },
  },
  exchange_rate: {
    description: `Convert an amount of money between currencies (${Object.keys(PER_USD).join(', ')}). Demo rates: a fixed table, not live prices.`,
    inputSchema: {
      type: 'object',
      properties: { amount: number, from: string('ISO currency code, e.g. "EUR"'), to: string('ISO currency code, e.g. "USD"') },
      required: ['amount', 'from', 'to'],
    },
  },
  calculate: {
    description: 'Evaluate an arithmetic expression: numbers, + - * / and parentheses only. Use it for every sum or product.',
    inputSchema: {
      type: 'object',
      properties: { expression: string('e.g. "1133.98 + 600"') },
      required: ['expression'],
    },
  },
}

const RUN = { convert_units: convertUnits, exchange_rate: exchangeRate, calculate }

/** Run a call: its output, or an Error (an unknown tool, or input the tool can't take) */
export function runTool({ name, input }) {
  if (!(name in RUN)) return new Error(`Unknown tool "${name}"`)
  if (!input || typeof input !== 'object') return new Error('The input must be an object')
  return RUN[name](input)
}
