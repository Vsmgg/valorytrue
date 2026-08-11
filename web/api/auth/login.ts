export const config = { runtime: 'edge' }

import { getDb } from '../_lib/db'
import { verifyPassword, createSessionCookie, toAuthUser, type UserRow } from '../_lib/auth'

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extraHeaders },
  })
}

export default async function handler(request: Request) {
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)

  let email: string
  let password: string
  try {
    const body = (await request.json()) as { email?: string; password?: string }
    email = (body.email || '').trim().toLowerCase()
    password = body.password || ''
  } catch {
    return json({ error: 'Corpo da requisição inválido.' }, 400)
  }
  if (!email || !password) {
    return json({ error: 'Informe e-mail e senha.' }, 400)
  }

  try {
    const sql = getDb()
    const rows = (await sql`
      SELECT id, email, password_hash, is_admin, evaluations_used, evaluations_limit
      FROM users WHERE email = ${email}
    `) as (UserRow & { password_hash: string })[]
    const row = rows[0]
    if (!row || !(await verifyPassword(password, row.password_hash))) {
      return json({ error: 'E-mail ou senha incorretos.' }, 401)
    }

    const user = toAuthUser(row)
    const cookie = await createSessionCookie(user.id, user.isAdmin)
    return json({ user }, 200, { 'set-cookie': cookie })
  } catch {
    return json({ error: 'Não foi possível entrar. Tente novamente.' }, 502)
  }
}
