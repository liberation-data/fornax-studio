/** The Inspect window's presets, and how it reads what a vision model answers: fields to tabulate, boxes to draw. */

export type PresetId = 'invoice' | 'defects' | 'review'

export interface Preset {
  id: PresetId
  label: string
  prompt: string
  /** The JSON schema the reply is held to, as the window's schema field shows it; empty for free text. */
  schema: string
  /** The sample image it is shown with, under public/samples. */
  sample: string
  /** The model it is best tried with, chosen when it is in the cache. */
  model: string
  /** Said above the reply. */
  note?: string
}

const INVOICE_SCHEMA = {
  type: 'object',
  properties: {
    vendor: { type: 'string' },
    invoice_number: { type: 'string' },
    date: { type: 'string', description: 'YYYY-MM-DD' },
    line_items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { description: { type: 'string' }, quantity: { type: 'number' }, unit_price: { type: 'number' }, amount: { type: 'number' } },
        required: ['description', 'quantity', 'unit_price', 'amount'],
      },
    },
    subtotal: { type: 'number' },
    tax: { type: 'number' },
    total: { type: 'number' },
  },
  required: ['vendor', 'invoice_number', 'date', 'line_items', 'subtotal', 'tax', 'total'],
}

// Qwen3-VL grounds objects as bbox_2d: [x1, y1, x2, y2] on a 0 to 1000 grid over the image.
const DEFECTS_SCHEMA = {
  type: 'object',
  properties: {
    defects: {
      type: 'array',
      items: {
        type: 'object',
        properties: { what: { type: 'string' }, bbox_2d: { type: 'array', items: { type: 'integer' }, minItems: 4, maxItems: 4 } },
        required: ['what', 'bbox_2d'],
      },
    },
  },
  required: ['defects'],
}

export const REVIEW_NOTE = 'An aid for a clinician’s review, not a diagnosis.'

export const PRESETS: readonly Preset[] = [
  {
    id: 'invoice',
    label: 'Read an invoice',
    prompt: 'Extract this invoice’s fields. Dates as YYYY-MM-DD, amounts as plain numbers.',
    schema: JSON.stringify(INVOICE_SCHEMA, null, 2),
    sample: '/samples/invoice.png',
    model: 'vision:qwen3-vl-4b',
  },
  {
    id: 'defects',
    label: 'Find defects',
    prompt: 'This is a tray of identical round parts. Find every part with a defect, such as a dent or a chip in its rim. For each, say in a few words what is wrong and give its bounding box as bbox_2d [x1, y1, x2, y2].',
    schema: JSON.stringify(DEFECTS_SCHEMA, null, 2),
    sample: '/samples/tray.png',
    model: 'vision:qwen3-vl-4b',
  },
  {
    id: 'review',
    label: 'Describe for review',
    prompt: 'Describe this chest X-ray for a clinician’s review: the projection and technique, then the lungs, heart, mediastinum, bones and soft tissues, and anything that merits a closer look. Be factual, and say what you cannot judge from the image.',
    schema: '',
    sample: '/samples/chest-xray.jpg',
    model: 'vision:medgemma-4b',
    note: REVIEW_NOTE,
  },
]

export const SAMPLES = [
  { url: '/samples/invoice.png', label: 'Invoice' },
  { url: '/samples/tray.png', label: 'Tray of parts' },
  { url: '/samples/chest-xray.jpg', label: 'Chest X-ray' },
] as const

/** The schema field's text as the request sends it: null for none; an Error's message when it isn't JSON. */
export function parseSchema(text: string): { schema: Record<string, unknown> | null; problem: string | null } {
  if (!text.trim()) return { schema: null, problem: null }
  try {
    const v = JSON.parse(text) as unknown
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { schema: null, problem: 'The schema is a JSON object.' }
    return { schema: v as Record<string, unknown>, problem: null }
  } catch (e) {
    return { schema: null, problem: `The schema isn’t JSON: ${e instanceof Error ? e.message : String(e)}` }
  }
}

/** A box the model found, as fractions of the image (0 to 1), with what it said of it. */
export interface Box {
  label: string
  x: number
  y: number
  w: number
  h: number
}

const BOX_KEYS = ['bbox_2d', 'bbox', 'box']
const LABEL_KEYS = ['what', 'label', 'kind', 'name', 'description']

const isBox = (v: unknown): v is number[] => Array.isArray(v) && v.length === 4 && v.every(n => typeof n === 'number' && Number.isFinite(n))

/**
 * Every box in a reply, wherever it is: an object with bbox_2d (or bbox, box) of four numbers. Qwen3-VL's are on a 0 to
 * 1000 grid; numbers past 1000 are taken as pixels of the image the model saw (width × height).
 */
export function findBoxes(json: unknown, width: number, height: number): Box[] {
  const found: { label: string; b: number[] }[] = []
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      const key = BOX_KEYS.find(k => isBox(o[k]))
      if (key) {
        const label = LABEL_KEYS.map(k => o[k]).find(l => typeof l === 'string')
        found.push({ label: typeof label === 'string' ? label : '', b: o[key] as number[] })
      }
      Object.values(o).forEach(walk)
    }
  }
  walk(json)
  const pixels = found.some(f => f.b.some(n => n > 1000))
  return found.map(({ label, b }) => {
    const [sx, sy] = pixels ? [width || 1, height || 1] : [1000, 1000]
    const [ax, ay, bx, by] = b as [number, number, number, number]
    const x1 = Math.min(ax, bx) / sx, x2 = Math.max(ax, bx) / sx
    const y1 = Math.min(ay, by) / sy, y2 = Math.max(ay, by) / sy
    const clamp = (n: number) => Math.min(1, Math.max(0, n))
    return { label, x: clamp(x1), y: clamp(y1), w: clamp(x2) - clamp(x1), h: clamp(y2) - clamp(y1) }
  })
}

/** "invoice_number" as a heading: "Invoice number". */
const HEADINGS: Record<string, string> = { bbox_2d: 'Box (0–1000)', bbox: 'Box', what: 'What' }

export function humanize(key: string): string {
  if (HEADINGS[key]) return HEADINGS[key]
  const words = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const MONEY = /(price|amount|total|tax|cost|subtotal|fee)/i

/** A value as a cell shows it: money to two places, a box as its four numbers, nested things as JSON. */
export function cell(key: string, v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'number') return MONEY.test(key) ? v.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : v.toLocaleString('en')
  if (typeof v === 'string') return v
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (isBox(v)) return `[${v.join(', ')}]`
  return JSON.stringify(v)
}

/** A reply as tables: its single values as fields, and each list of objects as a table of its own. */
export interface Fields {
  fields: { key: string; label: string; value: string }[]
  tables: { key: string; label: string; columns: string[]; rows: Record<string, unknown>[] }[]
}

export function fieldsOf(json: unknown): Fields {
  const out: Fields = { fields: [], tables: [] }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return out
  for (const [key, v] of Object.entries(json as Record<string, unknown>)) {
    if (Array.isArray(v) && v.length > 0 && v.every(r => r && typeof r === 'object' && !Array.isArray(r))) {
      const rows = v as Record<string, unknown>[]
      const columns = [...new Set(rows.flatMap(r => Object.keys(r)))]
      out.tables.push({ key, label: humanize(key), columns, rows })
    } else if (Array.isArray(v) && v.length === 0) {
      out.tables.push({ key, label: humanize(key), columns: [], rows: [] })
    } else {
      out.fields.push({ key, label: humanize(key), value: cell(key, v) })
    }
  }
  return out
}
