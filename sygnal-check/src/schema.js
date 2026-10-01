/**
 * A minimal JSON Schema validator (the subset schema/inspect.schema.json
 * uses): type (string or list), enum, const, properties, required,
 * additionalProperties (boolean or schema), items, $ref to '#/$defs/<name>'.
 * Kept dependency-free on purpose.
 *
 *   validate(schema, value) → string[]   // error messages; [] when valid
 */
const typeOf = (v) =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v

function matchesType(t, v) {
  const actual = typeOf(v)
  return t === actual || (t === 'number' && actual === 'integer')
}

export function validate(schema, value, root = schema, at = '$') {
  const errors = []
  if (schema === true || schema == null) return errors
  if (schema === false) return [`${at}: not allowed`]
  if (schema.$ref) {
    const m = /^#\/\$defs\/(.+)$/.exec(schema.$ref)
    const target = m && root.$defs && root.$defs[m[1]]
    if (!target) return [`${at}: unresolved $ref ${schema.$ref}`]
    return validate(target, value, root, at)
  }
  if (schema.type) {
    const types = [].concat(schema.type)
    if (!types.some(t => matchesType(t, value))) {
      return [`${at}: expected ${types.join(' | ')}, got ${typeOf(value)}`]
    }
  }
  if ('const' in schema && value !== schema.const) errors.push(`${at}: expected ${JSON.stringify(schema.const)}`)
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${at}: expected one of ${schema.enum.map(e => JSON.stringify(e)).join(', ')}, got ${JSON.stringify(value)}`)
  if (typeOf(value) === 'object') {
    for (const key of schema.required || []) {
      if (!(key in value)) errors.push(`${at}: missing required property '${key}'`)
    }
    const props = schema.properties || {}
    for (const [key, v] of Object.entries(value)) {
      if (key in props) errors.push(...validate(props[key], v, root, `${at}.${key}`))
      else if (schema.additionalProperties === false) errors.push(`${at}: unexpected property '${key}'`)
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        errors.push(...validate(schema.additionalProperties, v, root, `${at}[${JSON.stringify(key)}]`))
      }
    }
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((v, i) => errors.push(...validate(schema.items, v, root, `${at}[${i}]`)))
  }
  return errors
}
