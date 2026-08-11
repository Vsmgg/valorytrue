import { getDb } from './db.js'

const encoder = new TextEncoder()
const SESSION_COOKIE = 'realva_session'
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(str: string): Uint8Array<ArrayBuffer> {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(str.length + ((4 - (str.length % 4)) % 4), '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** PBKDF2-SHA256, 100k iterations, random per-user salt — Web Crypto is native to the
 * Edge runtime, unlike bcrypt which needs a Node.js native binding. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, keyMaterial, 256)
  return `${base64UrlEncode(salt)}.${base64UrlEncode(new Uint8Array(bits))}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltB64, hashB64] = stored.split('.')
  if (!saltB64 || !hashB64) return false
  const salt = base64UrlDecode(saltB64)
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, keyMaterial, 256)
  const computed = base64UrlEncode(new Uint8Array(bits))
  if (computed.length !== hashB64.length) return false
  let diff = 0
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ hashB64.charCodeAt(i)
  return diff === 0
}

interface SessionPayload {
  userId: number
  isAdmin: boolean
  exp: number
}

async function getHmacKey() {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET não configurado no servidor.')
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

async function createSessionToken(payload: SessionPayload): Promise<string> {
  const key = await getHmacKey()
  const payloadB64 = base64UrlEncode(encoder.encode(JSON.stringify(payload)))
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadB64))
  return `${payloadB64}.${base64UrlEncode(new Uint8Array(sig))}`
}

async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  const [payloadB64, sigB64] = token.split('.')
  if (!payloadB64 || !sigB64) return null
  try {
    const key = await getHmacKey()
    const valid = await crypto.subtle.verify('HMAC', key, base64UrlDecode(sigB64), encoder.encode(payloadB64))
    if (!valid) return null
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64))) as SessionPayload
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

export function buildSessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`
}

export function buildClearCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
}

export async function createSessionCookie(userId: number, isAdmin: boolean): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  const token = await createSessionToken({ userId, isAdmin, exp })
  return buildSessionCookie(token)
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    const k = part.slice(0, idx).trim()
    const v = part.slice(idx + 1).trim()
    if (k) out[k] = decodeURIComponent(v)
  }
  return out
}

export interface AuthUser {
  id: number
  email: string
  isAdmin: boolean
  evaluationsUsed: number
  evaluationsLimit: number
}

interface UserRow {
  id: number
  email: string
  is_admin: boolean
  evaluations_used: number
  evaluations_limit: number
}

function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    isAdmin: row.is_admin,
    evaluationsUsed: row.evaluations_used,
    evaluationsLimit: row.evaluations_limit,
  }
}

export async function getUserFromRequest(request: Request): Promise<AuthUser | null> {
  const cookies = parseCookies(request.headers.get('cookie'))
  const token = cookies['realva_session']
  if (!token) return null
  const payload = await verifySessionToken(token)
  if (!payload) return null
  const sql = getDb()
  const rows = (await sql`SELECT id, email, is_admin, evaluations_used, evaluations_limit FROM users WHERE id = ${payload.userId}`) as UserRow[]
  const row = rows[0]
  return row ? toAuthUser(row) : null
}

export interface EvaluationMeta {
  resumo?: string
  valorEstimado?: number
  resultadoJson?: unknown
}

export async function incrementEvaluationUsage(userId: number, module: string, meta: EvaluationMeta = {}): Promise<void> {
  const sql = getDb()
  await sql`UPDATE users SET evaluations_used = evaluations_used + 1 WHERE id = ${userId}`
  await sql`
    INSERT INTO evaluation_log (user_id, module, resumo, valor_estimado, resultado_json)
    VALUES (
      ${userId},
      ${module},
      ${meta.resumo ?? null},
      ${meta.valorEstimado ?? null},
      ${meta.resultadoJson != null ? JSON.stringify(meta.resultadoJson) : null}
    )
  `
}

export { toAuthUser }
export type { UserRow }
