import { useRef, useState } from 'react'
import { UploadCloud, X, Loader2, FileText, ImageIcon, CheckCircle2 } from 'lucide-react'
import { chunkedUpload } from '@/lib/chunked-upload'
import { cn } from '@/lib/utils'

interface UploadSlotProps {
  label: string
  accept?: string
  kind?: 'image' | 'document'
  onUploaded: (result: { url: string; name: string; previewUrl?: string }) => void
  onRemove?: () => void
  uploaded?: { name: string; previewUrl?: string } | null
  compact?: boolean
}

export function UploadSlot({
  label,
  accept = 'image/*,application/pdf',
  kind = 'image',
  onUploaded,
  onRemove,
  uploaded,
  compact,
}: UploadSlotProps) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File) => {
    setError(null)
    setUploading(true)
    try {
      const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
      const result = await chunkedUpload(file, 'avaliacoes')
      onUploaded({ url: result.url, name: file.name, previewUrl })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao enviar arquivo.')
    } finally {
      setUploading(false)
    }
  }

  if (uploaded) {
    return (
      <div
        className={cn(
          'relative flex items-center gap-2.5 rounded-xl border border-emerald-400/25 bg-emerald-400/5 px-3 py-2.5',
          compact ? '' : 'w-full',
        )}
      >
        {uploaded.previewUrl ? (
          <img src={uploaded.previewUrl} alt={label} className="size-9 rounded-lg object-cover shrink-0" />
        ) : (
          <div className="flex items-center justify-center size-9 rounded-lg bg-white/5 text-brand-400 shrink-0">
            <FileText className="size-4" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[11.5px] font-medium text-ink truncate">{label}</p>
          <p className="text-[10.5px] text-faint truncate">{uploaded.name}</p>
        </div>
        <CheckCircle2 className="size-4 text-emerald-400 shrink-0" />
        {onRemove && (
          <button onClick={onRemove} className="flex items-center justify-center size-5 rounded-lg text-faint hover:text-ink shrink-0">
            <X className="size-3.5" />
          </button>
        )}
      </div>
    )
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
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
        disabled={uploading}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-xl border border-dashed border-white/15 hover:border-white/30 hover:bg-white/[0.02] px-3 py-2.5 text-left transition-colors disabled:opacity-60',
        )}
      >
        {uploading ? (
          <Loader2 className="size-4 text-brand-400 animate-spin shrink-0" />
        ) : kind === 'image' ? (
          <ImageIcon className="size-4 text-faint shrink-0" />
        ) : (
          <UploadCloud className="size-4 text-faint shrink-0" />
        )}
        <span className="text-[12px] text-muted truncate">{uploading ? 'Enviando...' : label}</span>
      </button>
      {error && <p className="mt-1 text-[11px] text-red-400">{error}</p>}
    </div>
  )
}

export default UploadSlot
