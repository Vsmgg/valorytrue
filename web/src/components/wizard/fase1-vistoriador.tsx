import { useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, ArrowRight, Loader2, MapPin } from 'lucide-react'
import { UploadSlot } from '@/components/wizard/upload-slot'
import { TIPOS_IMOVEL_NBR, type PropertyData, type Finalidade } from '@/lib/avaliacao-types'
import { formatCep, lookupCep, type CepStatus } from '@/lib/cep'

const FIXED_DOC_LABELS = ['Matrícula do imóvel', 'IPTU']
const MAX_ROOM_SLOTS = 8

interface FileEntry {
  label: string
  url: string
  name: string
  previewUrl?: string
}

export interface Fase1Result {
  propertyData: PropertyData
  photos: { label: string; url: string }[]
  documents: { label: string; url: string }[]
}

function roomCount(raw: string): number {
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.min(n, MAX_ROOM_SLOTS)
}

export function Fase1Vistoriador({ onSubmit }: { onSubmit: (result: Fase1Result) => void }) {
  const [data, setData] = useState<PropertyData>({
    cep: '',
    logradouro: '',
    numero: '',
    complemento: '',
    bairro: '',
    cidade: '',
    uf: '',
    tipoImovel: 'Apartamento',
    areaConstruida: '',
    areaTerreno: '',
    dormitorios: '',
    banheiros: '',
    vagas: '',
    padraoPercebido: 'Médio',
    observacoes: '',
    finalidade: 'Valor de mercado',
    topografia: '',
    testada: '',
    posicao: '',
    infraestruturaUrbana: '',
    zoneamentoInformado: '',
    ocupacaoUso: '',
  })
  const [cepStatus, setCepStatus] = useState<CepStatus>('idle')
  const [photos, setPhotos] = useState<Record<string, FileEntry>>({})
  const [docLabels, setDocLabels] = useState<string[]>(FIXED_DOC_LABELS)
  const [docs, setDocs] = useState<Record<string, FileEntry>>({})
  const [submitting, setSubmitting] = useState(false)

  const handleCepChange = async (raw: string) => {
    const formatted = formatCep(raw)
    setData((d) => ({ ...d, cep: formatted }))
    const { status, address } = await lookupCep(formatted)
    setCepStatus(status)
    if (address) {
      setData((d) => ({
        ...d,
        logradouro: address.logradouro || d.logradouro,
        bairro: address.bairro || d.bairro,
        cidade: address.cidade || d.cidade,
        uf: address.uf || d.uf,
      }))
    }
  }

  const field = (key: keyof PropertyData, label: string, props: Partial<React.InputHTMLAttributes<HTMLInputElement>> = {}) => (
    <label className="block">
      <span className="text-[12px] font-medium text-muted">{label}</span>
      <input
        value={data[key]}
        onChange={(e) => setData((d) => ({ ...d, [key]: e.target.value }))}
        className="mt-1.5 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[13.5px] text-ink placeholder-faint focus:outline-none focus:border-brand-400/50"
        {...props}
      />
    </label>
  )

  const isApartamento = data.tipoImovel === 'Apartamento' || data.tipoImovel === 'Sala/conjunto comercial'
  // BUG real encontrado e corrigido — pedido explícito do usuário: um terreno/lote não tem
  // "número" de imóvel construído nem "área construída"/dormitórios/banheiros/vagas — o
  // formulário pedia tudo isso como obrigatório mesmo assim. Pra terreno, o número (quando
  // existe) é o do LOTE, sempre opcional, e o campo obrigatório de área é o do TERRENO, não o
  // construído.
  const isTerreno = data.tipoImovel === 'Terreno/lote urbano'
  const dormCount = roomCount(data.dormitorios)
  const banhCount = roomCount(data.banheiros)
  const photoCategories = [
    'Fachada',
    'Sala',
    ...Array.from({ length: dormCount }, (_, i) => `Quarto ${i + 1}`),
    'Cozinha',
    ...Array.from({ length: banhCount }, (_, i) => `Banheiro ${i + 1}`),
    'Área externa',
  ]

  const canSubmit =
    data.cep.replace(/\D/g, '').length === 8 &&
    data.logradouro.trim() &&
    (isTerreno || data.numero.trim()) &&
    data.cidade.trim() &&
    (isTerreno ? data.areaTerreno.trim() : data.areaConstruida.trim()) &&
    !submitting

  const handleSubmit = () => {
    if (!canSubmit) return
    setSubmitting(true)
    onSubmit({
      propertyData: data,
      photos: Object.entries(photos).map(([label, f]) => ({ label, url: f.url })),
      documents: Object.entries(docs).map(([label, f]) => ({ label, url: f.url })),
    })
  }

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="space-y-8">
      <div>
        <h2 className="font-display text-xl font-semibold text-ink">Fase 1 — Vistoriador</h2>
        <p className="mt-1 text-[13.5px] text-muted">Informe os dados coletados na vistoria e anexe fotos e documentos do imóvel.</p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-surface/60 p-5 sm:p-6 space-y-5">
        <h3 className="text-[13px] font-semibold text-ink/90 uppercase tracking-wide">Dados do imóvel</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-[12px] font-medium text-muted">CEP</span>
            <div className="relative mt-1.5">
              <input
                value={data.cep}
                onChange={(e) => handleCepChange(e.target.value)}
                placeholder="00000-000"
                inputMode="numeric"
                className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 pr-8 text-[13.5px] text-ink placeholder-faint focus:outline-none focus:border-brand-400/50"
              />
              {cepStatus === 'loading' && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 size-4 text-faint animate-spin" />}
              {cepStatus === 'found' && <MapPin className="absolute right-2.5 top-1/2 -translate-y-1/2 size-4 text-emerald-400" />}
            </div>
            {cepStatus === 'not-found' && <p className="mt-1 text-[11px] text-red-400">CEP não encontrado. Confira o número.</p>}
            {cepStatus === 'error' && <p className="mt-1 text-[11px] text-red-400">Não foi possível consultar o CEP agora.</p>}
            {cepStatus === 'found' && <p className="mt-1 text-[11px] text-emerald-400">Endereço localizado automaticamente.</p>}
          </label>
          {field('numero', isTerreno ? 'Número do lote (opcional)' : 'Número', { placeholder: isTerreno ? 'Ex.: Lote 12, Quadra 4' : '250' })}
          {field('logradouro', 'Logradouro (preenchido pelo CEP)', { placeholder: 'Rua / Avenida' })}
          {field('complemento', 'Complemento', { placeholder: 'Apto 12, bloco B (opcional)' })}
          {field('bairro', 'Bairro (preenchido pelo CEP)', { placeholder: 'Bairro' })}
          <div className="grid grid-cols-2 gap-3">
            {field('cidade', 'Cidade (preenchida pelo CEP)', { placeholder: 'Cidade' })}
            {field('uf', 'UF', { placeholder: 'SP', maxLength: 2 })}
          </div>
          <label className="block">
            <span className="text-[12px] font-medium text-muted">Tipo de imóvel (classificação NBR 14.653)</span>
            <select
              value={data.tipoImovel}
              onChange={(e) => setData((d) => ({ ...d, tipoImovel: e.target.value }))}
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[13.5px] text-ink focus:outline-none focus:border-brand-400/50"
            >
              {TIPOS_IMOVEL_NBR.map((t) => (
                <option key={t} value={t} className="bg-surface">
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[12px] font-medium text-muted">Finalidade da avaliação</span>
            <select
              value={data.finalidade}
              onChange={(e) => setData((d) => ({ ...d, finalidade: e.target.value as Finalidade }))}
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[13.5px] text-ink focus:outline-none focus:border-brand-400/50"
            >
              {(['Valor de mercado', 'Valor de garantia'] as const).map((f) => (
                <option key={f} value={f} className="bg-surface">
                  {f}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[12px] font-medium text-muted">Padrão construtivo percebido</span>
            <select
              value={data.padraoPercebido}
              onChange={(e) => setData((d) => ({ ...d, padraoPercebido: e.target.value }))}
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[13.5px] text-ink focus:outline-none focus:border-brand-400/50"
            >
              {['Baixo', 'Médio', 'Alto', 'Luxo'].map((t) => (
                <option key={t} value={t} className="bg-surface">
                  {t}
                </option>
              ))}
            </select>
          </label>
          {!isTerreno &&
            field('areaConstruida', isApartamento ? 'Área privativa (m²)' : 'Área construída (m²)', {
              placeholder: '85',
              inputMode: 'decimal',
            })}
          {field(
            'areaTerreno',
            isTerreno ? 'Área do terreno (m²)' : isApartamento ? 'Área construída total (com áreas comuns, opcional)' : 'Área do terreno (m²)',
            {
              placeholder: isTerreno ? '450' : isApartamento ? '110 (opcional)' : '120 (opcional)',
              inputMode: 'decimal',
            },
          )}
          {!isTerreno && field('dormitorios', 'Dormitórios', { placeholder: '3', inputMode: 'numeric' })}
          {!isTerreno && field('banheiros', 'Banheiros', { placeholder: '2', inputMode: 'numeric' })}
          {!isTerreno && field('vagas', 'Vagas de garagem', { placeholder: '1', inputMode: 'numeric' })}
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-surface/60 p-5 sm:p-6 space-y-5">
        <h3 className="text-[13px] font-semibold text-ink/90 uppercase tracking-wide">Caracterização física e urbana (NBR 14.653)</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {field('topografia', 'Topografia', { placeholder: 'Plana, aclive, declive...' })}
          {field('testada', 'Testada (m)', { placeholder: '10', inputMode: 'decimal' })}
          {field('posicao', 'Posição no lote/quadra', { placeholder: 'Meio de quadra, esquina...' })}
          {field('infraestruturaUrbana', 'Infraestrutura urbana observada', { placeholder: 'Água, esgoto, asfalto, iluminação...' })}
          {field('zoneamentoInformado', 'Zoneamento informado', { placeholder: 'Ex: ZM-2, ZC...' })}
          {field('ocupacaoUso', 'Ocupação e uso', { placeholder: 'Residencial, comercial, misto...' })}
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-surface/60 p-5 sm:p-6 space-y-5">
        <h3 className="text-[13px] font-semibold text-ink/90 uppercase tracking-wide">Observações</h3>
        <div className="grid grid-cols-1">
          <div>
            <span className="text-[12px] font-medium text-muted">Observações da vistoria</span>
            <textarea
              value={data.observacoes}
              onChange={(e) => setData((d) => ({ ...d, observacoes: e.target.value }))}
              rows={3}
              placeholder="Trincas visíveis, infiltrações, reformas recentes, estado geral..."
              className="mt-1.5 w-full resize-none rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[13.5px] text-ink placeholder-faint focus:outline-none focus:border-brand-400/50"
            />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-surface/60 p-5 sm:p-6 space-y-4">
        <h3 className="text-[13px] font-semibold text-ink/90 uppercase tracking-wide">Fotos do imóvel</h3>
        <p className="text-[11.5px] text-faint -mt-2">Os campos de quartos e banheiros se ajustam automaticamente à quantidade informada acima.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {photoCategories.map((cat) => (
            <UploadSlot
              key={cat}
              label={cat}
              kind="image"
              accept="image/*"
              uploaded={photos[cat] ?? null}
              onUploaded={(r) => setPhotos((p) => ({ ...p, [cat]: { ...r, label: cat } }))}
              onRemove={() => setPhotos((p) => { const n = { ...p }; delete n[cat]; return n })}
            />
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-surface/60 p-5 sm:p-6 space-y-4">
        <h3 className="text-[13px] font-semibold text-ink/90 uppercase tracking-wide">Documentos</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {docLabels.map((label) => (
            <UploadSlot
              key={label}
              label={label}
              kind="document"
              accept="image/*,application/pdf"
              uploaded={docs[label] ?? null}
              onUploaded={(r) => setDocs((d) => ({ ...d, [label]: { ...r, label } }))}
              onRemove={() => setDocs((d) => { const n = { ...d }; delete n[label]; return n })}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => setDocLabels((l) => [...l, `Documento adicional ${l.length - 1}`])}
          className="flex items-center gap-1.5 text-[12.5px] font-medium text-brand-400 hover:text-brand-300"
        >
          <Plus className="size-3.5" /> Adicionar outro documento
        </button>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-500 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 shadow-[0_0_20px_rgba(22,63,158,0.35)]"
        >
          {submitting ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Enviando...
            </>
          ) : (
            <>
              Enviar para análise <ArrowRight className="size-4" />
            </>
          )}
        </button>
      </div>
    </motion.div>
  )
}

export default Fase1Vistoriador
