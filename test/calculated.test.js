import { describe, it, expect, vi } from 'vitest'

// The calculated field functions (normalizeCalculatedEntry, topo sort, getCalculatedValues)
// are internal to Component class in src/component.js. We reproduce the key algorithms inline
// (same approach as test-calculated.mjs) to test the logic without requiring DOM/Cycle.js.

// ─── Helper: reproduce normalizeCalculatedEntry ───
function normalize(field, entry) {
  if (typeof entry === 'function') {
    return { fn: entry, deps: null }
  }
  if (Array.isArray(entry) && entry.length === 2
      && Array.isArray(entry[0]) && typeof entry[1] === 'function') {
    return { fn: entry[1], deps: entry[0] }
  }
  throw new Error(
    `Invalid calculated field '${field}': expected a function or [depsArray, function]`
  )
}

// ─── Helper: reproduce topo sort with cycle detection ───
function topoSort(calculated) {
  const normalized = {}
  for (const [field, entry] of Object.entries(calculated)) {
    normalized[field] = normalize(field, entry)
  }

  const fieldNames = new Set(Object.keys(normalized))

  const calcDeps = {}
  for (const [field, { deps }] of Object.entries(normalized)) {
    if (deps === null) {
      calcDeps[field] = []
    } else {
      calcDeps[field] = deps.filter(d => fieldNames.has(d))
    }
  }

  const inDegree = {}
  const reverseGraph = {}
  for (const field of fieldNames) {
    inDegree[field] = 0
    reverseGraph[field] = []
  }
  for (const [field, depList] of Object.entries(calcDeps)) {
    inDegree[field] = depList.length
    for (const dep of depList) {
      reverseGraph[dep].push(field)
    }
  }

  const queue = []
  for (const [field, degree] of Object.entries(inDegree)) {
    if (degree === 0) queue.push(field)
  }

  const sorted = []
  while (queue.length > 0) {
    const current = queue.shift()
    sorted.push(current)
    for (const dependent of reverseGraph[current]) {
      inDegree[dependent]--
      if (inDegree[dependent] === 0) queue.push(dependent)
    }
  }

  if (sorted.length !== fieldNames.size) {
    const inCycle = [...fieldNames].filter(f => !sorted.includes(f))
    const visited = new Set()
    const path = []
    const traceCycle = (node) => {
      if (visited.has(node)) { path.push(node); return true }
      visited.add(node)
      path.push(node)
      for (const dep of calcDeps[node]) {
        if (inCycle.includes(dep) && traceCycle(dep)) return true
      }
      path.pop()
      visited.delete(node)
      return false
    }
    traceCycle(inCycle[0])
    const start = path[path.length - 1]
    const cycle = path.slice(path.indexOf(start))
    throw new Error(`Circular calculated dependency: ${cycle.join(' → ')}`)
  }

  return { sorted, normalized, calcDeps }
}

// ─── Helper: reproduce getCalculatedValues ───
function getCalculatedValues(calculatedOrder, fieldCache, state) {
  if (!calculatedOrder || calculatedOrder.length === 0) return

  const mergedState = { ...state }
  const computedSoFar = {}

  for (const [field, { fn, deps }] of calculatedOrder) {
    if (deps !== null && fieldCache) {
      const cache = fieldCache[field]
      const currentDepValues = deps.map(d => mergedState[d])

      if (cache.lastDepValues !== undefined) {
        let unchanged = true
        for (let i = 0; i < currentDepValues.length; i++) {
          if (currentDepValues[i] !== cache.lastDepValues[i]) {
            unchanged = false
            break
          }
        }
        if (unchanged) {
          computedSoFar[field] = cache.lastResult
          mergedState[field] = cache.lastResult
          continue
        }
      }

      try {
        const result = fn(mergedState)
        cache.lastDepValues = currentDepValues
        cache.lastResult = result
        computedSoFar[field] = result
        mergedState[field] = result
      } catch (e) {
        console.warn(`Calculated field '${field}' threw: ${e.message}`)
      }
    } else {
      try {
        const result = fn(mergedState)
        computedSoFar[field] = result
        mergedState[field] = result
      } catch (e) {
        console.warn(`Calculated field '${field}' threw: ${e.message}`)
      }
    }
  }

  return computedSoFar
}

// ─── Helper: set up calculated order + cache from a calculated definition ───
function setupCalculated(calcDef) {
  const { sorted, normalized } = topoSort(calcDef)
  const order = sorted.map(f => [f, normalized[f]])
  const cache = {}
  for (const [field, { deps }] of order) {
    if (deps !== null) {
      cache[field] = { lastDepValues: undefined, lastResult: undefined }
    }
  }
  return { order, cache }
}


describe('calculated fields', () => {
  describe('normalizeCalculatedEntry', () => {
    it('normalizes a plain function', () => {
      const fn = state => state.a + state.b
      const result = normalize('sum', fn)
      expect(result.fn).toBe(fn)
      expect(result.deps).toBeNull()
    })

    it('normalizes a [deps, fn] tuple', () => {
      const fn = state => state.x * 2
      const result = normalize('double', [['x'], fn])
      expect(result.fn).toBe(fn)
      expect(result.deps).toEqual(['x'])
    })

    it('allows empty deps array', () => {
      const fn = () => 42
      const result = normalize('constant', [[], fn])
      expect(result.fn).toBe(fn)
      expect(result.deps).toEqual([])
    })

    it('throws for a string', () => {
      expect(() => normalize('bad', 'not a function')).toThrow('Invalid calculated field')
    })

    it('throws for a number', () => {
      expect(() => normalize('bad', 123)).toThrow('Invalid calculated field')
    })

    it('throws for a tuple missing the function', () => {
      expect(() => normalize('bad', [['x']])).toThrow('Invalid calculated field')
    })

    it('throws for a tuple with non-array deps', () => {
      expect(() => normalize('bad', ['x', () => 1])).toThrow('Invalid calculated field')
    })

    it('throws for a 3-element array', () => {
      expect(() => normalize('bad', [['x'], () => 1, 'extra'])).toThrow('Invalid calculated field')
    })

    it('throws for null', () => {
      expect(() => normalize('bad', null)).toThrow('Invalid calculated field')
    })

    it('throws for undefined', () => {
      expect(() => normalize('bad', undefined)).toThrow('Invalid calculated field')
    })

    it('includes field name in error message', () => {
      expect(() => normalize('myField', 42)).toThrow("'myField'")
    })
  })

  describe('topological sort', () => {
    it('sorts a simple chain: subtotal → tax → total', () => {
      const { sorted } = topoSort({
        subtotal: [['price', 'qty'], state => state.price * state.qty],
        tax:      [['subtotal'],     state => state.subtotal * 0.1],
        total:    [['subtotal', 'tax'], state => state.subtotal + state.tax],
      })
      expect(sorted.indexOf('subtotal')).toBeLessThan(sorted.indexOf('tax'))
      expect(sorted.indexOf('subtotal')).toBeLessThan(sorted.indexOf('total'))
      expect(sorted.indexOf('tax')).toBeLessThan(sorted.indexOf('total'))
    })

    it('includes no-deps fields alongside deps fields', () => {
      const { sorted } = topoSort({
        label:    state => `${state.qty}x`,
        subtotal: [['price', 'qty'], state => state.price * state.qty],
        total:    [['subtotal'], state => state.subtotal + 1],
      })
      expect(sorted).toContain('label')
      expect(sorted.indexOf('subtotal')).toBeLessThan(sorted.indexOf('total'))
      expect(sorted).toHaveLength(3)
    })

    it('handles a single field with no deps', () => {
      const { sorted } = topoSort({
        only: state => state.x + 1,
      })
      expect(sorted).toEqual(['only'])
    })

    it('handles a single field with deps', () => {
      const { sorted } = topoSort({
        doubled: [['value'], state => state.value * 2],
      })
      expect(sorted).toEqual(['doubled'])
    })

    it('handles all fields with no deps', () => {
      const { sorted } = topoSort({
        a: state => state.x,
        b: state => state.y,
        c: state => state.z,
      })
      expect(sorted).toHaveLength(3)
      expect(sorted).toContain('a')
      expect(sorted).toContain('b')
      expect(sorted).toContain('c')
    })

    it('handles a deep chain: a → b → c → d', () => {
      const { sorted } = topoSort({
        a: state => state.x,
        b: [['a'], state => state.a * 2],
        c: [['b'], state => state.b * 2],
        d: [['c'], state => state.c * 2],
      })
      expect(sorted.indexOf('a')).toBeLessThan(sorted.indexOf('b'))
      expect(sorted.indexOf('b')).toBeLessThan(sorted.indexOf('c'))
      expect(sorted.indexOf('c')).toBeLessThan(sorted.indexOf('d'))
    })

    it('handles diamond dependency: a → b, a → c, b+c → d', () => {
      const { sorted } = topoSort({
        a: state => state.x,
        b: [['a'], state => state.a + 1],
        c: [['a'], state => state.a + 2],
        d: [['b', 'c'], state => state.b + state.c],
      })
      expect(sorted.indexOf('a')).toBeLessThan(sorted.indexOf('b'))
      expect(sorted.indexOf('a')).toBeLessThan(sorted.indexOf('c'))
      expect(sorted.indexOf('b')).toBeLessThan(sorted.indexOf('d'))
      expect(sorted.indexOf('c')).toBeLessThan(sorted.indexOf('d'))
    })

    it('ignores deps on non-calculated fields (base state)', () => {
      const { sorted, calcDeps } = topoSort({
        doubled: [['value'], state => state.value * 2],
        tripled: [['doubled', 'value'], state => state.doubled + state.value],
      })
      // 'value' is not a calculated field, so calcDeps for doubled should be empty
      expect(calcDeps['doubled']).toEqual([])
      // tripled depends on doubled (calculated) but not value (base state)
      expect(calcDeps['tripled']).toEqual(['doubled'])
      expect(sorted.indexOf('doubled')).toBeLessThan(sorted.indexOf('tripled'))
    })
  })

  describe('circular dependency detection', () => {
    it('detects a 2-node cycle', () => {
      expect(() => topoSort({
        a: [['b'], state => state.b + 1],
        b: [['a'], state => state.a + 1],
      })).toThrow('Circular calculated dependency')
    })

    it('includes both fields in cycle message for 2-node cycle', () => {
      try {
        topoSort({
          a: [['b'], state => state.b + 1],
          b: [['a'], state => state.a + 1],
        })
      } catch (e) {
        expect(e.message).toContain('a')
        expect(e.message).toContain('b')
      }
    })

    it('detects a 3-node cycle', () => {
      expect(() => topoSort({
        x: [['y'], s => s.y],
        y: [['z'], s => s.z],
        z: [['x'], s => s.x],
      })).toThrow('Circular calculated dependency')
    })

    it('detects cycle even with non-cyclic fields present', () => {
      expect(() => topoSort({
        ok: state => state.val,
        a: [['b'], state => state.b + 1],
        b: [['a'], state => state.a + 1],
      })).toThrow('Circular calculated dependency')
    })

    it('detects self-referencing field', () => {
      expect(() => topoSort({
        loop: [['loop'], state => state.loop + 1],
      })).toThrow('Circular calculated dependency')
    })
  })

  describe('getCalculatedValues', () => {
    it('computes basic calculated values', () => {
      const { order, cache } = setupCalculated({
        doubled: [['value'], state => state.value * 2],
      })
      const result = getCalculatedValues(order, cache, { value: 5 })
      expect(result.doubled).toBe(10)
    })

    it('computes chained calculated values', () => {
      const { order, cache } = setupCalculated({
        doubled:    [['value'], state => state.value * 2],
        quadrupled: [['doubled'], state => state.doubled * 2],
        octupled:   [['quadrupled'], state => state.quadrupled * 2],
      })
      const result = getCalculatedValues(order, cache, { value: 5 })
      expect(result.doubled).toBe(10)
      expect(result.quadrupled).toBe(20)
      expect(result.octupled).toBe(40)
    })

    it('provides merged state to no-deps functions', () => {
      const { order, cache } = setupCalculated({
        sum: state => state.a + state.b,
      })
      const result = getCalculatedValues(order, cache, { a: 3, b: 7 })
      expect(result.sum).toBe(10)
    })

    it('returns undefined for empty/null calculated order', () => {
      expect(getCalculatedValues(null, null, { x: 1 })).toBeUndefined()
      expect(getCalculatedValues([], null, { x: 1 })).toBeUndefined()
    })

    it('handles error in calculated function gracefully', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { order, cache } = setupCalculated({
        broken: [['value'], () => { throw new Error('oops') }],
      })
      const result = getCalculatedValues(order, cache, { value: 1 })
      expect(result.broken).toBeUndefined()
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('broken'))
      warnSpy.mockRestore()
    })

    it('continues computing after error in one field', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { order, cache } = setupCalculated({
        broken: state => { throw new Error('fail') },
        ok:     state => state.x + 1,
      })
      const result = getCalculatedValues(order, cache, { x: 5 })
      expect(result.ok).toBe(6)
      warnSpy.mockRestore()
    })
  })

  describe('per-field memoization', () => {
    it('does not recompute when deps are unchanged', () => {
      let calls = 0
      const { order, cache } = setupCalculated({
        doubled: [['value'], state => { calls++; return state.value * 2 }],
      })

      getCalculatedValues(order, cache, { value: 5 })
      expect(calls).toBe(1)

      getCalculatedValues(order, cache, { value: 5 })
      expect(calls).toBe(1)
    })

    it('recomputes when deps change', () => {
      let calls = 0
      const { order, cache } = setupCalculated({
        doubled: [['value'], state => { calls++; return state.value * 2 }],
      })

      getCalculatedValues(order, cache, { value: 5 })
      expect(calls).toBe(1)

      const result = getCalculatedValues(order, cache, { value: 10 })
      expect(calls).toBe(2)
      expect(result.doubled).toBe(20)
    })

    it('always recomputes no-deps fields', () => {
      let calls = 0
      const { order, cache } = setupCalculated({
        label: state => { calls++; return `${state.qty}x` },
      })

      getCalculatedValues(order, cache, { qty: 2 })
      expect(calls).toBe(1)

      getCalculatedValues(order, cache, { qty: 2 })
      expect(calls).toBe(2)

      getCalculatedValues(order, cache, { qty: 2 })
      expect(calls).toBe(3)
    })

    it('cascades recomputation through dependency chain', () => {
      let subtotalCalls = 0
      let taxCalls = 0
      let totalCalls = 0
      let labelCalls = 0

      const { order, cache } = setupCalculated({
        subtotal: [['price', 'qty'], state => { subtotalCalls++; return state.price * state.qty }],
        tax:      [['subtotal'],     state => { taxCalls++;      return state.subtotal * 0.1 }],
        total:    [['subtotal', 'tax'], state => { totalCalls++; return state.subtotal + state.tax }],
        label:    state => { labelCalls++; return `${state.qty}x` },
      })

      // First call — all compute
      const r1 = getCalculatedValues(order, cache, { price: 10, qty: 2 })
      expect(r1.subtotal).toBe(20)
      expect(r1.tax).toBe(2)
      expect(r1.total).toBe(22)
      expect(r1.label).toBe('2x')
      expect(subtotalCalls).toBe(1)
      expect(taxCalls).toBe(1)
      expect(totalCalls).toBe(1)
      expect(labelCalls).toBe(1)

      // Second call — same values, deps-based fields skip, no-deps recompute
      const r2 = getCalculatedValues(order, cache, { price: 10, qty: 2 })
      expect(r2.subtotal).toBe(20)
      expect(subtotalCalls).toBe(1)
      expect(taxCalls).toBe(1)
      expect(totalCalls).toBe(1)
      expect(labelCalls).toBe(2)

      // Third call — change qty, cascades through chain
      const r3 = getCalculatedValues(order, cache, { price: 10, qty: 3 })
      expect(r3.subtotal).toBe(30)
      expect(r3.tax).toBe(3)
      expect(r3.total).toBe(33)
      expect(subtotalCalls).toBe(2)
      expect(taxCalls).toBe(2)
      expect(totalCalls).toBe(2)
      expect(labelCalls).toBe(3)
    })

    it('empty deps means compute once then cache forever', () => {
      let calls = 0
      const { order, cache } = setupCalculated({
        constant: [[], () => { calls++; return 42 }],
      })

      const r1 = getCalculatedValues(order, cache, { x: 1 })
      expect(r1.constant).toBe(42)
      expect(calls).toBe(1)

      const r2 = getCalculatedValues(order, cache, { x: 999 })
      expect(r2.constant).toBe(42)
      expect(calls).toBe(1)
    })

    it('uses identity comparison for dep values (not deep equality)', () => {
      let calls = 0
      const arr = [1, 2, 3]
      const { order, cache } = setupCalculated({
        len: [['items'], state => { calls++; return state.items.length }],
      })

      getCalculatedValues(order, cache, { items: arr })
      expect(calls).toBe(1)

      // Same reference — skip
      getCalculatedValues(order, cache, { items: arr })
      expect(calls).toBe(1)

      // New array with same values — recompute (identity, not deep equality)
      getCalculatedValues(order, cache, { items: [1, 2, 3] })
      expect(calls).toBe(2)
    })
  })

  describe('calculated depending on calculated', () => {
    it('supports long chains', () => {
      const { order, cache } = setupCalculated({
        doubled:    [['value'], state => state.value * 2],
        quadrupled: [['doubled'], state => state.doubled * 2],
        octupled:   [['quadrupled'], state => state.quadrupled * 2],
      })
      const result = getCalculatedValues(order, cache, { value: 5 })
      expect(result.doubled).toBe(10)
      expect(result.quadrupled).toBe(20)
      expect(result.octupled).toBe(40)
    })

    it('provides earlier calculated values to later functions via merged state', () => {
      const { order, cache } = setupCalculated({
        first:  [['x'], state => state.x + 1],
        second: [['first'], state => state.first * 10],
      })
      const result = getCalculatedValues(order, cache, { x: 3 })
      expect(result.first).toBe(4)
      expect(result.second).toBe(40)
    })

    it('memoizes each level independently', () => {
      let firstCalls = 0
      let secondCalls = 0
      const { order, cache } = setupCalculated({
        first:  [['x'], state => { firstCalls++; return state.x + 1 }],
        second: [['first', 'y'], state => { secondCalls++; return state.first + state.y }],
      })

      getCalculatedValues(order, cache, { x: 1, y: 10 })
      expect(firstCalls).toBe(1)
      expect(secondCalls).toBe(1)

      // Change y only — first is unchanged, second recomputes
      getCalculatedValues(order, cache, { x: 1, y: 20 })
      expect(firstCalls).toBe(1)
      expect(secondCalls).toBe(2)

      // Change x — both recompute
      getCalculatedValues(order, cache, { x: 2, y: 20 })
      expect(firstCalls).toBe(2)
      expect(secondCalls).toBe(3)
    })
  })

  describe('edge cases', () => {
    it('handles deps referencing nonexistent state keys', () => {
      const { order, cache } = setupCalculated({
        result: [['missing'], state => state.missing ?? 'default'],
      })
      const result = getCalculatedValues(order, cache, { x: 1 })
      expect(result.result).toBe('default')
    })

    it('handles many independent fields', () => {
      const { order, cache } = setupCalculated({
        a: [['x'], state => state.x + 1],
        b: [['x'], state => state.x + 2],
        c: [['x'], state => state.x + 3],
        d: [['x'], state => state.x + 4],
      })
      const result = getCalculatedValues(order, cache, { x: 10 })
      expect(result.a).toBe(11)
      expect(result.b).toBe(12)
      expect(result.c).toBe(13)
      expect(result.d).toBe(14)
    })

    it('handles field depending on mix of base state and calculated', () => {
      const { order, cache } = setupCalculated({
        doubled: [['x'], state => state.x * 2],
        mixed:   [['doubled'], state => state.doubled + state.y],
      })
      // y is base state (not in calculated), doubled is calculated
      const result = getCalculatedValues(order, cache, { x: 5, y: 3 })
      expect(result.doubled).toBe(10)
      expect(result.mixed).toBe(13)
    })
  })
})
