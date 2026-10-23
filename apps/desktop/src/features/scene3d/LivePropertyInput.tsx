import { useEffect, useRef, useState } from 'react'
import { Input, type InputProps } from 'antd'

interface Props extends Omit<InputProps, 'value' | 'onChange' | 'onBlur'> {
  label: string
  value: string
  onCommit(value: string): void
}

/** Apply completed input without remounting focused fields or committing partial text. */
export function LivePropertyInput({ label, value, onCommit, ...input }: Props) {
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState('')
  const commit = useRef(onCommit)
  commit.current = onCommit
  useEffect(() => { setDraft(value); setError('') }, [value])
  function apply(text: string, report: boolean): void {
    if (text === value) { setError(''); return }
    try { commit.current(text); setError('') } catch (reason) { if (report) setError(reason instanceof Error ? reason.message : '属性值无效') }
  }
  return <>
    <label className="editor-field">{label}<Input {...input} value={draft} onChange={event => {
      const text = event.target.value
      setDraft(text); setError('')
    }} onBlur={() => apply(draft, true)} onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); apply(draft, true) }
      if (event.key === 'Escape') { event.stopPropagation(); setDraft(value); setError('') }
    }} /></label>
    {error && <p className="editor-error" role="alert">{error}</p>}
  </>
}
