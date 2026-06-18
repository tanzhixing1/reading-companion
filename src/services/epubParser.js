import JSZip from 'jszip'

export async function parseEpub(file) {
  const zip = await JSZip.loadAsync(file)

  const containerXml = await zip.file('META-INF/container.xml')?.async('text')
  if (!containerXml) throw new Error('无效的 EPUB 文件')

  const containerDoc = new DOMParser().parseFromString(containerXml, 'application/xml')
  const rootfilePath = containerDoc.querySelector('rootfile')?.getAttribute('full-path')
  if (!rootfilePath) throw new Error('找不到 OPF 文件')

  const opfXml = await zip.file(rootfilePath)?.async('text')
  if (!opfXml) throw new Error('无法读取 OPF')

  const opfDoc = new DOMParser().parseFromString(opfXml, 'application/xml')
  const opfDir = rootfilePath.includes('/') ? rootfilePath.substring(0, rootfilePath.lastIndexOf('/') + 1) : ''

  // 书名
  const titleEl = opfDoc.querySelector('metadata > *|title, metadata title')
  const title = titleEl?.textContent?.trim() || file.name.replace(/\.epub$/i, '')

  // 封面
  let coverData = null
  const metaCover = opfDoc.querySelector('meta[name="cover"]')
  const coverId = metaCover?.getAttribute('content')
  if (coverId) {
    const coverItem = opfDoc.querySelector(`item[id="${coverId}"]`)
    const coverHref = coverItem?.getAttribute('href')
    if (coverHref) {
      const coverPath = opfDir + coverHref
      const coverFile = zip.file(coverPath)
      if (coverFile) {
        const blob = await coverFile.async('blob')
        coverData = await blobToBase64(blob)
      }
    }
  }

  // spine 顺序
  const spineItems = [...opfDoc.querySelectorAll('spine itemref')]
  const manifest = {}
  opfDoc.querySelectorAll('manifest item').forEach(item => {
    manifest[item.getAttribute('id')] = item.getAttribute('href')
  })

  const chapters = []

  for (let i = 0; i < spineItems.length; i++) {
    const idref = spineItems[i].getAttribute('idref')
    const href = manifest[idref]
    if (!href) continue

    const filePath = opfDir + href
    const htmlContent = await zip.file(filePath)?.async('text')
    if (!htmlContent) continue

    const doc = new DOMParser().parseFromString(htmlContent, 'application/xhtml+xml')
    const body = doc.querySelector('body')
    if (!body) continue

    // 提取标题
    const heading = body.querySelector('h1, h2, h3, h4')
    let chTitle = heading?.textContent?.trim() || ''

    cleanBody(body)

    // 提取段落
    let paragraphs = extractParagraphs(body)
    if (paragraphs[0] === chTitle) paragraphs = paragraphs.slice(1)
    if (paragraphs.length === 0) {
      const fallbackText = cleanText(body.textContent || '')
      paragraphs = splitLongParagraph(fallbackText)
    }

    if (paragraphs.length === 0) continue

    if (!chTitle) chTitle = `第 ${chapters.length + 1} 章`

    chapters.push({
      title: chTitle,
      paragraphs,
      order: chapters.length
    })
  }

  if (chapters.length === 0) throw new Error('未能解析出任何章节内容')

  return { title, cover: coverData, chapters }
}

function blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result)
    reader.readAsDataURL(blob)
  })
}

function cleanBody(body) {
  body.querySelectorAll('script, style, nav, header, footer, svg, noscript').forEach(el => el.remove())
}

function extractParagraphs(body) {
  const blockSelector = 'p, blockquote, li, h1, h2, h3, h4, h5, h6, div, section, article'
  const blocks = [...body.querySelectorAll(blockSelector)]
  const paragraphs = []

  for (const el of blocks) {
    if (isImgOnlyBlock(el)) continue
    if (shouldSkipContainer(el, blockSelector)) continue

    for (const part of getElementParagraphs(el)) {
      const text = cleanText(part)
      if (!isMeaningfulText(text)) continue
      paragraphs.push(...splitLongParagraph(text))
    }
  }

  return dedupeAdjacent(paragraphs)
}

function shouldSkipContainer(el, blockSelector) {
  const tag = el.tagName.toLowerCase()
  if (!['div', 'section', 'article', 'blockquote', 'li'].includes(tag)) return false

  const childBlocks = [...el.querySelectorAll(blockSelector)]
    .filter(child => child !== el && isMeaningfulText(cleanText(child.textContent || '')))
  return childBlocks.length > 0
}

function getElementParagraphs(el) {
  const clone = el.cloneNode(true)
  clone.querySelectorAll('script, style, nav, header, footer, svg, noscript').forEach(node => node.remove())

  const brCount = clone.querySelectorAll('br').length
  clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'))

  const raw = clone.textContent || ''
  const normalized = raw
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\f\v]+\n/g, '\n')
    .replace(/\n[ \t\f\v]+/g, '\n')

  const blankLineParts = normalized.split(/\n\s*\n+/).map(cleanText).filter(isMeaningfulText)
  if (blankLineParts.length > 1) return blankLineParts

  const lineParts = normalized.split(/\n+/).map(cleanText).filter(isMeaningfulText)
  if (brCount >= 2 && lineParts.length > 1) return lineParts

  return [normalized]
}

function cleanText(text) {
  return String(text || '')
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, ' ')
    .trim()
}

function isMeaningfulText(text) {
  if (!text) return false
  if (/^[\s\-—–·•*#~＿_.,，。:：;；!！?？'"“”‘’（）()[\]{}<>《》]+$/.test(text)) return false
  return /[\p{L}\p{N}\u4e00-\u9fff]/u.test(text)
}

function isImgOnlyBlock(el) {
  const text = cleanText(el.textContent || '')
  if (isMeaningfulText(text)) return false

  const media = el.querySelector('img, image, svg')
  return Boolean(media)
}

function splitLongParagraph(text, maxLen = 800) {
  const cleaned = cleanText(text)
  if (!cleaned) return []
  if (cleaned.length <= maxLen) return [cleaned]

  const sentences = splitSentences(cleaned)
  if (sentences.length <= 1) return [cleaned]

  const result = []
  let current = ''
  const minLen = Math.floor(maxLen / 2)

  for (const sentence of sentences) {
    if (!current) {
      current = sentence
      continue
    }

    if (current.length + sentence.length > maxLen && current.length >= minLen) {
      result.push(current)
      current = sentence
    } else if (current.length + sentence.length > maxLen) {
      result.push(current)
      current = sentence
    } else {
      current += sentence
    }
  }

  if (current) result.push(current)
  return result
}

function splitSentences(text) {
  const sentences = []
  let current = ''

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    current += ch

    if (isSentenceEnd(ch)) {
      while (i + 1 < text.length && isClosingQuote(text[i + 1])) {
        i++
        current += text[i]
      }
      sentences.push(current)
      current = ''
    }
  }

  if (current) sentences.push(current)
  return sentences
}

function isSentenceEnd(ch) {
  return /[。！？!?]/.test(ch) || ch === '…'
}

function isClosingQuote(ch) {
  return /[」”’》）)]/.test(ch)
}

function dedupeAdjacent(paragraphs) {
  const result = []
  let prev = ''

  for (const paragraph of paragraphs) {
    const text = cleanText(paragraph)
    if (!isMeaningfulText(text)) continue
    if (text === prev) continue
    result.push(text)
    prev = text
  }

  return result
}
