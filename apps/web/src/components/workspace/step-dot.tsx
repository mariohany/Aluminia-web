import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

/** A numbered/checked dot for a dialog's step indicator. */
export function StepDot({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <span
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-full text-[0.65rem] font-semibold',
        active
          ? 'bg-primary text-primary-foreground'
          : done
            ? 'bg-primary/15 text-primary'
            : 'bg-muted text-muted-foreground',
      )}
    >
      {done ? <Check className="size-3" aria-hidden="true" /> : label}
    </span>
  )
}
