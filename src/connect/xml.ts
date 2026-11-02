/** Minimal XML tree for DAV responses. Names use their namespace-local part. */
export interface XmlElement {
  name: string
  children: XmlElement[]
  text: string
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity: string, code: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
    if (!code.startsWith('#')) return named[code] ?? entity
    const value = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1))
    return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff)
      ? String.fromCodePoint(value) : '\ufffd'
  })
}

/** No DOM dependency, external entities, or DTD support. */
export function parseXml(xml: string): XmlElement {
  const document: XmlElement = { name: '', children: [], text: '' }
  const stack = [{ element: document, qualifiedName: '' }]
  const tokens = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<[^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>|[^<]+/g
  let end = 0
  for (const match of xml.matchAll(tokens)) {
    if (match.index !== end) throw new Error('Invalid XML')
    end = match.index + match[0].length
    const token = match[0]
    const current = stack[stack.length - 1]!
    if (token.startsWith('<!--') || token.startsWith('<?')) continue
    if (token.startsWith('<![CDATA[')) {
      current.element.text += token.slice(9, -3)
    } else if (token.startsWith('</')) {
      if (stack.length === 1 || token.slice(2, -1).trim() !== current.qualifiedName) throw new Error('Invalid XML closing tag')
      stack.pop()
    } else if (token.startsWith('<')) {
      const name = /^<([\w.-]+(?::[\w.-]+)?)(?:\s|\/?>)/.exec(token)?.[1]
      if (!name) throw new Error('Invalid XML element')
      const element: XmlElement = { name: name.split(':').pop()!, children: [], text: '' }
      current.element.children.push(element)
      if (!token.endsWith('/>')) stack.push({ element, qualifiedName: name })
    } else {
      current.element.text += decodeEntities(token)
    }
  }
  if (end !== xml.length || stack.length !== 1 || document.children.length !== 1 || document.text.trim()) {
    throw new Error('Invalid XML document')
  }
  return document.children[0]!
}
