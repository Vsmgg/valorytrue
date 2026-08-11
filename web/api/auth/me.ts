export const config = { runtime: 'edge' }

import { getUserFromRequest } from '../_lib/auth'

export default async function handler(request: Request) {
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Método não permitido.' }), { status: 405 })
  }
  const user = await getUserFromRequest(request)
  return new Response(JSON.stringify({ user }), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}
