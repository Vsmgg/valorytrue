import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Menu, X, ArrowUpRight, LogOut, Cpu, LayoutGrid, Gauge, Sparkles, PackageCheck, Handshake } from 'lucide-react'
import { navigate } from '@/lib/router'
import { useAuth } from '@/lib/auth-context'
import { SectionDock } from '@/components/ui/section-dock'
import { UserMenu } from '@/components/ui/user-menu'

const LINKS = [
  { href: '#motor-central', label: 'Motor Central', icon: Cpu },
  { href: '#modulos', label: 'Módulos', icon: LayoutGrid },
  { href: '#iqg', label: 'IQG', icon: Gauge },
  { href: '#funcionalidades', label: 'Funcionalidades', icon: Sparkles },
  { href: '#modalidades', label: 'Entrega', icon: PackageCheck },
  { href: '#parceiros', label: 'Parceiros', icon: Handshake },
]

export function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const { user, logout } = useAuth()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const go = (href: string) => {
    setOpen(false)
    document.querySelector(href)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <header
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
        scrolled ? 'bg-base/80 backdrop-blur-xl border-b border-white/8' : 'bg-transparent border-b border-transparent'
      }`}
    >
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 h-16 flex items-center justify-between">
        <a href="#top" onClick={(e) => { e.preventDefault(); go('#top') }} className="flex items-center gap-2.5 shrink-0">
          <img src="/logo.png" alt="ValoryTrue" className="size-9 object-contain" />
          <span className="font-display font-semibold text-[15px] text-ink tracking-tight">
            Valory <span className="text-muted font-normal">True</span>
          </span>
        </a>

        <div className="hidden lg:block absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <SectionDock items={LINKS} onSelect={go} />
        </div>

        <div className="hidden lg:flex items-center gap-3">
          {user?.isAdmin && (
            <button
              onClick={() => navigate('/admin')}
              className="px-3.5 py-2 rounded-lg text-[13px] font-medium text-muted hover:text-ink hover:bg-white/5 transition-colors"
            >
              Admin
            </button>
          )}
          <button
            onClick={() => navigate('/empresa-avaliadora')}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13.5px] font-medium bg-brand-600 hover:bg-brand-500 text-white transition-colors shadow-[0_0_20px_rgba(22,63,158,0.35)]"
          >
            Testar módulo Empresa Avaliadora
            <ArrowUpRight className="size-3.5" />
          </button>
          {user ? (
            <UserMenu user={user} onLogout={logout} />
          ) : (
            <button
              onClick={() => navigate('/login')}
              className="px-4 py-2 rounded-lg text-[13.5px] font-medium text-muted hover:text-ink hover:bg-white/5 transition-colors"
            >
              Entrar
            </button>
          )}
        </div>

        <button
          onClick={() => setOpen((v) => !v)}
          className="lg:hidden flex items-center justify-center size-9 rounded-lg text-ink hover:bg-white/5"
          aria-label="Abrir menu"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="lg:hidden overflow-hidden bg-base/95 backdrop-blur-xl border-b border-white/8"
          >
            <div className="px-4 py-3 flex flex-col gap-1">
              {LINKS.map((l) => (
                <button
                  key={l.href}
                  onClick={() => go(l.href)}
                  className="text-left px-3 py-2.5 rounded-lg text-[15px] text-muted hover:text-ink hover:bg-white/5"
                >
                  {l.label}
                </button>
              ))}
              <button
                onClick={() => { setOpen(false); navigate('/empresa-avaliadora') }}
                className="mt-2 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-medium bg-brand-600 text-white"
              >
                Testar módulo Empresa Avaliadora
                <ArrowUpRight className="size-3.5" />
              </button>
              {user ? (
                <>
                  <button
                    onClick={() => { setOpen(false); navigate('/minha-conta') }}
                    className="mt-2 text-left px-3 py-2.5 rounded-lg text-[15px] text-muted hover:text-ink hover:bg-white/5"
                  >
                    Minha Conta ({user.evaluationsUsed}/{user.evaluationsLimit})
                  </button>
                  <button
                    onClick={() => { setOpen(false); logout() }}
                    className="mt-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-medium bg-white/5 text-ink"
                  >
                    <LogOut className="size-3.5" /> Sair
                  </button>
                </>
              ) : (
                <button
                  onClick={() => { setOpen(false); navigate('/login') }}
                  className="mt-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-medium bg-white/5 text-ink"
                >
                  Entrar
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  )
}

export default Navbar
