const CHUNK_SIZE = 2.5 * 1024 * 1024
const MAX_ATTEMPTS = 3

export interface ChunkedUploadResult {
  url: string
  pathname: string
  contentType: string
  size: number
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      resolve(dataUrl.split(',')[1] ?? '')
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function postJsonWithRetry(url: string, body: unknown): Promise<Record<string, unknown>> {
  let lastError = 'Falha de rede.'
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (res.ok) return data
      lastError = (data.error as string) || `Erro ${res.status}.`
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Falha de rede.'
    }
    if (attempt < MAX_ATTEMPTS) await sleep(600 * attempt)
  }
  throw new Error(lastError)
}

/**
 * Uploads a file to Vercel Blob by streaming it through our own same-origin API in
 * small chunks, then asking the server to stitch them together. Every request goes
 * to our own domain as a plain JSON POST (base64 text, not a raw binary body) —
 * some antivirus/corporate network filters intercept and block binary file uploads
 * even to legitimate destinations, but a JSON API call reads as ordinary traffic.
 * Each chunk gets a few retries with backoff to ride out transient network blips.
 */
export async function chunkedUpload(
  file: File,
  prefix: 'chat' | 'uploads' | 'avaliacoes',
  onProgress?: (sentBytes: number, totalBytes: number) => void,
): Promise<ChunkedUploadResult> {
  const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE))
  const chunkUrls: string[] = []

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE
    const chunk = file.slice(start, start + CHUNK_SIZE)
    const data = await blobToBase64(chunk)

    let resData: Record<string, unknown>
    try {
      resData = await postJsonWithRetry('/api/chunk-upload', { uploadId, chunkIndex: i, data })
    } catch (err) {
      const detail = err instanceof Error ? err.message : ''
      throw new Error(`Falha ao enviar parte ${i + 1} de ${totalChunks}${detail ? `: ${detail}` : '.'}`)
    }
    if (!resData.url) {
      throw new Error(`Falha ao enviar parte ${i + 1} de ${totalChunks}.`)
    }
    chunkUrls.push(resData.url as string)
    onProgress?.(Math.min(start + chunk.size, file.size), file.size)
  }

  let finishData: Record<string, unknown>
  try {
    finishData = await postJsonWithRetry('/api/chunk-finish', {
      chunkUrls,
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      prefix,
    })
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Falha ao finalizar o envio.')
  }
  if (!finishData.url) {
    throw new Error('Falha ao finalizar o envio.')
  }

  return finishData as unknown as ChunkedUploadResult
}
