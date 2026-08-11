import { navigate } from '@/lib/router'

const LINKS = [
  { href: '#motor-central', label: 'Motor Central' },
  { href: '#modulos', label: 'Módulos' },
  { href: '#iqg', label: 'IQG' },
  { href: '#funcionalidades', label: 'Funcionalidades' },
  { href: '#modalidades', label: 'Entrega' },
]

export function Footer() {
  const go = (href: string) => document.querySelector(href)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <footer className="relative border-t border-white/8 bg-base-soft px-4 sm:px-6 py-12">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col sm:flex-row items-center sm:items-start justify-between gap-8">
          <div className="flex flex-col items-center sm:items-start gap-3">
            <div className="flex items-center gap-2.5">
              <img src="/logo.png" alt="ValoryTrue" className="size-9 object-contain" />
              <span className="font-display font-semibold text-[15px] text-ink">
                Valory <span className="text-muted font-normal">True</span>
              </span>
            </div>
            <p className="text-xs text-faint max-w-xs text-center sm:text-left leading-relaxed">
              A evolução da avaliação imobiliária — Motor Central, módulo Empresa Avaliadora, AVM, reavaliação de carteiras e bancos.
            </p>
          </div>

          <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            {LINKS.map((l) => (
              <button key={l.href} onClick={() => go(l.href)} className="text-xs text-muted hover:text-ink transition-colors">
                {l.label}
              </button>
            ))}
            <button onClick={() => navigate('/empresa-avaliadora')} className="text-xs text-brand-400 hover:text-brand-300 transition-colors">
              Empresa Avaliadora
            </button>
          </nav>
        </div>

        <div className="mt-10 pt-6 border-t border-white/8 flex items-center justify-center">
          <p className="text-[11px] text-faint">© {new Date().getFullYear()} ValoryTrue. Documento de especificação funcional.</p>
        </div>
      </div>
    </footer>
  )
}

export default Footer
