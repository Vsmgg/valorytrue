interface StatItem {
  value: string
  label: string
}

interface StatsMarqueeProps {
  items: StatItem[]
  className?: string
}

export function StatsMarquee({ items, className }: StatsMarqueeProps) {
  const doubled = [...items, ...items]
  return (
    <div className={`relative w-full overflow-hidden border-y border-white/10 bg-white/[0.02] backdrop-blur-sm py-3 mask-fade-x ${className ?? ''}`}>
      <div className="flex w-max items-center gap-10 animate-marquee">
        {doubled.map((item, i) => (
          <div key={i} className="flex items-center gap-2.5 whitespace-nowrap px-2">
            <span className="font-display font-bold text-brand-400 text-sm">{item.value}</span>
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-faint">{item.label}</span>
            <span className="mx-3 h-3 w-px bg-white/15" />
          </div>
        ))}
      </div>
    </div>
  )
}

export default StatsMarquee
