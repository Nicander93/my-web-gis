/** Minimal namespace-tolerant XML helpers (no external deps). */

export function stripXmlns(xml: string): string {
  return xml
    .replace(/<\?xml[^?]*\?>/i, '')
    .replace(/\sxmlns(?::\w+)?="[^"]*"/g, '')
}

export function localName(name: string): string {
  const i = name.indexOf(':')
  return (i >= 0 ? name.slice(i + 1) : name).toLowerCase()
}

export interface XmlElement {
  name: string
  attrs: Record<string, string>
  text: string
  children: XmlElement[]
}

/**
 * Parse a constrained XML document into an element tree.
 * Sufficient for OGC Capabilities fixtures (not a full XML 1.0 validator).
 */
export function parseXmlTree(xml: string): XmlElement {
  const source = stripXmlns(xml).trim()
  const root: XmlElement = { name: '#root', attrs: {}, text: '', children: [] }
  const stack: XmlElement[] = [root]
  const tokenRe = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\/([^\s>]+)\s*>|<([^\s>/]+)([^>]*)\/>|<([^\s>/]+)([^>]*)>|([^<]+)/g

  let match: RegExpExecArray | null
  while ((match = tokenRe.exec(source)) !== null) {
    if (match[0].startsWith('<!--')) continue

    if (match[1] !== undefined) {
      // CDATA
      const top = stack[stack.length - 1]!
      top.text += match[1]
      continue
    }

    if (match[2] !== undefined) {
      // closing tag
      if (stack.length > 1) stack.pop()
      continue
    }

    if (match[3] !== undefined) {
      // self-closing
      const el: XmlElement = {
        name: localName(match[3]),
        attrs: parseAttrs(match[4] ?? ''),
        text: '',
        children: []
      }
      stack[stack.length - 1]!.children.push(el)
      continue
    }

    if (match[5] !== undefined) {
      // opening tag
      const raw = match[6] ?? ''
      const selfClose = /\/\s*$/.test(raw)
      const el: XmlElement = {
        name: localName(match[5]),
        attrs: parseAttrs(raw.replace(/\/\s*$/, '')),
        text: '',
        children: []
      }
      stack[stack.length - 1]!.children.push(el)
      if (!selfClose) stack.push(el)
      continue
    }

    if (match[7] !== undefined) {
      const text = match[7].replace(/\s+/g, ' ').trim()
      if (text) stack[stack.length - 1]!.text += text
    }
  }

  return root
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /([^\s=]+)\s*=\s*"([^"]*)"|([^\s=]+)\s*=\s*'([^']*)'/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) {
    const key = localName(m[1] ?? m[3] ?? '')
    const value = m[2] ?? m[4] ?? ''
    attrs[key] = value
  }
  return attrs
}

export function child(el: XmlElement, name: string): XmlElement | undefined {
  const n = name.toLowerCase()
  return el.children.find((c) => c.name === n)
}

export function children(el: XmlElement, name: string): XmlElement[] {
  const n = name.toLowerCase()
  return el.children.filter((c) => c.name === n)
}

export function textOf(el: XmlElement | undefined): string {
  return el?.text?.trim() ?? ''
}

export function findDeep(el: XmlElement, name: string): XmlElement | undefined {
  const n = name.toLowerCase()
  if (el.name === n) return el
  for (const c of el.children) {
    const found = findDeep(c, n)
    if (found) return found
  }
  return undefined
}