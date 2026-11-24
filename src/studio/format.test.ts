import { describe, expect, it } from 'vitest'
import { bytes, rate, seconds, splitThinking } from './format'

describe('format', () => {
  it('sizes', () => {
    expect(bytes(639446688)).toBe('610 MB')
    expect(bytes(12470694092)).toBe('11.6 GB')
    expect(bytes(512)).toBe('512 B')
    expect(bytes(null)).toBe('—')
  })

  it('times and rates', () => {
    expect(seconds(0.036)).toBe('36 ms')
    expect(seconds(1.46)).toBe('1.46 s')
    expect(seconds(130)).toBe('2 min 10 s')
    expect(rate(195.8)).toBe('196 tok/s')
    expect(rate(0)).toBe('—')
  })

  it('splits reasoning from the answer', () => {
    expect(splitThinking('<think>\nhmm\n</think>\n\nHello')).toEqual({ thinking: 'hmm', answer: 'Hello', thinkingOpen: false })
    expect(splitThinking('<think>\nstill going')).toEqual({ thinking: 'still going', answer: '', thinkingOpen: true })
    expect(splitThinking('Plain')).toEqual({ thinking: null, answer: 'Plain', thinkingOpen: false })
    expect(splitThinking('<think>\n\n</think>\n\nShort')).toEqual({ thinking: '', answer: 'Short', thinkingOpen: false })
  })
})
