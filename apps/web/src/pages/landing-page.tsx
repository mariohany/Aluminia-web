import { Header } from '@/components/layout/header'
import { Footer } from '@/components/layout/footer'
import { Hero } from '@/components/sections/hero'
import { Problem } from '@/components/sections/problem'
import { HowItWorks } from '@/components/sections/how-it-works'
import { Features } from '@/components/sections/features'
import { WhoItsFor } from '@/components/sections/who-its-for'
import { Comparison } from '@/components/sections/comparison'
import { QuoteSection } from '@/components/sections/quote-section'
import { Faq } from '@/components/sections/faq'

export function LandingPage() {
  return (
    <>
      <Header />
      <main id="top">
        <Hero />
        <Problem />
        <HowItWorks />
        <Features />
        <WhoItsFor />
        <Comparison />
        <QuoteSection />
        <Faq />
      </main>
      <Footer />
    </>
  )
}
