import { forwardRef } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cn } from '../lib/cn'
import { buttonVariants, type ButtonVariantProps } from './button.variants'

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  ButtonVariantProps & {
    /** Renderiza el hijo (p. ej. <a>) con los estilos del botón. */
    asChild?: boolean
  }

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, type, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      ref={ref}
      // Evita envíos accidentales de formularios; no aplica al usar asChild.
      type={asChild ? undefined : (type ?? 'button')}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
})
