import { motion } from 'framer-motion'
import { Check, ClipboardList, Cpu, UserCheck, ShieldCheck, FileOutput } from 'lucide-react'
import { cn } from '@/lib/utils'

const STEPS = [
  { n: 1, label: 'Vistoriador', icon: ClipboardList },
  { n: 2, label: 'IA', icon: Cpu },
  { n: 3, label: 'Analista', icon: UserCheck },
  { n: 4, label: 'Auditoria', icon: ShieldCheck },
  { n: 5, label: 'Laudo', icon: FileOutput },
]

export function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-between gap-1 sm:gap-2 max-w-2xl mx-auto">
      {STEPS.map((step, i) => {
        const done = current > step.n
        const active = current === step.n
        return (
          <div key={step.n} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={cn(
                  'flex items-center justify-center size-8 sm:size-9 rounded-full border transition-colors shrink-0',
                  done && 'bg-emerald-500/15 border-emerald-400/40 text-emerald-400',
                  active && 'bg-brand-500/15 border-brand-400/50 text-brand-400',
                  !done && !active && 'bg-white/[0.03] border-white/10 text-faint',
                )}
              >
                {done ? <Check className="size-4" /> : <step.icon className="size-4" />}
              </div>
              <span
                className={cn(
                  'text-[10px] sm:text-[11px] font-medium hidden sm:block',
                  active ? 'text-ink' : 'text-faint',
                )}
              >
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className="flex-1 h-px bg-white/10 mx-1 sm:mx-2 relative top-[-10px] sm:top-[-12px]">
                <motion.div
                  className="h-px bg-emerald-400/60"
                  initial={false}
                  animate={{ width: done ? '100%' : '0%' }}
                  transition={{ duration: 0.4 }}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default StepIndicator
