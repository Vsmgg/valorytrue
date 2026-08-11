import type { ComponentType } from 'react'
import { useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { Navbar } from '@/components/Navbar'
import { Footer } from '@/components/Footer'
import { AmbientBackground } from '@/components/ui/ambient-background'
import { Home } from '@/pages/Home'
import { Login } from '@/pages/Login'
import { Admin } from '@/pages/Admin'
import { MinhaConta } from '@/pages/MinhaConta'
import { EmpresaAvaliadoraWizard } from '@/pages/EmpresaAvaliadoraWizard'
import { AvmClienteFinal } from '@/pages/AvmClienteFinal'
import { ReavaliacaoCarteiras } from '@/pages/ReavaliacaoCarteiras'
import { Bancos } from '@/pages/Bancos'
import { useRoute, navigate } from '@/lib/router'
import { useAuth } from '@/lib/auth-context'

const MODULE_ROUTES: Record<string, ComponentType> = {
  '/empresa-avaliadora': EmpresaAvaliadoraWizard,
  '/avm-cliente-final': AvmClienteFinal,
  '/reavaliacao-carteiras': ReavaliacaoCarteiras,
  '/bancos': Bancos,
}

function FullScreenSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-base">
      <Loader2 className="size-6 animate-spin text-brand-400" />
    </div>
  )
}

function App() {
  const path = useRoute()
  const { user, loading } = useAuth()
  const ModulePage = MODULE_ROUTES[path]
  const isAdminRoute = path === '/admin'
  const isAccountRoute = path === '/minha-conta'

  useEffect(() => {
    if (loading) return
    if (!user && (ModulePage || isAdminRoute || isAccountRoute)) {
      navigate('/login')
    } else if (user && isAdminRoute && !user.isAdmin) {
      navigate('/')
    }
  }, [loading, user, ModulePage, isAdminRoute, isAccountRoute])

  if (path === '/login') {
    return (
      <>
        <AmbientBackground />
        <Login />
      </>
    )
  }

  if (isAdminRoute) {
    if (loading || !user || !user.isAdmin) {
      return <FullScreenSpinner />
    }
    return (
      <>
        <AmbientBackground />
        <div className="min-h-screen">
          <Admin />
        </div>
      </>
    )
  }

  if (isAccountRoute) {
    if (loading || !user) {
      return <FullScreenSpinner />
    }
    return (
      <>
        <AmbientBackground />
        <div className="min-h-screen">
          <Navbar />
          <MinhaConta />
          <Footer />
        </div>
      </>
    )
  }

  if (ModulePage) {
    if (loading || !user) {
      return <FullScreenSpinner />
    }
    return (
      <>
        <AmbientBackground />
        <div className="min-h-screen">
          <ModulePage />
        </div>
      </>
    )
  }

  return (
    <>
      <AmbientBackground />
      <div className="min-h-screen">
        <Navbar />
        <Home />
        <Footer />
      </div>
    </>
  )
}

export default App
