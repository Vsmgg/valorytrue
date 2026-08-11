import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Bolt, ArrowRight } from 'lucide-react'
import { HeroVideoBackground } from '@/components/ui/hero-video-background'
import { StatsMarquee } from '@/components/ui/stats-marquee'
import { navigate } from '@/lib/router'

const STATS = [
  { value: '4', label: 'Módulos da plataforma' },
  { value: '5', label: 'Fases do laudo' },
  { value: 'NBR 14.653', label: 'Norma técnica' },
  { value: '0–100', label: 'Índice de Qualidade da Garantia' },
  { value: '24/7', label: 'Motor Central de IA' },
]

const HEADLINE_WORDS = ['O', 'motor', 'central', 'que']
const CYCLE_WORDS = ['avalia.', 'precifica.', 'compara.', 'garante.', 'financia.']

function CyclingWord() {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % CYCLE_WORDS.length), 2200)
    return () => clearInterval(id)
  }, [])

  return (
    <span className="relative inline-block h-[1.15em] overflow-hidden align-bottom">
      <AnimatePresence mode="wait">
        <motion.span
          key={CYCLE_WORDS[index]}
          initial={{ y: '110%', opacity: 0 }}
          animate={{ y: '0%', opacity: 1 }}
          exit={{ y: '-110%', opacity: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="block bg-gradient-to-r from-brand-300 via-brand-400 to-brand-600 bg-clip-text text-transparent"
        >
          {CYCLE_WORDS[index]}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

export function Hero() {
  const goSection = (href: string) => document.querySelector(href)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <section id="top" className="relative flex flex-col overflow-hidden pt-28 pb-6 sm:pb-8">
      <HeroVideoBackground />

      <div className="relative z-10 flex flex-col items-center px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="inline-flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs sm:text-sm border border-white/15 bg-base/70 backdrop-blur-md text-muted shadow-lg shadow-black/30"
        >
          <Bolt className="size-3.5 text-brand-400" />
          ValoryTrue · A evolução da avaliação imobiliária
        </motion.div>

        <div className="mt-10 w-full max-w-3xl flex flex-col items-center text-center">
          <h1 className="font-display text-[2.4rem] leading-[1.06] sm:text-6xl lg:text-[4.6rem] font-semibold tracking-tight text-ink text-balance">
            <span className="inline-block">
              {HEADLINE_WORDS.map((word, i) => (
                <motion.span
                  key={word}
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.1 + i * 0.07 }}
                  className="inline-block mr-[0.28em] last:mr-0"
                >
                  {word}
                </motion.span>
              ))}
            </span>
            <br />
            <CyclingWord />
          </h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="mt-6 text-[15px] sm:text-lg text-muted text-balance leading-relaxed max-w-2xl"
          >
            Um único motor calcula valor de mercado, liquidez e financiabilidade a partir de documentos, fotos e dados do imóvel — vistoria, avaliação de pessoa física, reavaliação de carteiras e crédito bancário rodam sobre o mesmo raciocínio.
          </motion.p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.3 }}
          className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3"
        >
          <button
            onClick={() => navigate('/empresa-avaliadora')}
            className="group flex w-full sm:w-auto items-center justify-center gap-2 px-6 py-3.5 rounded-lg text-sm font-semibold bg-brand-600 hover:bg-brand-500 text-white transition-all shadow-[0_0_30px_rgba(22,63,158,0.4)] active:scale-[0.98]"
          >
            Testar
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </button>
          <button
            onClick={() => goSection('#modulos')}
            className="flex w-full sm:w-auto items-center justify-center gap-2 px-6 py-3.5 rounded-lg text-sm font-semibold border border-white/12 bg-white/5 hover:bg-white/8 text-ink transition-all active:scale-[0.98]"
          >
            Ver os 4 módulos
          </button>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.7, delay: 0.5 }}
        className="relative z-10 mt-14"
      >
        <StatsMarquee items={STATS} />
      </motion.div>
    </section>
  )
}

export default Hero
