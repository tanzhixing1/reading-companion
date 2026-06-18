/**
 * 解析批注流式输出的文本
 * 格式: @@段落号\n批注内容\n@@段落号\n批注内容...
 *
 * @param {string} text - 累积的完整文本
 * @param {Array<number>|Set<number>} [allowedIndexes] - 可选的合法段落编号集合
 * @returns {Array} [{ paragraphIndex: number, content: string }]
 */
export function parseAnnotations(text, allowedIndexes) {
  const source = String(text || '')
  const allowedSet = normalizeAllowedIndexes(allowedIndexes)
  const markerRe = /(^|[\r\n])[ \t]*(?:[-*+]\s*)?(?:#{1,6}\s*)?@@\s*(\d+)\s*[:：.。\-—]?[ \t]*(?:\r?\n)?/g
  const matches = [...source.matchAll(markerRe)]
  const byIndex = new Map()
  let dropped = 0

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]
    const paragraphIndex = parseInt(match[2], 10)
    if (Number.isNaN(paragraphIndex)) continue
    if (allowedSet && !allowedSet.has(paragraphIndex)) {
      dropped++
      continue
    }

    const contentStart = match.index + match[0].length
    const contentEnd = matches[i + 1]?.index ?? source.length
    const content = cleanAnnotationContent(source.slice(contentStart, contentEnd))
    if (!content) continue

    if (byIndex.has(paragraphIndex)) {
      byIndex.set(paragraphIndex, `${byIndex.get(paragraphIndex)}\n\n${content}`)
    } else {
      byIndex.set(paragraphIndex, content)
    }
  }

  if (dropped > 0) {
    console.warn(`[annotationParser] Dropped ${dropped} annotation(s) with paragraph indexes outside the current range.`)
  }

  return [...byIndex.entries()].map(([paragraphIndex, content]) => ({ paragraphIndex, content }))
}

function normalizeAllowedIndexes(allowedIndexes) {
  if (!allowedIndexes) return null
  if (allowedIndexes instanceof Set) return allowedIndexes
  if (Array.isArray(allowedIndexes)) return new Set(allowedIndexes)
  return null
}

function cleanAnnotationContent(content) {
  return String(content || '')
    .replace(/```[\w-]*\s*/g, '')
    .replace(/```/g, '')
    .trim()
    .replace(/^[:：\-—.。•*+\s]+/, '')
    .replace(/^(?:批注内容|内容)\s*[:：]\s*/, '')
    .trim()
}
