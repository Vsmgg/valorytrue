import { useRef, useState } from 'react'
import { Download, UploadCloud, AlertTriangle, Loader2, ArrowRight } from 'lucide-react'
import { parseCsv, toCsv, downloadCsv } from '@/lib/csv'
import type { ImovelCarteira } from '@/lib/portfolio-types'

const MAX_ROWS = 25

const TEMPLATE_HEADERS = ['endereco', 'cidade', 'uf', 'tipo', 'areaM2', 'valorAtual']
const TEMPLATE_ROWS = [
  ['Rua Augusta, 1200', 'São Paulo', 'SP', 'Apartamento', 85, 850000],
  ['Av. Boa Viagem, 500', 'Recife', 'PE', 'Apartamento', 110, 620000],
]

function parseRows(raw: Record<string, string>[]): { imoveis: ImovelCarteira[]; truncated: boolean; skipped: number } {
  let skipped = 0
  const valid: ImovelCarteira[] = []
  raw.forEach((row, i) => {
    const endereco = row['endereco'] || ''
    const cidade = row['cidade'] || ''
    const uf = row['uf'] || ''
    const tipo = row['tipo'] || ''
    const areaM2 = Number(row['aream2'] ?? row['area'] ?? row['area_m2'] ?? '')
    const valorAtual = row['valoratual'] ? Number(row['valoratual']) : undefined
    if (!endereco || !cidade || !uf || !tipo || !areaM2 || Number.isNaN(areaM2)) {
      skipped += 1
      return
    }
    valid.push({ linha: i + 1, endereco, cidade, uf, tipo, areaM2, valorAtual })
  })
  const truncated = valid.length > MAX_ROWS
  return { imoveis: valid.slice(0, MAX_ROWS), truncated, skipped }
}

interface UploadPlanilhaProps {
  onProcess: (imoveis: ImovelCarteira[]) => void
  processing: boolean
}

export function UploadPlanilha({ onProcess, processing }: UploadPlanilhaProps) {
  const [imoveis, setImoveis] = useState<ImovelCarteira[]>([])
  const [truncated, setTruncated] = useState(false)
  const [skipped, setSkipped] = useState(0)
  const [fileError, setFileError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File) => {
    setFileError(null)
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setFileError('Envie um arquivo .csv (o suporte a .xlsx entra em uma próxima iteração).')
      return
    }
    const text = await file.text()
    const rows = parseCsv(text)
    if (rows.length === 0) {
      setFileError('Não foi possível ler nenhuma linha válida deste arquivo.')
      return
    }
    const { imoveis: parsed, truncated: t, skipped: s } = parseRows(rows)
    if (parsed.length === 0) {
      setFileError('Nenhuma linha tem as colunas obrigatórias preenchidas (endereco, cidade, uf, tipo, areaM2).')
      return
    }
    setImoveis(parsed)
    setTruncated(t)
    setSkipped(s)
  }

  const handleDownloadTemplate = () => {
    downloadCsv('modelo-carteira-imoveis.csv', toCsv(TEMPLATE_HEADERS, TEMPLATE_ROWS))
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-white/10 bg-surface/60 p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 className="text-[13px] font-semibold text-ink/90 uppercase tracking-wide">Upload da carteira</h3>
            <p className="mt-1 text-[12px] text-muted">
              Colunas obrigatórias: <code className="text-ink/80">endereco, cidade, uf, tipo, areaM2</code> (mais <code className="text-ink/80">valorAtual</code>, opcional). Até {MAX_ROWS} imóveis por lote nesta demonstração.
            </p>
          </div>
          <button
            onClick={handleDownloadTemplate}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12.5px] font-medium bg-white/5 hover:bg-white/10 text-ink transition-colors shrink-0"
          >
            <Download className="size-3.5" /> Baixar modelo (.csv)
          </button>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handleFile(f)
            e.target.value = ''
          }}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex w-full items-center gap-2.5 rounded-xl border border-dashed border-white/15 hover:border-white/30 hover:bg-white/[0.02] px-4 py-4 text-left transition-colors"
        >
          <UploadCloud className="size-4.5 text-faint shrink-0" />
          <span className="text-[13px] text-muted">Clique para enviar um arquivo .csv com a carteira de imóveis</span>
        </button>

        {fileError && (
          <div className="flex items-center gap-2 text-[12.5px] text-red-400">
            <AlertTriangle className="size-3.5 shrink-0" /> {fileError}
          </div>
        )}
        {truncated && (
          <div className="flex items-center gap-2 text-[12.5px] text-amber-400">
            <AlertTriangle className="size-3.5 shrink-0" /> O arquivo tinha mais de {MAX_ROWS} imóveis válidos — apenas os primeiros {MAX_ROWS} serão processados nesta demonstração.
          </div>
        )}
        {skipped > 0 && (
          <div className="flex items-center gap-2 text-[12.5px] text-amber-400">
            <AlertTriangle className="size-3.5 shrink-0" /> {skipped} linha(s) ignorada(s) por faltar alguma coluna obrigatória.
          </div>
        )}
      </div>

      {imoveis.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-surface/60 p-5 sm:p-6">
          <h3 className="text-[13px] font-semibold text-ink/90 uppercase tracking-wide mb-3">
            Pré-visualização ({imoveis.length} imóve{imoveis.length === 1 ? 'l' : 'is'})
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-faint text-left">
                  <th className="font-medium pb-2 pr-3">Endereço</th>
                  <th className="font-medium pb-2 pr-3">Cidade/UF</th>
                  <th className="font-medium pb-2 pr-3">Tipo</th>
                  <th className="font-medium pb-2">Área</th>
                </tr>
              </thead>
              <tbody>
                {imoveis.map((im) => (
                  <tr key={im.linha} className="border-t border-white/8">
                    <td className="py-2 pr-3 text-ink/90">{im.endereco}</td>
                    <td className="py-2 pr-3 text-muted">{im.cidade}/{im.uf}</td>
                    <td className="py-2 pr-3 text-muted">{im.tipo}</td>
                    <td className="py-2 text-muted">{im.areaM2} m²</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-5 flex justify-end">
            <button
              onClick={() => onProcess(imoveis)}
              disabled={processing}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-500 text-white transition-all disabled:opacity-50 active:scale-95 shadow-[0_0_20px_rgba(22,63,158,0.35)]"
            >
              {processing ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Processando carteira...
                </>
              ) : (
                <>
                  Processar carteira <ArrowRight className="size-4" />
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default UploadPlanilha
