import { useState } from 'react'
import { Play, Loader2, Copy, Check } from 'lucide-react'

const EXAMPLE_REQUEST = {
  propertyData: {
    cep: '01310-100',
    logradouro: 'Avenida Paulista',
    numero: '1000',
    complemento: '',
    bairro: 'Bela Vista',
    cidade: 'São Paulo',
    uf: 'SP',
    tipoImovel: 'Apartamento',
    areaConstruida: '85',
    areaTerreno: '',
    dormitorios: '2',
    banheiros: '2',
    vagas: '1',
    padraoPercebido: 'Médio',
    observacoes: '',
  },
  photos: [],
}

const CURL_EXAMPLE = `curl -X POST https://renan-solucoes.vercel.app/api/avm \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(EXAMPLE_REQUEST)}'`

export function ApiTester() {
  const [requestBody, setRequestBody] = useState(JSON.stringify(EXAMPLE_REQUEST, null, 2))
  const [response, setResponse] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const handleSend = async () => {
    setLoading(true)
    setError(null)
    setResponse(null)
    try {
      const parsed = JSON.parse(requestBody)
      const res = await fetch('/api/avm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed),
      })
      const data = await res.json()
      setResponse(JSON.stringify(data, null, 2))
    } catch (err) {
      setError(err instanceof Error ? `JSON inválido ou falha na chamada: ${err.message}` : 'Falha ao chamar a API.')
    } finally {
      setLoading(false)
    }
  }

  const handleCopyCurl = async () => {
    await navigator.clipboard.writeText(CURL_EXAMPLE)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-surface/60 p-5 sm:p-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[13px] font-semibold text-ink/90 uppercase tracking-wide">Exemplo via curl</h3>
          <button onClick={handleCopyCurl} className="flex items-center gap-1.5 text-[12px] text-brand-400 hover:text-brand-300">
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? 'Copiado' : 'Copiar'}
          </button>
        </div>
        <pre className="overflow-x-auto rounded-lg bg-black/30 p-3 text-[11.5px] text-emerald-300/90 font-mono">{CURL_EXAMPLE}</pre>
      </div>

      <div className="rounded-2xl border border-white/10 bg-surface/60 p-5 sm:p-6 space-y-3">
        <h3 className="text-[13px] font-semibold text-ink/90 uppercase tracking-wide">Testador ao vivo — POST /api/avm</h3>
        <p className="text-[11.5px] text-faint">Edite o JSON abaixo e envie de verdade — a resposta vem direto da nossa API de produção.</p>
        <textarea
          value={requestBody}
          onChange={(e) => setRequestBody(e.target.value)}
          rows={12}
          spellCheck={false}
          className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-[12px] font-mono text-ink/90 focus:outline-none focus:border-brand-400/50 resize-y"
        />
        <button
          onClick={handleSend}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium bg-brand-600 hover:bg-brand-500 text-white transition-all disabled:opacity-50 active:scale-95"
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Enviar requisição
        </button>

        {error && <p className="text-[12.5px] text-red-400">{error}</p>}
        {response && (
          <div>
            <p className="text-[11.5px] text-faint mb-1.5">Resposta real da API:</p>
            <pre className="overflow-x-auto rounded-lg bg-black/30 p-3 text-[11.5px] text-ink/80 font-mono max-h-96">{response}</pre>
          </div>
        )}
      </div>
    </div>
  )
}

export default ApiTester
