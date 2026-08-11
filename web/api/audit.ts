export const config = { runtime: 'edge' }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

async function handlePost(request: Request, token: string) {
  let caseId = ''
  let action = ''
  let changes: unknown = null
  try {
    const body = (await request.json()) as { caseId?: string; action?: string; changes?: unknown }
    caseId = (body.caseId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80)
    action = body.action === 'aprovado' || body.action === 'ajustado' ? body.action : ''
    changes = body.changes ?? null
  } catch {
    return json({ error: 'Corpo da requisição inválido.' }, 400)
  }

  if (!caseId || !action) {
    return json({ error: 'Dados de auditoria inválidos.' }, 400)
  }

  const at = new Date().toISOString()
  const pathname = `audit/${caseId}/${Date.now()}-${action}.json`

  try {
    const res = await fetch(`https://blob.vercel-storage.com/${pathname}`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`,
        'x-api-version': '7',
        'x-vercel-blob-access': 'private',
        'x-content-type': 'application/json',
      },
      body: JSON.stringify({ caseId, action, changes, at }),
    })
    if (!res.ok) {
      return json({ error: 'Falha ao registrar evento de auditoria.' }, 502)
    }
    return json({ ok: true, action, at })
  } catch {
    return json({ error: 'Não foi possível conectar ao armazenamento.' }, 502)
  }
}

async function handleGet(request: Request, token: string) {
  const url = new URL(request.url)
  const caseId = (url.searchParams.get('caseId') || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80)
  if (!caseId) {
    return json({ error: 'caseId não informado.' }, 400)
  }

  try {
    const res = await fetch(`https://blob.vercel-storage.com?prefix=audit/${caseId}/&limit=100`, {
      headers: { authorization: `Bearer ${token}`, 'x-api-version': '7' },
    })
    if (!res.ok) {
      return json({ error: 'Falha ao consultar auditoria.' }, 502)
    }
    const data = (await res.json()) as { blobs?: { url: string; pathname: string }[] }
    const entries: { action: string; at: string }[] = []
    for (const blob of data.blobs || []) {
      const name = blob.pathname.split('/').pop() || ''
      const match = name.match(/^(\d+)-(aprovado|ajustado)\.json$/)
      if (match) {
        entries.push({ action: match[2], at: new Date(Number(match[1])).toISOString() })
      }
    }
    entries.sort((a, b) => a.at.localeCompare(b.at))
    return json({ entries })
  } catch {
    return json({ error: 'Não foi possível conectar ao armazenamento.' }, 502)
  }
}

export default async function handler(request: Request) {
  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) {
    return json({ error: 'BLOB_READ_WRITE_TOKEN não configurado no servidor.' }, 500)
  }
  if (request.method === 'POST') return handlePost(request, token)
  if (request.method === 'GET') return handleGet(request, token)
  return json({ error: 'Método não permitido.' }, 405)
}
