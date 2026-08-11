import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { navigate } from '@/lib/router'
import { StepIndicator } from '@/components/wizard/step-indicator'
import { Fase1Vistoriador, type Fase1Result } from '@/components/wizard/fase1-vistoriador'
import { Fase2Processando } from '@/components/wizard/fase2-processando'
import { Fase3Analista } from '@/components/wizard/fase3-analista'
import { Fase4Auditoria } from '@/components/wizard/fase4-auditoria'
import { Fase5Laudo } from '@/components/wizard/fase5-laudo'
import { QuotaBadge } from '@/components/ui/quota-badge'
import { useAuth } from '@/lib/auth-context'
import type { AvaliacaoResultado } from '@/lib/avaliacao-types'

type Phase = 1 | 2 | 3 | 4 | 5

export function EmpresaAvaliadoraWizard() {
  const { refreshUser } = useAuth()
  const [phase, setPhase] = useState<Phase>(1)
  const [caseId] = useState(() => `case-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const [fase1Result, setFase1Result] = useState<Fase1Result | null>(null)
  const [resultado, setResultado] = useState<AvaliacaoResultado | null>(null)
  const [auditAction, setAuditAction] = useState<'aprovado' | 'ajustado'>('aprovado')
  const [auditChanges, setAuditChanges] = useState<unknown>(null)

  return (
    <main className="min-h-screen px-4 sm:px-6 py-10 sm:py-14">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center justify-between mb-8">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 text-[13px] text-faint hover:text-ink transition-colors"
          >
            <ArrowLeft className="size-3.5" /> Voltar para a home
          </button>
          <QuotaBadge />
        </div>

        <div className="mb-10">
          <StepIndicator current={phase} />
        </div>

        {phase === 1 && (
          <Fase1Vistoriador
            onSubmit={(result) => {
              setFase1Result(result)
              setPhase(2)
            }}
          />
        )}

        {phase === 2 && fase1Result && (
          <Fase2Processando
            input={fase1Result}
            onComplete={(r) => {
              setResultado(r)
              setPhase(3)
              refreshUser()
            }}
          />
        )}

        {phase === 3 && resultado && (
          <Fase3Analista
            resultado={resultado}
            onApprove={(final, adjusted) => {
              setResultado(final)
              setAuditAction(adjusted ? 'ajustado' : 'aprovado')
              setAuditChanges(adjusted ? final.parecer : null)
              setPhase(4)
            }}
          />
        )}

        {phase === 4 && (
          <Fase4Auditoria caseId={caseId} action={auditAction} changes={auditChanges} onContinue={() => setPhase(5)} />
        )}

        {phase === 5 && resultado && fase1Result && (
          <Fase5Laudo
            propertyData={fase1Result.propertyData}
            resultado={resultado}
            photos={fase1Result.photos}
            documents={fase1Result.documents}
          />
        )}
      </div>
    </main>
  )
}

export default EmpresaAvaliadoraWizard
