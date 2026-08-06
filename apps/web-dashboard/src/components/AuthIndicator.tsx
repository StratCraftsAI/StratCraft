/**
 * TICKET_1027 (rewrite): Auth indicator showing user identity
 *
 * Shows user email + plan badge when logged in,
 * or "Local only" when not authenticated.
 */

import { useTranslation } from 'react-i18next'
import { getAuthSession, logoutSession, type AuthMode } from '../auth-session.ts'
import { DASHBOARD_COLORS } from '../constants'

interface Props {
  onLogout: () => void
}

export function AuthIndicator({ onLogout }: Props) {
  const { t } = useTranslation('dashboard')
  const session = getAuthSession()
  const mode: AuthMode = session?.mode ?? 'none'

  const handleLogout = async () => {
    await logoutSession()
    onLogout()
  }

  if (mode === 'login' && session?.user) {
    const { user } = session
    const planColor = user.plan === 'GOLD'
      ? DASHBOARD_COLORS.AMBER
      : user.plan === 'PRO'
        ? DASHBOARD_COLORS.PRIMARY
        : DASHBOARD_COLORS.GRAY_500

    return (
      <div style={containerStyle}>
        <span style={planBadgeStyle(planColor)}>{user.plan}</span>
        <span style={emailStyle}>{user.email}</span>
        <button onClick={() => void handleLogout()} style={logoutBtnStyle}>{t('auth.signOut')}</button>
      </div>
    )
  }

  return (
    <div style={containerStyle}>
      <span style={dotStyle(DASHBOARD_COLORS.GRAY_500)} />
      <span style={textStyle}>{t('auth.localOnly')}</span>
      <button onClick={() => void handleLogout()} style={logoutBtnStyle}>{t('auth.signIn')}</button>
    </div>
  )
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 11,
  padding: '2px 8px',
  borderRadius: 4,
  background: 'rgba(128, 128, 128, 0.1)',
}

const emailStyle: React.CSSProperties = {
  color: 'var(--text-2)',
  maxWidth: 160,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

function planBadgeStyle(color: string): React.CSSProperties {
  return {
    fontSize: 8,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    color,
    border: `1px solid ${color}40`,
    background: `${color}20`,
    borderRadius: 3,
    padding: '1px 5px',
  }
}

function dotStyle(color: string): React.CSSProperties {
  return {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: color,
    flexShrink: 0,
  }
}

const textStyle: React.CSSProperties = {
  color: 'var(--text-2)',
}

const logoutBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--text-muted)',
  fontSize: 10,
  cursor: 'pointer',
  textDecoration: 'underline',
  padding: 0,
  marginLeft: 4,
}
