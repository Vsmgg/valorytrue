import { useAuth } from '@/lib/auth-context'

export function QuotaBadge() {
  const { user } = useAuth()
  if (!user) return null
  return (
    <span className="text-[12px] text-faint px-2.5 py-1 rounded-lg bg-white/5 border border-white/8">
      {user.isAdmin ? 'Admin · avaliações ilimitadas' : `${user.evaluationsUsed}/${user.evaluationsLimit} avaliações usadas`}
    </span>
  )
}

export default QuotaBadge
