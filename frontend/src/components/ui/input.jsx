import * as React from 'react'
import { cn } from '../../lib/utils'

const Input = React.forwardRef(({ className, type = 'text', ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    className={cn(
      'h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent',
      className
    )}
    {...props}
  />
))
Input.displayName = 'Input'

export { Input }
