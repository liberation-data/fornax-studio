import { describe, expect, it } from 'vitest'
import { clipSize, framesAllowed, videoPhase, videoRequest } from './Video'

const form = {
  prompt: ' a kiln at dusk ', image: null, width: 672, height: 448, frames: 49, fps: 24, steps: 8, cfg: 1, seed: '', twoStage: true, audio: true,
}

describe('videoRequest', () => {
  it('leaves the steps to the two-stage recipe, and sends no image when there is none', () => {
    expect(videoRequest('video:ltx-2.5-distilled', form)).toEqual({
      model: 'video:ltx-2.5-distilled', prompt: 'a kiln at dusk', width: 672, height: 448, frames: 49, fps: 24, cfg: 1, seed: -1,
      twoStage: true, audio: true,
    })
  })

  it('sends the steps for one pass, the first frame, and sound off', () => {
    const r = videoRequest('video:ltx-2.5-dev', { ...form, twoStage: false, audio: false, steps: 20, seed: '7', image: 'data:image/png;base64,AAAA' })
    expect(r).toMatchObject({ twoStage: false, audio: false, steps: 20, seed: 7, image: 'data:image/png;base64,AAAA' })
  })
})

describe('video form', () => {
  it('takes 8n + 1 frames', () => {
    expect([9, 49, 121, 257].every(framesAllowed)).toBe(true)
    expect([8, 48, 50, 265, 1].some(framesAllowed)).toBe(false)
  })

  it('doubles the size for two-stage', () => {
    expect(clipSize({ width: 672, height: 448, twoStage: true })).toEqual({ width: 1344, height: 896 })
    expect(clipSize({ width: 672, height: 448, twoStage: false })).toEqual({ width: 672, height: 448 })
  })

  it('says which stage a render is in', () => {
    expect(videoPhase(null, 'generating')).toBe('Reading the prompt…')
    expect(videoPhase({ step: 3, steps: 8, secondsPerStep: 1, stage: 1, stages: 2 }, 'generating')).toBe('Draft: step 3 of 8')
    expect(videoPhase({ step: 1, steps: 3, secondsPerStep: 1, stage: 2, stages: 2 }, 'generating')).toBe('Refine at twice the size: step 1 of 3')
    expect(videoPhase({ step: 5, steps: 20, secondsPerStep: 1, stage: 1, stages: 1 }, 'generating')).toBe('Step 5 of 20')
    expect(videoPhase({ step: 3, steps: 3, secondsPerStep: 1, stage: 2, stages: 2 }, 'encoding')).toBe('Making the .mp4…')
  })
})
