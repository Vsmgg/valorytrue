export const config = { runtime: 'edge' }

import { getDb } from '../_lib/db'
import { hashPassword, createSessionCookie, toAuthUser, type UserRow } from '../_lib/auth'

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

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'Informe um e-mail válido.' }, 400)
  }
  if (password.length < 6) {
    return json({ error: 'A senha precisa ter pelo menos 6 caracteres.' }, 400)
  }

  try {
    const sql = getDb()
    const existing = await sql`SELECT id FROM users WHERE email = ${email}`
    if (existing.length > 0) {
      return json({ error: 'Já existe uma conta com este e-mail.' }, 409)
    }

    const passwordHash = await hashPassword(password)
    const inserted = (await sql`
      INSERT INTO users (email, password_hash)
      VALUES (${email}, ${passwordHash})
      RETURNING id, email, is_admin, evaluations_used, evaluations_limit
    `) as UserRow[]
    const user = toAuthUser(inserted[0])
    const cookie = await createSessionCookie(user.id, user.isAdmin)
    return json({ user }, 200, { 'set-cookie': cookie })
  } catch {
    return json({ error: 'Não foi possível criar a conta. Tente novamente.' }, 502)
  }
}
