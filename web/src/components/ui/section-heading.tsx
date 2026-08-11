import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

interface SectionHeadingProps {
  eyebrow?: string
  title: string
  description?: string
  align?: 'center' | 'left'
  className?: string
}

export function SectionHeading({ eyebrow, title, description, align = 'center', className }: SectionHeadingProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className={cn('max-w-2xl', align === 'center' ? 'mx-auto text-center' : 'text-left', className)}
    >
      {eyebrow && (
        <div className={cn('inline-flex items-center gap-2 mb-4', align === 'center' ? 'justify-center' : '')}>
          <span className="h-px w-6 bg-brand-500/60" />
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-400">{eyebrow}</span>
          <span className="h-px w-6 bg-brand-500/60" />
        </div>
      )}
      <h2 className="font-display text-3xl sm:text-4xl md:text-[2.75rem] font-semibold tracking-tight text-ink text-balance">
        {title}
      </h2>
      {description && (
        <p className="mt-4 text-base sm:text-lg text-muted text-balance leading-relaxed">{description}</p>
      )}
    </motion.div>
  )
}

export default SectionHeading
