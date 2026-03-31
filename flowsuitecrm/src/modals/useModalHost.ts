import { useContext } from 'react'
import { ModalHostContext } from './ModalHostContext'

export function useModalHost() {
  const context = useContext(ModalHostContext)
  if (!context) {
    throw new Error('useModalHost must be used within ModalProvider')
  }
  return context
}

export function useOptionalModalHost() {
  return useContext(ModalHostContext)
}
