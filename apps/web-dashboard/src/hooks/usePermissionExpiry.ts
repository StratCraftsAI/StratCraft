import { useEffect, useState } from 'react'

export function usePermissionExpiry(expiresAt: string | undefined): boolean {
  const [expired, setExpired] = useState(() => expiresAt
    ? Date.parse(expiresAt) <= Date.now()
    : false)

  useEffect(() => {
    if (!expiresAt) {
      setExpired(false)
      return
    }
    const remaining = Date.parse(expiresAt) - Date.now()
    if (remaining <= 0) {
      setExpired(true)
      return
    }
    setExpired(false)
    const timer = window.setTimeout(() => setExpired(true), remaining)
    return () => window.clearTimeout(timer)
  }, [expiresAt])

  return expired
}
