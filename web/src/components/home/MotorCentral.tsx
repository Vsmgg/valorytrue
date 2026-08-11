import { motion } from 'framer-motion'
import { FileText, Camera, Search, Droplets, ShieldCheck, Database } from 'lucide-react'
import { SectionHeading } from '@/components/ui/section-heading'

const ENTRADAS = [
  'Endereço do imóvel', 'Fotos', 'Documentação', 'Dados cadastrais',
  'Informações do mercado', 'Dados históricos', 'Bases públicas', 'Bases privadas', 'APIs de parceiros',
]

const PROCESSAMENTOS = [
  {
    icon: FileText,
    title: 'Análise Documental',
    desc: 'Leitura automática de matrícula, IPTU, certidão, cadastro municipal e zoneamento.',
    chips: ['Matrícula', 'IPTU', 'Certidão', 'Cadastro Municipal', 'Zoneamento'],
  },
  {
    icon: Camera,
    title: 'Análise Física',
    desc: 'Estado de conservação, acabamento, padrão construtivo e patologias aparentes.',
    chips: ['Conservação', 'Acabamento', 'Padrão construtivo', 'Trincas', 'Infiltrações', 'Fissuras', 'Recalques', 'Umidade'],
  },
  {
    icon: Search,
    title: 'Análise Mercadológica',
    desc: 'Comparáveis, eliminação de outliers, homogeneização e valor de mercado.',
    chips: ['Portais imobiliários', 'Histórico de transações', 'Bases de avaliação', 'Dados próprios'],
  },
  {
    icon: Droplets,
    title: 'Análise de Liquidez',
    desc: 'De Muito Alta a Muito Baixa, com tempo médio de venda, oferta e demanda.',
    chips: ['Muito Alta', 'Alta', 'Normal', 'Baixa', 'Muito Baixa'],
  },
  {
    icon: ShieldCheck,
    title: 'Análise de Financiabilidade',
    desc: 'Restrições documentais, tombamento, APP, área de risco e servidão.',
    chips: ['Financiável', 'Financiável com restrições', 'Não financiável'],
  },
]

const MAX_VISIBLE_CHIPS = 3

export function MotorCentral() {
  return (
    <section id="motor-central" className="relative py-20 sm:py-28 px-4 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <SectionHeading
          eyebrow="Arquitetura Geral"
          title="Motor Central de Inteligência Imobiliária"
          description="O cérebro da plataforma: recebe entradas de diversas fontes e processa cinco camadas de análise para sustentar qualquer módulo construído sobre ele."
        />

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mt-10 flex flex-wrap justify-center gap-2"
        >
          <span className="flex items-center gap-1.5 text-xs text-faint mr-1 mt-1.5">
            <Database className="size-3.5" /> Entradas:
          </span>
          {ENTRADAS.map((e) => (
            <span key={e} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs text-muted">
              {e}
            </span>
          ))}
        </motion.div>

        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
          {PROCESSAMENTOS.map((m, i) => {
            const hiddenCount = m.chips.length - MAX_VISIBLE_CHIPS
            return (
              <motion.div
                key={m.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.45, delay: i * 0.06 }}
                className="group relative rounded-xl border border-white/8 bg-surface/50 p-4 hover:border-white/15 hover:bg-surface-hover transition-colors"
              >
                <div className="flex items-center justify-center size-9 rounded-lg mb-3 bg-brand-500/10 text-brand-400 group-hover:bg-brand-500/15 transition-colors">
                  <m.icon className="size-4" />
                </div>
                <h3 className="font-display font-semibold text-ink text-[13.5px]">{m.title}</h3>
                <p className="mt-1 text-[12px] leading-relaxed text-muted">{m.desc}</p>
                <div className="mt-3 flex flex-wrap gap-1">
                  {m.chips.slice(0, MAX_VISIBLE_CHIPS).map((c) => (
                    <span key={c} className="rounded-md bg-white/5 border border-white/8 px-1.5 py-0.5 text-[10px] text-faint">
                      {c}
                    </span>
                  ))}
                  {hiddenCount > 0 && (
                    <span className="rounded-md bg-white/5 border border-white/8 px-1.5 py-0.5 text-[10px] text-faint">
                      +{hiddenCount}
                    </span>
                  )}
                </div>
              </motion.div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

export default MotorCentral
