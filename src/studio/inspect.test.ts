import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Model } from './api'
import { Prose } from './Inspect'
import { PRESETS, cell, contain, fieldsOf, findBoxes, humanize, inspectPhase, inspectRequest, parseSchema } from './inspect'
import { defaultModel } from './state'

describe('presets', () => {
  it('hold valid schemas, or none for free text', () => {
    for (const p of PRESETS) {
      const { schema, problem } = parseSchema(p.schema)
      expect(problem).toBeNull()
      expect(schema === null).toBe(p.id === 'review')
    }
  })

  it('say a review is not a diagnosis', () => {
    expect(PRESETS.find(p => p.id === 'review')?.note).toMatch(/not a diagnosis/)
  })
})

describe('parseSchema', () => {
  it('says what is wrong with one that is not JSON or not an object', () => {
    expect(parseSchema('{').problem).toMatch(/isn’t JSON/)
    expect(parseSchema('[1]').problem).toMatch(/object/)
    expect(parseSchema('  ')).toEqual({ schema: null, problem: null })
  })
})

describe('findBoxes', () => {
  it('reads Qwen3-VL boxes on the 0 to 1000 grid, wherever they are', () => {
    const boxes = findBoxes({ defects: [{ what: 'dent in rim', bbox_2d: [530, 300, 640, 480] }] }, 1000, 700)
    expect(boxes).toHaveLength(1)
    expect(boxes[0]?.label).toBe('dent in rim')
    expect(boxes[0]?.x).toBeCloseTo(0.53)
    expect(boxes[0]?.h).toBeCloseTo(0.18)
  })

  it('takes numbers past 1000 as pixels of the image, and puts corners in order', () => {
    const [b] = findBoxes([{ label: 'x', box: [1200, 600, 0, 0] }], 1280, 1200)
    expect(b?.x).toBe(0)
    expect(b?.w).toBeCloseTo(1200 / 1280)
    expect(b?.h).toBeCloseTo(0.5)
  })

  it('finds none in free text or other JSON', () => {
    expect(findBoxes(null, 10, 10)).toEqual([])
    expect(findBoxes({ total: 4, items: [1, 2, 3, 4] }, 10, 10)).toEqual([])
  })
})

describe('fieldsOf', () => {
  it('splits an invoice into its fields and its line items', () => {
    const f = fieldsOf({ vendor: 'Ember & Ash', total: 2139.5, line_items: [{ description: 'Plate', quantity: 48, amount: 696 }] })
    expect(f.fields.map(x => [x.label, x.value])).toEqual([['Vendor', 'Ember & Ash'], ['Total', '2,139.50']])
    expect(f.tables).toHaveLength(1)
    expect(f.tables[0]?.label).toBe('Line items')
    expect(f.tables[0]?.columns).toEqual(['description', 'quantity', 'amount'])
  })

  it('keeps an empty list as an empty table', () => {
    expect(fieldsOf({ defects: [] }).tables[0]?.rows).toEqual([])
  })
})

describe('cells', () => {
  it('show money to two places, counts as they are, and boxes as four numbers', () => {
    expect(cell('unit_price', 14.5)).toBe('14.50')
    expect(cell('quantity', 48)).toBe('48')
    expect(cell('bbox_2d', [1, 2, 3, 4])).toBe('[1, 2, 3, 4]')
    expect(cell('x', null)).toBe('—')
    expect(humanize('invoice_number')).toBe('Invoice number')
  })
})

describe('the vision model chosen first', () => {
  const vision = (id: string, sizeBytes: number, loaded = false) =>
    ({ id, kind: 'vision', name: id, available: true, sizeBytes, loaded }) as unknown as Model
  it('is Qwen3-VL, which the presets are made for, not the smallest (PaddleOCR-VL only reads text)', () => {
    const models = [vision('vision:qwen3-vl-4b', 3e9), vision('vision:paddleocr-vl', 1e9), vision('vision:medgemma-4b', 3.2e9)]
    expect(defaultModel(models, 'vision')?.id).toBe('vision:qwen3-vl-4b')
    expect(defaultModel(models, 'vision', 'vision:medgemma-4b')?.id).toBe('vision:medgemma-4b')
    expect(defaultModel(models.slice(1), 'vision')?.id).toBe('vision:paddleocr-vl')
  })
})

describe('the stage', () => {
  it('fits the image to the box it is drawn in, so boxes over it land where the model put them', () => {
    expect(contain(800, 400, 2)).toEqual({ width: 800, height: 400 })
    expect(contain(800, 600, 2)).toEqual({ width: 800, height: 400 })
    expect(contain(800, 200, 2)).toEqual({ width: 400, height: 200 })
    expect(contain(0, 200, 2)).toBeNull()
  })
})

describe('a look', () => {
  it('sends the schema only when there is one, and the prompt trimmed', () => {
    expect(inspectRequest('m', { image: 'data:', prompt: ' OCR: ', schema: null })).toEqual({ model: 'm', image: 'data:', prompt: 'OCR:' })
    expect(inspectRequest('m', { image: 'data:', prompt: 'x', schema: { type: 'object' } }).schema).toEqual({ type: 'object' })
  })

  it('says what it is doing, through the second model of an OCR read too', () => {
    const name = (id: string | undefined) => (id === 'vision:qwen3-vl-4b' ? 'Qwen3-VL 4B' : undefined)
    expect(inspectPhase(null, name, null, null)).toBe('reading the image…')
    expect(inspectPhase({ state: 'loading', model: 'vision:qwen3-vl-4b' }, name, null, null)).toBe('loading Qwen3-VL 4B…')
    // The filler loaded, and reading the text before its first token: still filling the schema, not reading the image.
    expect(inspectPhase({ state: 'loaded', model: 'vision:qwen3-vl-4b' }, name, 'Qwen3-VL 4B', null)).toBe('filling the schema with Qwen3-VL 4B…')
    expect(inspectPhase({ state: 'generating' }, name, 'Qwen3-VL 4B', 42)).toBe('42.0 tok/s')
  })
})

describe('a free-text answer', () => {
  it('shows a model’s markup as text, with only bold and bullets made of it', () => {
    const html = renderToStaticMarkup(createElement(Prose, { text: '**Lungs:** clear <img src=x onerror=alert(1)>\n- <script>alert(2)</script>' }))
    expect(html).toContain('<strong>Lungs:</strong>')
    expect(html).not.toMatch(/<img|<script/)
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })
})
