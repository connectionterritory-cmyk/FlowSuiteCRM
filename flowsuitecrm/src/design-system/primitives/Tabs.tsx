import { forwardRef } from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '../lib/cn'

export const Tabs = TabsPrimitive.Root

export const TabsList = forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(function TabsList({ className, ...props }, ref) {
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        // Desplazable en horizontal para pantallas angostas.
        'tw:flex tw:w-full tw:items-end tw:gap-1 tw:overflow-x-auto tw:border-b tw:border-fs-border',
        className,
      )}
      {...props}
    />
  )
})

export const TabsTrigger = forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(function TabsTrigger({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        'tw:-mb-px tw:inline-flex tw:min-h-10 tw:shrink-0 tw:items-center tw:justify-center tw:whitespace-nowrap',
        'tw:cursor-pointer tw:border-0 tw:border-b-2 tw:border-solid tw:border-transparent tw:bg-transparent tw:px-3',
        'tw:text-fs-base tw:font-medium tw:text-fs-muted tw:transition-colors tw:hover:text-fs-fg',
        'tw:disabled:cursor-not-allowed tw:disabled:opacity-50',
        'tw:data-[state=active]:border-fs-primary tw:data-[state=active]:text-fs-fg',
        className,
      )}
      {...props}
    />
  )
})

export const TabsContent = forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...props }, ref) {
  return <TabsPrimitive.Content ref={ref} className={cn('tw:pt-4 tw:text-fs-base tw:text-fs-fg', className)} {...props} />
})
