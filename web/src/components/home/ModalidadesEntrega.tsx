import { motion } from 'framer-motion'
import { Zap, Users, FileSignature } from 'lucide-react'
import { SectionHeading } from '@/components/ui/section-heading'

const MODALIDADES = [
  {
    icon: Zap,
    title: 'AVM Automático',
    desc: 'Sem intervenção humana. Prazo: segundos.',
  },
  {
    icon: Users,
    title: 'Avaliação Híbrida',
    desc: 'IA + Analista. Prazo: minutos.',
  },
  {
    icon: FileSignature,
    title: 'Laudo Completo',
    desc: 'IA + Avaliador Responsável, com ART/RRT e assinatura digital (ICP-Brasil, Gov.br ou certificado digital).',
  },
]

export function ModalidadesEntrega() {
  return (
    <section id="modalidades" className="relative py-20 sm:py-28 px-4 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <SectionHeading eyebrow="Entrega" title="Modalidades de entrega" />

        <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-5">
          {MODALIDADES.map((m, i) => (
            <motion.div
              key={m.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="rounded-2xl border border-white/10 bg-surface/60 p-6 text-center"
            >
              <div className="flex items-center justify-center size-12 mx-auto rounded-xl bg-brand-500/10 text-brand-400 mb-4">
                <m.icon className="size-5.5" />
              </div>
              <h3 className="font-display font-semibold text-ink text-[16px]">{m.title}</h3>
              <p className="mt-2 text-[13.5px] text-muted leading-relaxed">{m.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

export default ModalidadesEntrega
