import { describe, it, expect } from 'vitest'
import { createCommand, makeCommandSource } from '../src/extra/command'

describe('createCommand', () => {
  it('returns an object with send and __sygnalCommand marker', () => {
    const cmd = createCommand()
    expect(cmd).toHaveProperty('send')
    expect(cmd).toHaveProperty('_stream')
    expect(cmd.__sygnalCommand).toBe(true)
    expect(typeof cmd.send).toBe('function')
  })

  it('send() emits { type, data } messages on _stream', () => {
    const cmd = createCommand()
    const messages = []

    cmd._stream.addListener({ next: v => messages.push(v) })
    cmd.send('play', { time: 42 })
    cmd.send('pause')

    expect(messages).toEqual([
      { type: 'play', data: { time: 42 } },
      { type: 'pause', data: undefined },
    ])
  })

  it('does not replay values to late subscribers', () => {
    const cmd = createCommand()
    cmd.send('before')

    const messages = []
    cmd._stream.addListener({ next: v => messages.push(v) })
    cmd.send('after')

    expect(messages).toHaveLength(1)
    expect(messages[0].type).toBe('after')
  })
})

describe('makeCommandSource', () => {
  it('select() filters by type and extracts data', () => {
    const cmd = createCommand()
    const source = makeCommandSource(cmd)
    const values = []

    source.select('play').addListener({ next: v => values.push(v) })
    cmd.send('play', { time: 0 })
    cmd.send('pause')
    cmd.send('play', { time: 10 })

    expect(values).toEqual([{ time: 0 }, { time: 10 }])
  })

  it('select() returns undefined data when send() has no data arg', () => {
    const cmd = createCommand()
    const source = makeCommandSource(cmd)
    const values = []

    source.select('reset').addListener({ next: v => values.push(v) })
    cmd.send('reset')

    expect(values).toEqual([undefined])
  })

  it('multiple selects work independently', () => {
    const cmd = createCommand()
    const source = makeCommandSource(cmd)
    const plays = []
    const pauses = []

    source.select('play').addListener({ next: v => plays.push(v) })
    source.select('pause').addListener({ next: v => pauses.push(v) })

    cmd.send('play', 'a')
    cmd.send('pause', 'b')
    cmd.send('play', 'c')

    expect(plays).toEqual(['a', 'c'])
    expect(pauses).toEqual(['b'])
  })
})
