import { describe, expect, it } from 'vitest'
import { PRESETS, cell, fieldsOf, findBoxes, humanize, parseSchema } from './inspect'

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
