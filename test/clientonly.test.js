import { describe, it, expect } from 'vitest'
import { ClientOnly } from '../src/vike/ClientOnly.ts'

describe('ClientOnly component', () => {
  it('has preventInstantiation set', () => {
    expect(ClientOnly.preventInstantiation).toBe(true)
  })

  it('has label set to clientonly', () => {
    expect(ClientOnly.label).toBe('clientonly')
  })

  it('produces a vnode with sel "clientonly"', () => {
    const vnode = ClientOnly({ children: [] })
    expect(vnode.sel).toBe('clientonly')
  })

  it('passes fallback as a prop', () => {
    const fallback = { sel: 'span', data: {}, children: [{ text: 'Loading...' }] }
    const vnode = ClientOnly({ fallback, children: [] })
    expect(vnode.data.props.fallback).toBe(fallback)
  })

  it('passes children through', () => {
    const child = { sel: 'div', data: {}, children: [], text: undefined, elm: undefined, key: undefined }
    const vnode = ClientOnly({ children: [child] })
    expect(vnode.children).toEqual([child])
  })
})
