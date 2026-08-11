import { getDb } from '../_lib/db.js'
import { getUserFromRequest } from '../_lib/auth.js'

export const config = { runtime: 'edge' }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

interface HistoryRow {
  id: number
  module: string
  resumo: string | null
  valor_estimado: string | null
  created_at: string
}

export default async function handler(request: Request) {
  if (request.method !== 'GET') {
    return json({ error: 'Método não permitido.' }, 405)
  }

  const user = await getUserFromRequest(request)
  if (!user) {
    return json({ error: 'Faça login para ver seu histórico.' }, 401)
  }

  const sql = getDb()
  const rows = (await sql`
    SELECT id, module, resumo, valor_estimado, created_at
    FROM evaluation_log
    WHERE user_id = ${user.id}
    ORDER BY created_at DESC NULLS LAST, id DESC
    LIMIT 100
  `) as HistoryRow[]

  const history = rows.map((r) => ({
    id: r.id,
    module: r.module,
    resumo: r.resumo,
    valorEstimado: r.valor_estimado !== null ? Number(r.valor_estimado) : null,
    createdAt: r.created_at,
  }))

  return json({ user, history })
}
