import { getDb } from '../_lib/db.js'
import { getUserFromRequest } from '../_lib/auth.js'

export const config = { runtime: 'edge' }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/** Idempotent, admin-only schema migration — safe to call more than once. */
export default async function handler(request: Request) {
  if (request.method !== 'POST') {
    return json({ error: 'Método não permitido.' }, 405)
  }

  const user = await getUserFromRequest(request)
  if (!user || !user.isAdmin) {
    return json({ error: 'Acesso negado.' }, 403)
  }

  const sql = getDb()
  await sql`ALTER TABLE evaluation_log ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now()`
  await sql`ALTER TABLE evaluation_log ADD COLUMN IF NOT EXISTS resumo TEXT`
  await sql`ALTER TABLE evaluation_log ADD COLUMN IF NOT EXISTS valor_estimado NUMERIC`
  await sql`ALTER TABLE evaluation_log ADD COLUMN IF NOT EXISTS resultado_json JSONB`

  return json({ ok: true })
}
