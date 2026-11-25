import { describe, expect, it } from 'vitest'
import { isYue2, songRequest } from './Song'
import { licenseName } from './parts'

const form = { caption: ' country rock ', lyrics: '[Verse]\nla', duration: 30, bpm: 96, keyscale: ' ', steps: 8, seed: '' }

describe('songRequest', () => {
  it('sends ACE-Step the tempo, key and steps', () => {
    expect(songRequest('song:acestep-turbo', form, 'acestep.cpp')).toEqual({
      model: 'song:acestep-turbo', caption: 'country rock', lyrics: '[Verse]\nla', duration: 30, seed: -1, bpm: 96, keyscale: 'C major', steps: 8,
    })
  })

  it('sends YuE2 its style, lyrics, length and seed alone', () => {
    expect(isYue2('yue2.cpp')).toBe(true)
    expect(songRequest('song:yue2-3b', { ...form, seed: '42' }, 'yue2.cpp')).toEqual({
      model: 'song:yue2-3b', caption: 'country rock', lyrics: '[Verse]\nla', duration: 30, seed: 42,
    })
  })

  it('names a license by what comes before its words', () => {
    expect(licenseName('CC BY-NC 4.0: no commercial use of the weights or of what they make')).toBe('CC BY-NC 4.0')
    expect(licenseName('MIT')).toBe('MIT')
  })
})
