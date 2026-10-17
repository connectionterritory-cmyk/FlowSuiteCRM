import { cn } from '../lib/cn'
import { badgeVariants, type BadgeVariantProps } from './badge.variants'

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & BadgeVariantProps

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
