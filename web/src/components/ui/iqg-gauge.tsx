import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import type { IqgClassificacao } from '@/lib/avaliacao-types'

interface IqgGaugeProps {
  score: number
  classificacao?: IqgClassificacao
  size?: number
  className?: string
}

function classify(score: number): IqgClassificacao {
  if (score >= 75) return 'Premium'
  if (score >= 40) return 'Atenção'
  return 'Inadequada'
}

const COLOR_MAP: Record<IqgClassificacao, { stroke: string; text: string; bg: string }> = {
  Premium: { stroke: '#4ade80', text: 'text-emerald-400', bg: 'bg-emerald-400/10' },
  'Atenção': { stroke: '#f2c879', text: 'text-gold-400', bg: 'bg-gold-500/10' },
  Inadequada: { stroke: '#f87171', text: 'text-red-400', bg: 'bg-red-500/10' },
}

export function IqgGauge({ score, classificacao, size = 140, className }: IqgGaugeProps) {
  const clamped = Math.max(0, Math.min(100, score))
  const label = classificacao || classify(clamped)
  const colors = COLOR_MAP[label]

  const strokeWidth = size * 0.09
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - clamped / 100)

  return (
    <div className={cn('flex flex-col items-center', className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={strokeWidth}
          />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={colors.stroke}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            whileInView={{ strokeDashoffset: offset }}
            viewport={{ once: true }}
            transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-3xl font-bold text-ink">{Math.round(clamped)}</span>
          <span className="text-[10px] text-faint">/ 100</span>
        </div>
      </div>
      <span className={cn('mt-3 rounded-lg px-3 py-1 text-xs font-semibold', colors.text, colors.bg)}>
        {label}
      </span>
    </div>
  )
}

export default IqgGauge
