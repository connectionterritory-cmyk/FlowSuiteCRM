import { useMediaQuery } from './useMediaQuery'

export function useBreakpoint() {
  const isPhone = useMediaQuery('(max-width: 600px)')
  const isMobile = useMediaQuery('(max-width: 720px)')
  const isTablet = useMediaQuery('(min-width: 721px) and (max-width: 1024px)')
  const isDesktop = useMediaQuery('(min-width: 1025px)', true)

  return {
    isPhone,
    isMobile,
    isTablet,
    isDesktop,
  }
}
