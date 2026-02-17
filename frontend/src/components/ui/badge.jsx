import * as React from 'react'
import { cva } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border border-slate-300 px-2.5 py-1 text-xs font-semibold',
  {
    variants: {
      variant: {
        default: 'bg-white text-ink',
        accent: 'bg-accent text-white border-accent',
        success: 'bg-success text-white border-success',
        warning: 'bg-warning text-white border-warning',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

const Badge = React.forwardRef(({ className, variant, ...props }, ref) => (
  <div ref={ref} className={cn(badgeVariants({ variant, className }))} {...props} />
))
Badge.displayName = 'Badge'

export { Badge }
