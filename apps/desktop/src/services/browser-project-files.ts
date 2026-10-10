/** Browser previews use explicit downloads and file selection; desktop IO stays native. */
export function downloadProject(content: string, name: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url; link.download = name
  document.body.append(link)
  try { link.click() } finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60_000) }
}

export function pickBrowserProject(accept = '.json'): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = accept; input.hidden = true
    const done = (file: File | null): void => { input.remove(); resolve(file) }
    input.addEventListener('change', () => done(input.files?.[0] ?? null), { once: true })
    input.addEventListener('cancel', () => done(null), { once: true })
    document.body.append(input); input.click()
  })
}
