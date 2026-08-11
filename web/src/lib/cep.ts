export interface CepAddress {
  logradouro: string
  bairro: string
  cidade: string
  uf: string
}

export type CepStatus = 'idle' | 'loading' | 'found' | 'not-found' | 'error'

export function formatCep(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits
}

export async function lookupCep(formattedCep: string): Promise<{ status: CepStatus; address?: CepAddress }> {
  const digits = formattedCep.replace(/\D/g, '')
  if (digits.length !== 8) return { status: 'idle' }

  try {
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`)
    const json = (await res.json()) as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string }
    if (json.erro) return { status: 'not-found' }
    return {
      status: 'found',
      address: {
        logradouro: json.logradouro || '',
        bairro: json.bairro || '',
        cidade: json.localidade || '',
        uf: json.uf || '',
      },
    }
  } catch {
    return { status: 'error' }
  }
}
