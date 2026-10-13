// Just enough Markdown for an agent's answer: headings, lists, code blocks, paragraphs, and
// **bold**, *italic*, `code` and [links](url) (as text) inline. Text only: nothing is parsed as HTML.

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|\[[^\]]+\]\([^)\s]+\))/

function inline(text) {
  return text.split(INLINE).filter(Boolean).map((part) => {
    if (part.startsWith('**')) return <strong>{part.slice(2, -2)}</strong>
    if (part.startsWith('`')) return <code>{part.slice(1, -1)}</code>
    if (part.startsWith('*') && part.length > 2) return <em>{part.slice(1, -1)}</em>
    const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)
    // the view's sandbox can't follow links: show where it points
    if (link) return <span className="link" title={link[2]}>{link[1]}</span>
    return part
  })
}

/** the blocks of a Markdown text, as vnodes */
export function markdown(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks = []
  for (let i = 0; i < lines.length;) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }
    if (line.startsWith('```')) {
      const code = []
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) code.push(lines[i])
      i++
      blocks.push(<pre><code>{code.join('\n')}</code></pre>)
      continue
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/)
    if (heading) {
      blocks.push(heading[1].length <= 2 ? <h3>{inline(heading[2])}</h3> : <h4>{inline(heading[2])}</h4>)
      i++
      continue
    }
    const ordered = /^\s*\d+[.)]\s+/
    const bullet = /^\s*[-*+]\s+/
    if (ordered.test(line) || bullet.test(line)) {
      const marker = ordered.test(line) ? ordered : bullet
      const items = []
      for (; i < lines.length && marker.test(lines[i]); i++) items.push(<li>{inline(lines[i].replace(marker, ''))}</li>)
      blocks.push(marker === ordered ? <ol>{items}</ol> : <ul>{items}</ul>)
      continue
    }
    const para = []
    for (; i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*[-*+]\s|\s*\d+[.)]\s)/.test(lines[i]); i++) para.push(lines[i])
    blocks.push(<p>{inline(para.join(' '))}</p>)
  }
  return blocks
}
