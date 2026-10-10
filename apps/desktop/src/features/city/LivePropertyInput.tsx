import { useEffect, useRef, useState } from 'react'
import type { InputHTMLAttributes } from 'react'

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur'> {
  label: string
  value: string
  onCommit(value: string): void
}

/** Apply completed input without remounting focused fields or committing partial text. */
export function LivePropertyInput({ label, value, onCommit, ...input }: Props) {
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const commit = useRef(onCommit)
  commit.current = onCommit
  useEffect(() => { clearTimeout(timer.current); setDraft(value); setError('') }, [value])
  useEffect(() => () => clearTimeout(timer.current), [])
  function apply(text: string, report: boolean): void {
    clearTimeout(timer.current)
    if (text === value) { setError(''); return }
    try { commit.current(text); setError('') } catch (reason) { if (report) setError(reason instanceof Error ? reason.message : '属性值无效') }
  }
  return <>
    <label className="editor-field">{label}<input {...input} value={draft} onChange={event => {
      const text = event.target.value
      setDraft(text); setError(''); clearTimeout(timer.current)
      timer.current = setTimeout(() => apply(text, false), 300)
    }} onBlur={() => apply(draft, true)} onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); apply(draft, true) }
      if (event.key === 'Escape') { event.stopPropagation(); clearTimeout(timer.current); setDraft(value); setError('') }
    }} /></label>
    {error && <p className="editor-error" role="alert">{error}</p>}
  </>
}
