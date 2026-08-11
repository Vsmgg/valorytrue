export const config = { runtime: 'edge' }

const MAX_TOTAL_SIZE = 30 * 1024 * 1024

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

function sanitizeFilename(raw: string) {
  const normalized = raw.normalize('NFD').replace(/[̀-ͯ]/g, '')
  const base = normalized.split(/[/\\]/).pop() || 'arquivo'
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').slice(-120) || 'arquivo'
}

export default async function handler(request: Request) {
  if (request.method !== 'POST') {
    return json({ error: 'Método não permitido.' }, 405)
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) {
    return json({ error: 'BLOB_READ_WRITE_TOKEN não configurado no servidor.' }, 500)
  }

  let chunkUrls: string[]
  let filename: string
  let contentType: string
  let prefix: string
  try {
    const body = (await request.json()) as {
      chunkUrls?: string[]
      filename?: string
      contentType?: string
      prefix?: string
    }
    if (!Array.isArray(body.chunkUrls) || body.chunkUrls.length === 0) {
      return json({ error: 'Nenhuma parte recebida.' }, 400)
    }
    chunkUrls = body.chunkUrls
    filename = sanitizeFilename(body.filename || 'arquivo')
    contentType = body.contentType || 'application/octet-stream'
    prefix = body.prefix === 'chat' ? 'chat' : body.prefix === 'avaliacoes' ? 'avaliacoes' : 'uploads'
  } catch {
    return json({ error: 'Corpo da requisição inválido.' }, 400)
  }

  const authHeaders = { authorization: `Bearer ${token}` }
  const parts: Uint8Array[] = []
  let totalSize = 0

  try {
    for (const url of chunkUrls) {
      const res = await fetch(url, { headers: authHeaders })
      if (!res.ok) {
        return json({ error: 'Falha ao reunir as partes do arquivo.' }, 502)
      }
      const buf = await res.arrayBuffer()
      totalSize += buf.byteLength
      if (totalSize > MAX_TOTAL_SIZE) {
        return json({ error: 'Arquivo maior que o permitido.' }, 413)
      }
      parts.push(new Uint8Array(buf))
    }

    const combined = new Uint8Array(totalSize)
    let offset = 0
    for (const part of parts) {
      combined.set(part, offset)
      offset += part.length
    }

    const pathname = `${prefix}/${Date.now()}-${filename}`
    const putRes = await fetch(`https://blob.vercel-storage.com/${pathname}`, {
      method: 'PUT',
      headers: {
        ...authHeaders,
        'x-api-version': '7',
        'x-vercel-blob-access': 'private',
        'x-content-type': contentType,
        'x-add-random-suffix': '1',
      },
      body: combined,
    })
    const putData = (await putRes.json()) as {
      url?: string
      pathname?: string
      contentType?: string
      error?: { message?: string }
    }
    if (!putRes.ok) {
      return json({ error: putData.error?.message || 'Falha ao salvar o arquivo final.' }, 502)
    }

    // Best-effort cleanup of the temporary chunk blobs — awaited so the edge
    // runtime doesn't tear down the request context before it fires.
    await fetch('https://blob.vercel-storage.com/delete', {
      method: 'POST',
      headers: { ...authHeaders, 'x-api-version': '7', 'content-type': 'application/json' },
      body: JSON.stringify({ urls: chunkUrls }),
    }).catch(() => {})

    return json({
      url: putData.url,
      pathname: putData.pathname || pathname,
      contentType: putData.contentType || contentType,
      size: totalSize,
    })
  } catch {
    return json({ error: 'Não foi possível montar o arquivo enviado.' }, 502)
  }
}
