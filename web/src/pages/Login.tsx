import { useState } from 'react'
import { ArrowLeft, AlertTriangle, Loader2 } from 'lucide-react'
import { navigate } from '@/lib/router'
import { useAuth } from '@/lib/auth-context'

export function Login() {
  const { login, register } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!email || !password) return
    setSubmitting(true)
    setError(null)
    const result = mode === 'login' ? await login(email, password) : await register(email, password)
    setSubmitting(false)
    if (result) {
      setError(result)
      return
    }
    navigate('/')
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 sm:px-6 py-14">
      <div className="w-full max-w-sm">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-1.5 text-[13px] text-faint hover:text-ink mb-8 transition-colors"
        >
          <ArrowLeft className="size-3.5" /> Voltar para a home
        </button>

        <div className="rounded-2xl border border-white/10 bg-surface/60 p-6 sm:p-7">
          <h1 className="font-display text-xl font-semibold text-ink">
            {mode === 'login' ? 'Entrar' : 'Criar conta'}
          </h1>
          <p className="mt-1.5 text-[13px] text-muted">
            {mode === 'login'
              ? 'Entre para usar os módulos da plataforma.'
              : 'Crie sua conta e faça até 5 avaliações gratuitas.'}
          </p>

          <div className="mt-6 space-y-4">
            <label className="block">
              <span className="text-[12px] font-medium text-muted">E-mail</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                placeholder="voce@email.com"
                className="mt-1.5 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[13.5px] text-ink placeholder-faint focus:outline-none focus:border-brand-400/50"
              />
            </label>
            <label className="block">
              <span className="text-[12px] font-medium text-muted">Senha</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                placeholder="••••••••"
                className="mt-1.5 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[13.5px] text-ink placeholder-faint focus:outline-none focus:border-brand-400/50"
              />
            </label>

            {error && (
              <div className="flex items-center gap-2 text-[12.5px] text-red-400">
                <AlertTriangle className="size-3.5 shrink-0" /> {error}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={submitting || !email || !password}
              className="flex w-full items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-500 text-white transition-all disabled:opacity-40 active:scale-95"
            >
              {submitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : mode === 'login' ? (
                'Entrar'
              ) : (
                'Criar conta'
              )}
            </button>
          </div>

          <button
            onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null) }}
            className="mt-5 w-full text-center text-[12.5px] text-brand-400 hover:text-brand-300"
          >
            {mode === 'login' ? 'Não tem conta? Criar uma agora' : 'Já tem conta? Entrar'}
          </button>
        </div>
      </div>
    </main>
  )
}

export default Login
