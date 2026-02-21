import { type FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase/client'
import { Button } from '../../components/Button'
import { useAuth } from '../../auth/AuthProvider'
import logoFull from '../../assets/FlowSuiteCRM_Vector_Antigravity.svg'

export function ResetPasswordPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { session, loading } = useAuth()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (loading) return
    if (!session && !success) {
      setError(t('auth.resetInvalid'))
    }
  }, [loading, session, success, t])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!session) {
      setError(t('auth.resetInvalid'))
      return
    }
    if (password.trim().length < 8) {
      setError(t('auth.resetWeak'))
      return
    }
    if (password !== confirmPassword) {
      setError(t('auth.resetMismatch'))
      return
    }

    setSubmitting(true)
    setError(null)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) {
      setError(updateError.message)
    } else {
      setSuccess(true)
      await supabase.auth.signOut()
      setTimeout(() => navigate('/login', { replace: true }), 1200)
    }
    setSubmitting(false)
  }

  return (
    <div className="login-page">
      <div className="login-container">
        <img src={logoFull} alt={t('app.name')} className="login-logo" />
        <div className="login-card">
          <div className="login-brand">
            <h1>{t('auth.resetTitle')}</h1>
            <p>{t('auth.resetSubtitle')}</p>
          </div>
          {success ? (
            <div className="form-hint">
              <strong>{t('auth.resetSuccess')}</strong>
              <p>{t('auth.resetRedirect')}</p>
            </div>
          ) : (
            <form className="auth-form" onSubmit={handleSubmit}>
              <label className="form-field">
                <span>{t('auth.newPassword')}</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={t('auth.newPasswordPlaceholder')}
                  required
                />
              </label>
              <label className="form-field">
                <span>{t('auth.confirmPassword')}</span>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder={t('auth.confirmPasswordPlaceholder')}
                  required
                />
              </label>
              {error && <div className="form-error">{error}</div>}
              <Button type="submit" disabled={submitting}>
                {submitting ? t('auth.resetting') : t('auth.resetButton')}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
