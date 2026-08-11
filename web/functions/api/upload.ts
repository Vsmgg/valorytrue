interface Env {
  BLOB_READ_WRITE_TOKEN: string
}

const MAX_SIZE = 15 * 1024 * 1024

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

function sanitizeFilename(raw: string) {
  const decoded = (() => {
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  })()
  const base = decoded.split(/[/\\]/).pop() || 'arquivo'
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'arquivo'
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.BLOB_READ_WRITE_TOKEN) {
    return json({ error: 'BLOB_READ_WRITE_TOKEN não configurado no servidor.' }, 500)
  }

  const contentLength = Number(request.headers.get('content-length') || '0')
  if (contentLength > MAX_SIZE) {
    return json({ error: 'Arquivo maior que 15 MB.' }, 413)
  }

  const filenameHeader = request.headers.get('x-filename') || 'documento'
  const contentType = request.headers.get('content-type') || 'application/octet-stream'
  const filename = sanitizeFilename(filenameHeader)

  const buffer = await request.arrayBuffer()
  if (buffer.byteLength === 0) {
    return json({ error: 'Arquivo vazio.' }, 400)
  }
  if (buffer.byteLength > MAX_SIZE) {
    return json({ error: 'Arquivo maior que 15 MB.' }, 413)
  }

  const pathname = `uploads/${Date.now()}-${filename}`

  try {
    const blobRes = await fetch(`https://blob.vercel-storage.com/${pathname}`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${env.BLOB_READ_WRITE_TOKEN}`,
        'x-api-version': '7',
        'x-vercel-blob-access': 'private',
        'x-content-type': contentType,
        'x-add-random-suffix': '1',
      },
      body: buffer,
    })

    const data = (await blobRes.json()) as { pathname?: string; contentType?: string; error?: { message?: string } }

    if (!blobRes.ok) {
      return json({ error: data.error?.message || 'Falha ao armazenar o arquivo.' }, 502)
    }

    return json({
      pathname: data.pathname || pathname,
      contentType: data.contentType || contentType,
      size: buffer.byteLength,
      uploadedAt: new Date().toISOString(),
    })
  } catch {
    return json({ error: 'Não foi possível conectar ao armazenamento.' }, 502)
  }
}
