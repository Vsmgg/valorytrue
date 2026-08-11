import { Hero } from '@/components/Hero'
import { MotorCentral } from '@/components/home/MotorCentral'
import { ModulosOverview } from '@/components/home/ModulosOverview'
import { IQGSection } from '@/components/home/IQGSection'
import { Funcionalidades } from '@/components/home/Funcionalidades'
import { ModalidadesEntrega } from '@/components/home/ModalidadesEntrega'
import { Parceiros } from '@/components/home/Parceiros'

export function Home() {
  return (
    <main>
      <Hero />
      <MotorCentral />
      <ModulosOverview />
      <IQGSection />
      <Funcionalidades />
      <ModalidadesEntrega />
      <Parceiros />
    </main>
  )
}

export default Home
