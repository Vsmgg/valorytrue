import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { SendHorizontal, Sparkles, Paperclip, X, FileText, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { chunkedUpload } from '@/lib/chunked-upload'

export interface PendingAttachment {
  previewUrl: string
  blobUrl: string
  mimeType: string
  name: string
  kind: 'image' | 'pdf'
}

export interface ChatInputHandle {
  setValue: (text: string) => void
  focus: () => void
}

interface ChatInputProps {
  onSend: (message: string, attachment?: PendingAttachment) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

const MAX_FILE_BYTES = 18 * 1024 * 1024

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput(
  { onSend, placeholder = 'Pergunte algo sobre a plataforma...', disabled, className },
  ref,
) {
  const [message, setMessage] = useState('')
  const [attachment, setAttachment] = useState<PendingAttachment | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadPct, setUploadPct] = useState(0)
  const [fileError, setFileError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useImperativeHandle(ref, () => ({
    setValue: (text: string) => setMessage(text),
    focus: () => textareaRef.current?.focus(),
  }))

  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`
    }
  }, [message])

  const handleFile = async (file: File) => {
    setFileError(null)
    const isImage = file.type.startsWith('image/')
    const isPdf = file.type === 'application/pdf'
    if (!isImage && !isPdf) {
      setFileError('Envie uma imagem (JPG, PNG, WEBP) ou um PDF.')
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      setFileError('Arquivo maior que 18 MB. Envie um arquivo menor.')
      return
    }

    const previewUrl = isImage ? await readAsDataUrl(file).catch(() => '') : ''
    const kind: 'image' | 'pdf' = isPdf ? 'pdf' : 'image'
    setAttachment({ previewUrl, blobUrl: '', mimeType: file.type, name: file.name, kind })
    setUploading(true)
    setUploadPct(0)
    try {
      const result = await chunkedUpload(file, 'chat', (sent, total) => setUploadPct(Math.round((sent / total) * 100)))
      setAttachment({ previewUrl, blobUrl: result.url, mimeType: file.type, name: file.name, kind })
    } catch (err) {
      setFileError(err instanceof Error ? err.message : 'Falha ao enviar o arquivo. Tente novamente.')
      setAttachment(null)
    } finally {
      setUploading(false)
    }
  }

  const handleSubmit = () => {
    if (disabled || uploading) return
    const text = message.trim()
    if (!text && !attachment) return
    if (attachment && !attachment.blobUrl) return
    const defaultText = attachment?.kind === 'pdf' ? 'Analise este documento.' : 'Analise esta foto do imóvel.'
    onSend(text || defaultText, attachment ?? undefined)
    setMessage('')
    setAttachment(null)
    setFileError(null)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className={cn('relative w-full', className)}>
      <div className="absolute -inset-px rounded-2xl bg-gradient-to-b from-white/10 to-transparent pointer-events-none" />
      <div className="relative rounded-2xl bg-surface ring-1 ring-white/10 shadow-[0_2px_30px_rgba(0,0,0,0.45)]">
        {attachment && (
          <div className="flex items-center gap-2 px-4 sm:px-5 pt-3">
            <div className="relative">
              {attachment.kind === 'image' ? (
                <img src={attachment.previewUrl} alt="Anexo" className="size-12 rounded-lg object-cover ring-1 ring-white/10" />
              ) : (
                <div className="flex items-center justify-center size-12 rounded-lg bg-white/5 ring-1 ring-white/10 text-brand-400">
                  <FileText className="size-5" />
                </div>
              )}
              {uploading && (
                <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/50">
                  <Loader2 className="size-4 text-white animate-spin" />
                </div>
              )}
              <button
                onClick={() => setAttachment(null)}
                className="absolute -top-1.5 -right-1.5 flex items-center justify-center size-4.5 rounded-full bg-base ring-1 ring-white/20 text-faint hover:text-ink"
                aria-label="Remover anexo"
              >
                <X className="size-3" />
              </button>
            </div>
            <span className="text-xs text-muted truncate max-w-[220px]">
              {uploading
                ? `Enviando arquivo... ${uploadPct}%`
                : attachment.kind === 'pdf'
                  ? `${attachment.name} — a IA vai ler o documento`
                  : 'Foto anexada — a IA de Visão vai analisá-la'}
            </span>
          </div>
        )}
        {fileError && <p className="px-4 sm:px-5 pt-2 text-xs text-red-400">{fileError}</p>}

        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          className="w-full resize-none bg-transparent text-[15px] text-ink placeholder-faint px-4 sm:px-5 pt-3 pb-2 focus:outline-none min-h-[50px] max-h-[160px]"
        />
        <div className="flex items-center justify-between px-3 pb-3 pt-1">
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleFile(file)
                e.target.value = ''
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              title="Anexar foto ou PDF (matrícula, IPTU, escritura...)"
              className="flex items-center justify-center size-8 rounded-lg bg-white/5 hover:bg-white/10 text-muted hover:text-ink transition-colors"
            >
              <Paperclip className="size-4" />
            </button>
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5 text-[11px] font-medium text-muted">
              <Sparkles className="size-3.5 text-brand-400" />
              <span>Gemini 2.5 Flash</span>
            </div>
          </div>
          <button
            onClick={handleSubmit}
            disabled={(!message.trim() && !attachment) || disabled || uploading || (!!attachment && !attachment.blobUrl)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-500 text-white transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 shadow-[0_0_20px_rgba(22,63,158,0.35)]"
          >
            <span className="hidden sm:inline">Enviar</span>
            <SendHorizontal className="size-4" />
          </button>
        </div>
      </div>
    </div>
  )
})

export default ChatInput
