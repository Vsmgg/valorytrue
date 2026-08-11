import { motion } from 'framer-motion'
import { CheckCircle2 } from 'lucide-react'
import { SectionHeading } from '@/components/ui/section-heading'

const ITEMS = [
  'Análise automática de matrícula, IPTU, certidões e zoneamento.',
  'Identificação de áreas divergentes entre vistoria e documentação.',
  'Detecção de trincas, infiltrações e patologias por visão computacional.',
  'Seleção automática de comparáveis de mercado.',
  'Cálculo automatizado do valor de mercado e liquidez.',
  'Classificação de financiabilidade do imóvel.',
  'Auditoria completa das aprovações realizadas.',
  'Geração de laudos aderentes à ABNT NBR 14.653.',
  'Integração via API para bancos, fundos e sistemas terceiros.',
]

export function Funcionalidades() {
  return (
    <section id="funcionalidades" className="relative py-20 sm:py-28 px-4 sm:px-6 bg-base-soft border-y border-white/5">
      <div className="mx-auto max-w-4xl">
        <SectionHeading eyebrow="Funcionalidades" title="Funcionalidades principais" />

        <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {ITEMS.map((item, i) => (
            <motion.div
              key={item}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: 0.4, delay: (i % 5) * 0.06 }}
              className="flex items-start gap-3 rounded-xl border border-white/8 bg-surface/50 px-4 py-3.5"
            >
              <CheckCircle2 className="size-4.5 text-brand-400 shrink-0 mt-0.5" />
              <span className="text-[13.5px] text-ink/90 leading-relaxed">{item}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

export default Funcionalidades
