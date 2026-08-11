import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import type { FinanciabilidadeStatus } from '@/lib/avaliacao-types'

const STYLE_MAP: Record<FinanciabilidadeStatus, { icon: typeof CheckCircle2; cls: string }> = {
  'Financiável': { icon: CheckCircle2, cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-400/25' },
  'Financiável com restrições': { icon: AlertTriangle, cls: 'bg-amber-500/10 text-amber-400 border-amber-400/25' },
  'Não financiável': { icon: XCircle, cls: 'bg-red-500/10 text-red-400 border-red-400/25' },
}

interface FinanciabilidadeBadgeProps {
  status: FinanciabilidadeStatus
  detail?: string
  className?: string
}

export function FinanciabilidadeBadge({ status, detail, className }: FinanciabilidadeBadgeProps) {
  const { icon: Icon, cls } = STYLE_MAP[status]
  return (
    <div className={`rounded-2xl border p-4 flex items-center gap-3 ${cls} ${className ?? ''}`}>
      <Icon className="size-5 shrink-0" />
      <div>
        <p className="text-[13px] font-semibold">{status}</p>
        {detail && <p className="text-[11.5px] opacity-80">{detail}</p>}
      </div>
    </div>
  )
}

export default FinanciabilidadeBadge
