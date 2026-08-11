import { useRef, useState } from 'react'
import { motion, useMotionValue, useSpring, useTransform, type MotionValue } from 'framer-motion'
import type { LucideIcon } from 'lucide-react'

export interface DockItem {
  href: string
  label: string
  icon: LucideIcon
}

interface DockIconProps {
  item: DockItem
  mouseX: MotionValue<number>
  onSelect: (href: string) => void
}

function DockIcon({ item, mouseX, onSelect }: DockIconProps) {
  const ref = useRef<HTMLButtonElement>(null)
  const [hovered, setHovered] = useState(false)

  const distance = useTransform(mouseX, (val) => {
    const bounds = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 }
    return val - bounds.x - bounds.width / 2
  })

  const sizeSync = useTransform(distance, [-120, 0, 120], [34, 46, 34])
  const size = useSpring(sizeSync, { mass: 0.15, stiffness: 220, damping: 16 })

  return (
    <motion.button
      ref={ref}
      style={{ width: size, height: size }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onSelect(item.href)}
      whileTap={{ scale: 0.92 }}
      className="relative flex items-center justify-center shrink-0"
    >
      <motion.span
        animate={{ y: hovered ? -3 : 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 17 }}
        className="flex items-center justify-center size-full rounded-xl text-muted hover:text-ink transition-colors"
      >
        <item.icon className="size-[45%]" />
      </motion.span>

      <motion.span
        initial={false}
        animate={{ opacity: hovered ? 1 : 0, y: hovered ? -8 : 4, scale: hovered ? 1 : 0.85 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-surface border border-white/10 px-2 py-1 text-[11px] text-ink pointer-events-none shadow-lg shadow-black/30"
      >
        {item.label}
      </motion.span>
    </motion.button>
  )
}

export function SectionDock({ items, onSelect, className }: { items: DockItem[]; onSelect: (href: string) => void; className?: string }) {
  const mouseX = useMotionValue(Infinity)

  return (
    <motion.div
      onMouseMove={(e) => mouseX.set(e.pageX)}
      onMouseLeave={() => mouseX.set(Infinity)}
      className={`flex items-end gap-1.5 rounded-2xl border border-white/10 bg-white/[0.03] px-2.5 py-1.5 ${className ?? ''}`}
    >
      {items.map((item) => (
        <DockIcon key={item.href} item={item} mouseX={mouseX} onSelect={onSelect} />
      ))}
    </motion.div>
  )
}

export default SectionDock
