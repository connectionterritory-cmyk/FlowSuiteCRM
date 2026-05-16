import { useEffect, useState } from 'react'

const canUseMatchMedia = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'

const getInitialMatch = (query: string, defaultValue: boolean) => {
  if (!canUseMatchMedia()) return defaultValue
  return window.matchMedia(query).matches
}

export function useMediaQuery(query: string, defaultValue = false) {
  const [matches, setMatches] = useState(() => getInitialMatch(query, defaultValue))

  useEffect(() => {
    if (!canUseMatchMedia()) return undefined

    const mediaQuery = window.matchMedia(query)
    const handleChange = () => setMatches(mediaQuery.matches)

    handleChange()

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange)
      return () => mediaQuery.removeEventListener('change', handleChange)
    }

    mediaQuery.addListener(handleChange)
    return () => mediaQuery.removeListener(handleChange)
  }, [query])

  return matches
}
