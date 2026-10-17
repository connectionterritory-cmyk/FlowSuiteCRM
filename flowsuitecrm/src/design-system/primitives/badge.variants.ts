import { cva, type VariantProps } from 'class-variance-authority'

export const badgeVariants = cva(
  [
    'tw:inline-flex tw:items-center tw:gap-1 tw:whitespace-nowrap',
    'tw:rounded-fs-full tw:border tw:border-transparent tw:px-2.5 tw:py-0.5',
    'tw:text-fs-xs tw:font-semibold tw:leading-4',
  ],
  {
    variants: {
      variant: {
        neutral: 'tw:bg-fs-neutral-soft tw:text-fs-neutral-fg',
        info: 'tw:bg-fs-info-soft tw:text-fs-info-fg',
        success: 'tw:bg-fs-success-soft tw:text-fs-success-fg',
        warning: 'tw:bg-fs-warning-soft tw:text-fs-warning-fg',
        danger: 'tw:bg-fs-danger-soft tw:text-fs-danger-soft-fg',
        outline: 'tw:bg-transparent tw:text-fs-fg tw:border-fs-border',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
)

export type BadgeVariantProps = VariantProps<typeof badgeVariants>
