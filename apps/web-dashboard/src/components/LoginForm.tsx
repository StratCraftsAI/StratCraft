/**
 * TICKET_1027 (rewrite): InlineAuth Login Form
 *
 * Replicates the desktop InlineAuth (TICKET_564) for the Web Dashboard.
 * 3 steps: email -> verification code -> logged in (or email + password).
 * Calls AUTH_SERVER_BASE_URL/api/auth/* endpoints (see packages/types/src/api-config.ts).
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { DASHBOARD_COLORS, Z_INDEX_DROPDOWN } from '../constants'
import { sendCode, verifyCode, loginWithPassword } from '../auth-session.ts'

const CODE_LENGTH = 6
const RESEND_COOLDOWN_SECONDS = 60
const FOCUS_DELAY_MS = 100

type Step = 'email' | 'code' | 'password'

interface Props {
  onLogin: () => void
  onSkip: () => void
}

export function LoginForm({ onLogin, onSkip }: Props) {
  const { t } = useTranslation('dashboard')
  const [step, setStep] = useState<Step>('email')

  // Email step
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState('')
  const [isSending, setIsSending] = useState(false)

  // Code step
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(''))
  const [codeError, setCodeError] = useState('')
  const [isVerifying, setIsVerifying] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const digitRefs = useRef<(HTMLInputElement | null)[]>([])

  // Password step
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [isLoggingIn, setIsLoggingIn] = useState(false)

  const emailInputRef = useRef<HTMLInputElement>(null)
  const passwordEmailRef = useRef<HTMLInputElement>(null)

  // Focus management
  useEffect(() => {
    if (step === 'email') setTimeout(() => emailInputRef.current?.focus(), FOCUS_DELAY_MS)
    if (step === 'code') setTimeout(() => digitRefs.current[0]?.focus(), FOCUS_DELAY_MS)
    if (step === 'password') setTimeout(() => passwordEmailRef.current?.focus(), FOCUS_DELAY_MS)
  }, [step])

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = setTimeout(() => setResendCooldown((p) => p - 1), 1000)
    return () => clearTimeout(timer)
  }, [resendCooldown])

  // -------------------------------------------------------------------------
  // Email Step
  // -------------------------------------------------------------------------

  const handleSendCode = useCallback(async () => {
    const trimmed = email.trim()
    if (!trimmed) return

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setEmailError(t('login.invalidEmail'))
      return
    }

    setEmailError('')
    setIsSending(true)
    try {
      const result = await sendCode(trimmed)
      if (!result.success) {
        if (result.retryAfter) setResendCooldown(result.retryAfter)
        setEmailError(result.error || t('login.failedToSendCode'))
        return
      }
      setDigits(Array(CODE_LENGTH).fill(''))
      setCodeError('')
      setResendCooldown(RESEND_COOLDOWN_SECONDS)
      setStep('code')
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : t('login.networkError'))
    } finally {
      setIsSending(false)
    }
  }, [email])

  // -------------------------------------------------------------------------
  // Code Step
  // -------------------------------------------------------------------------

  const submitCode = useCallback(
    async (codeDigits: string[]) => {
      const code = codeDigits.join('')
      if (code.length !== CODE_LENGTH) return

      setCodeError('')
      setIsVerifying(true)
      try {
        const result = await verifyCode(email.trim(), code)
        if (!result.success) {
          setCodeError(result.error || t('login.invalidCode'))
          setDigits(Array(CODE_LENGTH).fill(''))
          setTimeout(() => digitRefs.current[0]?.focus(), FOCUS_DELAY_MS)
          return
        }
        onLogin()
      } catch (err) {
        setCodeError(err instanceof Error ? err.message : t('login.networkError'))
        setDigits(Array(CODE_LENGTH).fill(''))
        setTimeout(() => digitRefs.current[0]?.focus(), FOCUS_DELAY_MS)
      } finally {
        setIsVerifying(false)
      }
    },
    [email, onLogin],
  )

  const handleDigitChange = useCallback(
    (index: number, value: string) => {
      if (isVerifying) return
      const digit = value.replace(/\D/g, '').slice(-1)
      setDigits((prev) => {
        const next = [...prev]
        next[index] = digit
        if (digit && index < CODE_LENGTH - 1) {
          setTimeout(() => digitRefs.current[index + 1]?.focus(), 0)
        }
        if (digit && index === CODE_LENGTH - 1 && next.every((d) => d !== '')) {
          setTimeout(() => submitCode(next), 50)
        }
        return next
      })
    },
    [isVerifying, submitCode],
  )

  const handleDigitKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Backspace' && !digits[index] && index > 0) {
        e.preventDefault()
        setDigits((prev) => {
          const next = [...prev]
          next[index - 1] = ''
          return next
        })
        digitRefs.current[index - 1]?.focus()
      }
    },
    [digits],
  )

  const handleDigitPaste = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault()
      const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, CODE_LENGTH)
      if (!pasted) return
      const newDigits = Array(CODE_LENGTH).fill('')
      for (let i = 0; i < pasted.length; i++) newDigits[i] = pasted[i]
      setDigits(newDigits)
      const focusIndex = Math.min(pasted.length, CODE_LENGTH - 1)
      setTimeout(() => digitRefs.current[focusIndex]?.focus(), 0)
      if (pasted.length === CODE_LENGTH) {
        setTimeout(() => submitCode(newDigits), 50)
      }
    },
    [submitCode],
  )

  const handleResend = useCallback(async () => {
    if (resendCooldown > 0 || isSending) return
    setIsSending(true)
    setCodeError('')
    try {
      const result = await sendCode(email.trim())
      if (!result.success) {
        setCodeError(result.error || t('login.failedToResend'))
        return
      }
      setResendCooldown(RESEND_COOLDOWN_SECONDS)
      setDigits(Array(CODE_LENGTH).fill(''))
      setTimeout(() => digitRefs.current[0]?.focus(), FOCUS_DELAY_MS)
    } catch (err) {
      setCodeError(err instanceof Error ? err.message : t('login.networkError'))
    } finally {
      setIsSending(false)
    }
  }, [resendCooldown, isSending, email, t])

  // -------------------------------------------------------------------------
  // Password Step
  // -------------------------------------------------------------------------

  const handlePasswordLogin = useCallback(async () => {
    const trimmedEmail = email.trim()
    if (!trimmedEmail || !password) return

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setPasswordError(t('login.invalidEmail'))
      return
    }

    setPasswordError('')
    setIsLoggingIn(true)
    try {
      const result = await loginWithPassword(trimmedEmail, password)
      if (!result.success) {
        setPasswordError(result.error || t('login.invalidCredentials'))
        return
      }
      onLogin()
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : t('login.networkError'))
    } finally {
      setIsLoggingIn(false)
    }
  }, [email, password, onLogin])

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div style={overlayStyle}>
      <div style={cardStyle}>
        {step === 'email' && (
          <div>
            {/* Branding */}
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={brandingStyle}>{t('login.brand')}</div>
              <h2 style={headingStyle}>{t('login.signInHeading')}</h2>
              <p style={subTextStyle}>{t('login.signInSubtext')}</p>
            </div>

            {/* Email input */}
            <div style={fieldGroupStyle}>
              <div style={inputCardStyle}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span style={inputLabelSmStyle}>{t('login.secureAccess')}</span>
                  <span style={badgeStyle}>{t('login.emailVerification')}</span>
                </div>

                <input
                  ref={emailInputRef}
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setEmailError('') }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && email.trim() && !isSending) handleSendCode()
                  }}
                  placeholder={t('login.emailPlaceholder')}
                  disabled={isSending}
                  style={{
                    ...inputStyle,
                    borderColor: emailError ? 'rgba(248, 113, 113, 0.6)' : 'var(--border)',
                  }}
                />
                {emailError && <p style={errorTextStyle}>{emailError}</p>}

                <button
                  onClick={handleSendCode}
                  disabled={!email.trim() || isSending}
                  style={primaryBtnStyle}
                >
                  {isSending ? t('login.sending') : t('login.continue')}
                </button>
              </div>
            </div>

            {/* Alternative login methods */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 16 }}>
              <button
                onClick={() => { setStep('password'); setPasswordError('') }}
                style={altMethodCardStyle}
              >
                <div style={altMethodTitleStyle}>{t('login.passwordLogin')}</div>
                <div style={altMethodDescStyle}>{t('login.useEmailAndPassword')}</div>
              </button>
              <button onClick={onSkip} style={altMethodCardStyle}>
                <div style={altMethodTitleStyle}>{t('login.skipForNow')}</div>
                <div style={altMethodDescStyle}>{t('login.browseLocalOnly')}</div>
              </button>
            </div>
          </div>
        )}

        {step === 'code' && (
          <div>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <h2 style={headingStyle}>{t('login.checkYourEmail')}</h2>
              <p style={subTextStyle}>
                <Trans
                  i18nKey="login.codeSentTo"
                  t={t}
                  values={{ email }}
                  components={{ 1: <strong style={{ color: 'var(--text)' }} /> }}
                />
              </p>
            </div>

            {/* 6-digit input */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 8 }}>
              {digits.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => { digitRefs.current[i] = el }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleDigitChange(i, e.target.value)}
                  onKeyDown={(e) => handleDigitKeyDown(i, e)}
                  onPaste={i === 0 ? handleDigitPaste : undefined}
                  disabled={isVerifying}
                  style={{
                    ...digitInputStyle,
                    borderColor: codeError ? 'rgba(248, 113, 113, 0.6)' : 'var(--border)',
                  }}
                />
              ))}
            </div>
            {codeError && <p style={{ ...errorTextStyle, textAlign: 'center' }}>{codeError}</p>}

            {isVerifying && (
              <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                {t('login.verifying')}
              </p>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, fontSize: 11 }}>
              <button
                onClick={() => { setStep('email'); setCodeError('') }}
                disabled={isVerifying}
                style={linkBtnStyle}
              >
                &larr; {t('login.changeEmail')}
              </button>
              <button
                onClick={handleResend}
                disabled={resendCooldown > 0 || isSending || isVerifying}
                style={{
                  ...linkBtnStyle,
                  color: resendCooldown > 0 ? 'var(--text-muted)' : DASHBOARD_COLORS.TEAL,
                  cursor: resendCooldown > 0 ? 'not-allowed' : 'pointer',
                }}
              >
                {resendCooldown > 0 ? t('login.resendCountdown', { seconds: resendCooldown }) : t('login.resendCode')}
              </button>
            </div>

            {/* Other methods */}
            <div style={{ marginTop: 20 }}>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                {t('login.otherSignInMethods')}
              </p>
              <ul style={{ listStyle: 'disc', paddingLeft: 16, margin: 0 }}>
                <li>
                  <button
                    onClick={() => { setStep('password'); setPasswordError('') }}
                    style={{ ...linkBtnStyle, color: DASHBOARD_COLORS.TEAL, fontSize: 11 }}
                  >
                    {t('login.usePassword')}
                  </button>
                </li>
              </ul>
            </div>
          </div>
        )}

        {step === 'password' && (
          <div>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <h2 style={headingStyle}>{t('login.logInWithPassword')}</h2>
              <p style={subTextStyle}>{t('login.enterEmailAndPassword')}</p>
            </div>

            {/* Email */}
            <input
              ref={passwordEmailRef}
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setPasswordError('') }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && email.trim() && password && !isLoggingIn) handlePasswordLogin()
              }}
              placeholder={t('login.emailPlaceholder')}
              disabled={isLoggingIn}
              style={{
                ...inputStyle,
                marginBottom: 10,
                borderColor: passwordError ? 'rgba(248, 113, 113, 0.6)' : 'var(--border)',
              }}
            />

            {/* Password */}
            <div style={{ position: 'relative', marginBottom: 8 }}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setPasswordError('') }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && email.trim() && password && !isLoggingIn) handlePasswordLogin()
                }}
                placeholder={t('login.passwordPlaceholder')}
                disabled={isLoggingIn}
                style={{
                  ...inputStyle,
                  paddingRight: 36,
                  borderColor: passwordError ? 'rgba(248, 113, 113, 0.6)' : 'var(--border)',
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((p) => !p)}
                tabIndex={-1}
                style={eyeBtnStyle}
              >
                {showPassword ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
            {passwordError && <p style={errorTextStyle}>{passwordError}</p>}

            <button
              onClick={handlePasswordLogin}
              disabled={!email.trim() || !password || isLoggingIn}
              style={{ ...primaryBtnStyle, marginTop: 12 }}
            >
              {isLoggingIn ? t('login.loggingIn') : t('login.logIn')}
            </button>

            {/* Other methods */}
            <div style={{ marginTop: 20 }}>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                {t('login.otherSignInMethods')}
              </p>
              <ul style={{ listStyle: 'disc', paddingLeft: 16, margin: 0 }}>
                <li>
                  <button
                    onClick={() => { setStep('email'); setEmailError('') }}
                    disabled={isLoggingIn}
                    style={{ ...linkBtnStyle, color: DASHBOARD_COLORS.TEAL, fontSize: 11 }}
                  >
                    {t('login.useVerificationCode')}
                  </button>
                </li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Styles (inline, matching desktop InlineAuth dark theme)
// ---------------------------------------------------------------------------

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0, 0, 0, 0.6)',
  backdropFilter: 'blur(4px)',
  zIndex: Z_INDEX_DROPDOWN,
}

const cardStyle: React.CSSProperties = {
  position: 'relative',
  background: 'var(--panel)',
  border: '1px solid var(--border)',
  borderRadius: 20,
  padding: '32px 28px',
  width: 420,
  maxWidth: '90vw',
  boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.6)',
  overflow: 'hidden',
}

const brandingStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.28em',
  textTransform: 'uppercase' as const,
  color: 'var(--text-muted)',
  marginBottom: 12,
}

const headingStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  color: 'var(--text)',
  margin: 0,
}

const subTextStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-muted)',
  marginTop: 6,
  lineHeight: 1.5,
}

const fieldGroupStyle: React.CSSProperties = {
  marginTop: 0,
}

const inputCardStyle: React.CSSProperties = {
  borderRadius: 14,
  border: '1px solid rgba(255,255,255,0.08)',
  background: 'rgba(0,0,0,0.1)',
  padding: 16,
}

const inputLabelSmStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: '0.22em',
  textTransform: 'uppercase' as const,
  color: 'var(--text-muted)',
}

const badgeStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 500,
  color: DASHBOARD_COLORS.TEAL,
  background: 'rgba(93, 212, 194, 0.1)',
  border: '1px solid rgba(93, 212, 194, 0.25)',
  borderRadius: 99,
  padding: '2px 8px',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  fontSize: 12,
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  color: 'var(--text)',
  outline: 'none',
  boxSizing: 'border-box',
}

const digitInputStyle: React.CSSProperties = {
  width: 40,
  height: 48,
  borderRadius: 6,
  textAlign: 'center' as const,
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  fontSize: 18,
  fontFamily: 'var(--mono)',
  fontWeight: 700,
  outline: 'none',
}

const primaryBtnStyle: React.CSSProperties = {
  width: '100%',
  marginTop: 16,
  padding: '10px 0',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.2em',
  textTransform: 'uppercase' as const,
  background: DASHBOARD_COLORS.TEAL,
  color: DASHBOARD_COLORS.TEAL_BUTTON_TEXT,
  border: 'none',
  borderRadius: 10,
  cursor: 'pointer',
}

const linkBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--text-muted)',
  fontSize: 11,
  cursor: 'pointer',
  padding: 0,
}

const altMethodCardStyle: React.CSSProperties = {
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.1)',
  background: 'rgba(255,255,255,0.03)',
  padding: '10px 12px',
  textAlign: 'left' as const,
  cursor: 'pointer',
}

const altMethodTitleStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  color: 'var(--text)',
}

const altMethodDescStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--text-muted)',
  marginTop: 2,
  lineHeight: 1.4,
}

const errorTextStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--red)',
  marginTop: 4,
  padding: '0 4px',
}

const eyeBtnStyle: React.CSSProperties = {
  position: 'absolute',
  right: 10,
  top: '50%',
  transform: 'translateY(-50%)',
  background: 'none',
  border: 'none',
  color: 'var(--text-muted)',
  cursor: 'pointer',
  padding: 0,
  display: 'flex',
}
