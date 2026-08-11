export const config = { runtime: 'edge' }

const MAX_CHUNK_B64_LEN = 6 * 1024 * 1024

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export default async function handler(request: Request) {
  if (request.method !== 'POST') {
    return json({ error: 'Método não permitido.' }, 405)
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) {
    return json({ error: 'BLOB_READ_WRITE_TOKEN não configurado no servidor.' }, 500)
  }

  let uploadId = ''
  let chunkIndex = -1
  let data = ''
  try {
    const body = (await request.json()) as { uploadId?: string; chunkIndex?: number; data?: string }
    uploadId = (body.uploadId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80)
    chunkIndex = Number(body.chunkIndex)
    data = body.data || ''
  } catch {
    return json({ error: 'Corpo da requisição inválido.' }, 400)
  }

  if (!uploadId || !Number.isInteger(chunkIndex) || chunkIndex < 0) {
    return json({ error: 'Dados de upload inválidos.' }, 400)
  }
  if (!data) {
    return json({ error: 'Parte vazia.' }, 400)
  }
  if (data.length > MAX_CHUNK_B64_LEN) {
    return json({ error: 'Parte maior que o permitido.' }, 413)
  }

  let bytes: Uint8Array
  try {
    bytes = base64ToBytes(data)
  } catch {
    return json({ error: 'Conteúdo da parte corrompido.' }, 400)
  }

  const pathname = `chunks/${uploadId}/${String(chunkIndex).padStart(6, '0')}`

  try {
    const res = await fetch(`https://blob.vercel-storage.com/${pathname}`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`,
        'x-api-version': '7',
        'x-vercel-blob-access': 'private',
        'x-content-type': 'application/octet-stream',
      },
      body: bytes,
    })
    const resData = (await res.json()) as { url?: string; error?: { message?: string } }
    if (!res.ok) {
      return json({ error: resData.error?.message || 'Falha ao armazenar a parte do arquivo.' }, 502)
    }
    return json({ url: resData.url })
  } catch {
    return json({ error: 'Não foi possível conectar ao armazenamento.' }, 502)
  }
}
