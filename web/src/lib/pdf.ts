const MARGIN = 56
const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2
const BRAND = { r: 47, g: 139, b: 245 }
const INK = { r: 25, g: 28, b: 36 }
const MUTED = { r: 110, g: 118, b: 132 }

function isSectionTitle(line: string) {
  const trimmed = line.trim()
  if (trimmed.length < 3 || trimmed.length > 70) return false
  const letters = trimmed.replace(/[^\p{L}]/gu, '')
  if (letters.length < 3) return false
  return letters === letters.toUpperCase() && /[A-ZÀ-Ú]/.test(letters)
}

const DOC_START = '<<<DOCUMENTO>>>'
const DOC_END = '<<<FIM_DOCUMENTO>>>'

/** Strips the <<<DOCUMENTO>>> markers from text before it's shown in the chat bubble. */
export function stripDocumentMarkers(text: string): string {
  return text.replaceAll(DOC_START, '').replaceAll(DOC_END, '').trim()
}

/**
 * Detects whether a chat message is an actual document (minuta/laudo) rather than
 * a casual reply, and strips any conversational preamble before the document title.
 * Returns null when the message doesn't look like a document at all.
 */
export function extractDocumentText(text: string): { title: string; body: string } | null {
  const startIdx = text.indexOf(DOC_START)
  const endIdx = text.indexOf(DOC_END)
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const inner = text.slice(startIdx + DOC_START.length, endIdx).trim()
    const innerLines = inner.split('\n')
    const title = innerLines[0]?.trim()
    const body = innerLines.slice(1).join('\n').trim()
    if (title && body.length > 50) return { title, body }
  }

  const lines = text.split('\n')
  const candidates: number[] = []

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (!trimmed.startsWith('- ') && !trimmed.startsWith('* ') && isSectionTitle(trimmed) && trimmed.length >= 8) {
      candidates.push(i)
    }
  }

  if (candidates.length === 0) return null

  // Prefer a standalone document title (e.g. "MINUTA DE LAUDO DE AVALIAÇÃO IMOBILIÁRIA"),
  // even if it appears deep in the message after a scenario or reasoning preamble — but
  // skip numbered section headers like "4. GERAÇÃO DA MINUTA DO LAUDO", which merely
  // *mention* the document rather than being its actual title.
  const isNumberedHeading = (line: string) => /^\(?\d+[.)]/.test(line.trim())
  const looksLikeDocTitle = (i: number) => /MINUTA|LAUDO|RELAT[ÓO]RIO|PARECER/i.test(lines[i])

  const titleIndex =
    candidates.find((i) => !isNumberedHeading(lines[i]) && looksLikeDocTitle(i)) ??
    candidates.find((i) => looksLikeDocTitle(i)) ??
    candidates[0]

  const title = lines[titleIndex].trim()
  const body = lines.slice(titleIndex + 1).join('\n').trim()
  if (body.length < 100) return null

  return { title, body }
}

export interface LaudoAttachment {
  label: string
  url: string
}

export interface LaudoAttachments {
  photos?: LaudoAttachment[]
  documents?: LaudoAttachment[]
}

/** Fetches a private blob (photos/documents are uploaded as private) through the
 * authenticated proxy — the browser has no token to read them directly. */
async function fetchAttachment(url: string): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  try {
    const res = await fetch(`/api/blob-proxy?url=${encodeURIComponent(url)}`)
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') || ''
    const bytes = await res.arrayBuffer()
    return { bytes, contentType }
  } catch {
    return null
  }
}

async function bitmapToPngBytes(bitmap: ImageBitmap): Promise<ArrayBuffer> {
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable')
  ctx.drawImage(bitmap, 0, 0)
  const pngBlob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas.toBlob failed'))), 'image/png'),
  )
  return pngBlob.arrayBuffer()
}

/** iPhones default to shooting photos as HEIC, which neither Chrome nor Firefox can
 * decode via createImageBitmap/<img> — only Safari can. heic2any ports libheif to
 * WASM to convert it to PNG client-side first, so vistoria photos taken on an iPhone
 * still make it into the laudo regardless of which browser generates the PDF. */
async function heicToPngBlob(blob: Blob): Promise<Blob> {
  const heic2any = (await import('heic2any')).default
  const converted = await heic2any({ blob, toType: 'image/png' })
  return Array.isArray(converted) ? converted[0] : converted
}

/** Normalizes any image format (webp, jpeg, png, heic/heif from an iPhone, etc.) to PNG
 * bytes via an offscreen canvas, since pdf-lib can only embed JPG or PNG directly. */
async function toPngBytes(bytes: ArrayBuffer, contentType: string): Promise<ArrayBuffer> {
  const blob = new Blob([bytes], { type: contentType || 'image/jpeg' })
  const looksLikeHeic = /hei[cf]/i.test(contentType)

  if (looksLikeHeic) {
    const bitmap = await createImageBitmap(await heicToPngBlob(blob))
    return bitmapToPngBytes(bitmap)
  }

  try {
    const bitmap = await createImageBitmap(blob)
    return await bitmapToPngBytes(bitmap)
  } catch (err) {
    // Some cameras/uploaders leave the content-type as octet-stream/jpeg even for a
    // genuinely HEIC file — if the direct decode failed, try the HEIC path as a
    // last resort before giving up.
    try {
      const bitmap = await createImageBitmap(await heicToPngBlob(blob))
      return await bitmapToPngBytes(bitmap)
    } catch {
      throw err
    }
  }
}

function triggerDownload(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes.slice().buffer], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export async function downloadLaudoPdf(text: string, title = 'Minuta gerada pelo Assistente de IA', attachments?: LaudoAttachments) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  let y = 0
  let page = 1

  const drawHeader = () => {
    doc.setFillColor(BRAND.r, BRAND.g, BRAND.b)
    doc.rect(0, 0, PAGE_WIDTH, 6, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.setTextColor(INK.r, INK.g, INK.b)
    doc.text('ValoryTrue', MARGIN, 48)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(MUTED.r, MUTED.g, MUTED.b)
    doc.text('Plataforma Inteligente para Avaliação Bancária', MARGIN, 62)
    doc.setDrawColor(225, 228, 234)
    doc.line(MARGIN, 74, PAGE_WIDTH - MARGIN, 74)
    y = 100
  }

  const drawFooter = () => {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(MUTED.r, MUTED.g, MUTED.b)
    doc.setDrawColor(225, 228, 234)
    doc.line(MARGIN, PAGE_HEIGHT - 46, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 46)
    doc.text('ValoryTrue', MARGIN, PAGE_HEIGHT - 30)
    doc.text(String(page), PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 30, { align: 'right' })
  }

  const newPage = () => {
    drawFooter()
    doc.addPage()
    page += 1
    drawHeader()
  }

  drawHeader()

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(INK.r, INK.g, INK.b)
  const titleLines = doc.splitTextToSize(title.toUpperCase(), CONTENT_WIDTH)
  doc.text(titleLines, MARGIN, y)
  y += titleLines.length * 15 + 4

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(MUTED.r, MUTED.g, MUTED.b)
  doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, MARGIN, y)
  y += 22

  const bodyFontSize = 10
  const lineHeight = 14
  doc.setFontSize(bodyFontSize)

  const rawLines = text.split('\n')

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim()

    if (!trimmed) {
      y += lineHeight * 0.6
      continue
    }

    const isBullet = trimmed.startsWith('- ') || trimmed.startsWith('* ')
    const content = isBullet ? trimmed.slice(2) : trimmed
    const isTitle = !isBullet && isSectionTitle(trimmed)

    doc.setFont('helvetica', isTitle ? 'bold' : 'normal')
    doc.setFontSize(isTitle ? 11 : bodyFontSize)
    doc.setTextColor(isTitle ? BRAND.r : INK.r, isTitle ? BRAND.g : INK.g, isTitle ? BRAND.b : INK.b)

    const indent = isBullet ? 14 : 0
    const width = CONTENT_WIDTH - indent
    const lines: string[] = doc.splitTextToSize(content, width)

    if (isTitle) y += 6

    for (const line of lines) {
      if (y > PAGE_HEIGHT - MARGIN - 20) newPage()
      if (isBullet && line === lines[0]) {
        doc.text('•', MARGIN, y)
      }
      doc.text(line, MARGIN + indent, y)
      y += lineHeight
    }

    if (isTitle) y += 4
  }

  drawFooter()

  const stamp = new Date().toISOString().slice(0, 10)
  const filename = `minuta-laudo-valorytrue-${stamp}.pdf`

  const photos = attachments?.photos ?? []
  const documents = attachments?.documents ?? []
  if (photos.length === 0 && documents.length === 0) {
    doc.save(filename)
    return
  }

  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const merged = await PDFDocument.load(doc.output('arraybuffer'))
  const bold = await merged.embedFont(StandardFonts.HelveticaBold)
  const regular = await merged.embedFont(StandardFonts.Helvetica)
  const brand = rgb(BRAND.r / 255, BRAND.g / 255, BRAND.b / 255)
  const ink = rgb(INK.r / 255, INK.g / 255, INK.b / 255)

  const addSectionDivider = (sectionTitle: string) => {
    const p = merged.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    p.drawText(sectionTitle, { x: MARGIN, y: PAGE_HEIGHT - 120, size: 16, font: bold, color: brand })
  }

  const addImagePage = async (label: string, bytes: ArrayBuffer, contentType: string) => {
    const png = await toPngBytes(bytes, contentType)
    const image = await merged.embedPng(png)
    const p = merged.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    const maxW = CONTENT_WIDTH
    const maxH = PAGE_HEIGHT - MARGIN * 2 - 30
    const scale = Math.min(maxW / image.width, maxH / image.height, 1)
    const w = image.width * scale
    const h = image.height * scale
    p.drawImage(image, { x: (PAGE_WIDTH - w) / 2, y: PAGE_HEIGHT - MARGIN - h, width: w, height: h })
    p.drawText(label, { x: MARGIN, y: MARGIN - 12, size: 9, font: regular, color: ink })
  }

  // Um anexo que falhe (formato não suportado pelo navegador para decodificar,
  // como HEIC em navegadores não-Safari, ou falha de rede) nunca deve simplesmente
  // desaparecer do laudo em silêncio — sempre deixamos um rastro visível.
  const addFailurePage = (label: string, motivo: string) => {
    const p = merged.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    p.drawText('Anexo não incluído', { x: MARGIN, y: PAGE_HEIGHT - 140, size: 12, font: bold, color: ink })
    p.drawText(label, { x: MARGIN, y: PAGE_HEIGHT - 162, size: 10, font: regular, color: ink })
    p.drawText(motivo, { x: MARGIN, y: PAGE_HEIGHT - 180, size: 9, font: regular, color: rgb(0.6, 0.4, 0.2) })
  }

  if (photos.length > 0) {
    addSectionDivider('RELATÓRIO FOTOGRÁFICO')
    for (const photo of photos) {
      const fetched = await fetchAttachment(photo.url)
      if (!fetched) {
        addFailurePage(photo.label, 'Não foi possível baixar o arquivo do servidor.')
        continue
      }
      try {
        await addImagePage(photo.label, fetched.bytes, fetched.contentType)
      } catch {
        addFailurePage(photo.label, `Formato de imagem não suportado pelo navegador (${fetched.contentType || 'desconhecido'}).`)
      }
    }
  }

  if (documents.length > 0) {
    addSectionDivider('DOCUMENTAÇÃO ANEXADA')
    for (const documento of documents) {
      const fetched = await fetchAttachment(documento.url)
      if (!fetched) {
        addFailurePage(documento.label, 'Não foi possível baixar o arquivo do servidor.')
        continue
      }
      try {
        if (fetched.contentType.includes('pdf')) {
          const srcDoc = await PDFDocument.load(fetched.bytes)
          const copied = await merged.copyPages(srcDoc, srcDoc.getPageIndices())
          copied.forEach((p) => merged.addPage(p))
        } else {
          await addImagePage(documento.label, fetched.bytes, fetched.contentType)
        }
      } catch {
        addFailurePage(documento.label, `Formato de arquivo não suportado pelo navegador (${fetched.contentType || 'desconhecido'}).`)
      }
    }
  }

  triggerDownload(await merged.save(), filename)
}
