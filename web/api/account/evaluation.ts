import { getDb } from '../_lib/db.js'
import { getUserFromRequest } from '../_lib/auth.js'

export const config = { runtime: 'edge' }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

interface EvaluationRow {
  id: number
  module: string
  resumo: string | null
  valor_estimado: string | null
  resultado_json: unknown
  created_at: string
}

/** Devolve o detalhe COMPLETO (resultado_json inteiro) de uma avaliação específica do
 * histórico — separado de api/account/history.ts (que só lista campos resumidos, pra não
 * carregar o JSON inteiro de até 100 avaliações de uma vez só à toa). Checa "user_id" na
 * própria query (não só depois) — garante que um usuário nunca acessa o detalhe de uma
 * avaliação de outra conta só adivinhando o id na URL. */
export default async function handler(request: Request) {
  if (request.method !== 'GET') {
    return json({ error: 'Método não permitido.' }, 405)
  }

  const user = await getUserFromRequest(request)
  if (!user) {
    return json({ error: 'Faça login para ver esta avaliação.' }, 401)
  }

  const id = Number(new URL(request.url).searchParams.get('id'))
  if (!Number.isInteger(id) || id <= 0) {
    return json({ error: 'Id inválido.' }, 400)
  }

  const sql = getDb()
  const rows = (await sql`
    SELECT id, module, resumo, valor_estimado, resultado_json, created_at
    FROM evaluation_log
    WHERE id = ${id} AND user_id = ${user.id}
  `) as EvaluationRow[]

  const row = rows[0]
  if (!row) {
    return json({ error: 'Avaliação não encontrada.' }, 404)
  }

  return json({
    evaluation: {
      id: row.id,
      module: row.module,
      resumo: row.resumo,
      valorEstimado: row.valor_estimado !== null ? Number(row.valor_estimado) : null,
      resultado: row.resultado_json,
      createdAt: row.created_at,
    },
  })
}
