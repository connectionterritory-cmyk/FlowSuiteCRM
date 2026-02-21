import { type FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase/client'
import { Button } from '../../components/Button'
import { useAuth } from '../../auth/AuthProvider'
import logoFull from '../../assets/FlowSuiteCRM_Vector_Antigravity.svg'

export function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { session, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [resetMessage, setResetMessage] = useState<string | null>(null)
  const [resetError, setResetError] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!loading && session) {
      navigate('/dashboard', { replace: true })
    }
  }, [loading, navigate, session])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (signInError) {
      setError(signInError.message)
    } else {
      navigate('/dashboard', { replace: true })
    }

    setSubmitting(false)
  }

  const handleResetPassword = async () => {
    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      setResetError(t('auth.resetMissingEmail'))
      return
    }
    setResetting(true)
    setResetError(null)
    setResetMessage(null)
    const { error: resetErrorResponse } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    if (resetErrorResponse) {
      setResetError(resetErrorResponse.message)
    } else {
      setResetMessage(t('auth.resetSent'))
    }
    setResetting(false)
  }

  return (
    <div className="login-page">
      <div className="login-container">
        <img src={logoFull} alt={t('app.name')} className="login-logo" />
        <div className="login-card">
          <div className="login-brand">
            <h1>{t('app.name')}</h1>
            <p>{t('auth.loginSubtitle')}</p>
          </div>
          <form className="auth-form" onSubmit={handleSubmit}>
            <label className="form-field">
              <span>{t('auth.email')}</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={t('auth.emailPlaceholder')}
                required
              />
            </label>
            <label className="form-field">
              <span>{t('auth.password')}</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={t('auth.passwordPlaceholder')}
                required
              />
            </label>
            {error && <div className="form-error">{error}</div>}
            {resetError && <div className="form-error">{resetError}</div>}
            {resetMessage && <div className="form-success">{resetMessage}</div>}
            <Button type="submit" disabled={submitting}>
              {submitting ? t('auth.signingIn') : t('auth.signIn')}
            </Button>
            <button
              type="button"
              className="inline-link"
              onClick={handleResetPassword}
              disabled={resetting}
            >
              {resetting ? t('auth.resetting') : t('auth.forgotPassword')}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
