import { motion } from 'framer-motion'
import { Gauge } from 'lucide-react'
import { SectionHeading } from '@/components/ui/section-heading'
import { IqgGauge } from '@/components/ui/iqg-gauge'

const FATORES = [
  'Liquidez', 'Conservação', 'Localização', 'Risco jurídico', 'Risco ambiental', 'Risco documental', 'Potencial de valorização',
]

const EXEMPLOS = [
  { score: 92, label: 'Garantia Premium', desc: 'Alta liquidez, boa conservação, localização consolidada, sem pendências.' },
  { score: 55, label: 'Garantia com atenção', desc: 'Ponto de atenção identificado — ainda financiável, com ressalvas.' },
  { score: 28, label: 'Garantia inadequada', desc: 'Riscos relevantes acumulados — recomenda-se cautela na concessão.' },
]

export function IQGSection() {
  return (
    <section id="iqg" className="relative py-20 sm:py-28 px-4 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <SectionHeading
          eyebrow="Diferencial"
          title="Índice de Qualidade da Garantia (IQG)"
          description="Um score de 0 a 100, calculado pelo Motor Central, que resume o quão sólida uma garantia imobiliária realmente é — o principal diferencial competitivo da plataforma."
        />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mt-10 flex flex-wrap justify-center gap-2"
        >
          <span className="flex items-center gap-1.5 text-xs text-faint mr-1 mt-1.5">
            <Gauge className="size-3.5" /> Fatores considerados:
          </span>
          {FATORES.map((f) => (
            <span key={f} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs text-muted">
              {f}
            </span>
          ))}
        </motion.div>

        <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-6">
          {EXEMPLOS.map((ex, i) => (
            <motion.div
              key={ex.score}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="flex flex-col items-center rounded-2xl border border-white/10 bg-surface/60 p-6 text-center"
            >
              <IqgGauge score={ex.score} />
              <h3 className="mt-4 font-display font-semibold text-ink text-[15px]">{ex.label}</h3>
              <p className="mt-1.5 text-[13px] text-muted leading-relaxed">{ex.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

export default IQGSection
