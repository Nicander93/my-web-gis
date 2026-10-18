import type { ReactNode } from 'react'
import { InputNumber } from 'antd'

export function PropertyField({ label, alias, children }: { label: string; alias?: string; children: ReactNode }) {
  return <label className="scene-property-window__field"><span>{label}{alias && <small>{alias}</small>}</span><div className="property-field-control">{children}</div></label>
}

export function PropertyGroup({ title, children }: { title: string; children: ReactNode }) {
  return <section className="property-group" aria-label={title}><h3>{title}</h3>{children}</section>
}

/** Pure presentation: the owning draft still validates and commits vector changes. */
export function PropertyVector3({ label, alias, unit, value, onChange }: { label: string; alias: string; unit: string; value: number[]; onChange(index: number, value: number): void }) {
  return <fieldset className="property-vector"><legend>{label} <small>{alias} · {unit}</small></legend><div>{value.map((value, index) => <label key={index}>
    <span>{['X', 'Y', 'Z'][index]}</span><InputNumber aria-label={`${label} ${['X', 'Y', 'Z'][index]}（${unit}）`} value={value} onChange={next => { if (next !== null && Number.isFinite(next)) onChange(index, next) }} />
  </label>)}</div></fieldset>
}
