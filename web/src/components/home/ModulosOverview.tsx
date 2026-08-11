import { motion } from 'framer-motion'
import { ClipboardCheck, UserCircle2, Layers, Landmark, ArrowRight, Sparkles } from 'lucide-react'
import { SectionHeading } from '@/components/ui/section-heading'
import { navigate } from '@/lib/router'
import { cn } from '@/lib/utils'

const MODULES = [
  {
    icon: ClipboardCheck,
    title: 'Módulo Empresa Avaliadora',
    desc: 'Fluxo de vistoria, análise automática por IA, validação técnica, auditoria e geração de laudo conforme a NBR 14.653.',
    chips: ['Vistoriador', 'IA', 'Analista', 'Auditoria', 'Laudo'],
    live: true,
    path: '/empresa-avaliadora',
  },
  {
    icon: UserCircle2,
    title: 'Módulo AVM Cliente Final',
    desc: 'Estimativa de valor de mercado e liquidez para pessoas físicas, com análise de financiabilidade, simulador de financiamento e orientação de crédito.',
    chips: ['Valor de mercado', 'Liquidez', 'Simulador de financiamento', 'Orientador de crédito'],
    live: true,
    path: '/avm-cliente-final',
  },
  {
    icon: Layers,
    title: 'Módulo Reavaliação de Carteiras',
    desc: 'Processamento em lote de carteiras de bancos, fundos e securitizadoras, com dashboard executivo.',
    chips: ['Upload CSV', 'Geolocalização', 'Clusterização', 'Dashboard executivo'],
    live: true,
    path: '/reavaliacao-carteiras',
  },
  {
    icon: Landmark,
    title: 'Módulo Bancos',
    desc: 'Nosso Motor Central exposto como API real e testável, cálculo automático de LTV e roadmap de integração com bureaus de crédito.',
    chips: ['API real', 'LTV', 'CRIM', 'SISCRED', 'LOS'],
    live: true,
    path: '/bancos',
  },
]

export function ModulosOverview() {
  return (
    <section id="modulos" className="relative py-20 sm:py-28 px-4 sm:px-6 bg-base-soft border-y border-white/5">
      <div className="mx-auto max-w-6xl">
        <SectionHeading
          eyebrow="Módulos"
          title="Quatro módulos, um único motor por trás"
          description="Cada público tem seu próprio fluxo, mas todos consomem o mesmo Motor Central de Inteligência Imobiliária."
        />

        <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-5">
          {MODULES.map((m, i) => (
            <motion.div
              key={m.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.5, delay: i * 0.08 }}
              className={cn(
                'group relative rounded-2xl border p-6 sm:p-7 transition-colors',
                m.live
                  ? 'border-brand-400/30 bg-gradient-to-br from-brand-500/10 to-surface/60 hover:border-brand-400/50'
                  : 'border-white/10 bg-surface/60 hover:border-white/20 hover:bg-surface-hover',
              )}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center justify-center size-11 rounded-xl bg-brand-500/10 text-brand-400">
                  <m.icon className="size-5" />
                </div>
                {m.live && (
                  <span className="flex items-center gap-1 rounded-lg bg-brand-400/10 text-brand-400 text-[11px] font-medium px-2.5 py-1">
                    <Sparkles className="size-3" />
                    Demonstração real
                  </span>
                )}
              </div>
              <h3 className="mt-4 font-display font-semibold text-ink text-[17px]">{m.title}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{m.desc}</p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {m.chips.map((c) => (
                  <span key={c} className="rounded-md bg-white/5 border border-white/8 px-2 py-1 text-[11px] text-faint">
                    {c}
                  </span>
                ))}
              </div>
              {m.live && (
                <button
                  onClick={() => navigate(m.path)}
                  className="mt-5 flex items-center gap-1.5 text-sm font-medium text-brand-400 hover:text-brand-300 transition-colors"
                >
                  Experimentar o fluxo completo
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </button>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

export default ModulosOverview
