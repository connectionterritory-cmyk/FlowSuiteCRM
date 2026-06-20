import { useMemo } from 'react'
import { useAuth } from '../../auth/useAuth'
import { useUsers } from '../../data/useUsers'
import { Badge } from '../../components/Badge'

const getGreetingName = ({
  fullName,
  email,
}: {
  fullName: string
  email: string | null | undefined
}) => {
  if (fullName.trim()) return fullName.trim().split(' ')[0]
  if (email) return email.split('@')[0]
  return 'equipo'
}

export function HubHeader() {
  const { session } = useAuth()
  const { currentUser } = useUsers()

  const displayName = useMemo(() => {
    const metadata = session?.user.user_metadata as Record<string, string> | undefined
    const metadataName =
      metadata?.full_name ||
      metadata?.name ||
      [metadata?.first_name, metadata?.last_name].filter(Boolean).join(' ').trim()

    return (
      [currentUser?.nombre, currentUser?.apellido].filter(Boolean).join(' ').trim() ||
      metadataName ||
      ''
    )
  }, [currentUser?.apellido, currentUser?.nombre, session?.user.user_metadata])

  // Badge: primer nombre si disponible, prefijo de email como último recurso (nunca email completo)
  const badgeName = useMemo(() => {
    if (displayName) return displayName.split(' ')[0]
    const email = session?.user.email
    return email ? email.split('@')[0] : 'Usuario'
  }, [displayName, session?.user.email])

  const roleLabel = currentUser?.rol?.replaceAll('_', ' ') ?? 'usuario'

  const todayLabel = useMemo(
    () =>
      new Intl.DateTimeFormat('es-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      }).format(new Date()),
    [],
  )

  return (
    <section className="hub-hero card">
      <div className="hub-hero-copy">
        <p className="hub-kicker">Connection Worldwide Group</p>
        <h2 className="hub-title">CWG Business Hub</h2>
        <p className="hub-powered">Powered by FlowSuite CRM</p>
        <p className="hub-subtitle">
          Bienvenido, {getGreetingName({ fullName: displayName, email: session?.user.email })}. Aqui esta tu resumen de hoy.
        </p>
        <p className="hub-date">{todayLabel}</p>
      </div>
      <div className="hub-hero-meta">
        <Badge label={badgeName} tone="emerald" />
        <Badge label={roleLabel} tone="gold" />
      </div>
    </section>
  )
}
