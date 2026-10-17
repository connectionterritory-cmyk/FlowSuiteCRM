import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// Prefijo `tw:` y escala tipográfica FlowSuite (text-fs-*) para que tailwind-merge
// distinga tamaño de fuente de color de texto.
const twMerge = extendTailwindMerge({
  prefix: 'tw',
  extend: {
    theme: {
      text: ['fs-xs', 'fs-sm', 'fs-base', 'fs-lg', 'fs-xl', 'fs-2xl'],
      radius: ['fs-sm', 'fs-md', 'fs-lg', 'fs-full'],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
