interface Env {
  BLOB_READ_WRITE_TOKEN: string
}

const TYPES = ['aprovado', 'mudanca', 'refazer'] as const
type StatType = (typeof TYPES)[number]

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.BLOB_READ_WRITE_TOKEN) {
    return json({ error: 'BLOB_READ_WRITE_TOKEN não configurado no servidor.' }, 500)
  }

  let type: StatType
  try {
    const body = (await request.json()) as { type?: string }
    if (!body.type || !TYPES.includes(body.type as StatType)) {
      return json({ error: 'Tipo de evento inválido.' }, 400)
    }
    type = body.type as StatType
  } catch {
    return json({ error: 'Corpo da requisição inválido.' }, 400)
  }

  const pathname = `stats/${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`

  try {
    const res = await fetch(`https://blob.vercel-storage.com/${pathname}`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${env.BLOB_READ_WRITE_TOKEN}`,
        'x-api-version': '7',
        'x-vercel-blob-access': 'private',
        'x-content-type': 'application/json',
      },
      body: JSON.stringify({ type, at: new Date().toISOString() }),
    })
    if (!res.ok) {
      return json({ error: 'Falha ao registrar evento.' }, 502)
    }
    return json({ ok: true })
  } catch {
    return json({ error: 'Não foi possível conectar ao armazenamento.' }, 502)
  }
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  if (!env.BLOB_READ_WRITE_TOKEN) {
    return json({ error: 'BLOB_READ_WRITE_TOKEN não configurado no servidor.' }, 500)
  }

  try {
    const res = await fetch('https://blob.vercel-storage.com?prefix=stats/&limit=1000', {
      headers: {
        authorization: `Bearer ${env.BLOB_READ_WRITE_TOKEN}`,
        'x-api-version': '7',
      },
    })
    if (!res.ok) {
      return json({ error: 'Falha ao consultar estatísticas.' }, 502)
    }
    const data = (await res.json()) as { blobs?: { pathname: string }[] }
    const counts: Record<StatType, number> = { aprovado: 0, mudanca: 0, refazer: 0 }
    for (const blob of data.blobs || []) {
      const name = blob.pathname.replace(/^stats\//, '')
      for (const t of TYPES) {
        if (name.startsWith(`${t}-`)) counts[t]++
      }
    }
    const total = counts.aprovado + counts.mudanca + counts.refazer
    return json({ ...counts, total })
  } catch {
    return json({ error: 'Não foi possível conectar ao armazenamento.' }, 502)
  }
}
