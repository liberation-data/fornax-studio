import { describe, expect, it } from 'vitest'
import { remembered } from './state'

const storage = (items: Record<string, string>) => ({ getItem: (key: string) => items[key] ?? null })

describe('remembered', () => {
  it('reads the models chosen', () => {
    expect(remembered(storage({ 'fornax-studio.chosen': '{"chat":"a"}' }))).toEqual({ chat: 'a' })
  })
  it('keeps the models chosen before the rename until the app saves its own', () => {
    expect(remembered(storage({ 'kiln-studio.chosen': '{"chat":"old"}' }))).toEqual({ chat: 'old' })
    expect(remembered(storage({ 'kiln-studio.chosen': '{"chat":"old"}', 'fornax-studio.chosen': '{"chat":"new"}' }))).toEqual({ chat: 'new' })
  })
  it('is empty with nothing chosen, or what is kept is not JSON', () => {
    expect(remembered(storage({}))).toEqual({})
    expect(remembered(storage({ 'fornax-studio.chosen': '{' }))).toEqual({})
  })
})
