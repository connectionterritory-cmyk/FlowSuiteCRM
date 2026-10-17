import { cva, type VariantProps } from 'class-variance-authority'

export const buttonVariants = cva(
  [
    'tw:inline-flex tw:items-center tw:justify-center tw:gap-2 tw:whitespace-nowrap',
    'tw:rounded-fs-md tw:border tw:border-transparent tw:font-medium tw:no-underline',
    'tw:cursor-pointer tw:select-none tw:transition-colors',
    'tw:disabled:cursor-not-allowed tw:disabled:opacity-50',
    'tw:aria-disabled:cursor-not-allowed tw:aria-disabled:opacity-50',
  ],
  {
    variants: {
      variant: {
        default: 'tw:bg-fs-primary tw:text-fs-primary-fg tw:hover:bg-fs-primary-hover',
        secondary: 'tw:bg-fs-neutral-soft tw:text-fs-fg tw:hover:bg-fs-surface-muted',
        outline: 'tw:bg-transparent tw:text-fs-fg tw:border-fs-border tw:hover:bg-fs-neutral-soft',
        ghost: 'tw:bg-transparent tw:text-fs-fg tw:hover:bg-fs-neutral-soft',
        destructive: 'tw:bg-fs-danger tw:text-fs-danger-fg tw:hover:bg-fs-danger-hover',
        link: 'tw:bg-transparent tw:text-fs-link tw:underline tw:hover:opacity-80 tw:px-0',
      },
      size: {
        sm: 'tw:min-h-8 tw:px-3 tw:text-fs-sm',
        md: 'tw:min-h-10 tw:px-4 tw:text-fs-base',
        lg: 'tw:min-h-11 tw:px-5 tw:text-fs-lg',
        icon: 'tw:size-10 tw:p-0 tw:text-fs-base',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
)

export type ButtonVariantProps = VariantProps<typeof buttonVariants>
