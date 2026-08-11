import { getUserFromRequest } from './_lib/auth.js'

export const config = { runtime: 'edge' }

/**
 * Uploaded photos/documents are stored as private Vercel Blobs (`x-vercel-blob-access:
 * 'private'` in chunk-finish.ts) — the browser has no token to fetch them directly, only
 * this server does. This lets an authenticated client (the PDF generator) read them back
 * without ever exposing BLOB_READ_WRITE_TOKEN.
 */
export default async function handler(request: Request) {
  const user = await getUserFromRequest(request)
  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  const blobUrl = new URL(request.url).searchParams.get('url')
  if (!blobUrl) {
    return new Response('Missing url', { status: 400 })
  }

  let parsed: URL
  try {
    parsed = new URL(blobUrl)
  } catch {
    return new Response('Invalid url', { status: 400 })
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.vercel-storage.com')) {
    return new Response('Invalid url', { status: 400 })
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN
  const res = await fetch(blobUrl, { headers: token ? { authorization: `Bearer ${token}` } : {} })
  if (!res.ok) {
    return new Response('Not found', { status: 404 })
  }

  const buf = await res.arrayBuffer()
  return new Response(buf, {
    headers: { 'content-type': res.headers.get('content-type') || 'application/octet-stream' },
  })
}
