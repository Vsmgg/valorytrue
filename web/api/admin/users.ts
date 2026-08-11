export const config = { runtime: 'edge' }

import { getDb } from '../_lib/db'
import { getUserFromRequest } from '../_lib/auth'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

interface UserListRow {
  id: number
  email: string
  is_admin: boolean
  evaluations_used: number
  evaluations_limit: number
  created_at: string
}

async function handleGet() {
  const sql = getDb()
  const rows = (await sql`
    SELECT id, email, is_admin, evaluations_used, evaluations_limit, created_at
    FROM users ORDER BY created_at DESC
  `) as UserListRow[]
  const totalEvaluations = await sql`SELECT count(*)::int AS count FROM evaluation_log`
  return json({
    users: rows.map((r) => ({
      id: r.id,
      email: r.email,
      isAdmin: r.is_admin,
      evaluationsUsed: r.evaluations_used,
      evaluationsLimit: r.evaluations_limit,
      createdAt: r.created_at,
    })),
    stats: {
      totalUsers: rows.length,
      totalEvaluations: (totalEvaluations[0] as { count: number }).count,
    },
  })
}

async function handlePatch(request: Request) {
  let userId: number
  let evaluationsLimit: number | undefined
  let isAdmin: boolean | undefined
  try {
    const body = (await request.json()) as { userId?: number; evaluationsLimit?: number; isAdmin?: boolean }
    if (typeof body.userId !== 'number') return json({ error: 'userId inválido.' }, 400)
    userId = body.userId
    evaluationsLimit = typeof body.evaluationsLimit === 'number' ? body.evaluationsLimit : undefined
    isAdmin = typeof body.isAdmin === 'boolean' ? body.isAdmin : undefined
  } catch {
    return json({ error: 'Corpo da requisição inválido.' }, 400)
  }

  if (evaluationsLimit === undefined && isAdmin === undefined) {
    return json({ error: 'Nada para atualizar.' }, 400)
  }

  const sql = getDb()
  if (evaluationsLimit !== undefined) {
    await sql`UPDATE users SET evaluations_limit = ${evaluationsLimit} WHERE id = ${userId}`
  }
  if (isAdmin !== undefined) {
    await sql`UPDATE users SET is_admin = ${isAdmin} WHERE id = ${userId}`
  }
  return json({ ok: true })
}

export default async function handler(request: Request) {
  const user = await getUserFromRequest(request)
  if (!user) return json({ error: 'Faça login.' }, 401)
  if (!user.isAdmin) return json({ error: 'Acesso restrito ao administrador.' }, 403)

  if (request.method === 'GET') return handleGet()
  if (request.method === 'PATCH') return handlePatch(request)
  return json({ error: 'Método não permitido.' }, 405)
}
