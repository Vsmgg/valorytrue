import { motion } from 'framer-motion'
import { SectionHeading } from '@/components/ui/section-heading'

interface Parceiro {
  name: string
  logo?: string
  height: string
}

const PARCEIROS: Parceiro[] = [
  { name: 'Microsoft', logo: '/partners/microsoft.svg', height: 'h-7 sm:h-8' },
  { name: 'Google', logo: '/partners/google.svg', height: 'h-8 sm:h-10' },
  { name: 'AbStartups', height: 'h-8 sm:h-10' },
  { name: 'AWS', logo: '/partners/aws.svg', height: 'h-10 sm:h-12' },
  { name: 'Grupo Gate', logo: '/partners/grupo-gate.png', height: 'h-14 sm:h-16' },
]

export function Parceiros() {
  return (
    <section id="parceiros" className="relative pt-8 pb-20 sm:pt-10 sm:pb-24 px-4 sm:px-6">
      <div className="mx-auto max-w-4xl text-center">
        <SectionHeading eyebrow="Parceiros" title="Programas e tecnologias que sustentam a plataforma" />

        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-16 gap-y-12">
          {PARCEIROS.map((p, i) => (
            <motion.div
              key={p.name}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.5, delay: i * 0.06 }}
              className="flex items-center justify-center grayscale opacity-70 hover:grayscale-0 hover:opacity-100 transition-all duration-300"
            >
              {p.logo ? (
                <img src={p.logo} alt={p.name} className={`${p.height} w-auto object-contain`} />
              ) : (
                <span className="font-display text-xl sm:text-2xl font-semibold tracking-tight text-ink">{p.name}</span>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

export default Parceiros
