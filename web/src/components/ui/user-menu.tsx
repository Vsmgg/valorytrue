import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, UserRound, LogOut } from 'lucide-react'
import { navigate } from '@/lib/router'
import type { AuthUser } from '@/lib/auth-context'

export function UserMenu({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 pl-1.5 pr-2 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-ink transition-colors"
      >
        <span className="flex items-center justify-center size-6 rounded-md bg-brand-500/20 text-brand-300 text-[11px] font-semibold uppercase">
          {user.email.slice(0, 1)}
        </span>
        <ChevronDown className={`size-3.5 text-faint transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 mt-2 w-56 rounded-xl border border-white/10 bg-surface shadow-xl shadow-black/40 overflow-hidden z-50"
          >
            <div className="px-3.5 py-3 border-b border-white/8">
              <p className="text-[13px] text-ink truncate">{user.email}</p>
              <p className="mt-0.5 text-[11.5px] text-faint">{user.evaluationsUsed}/{user.evaluationsLimit} avaliações usadas</p>
            </div>
            <button
              onClick={() => { setOpen(false); navigate('/minha-conta') }}
              className="flex w-full items-center gap-2 px-3.5 py-2.5 text-[13px] text-muted hover:text-ink hover:bg-white/5 transition-colors"
            >
              <UserRound className="size-4" /> Minha Conta
            </button>
            <button
              onClick={() => { setOpen(false); onLogout() }}
              className="flex w-full items-center gap-2 px-3.5 py-2.5 text-[13px] text-muted hover:text-ink hover:bg-white/5 transition-colors"
            >
              <LogOut className="size-4" /> Sair
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default UserMenu
