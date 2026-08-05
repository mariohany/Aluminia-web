import { useTranslation } from 'react-i18next'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Section } from '@/components/layout/section'

const itemKeys = ['isolation', 'migration', 'learningCurve', 'mobile', 'pricing', 'arabic'] as const

export function Faq() {
  const { t } = useTranslation('faq')

  return (
    <Section id="faq" className="bg-secondary/30">
      <div className="mx-auto max-w-2xl">
        <h2 className="text-center text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          {t('heading')}
        </h2>

        <Accordion type="single" collapsible defaultValue={itemKeys[0]} className="mt-10">
          {itemKeys.map((key) => (
            <AccordionItem key={key} value={key}>
              <AccordionTrigger>{t(`items.${key}.question`)}</AccordionTrigger>
              <AccordionContent className="text-muted-foreground">{t(`items.${key}.answer`)}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </Section>
  )
}
