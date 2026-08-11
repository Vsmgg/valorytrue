import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ShieldCheck, Loader2, ArrowRight, Clock } from 'lucide-react'

interface AuditEntry {
  action: string
  at: string
}

interface Fase4Props {
  caseId: string
  action: 'aprovado' | 'ajustado'
  changes: unknown
  onContinue: () => void
}

export function Fase4Auditoria({ caseId, action, changes, onContinue }: Fase4Props) {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    const run = async () => {
      try {
        await fetch('/api/audit', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ caseId, action, changes }),
        })
        const res = await fetch(`/api/audit?caseId=${encodeURIComponent(caseId)}`)
        const data = (await res.json().catch(() => ({}))) as { entries?: AuditEntry[] }
        setEntries(data.entries || [])
      } finally {
        setLoading(false)
      }
    }
    run()
  }, [caseId, action, changes])

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="space-y-8">
      <div>
        <h2 className="font-display text-xl font-semibold text-ink">Fase 4 — Auditoria</h2>
        <p className="mt-1 text-[13.5px] text-muted">Toda aprovação ou ajuste fica registrado na trilha de auditoria deste caso.</p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-surface/60 p-5 sm:p-6">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink/90 uppercase tracking-wide">
          <ShieldCheck className="size-4 text-brand-400" /> Trilha de auditoria — caso {caseId}
        </h3>

        {loading ? (
          <div className="flex items-center gap-2 mt-5 text-[13px] text-muted">
            <Loader2 className="size-4 animate-spin" /> Registrando evento...
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            {entries.length === 0 && <p className="text-[13px] text-muted">Nenhum evento registrado ainda.</p>}
            {entries.map((e, i) => (
              <div key={i} className="flex items-center gap-3 text-[13px]">
                <Clock className="size-3.5 text-faint shrink-0" />
                <span className="text-ink/90 font-medium capitalize">{e.action}</span>
                <span className="text-faint">{new Date(e.at).toLocaleString('pt-BR')}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button
          onClick={onContinue}
          disabled={loading}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-500 text-white transition-all disabled:opacity-40 active:scale-95 shadow-[0_0_20px_rgba(22,63,158,0.35)]"
        >
          Gerar laudo <ArrowRight className="size-4" />
        </button>
      </div>
    </motion.div>
  )
}

export default Fase4Auditoria
