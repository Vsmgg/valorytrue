import { useState } from 'react'
import { Plus, ArrowRight, Loader2, MapPin } from 'lucide-react'
import { UploadSlot } from '@/components/wizard/upload-slot'
import { formatCep, lookupCep, type CepStatus } from '@/lib/cep'
import type { PropertyData } from '@/lib/avaliacao-types'

const MAX_PHOTOS = 5
const DOC_LABELS = ['Matrícula do imóvel', 'IPTU']

interface FileEntry {
  url: string
  name: string
  previewUrl?: string
}

export interface AvmFormResult {
  propertyData: PropertyData
  photos: { label: string; url: string }[]
  documents: { label: string; url: string }[]
}

export function AvmForm({ onSubmit, submitting }: { onSubmit: (result: AvmFormResult) => void; submitting: boolean }) {
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
  })
  const [cepStatus, setCepStatus] = useState<CepStatus>('idle')
  const [photoCount, setPhotoCount] = useState(1)
  const [photos, setPhotos] = useState<Record<number, FileEntry>>({})
  const [documents, setDocuments] = useState<Record<string, FileEntry>>({})

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

  // Mesmo bug do módulo Empresa Avaliadora: terreno não tem "número" de imóvel construído nem
  // área construída — o número (quando existe) é do lote, e o campo obrigatório de área é o
  // do terreno.
  const isTerreno = data.tipoImovel === 'Terreno'

  const canSubmit =
    data.cep.replace(/\D/g, '').length === 8 &&
    data.logradouro.trim() &&
    (isTerreno || data.numero.trim()) &&
    data.cidade.trim() &&
    (isTerreno ? data.areaTerreno.trim() : data.areaConstruida.trim()) &&
    !submitting

  const handleSubmit = () => {
    if (!canSubmit) return
    onSubmit({
      propertyData: data,
      photos: Object.entries(photos).map(([i, f]) => ({ label: `Foto ${Number(i) + 1}`, url: f.url })),
      documents: Object.entries(documents).map(([label, f]) => ({ label, url: f.url })),
    })
  }

  return (
    <div className="space-y-6">
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
            {cepStatus === 'not-found' && <p className="mt-1 text-[11px] text-red-400">CEP não encontrado.</p>}
            {cepStatus === 'found' && <p className="mt-1 text-[11px] text-emerald-400">Endereço localizado automaticamente.</p>}
          </label>
          {field('numero', isTerreno ? 'Número do lote (opcional)' : 'Número', { placeholder: isTerreno ? 'Ex.: Lote 12, Quadra 4' : '250' })}
          {field('logradouro', 'Logradouro', { placeholder: 'Preenchido pelo CEP' })}
          {field('complemento', 'Complemento', { placeholder: 'Opcional' })}
          {field('bairro', 'Bairro', { placeholder: 'Preenchido pelo CEP' })}
          <div className="grid grid-cols-2 gap-3">
            {field('cidade', 'Cidade', { placeholder: 'Preenchida pelo CEP' })}
            {field('uf', 'UF', { placeholder: 'SP', maxLength: 2 })}
          </div>
          <label className="block">
            <span className="text-[12px] font-medium text-muted">Tipo de imóvel</span>
            <select
              value={data.tipoImovel}
              onChange={(e) => setData((d) => ({ ...d, tipoImovel: e.target.value }))}
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[13.5px] text-ink focus:outline-none focus:border-brand-400/50"
            >
              {['Apartamento', 'Casa', 'Sobrado', 'Terreno', 'Sala comercial'].map((t) => (
                <option key={t} value={t} className="bg-surface">{t}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[12px] font-medium text-muted">Padrão do imóvel</span>
            <select
              value={data.padraoPercebido}
              onChange={(e) => setData((d) => ({ ...d, padraoPercebido: e.target.value }))}
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[13.5px] text-ink focus:outline-none focus:border-brand-400/50"
            >
              {['Baixo', 'Médio', 'Alto', 'Luxo'].map((t) => (
                <option key={t} value={t} className="bg-surface">{t}</option>
              ))}
            </select>
          </label>
          {!isTerreno && field('areaConstruida', 'Área construída (m²)', { placeholder: '75', inputMode: 'decimal' })}
          {field('areaTerreno', 'Área do terreno (m²)', { placeholder: isTerreno ? '450' : 'opcional', inputMode: 'decimal' })}
          {!isTerreno && field('dormitorios', 'Dormitórios', { placeholder: '2', inputMode: 'numeric' })}
          {!isTerreno && field('banheiros', 'Banheiros', { placeholder: '1', inputMode: 'numeric' })}
          {!isTerreno && field('vagas', 'Vagas de garagem', { placeholder: '1', inputMode: 'numeric' })}
          <div className="sm:col-span-2">
            <span className="text-[12px] font-medium text-muted">Observações (opcional)</span>
            <textarea
              value={data.observacoes}
              onChange={(e) => setData((d) => ({ ...d, observacoes: e.target.value }))}
              rows={2}
              placeholder="Reformas recentes, estado geral..."
              className="mt-1.5 w-full resize-none rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[13.5px] text-ink placeholder-faint focus:outline-none focus:border-brand-400/50"
            />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-surface/60 p-5 sm:p-6 space-y-4">
        <h3 className="text-[13px] font-semibold text-ink/90 uppercase tracking-wide">Fotos (opcional)</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Array.from({ length: photoCount }, (_, i) => (
            <div key={i} className="relative">
              <UploadSlot
                label={`Foto ${i + 1}`}
                kind="image"
                accept="image/*"
                uploaded={photos[i] ?? null}
                onUploaded={(r) => setPhotos((p) => ({ ...p, [i]: r }))}
                onRemove={() => setPhotos((p) => { const n = { ...p }; delete n[i]; return n })}
              />
            </div>
          ))}
        </div>
        {photoCount < MAX_PHOTOS && (
          <button
            type="button"
            onClick={() => setPhotoCount((c) => Math.min(c + 1, MAX_PHOTOS))}
            className="flex items-center gap-1.5 text-[12.5px] font-medium text-brand-400 hover:text-brand-300"
          >
            <Plus className="size-3.5" /> Adicionar outra foto
          </button>
        )}
      </div>

      <div className="rounded-2xl border border-white/10 bg-surface/60 p-5 sm:p-6 space-y-4">
        <h3 className="text-[13px] font-semibold text-ink/90 uppercase tracking-wide">Documentos (opcional)</h3>
        <p className="text-[11.5px] text-faint -mt-2">
          Se anexar a matrícula e/ou o IPTU, a IA confere a área registrada e aponta divergências com o que você informou acima.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {DOC_LABELS.map((label) => (
            <UploadSlot
              key={label}
              label={label}
              kind="document"
              accept="image/*,application/pdf"
              uploaded={documents[label] ?? null}
              onUploaded={(r) => setDocuments((d) => ({ ...d, [label]: r }))}
              onRemove={() => setDocuments((d) => { const n = { ...d }; delete n[label]; return n })}
            />
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-500 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 shadow-[0_0_20px_rgba(22,63,158,0.35)]"
        >
          {submitting ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Estimando...
            </>
          ) : (
            <>
              Estimar valor <ArrowRight className="size-4" />
            </>
          )}
        </button>
      </div>
    </div>
  )
}

export default AvmForm
