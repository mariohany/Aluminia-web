import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'
import { Container } from '@/components/layout/container'

interface SectionProps extends ComponentProps<'section'> {
  containerClassName?: string
}

export function Section({ className, containerClassName, children, ...props }: SectionProps) {
  return (
    <section className={cn('py-16 sm:py-20 lg:py-24', className)} {...props}>
      <Container className={containerClassName}>{children}</Container>
    </section>
  )
}
