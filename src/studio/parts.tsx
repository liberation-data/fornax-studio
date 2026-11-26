'use client'

import { PopUpButton } from '@liberation-data/desk/react'
import { useId } from 'react'
import type { TextareaHTMLAttributes } from 'react'
import type { Kind, Model } from './api'
import { bytes, seconds } from './format'
import { useStudio } from './state'

/** The model a window uses, chosen from those of its kind in the cache; one not downloaded in full is listed, dimmed. */
export function ModelPicker({ kind, disabled }: { kind: Kind; disabled?: boolean }) {
  const { status, chosen, choose } = useStudio()
  const models = (status?.models ?? []).filter(m => m.kind === kind)
  const current = chosen(kind)
  return (
    <PopUpButton
      label="Model"
      labelHidden
      size="small"
      disabled={disabled || models.length === 0}
      placeholder={status ? 'No models in the cache' : 'Reading the cache…'}
      value={current?.id ?? null}
      onChange={id => choose(kind, id)}
      options={models.map(m => ({
        value: m.id,
        label: m.name,
        description: m.available
          ? `${bytes(m.sizeBytes)}${m.loaded ? ' · loaded' : ''}${m.stub ? ' · stub' : ''}${m.license ? ` · ${licenseName(m.license)}` : ''}`
          : 'Missing files: see Models',
        disabled: !m.available,
      }))}
    />
  )
}

/** The license's name, before what it says of it: "CC BY-NC 4.0". */
export function licenseName(license: string): string {
  return license.split(':')[0]?.trim() ?? license
}

/** Said under the model picker when the chosen model's weights limit what may be done with what they make. */
export function LicenseNote({ model }: { model: Model | null }) {
  if (!model?.license) return null
  return (
    <p className="studio-license desk-text-small" role="note">
      Check each model&apos;s license before you use what it makes. {model.name}&apos;s weights are {model.license}.
    </p>
  )
}

/** A multi-line field, drawn as the desk draws its text fields. */
export function TextArea({ label, help, ...rest }: { label: string; help?: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId()
  return (
    <div className="desk-field">
      <label htmlFor={id} className="desk-label">{label}</label>
      <textarea id={id} className="desk-input studio-textarea" {...rest} />
      {help && <span className="desk-help">{help}</span>}
    </div>
  )
}

/** Figures in a row: what each is, then the figure. */
export function Figures({ items }: { items: readonly (readonly [string, string])[] }) {
  return (
    <dl className="studio-figures">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Said in front of a window whose kind of work the backend answers with a stub: what is shown is not a model's. */
export function StubNotice({ kind }: { kind: Kind }) {
  const { status } = useStudio()
  if (!status?.stubs.includes(kind)) return null
  return (
    <p className="studio-stub" role="note">
      <strong>Stub backend.</strong> {kind === 'image' ? 'Images' : kind === 'song' ? 'Songs' : kind === 'video' ? 'Videos' : kind === 'vision' ? 'Answers' : 'Replies'} here are placeholders
      made without loading the model (FORNAX_STUDIO_STUB={status.stubs.join(',')}). The request is the real one.
    </p>
  )
}

/** What a load said while a request waited for it. */
export function loadNote(state: { loading: boolean; loadSeconds: number | null; sizeBytes?: number }): string | null {
  if (state.loading) return `Loading the model${state.sizeBytes ? ` (${bytes(state.sizeBytes)})` : ''}…`
  if (state.loadSeconds != null) return `Loaded in ${seconds(state.loadSeconds)}`
  return null
}
