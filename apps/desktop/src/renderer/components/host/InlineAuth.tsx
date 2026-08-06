/**
 * InlineAuth - In-App Email + Verification Code Login/Registration
 *
 * TICKET_564: Desktop In-App Registration
 * Two-step modal: email input -> 6-digit code verification.
 * Falls back to browser OAuth via "Other ways to sign in" link.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  Mail,
  ArrowLeft,
  Loader2,
  X,
  Eye,
  EyeOff,
  Activity,
  ShieldCheck,
  Sparkles,
  LineChart,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks';
import { Z_INDEX_MODAL } from '@shared/constants/z-index';
import { THEME_COLORS } from '@shared/constants/colors';
import { FOCUS_DELAY_MS } from '@shared/constants/timing';

// =============================================================================
// Constants
// =============================================================================

const CODE_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 60;

// =============================================================================
// Types
// =============================================================================

interface InlineAuthProps {
  isOpen: boolean;
  onClose: () => void;
}

type Step = 'email' | 'code' | 'password';

const HERO_PILLAR_KEYS = [
  { key: 'workflows', icon: Sparkles },
  { key: 'backtesting', icon: LineChart },
  { key: 'controls', icon: ShieldCheck },
] as const;

const HERO_STAT_KEYS = ['multistep', 'desktopNative', 'secure'] as const;

// =============================================================================
// InlineAuth Component
// =============================================================================

export function InlineAuth({ isOpen, onClose }: InlineAuthProps) {
  const { t } = useTranslation('ui');
  const { login } = useAuth();

  // Step state
  const [step, setStep] = useState<Step>('email');

  // Email step
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  // Code step
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(''));
  const [codeError, setCodeError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const digitRefs = useRef<(HTMLInputElement | null)[]>([]);
  const emailInputRef = useRef<HTMLInputElement | null>(null);
  const passwordStepEmailRef = useRef<HTMLInputElement | null>(null);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);
  const mouseDownOnBackdropRef = useRef(false);

  // Password step
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStep('email');
      setEmail('');
      setEmailError(null);
      setDigits(Array(CODE_LENGTH).fill(''));
      setCodeError(null);
      setIsSending(false);
      setIsVerifying(false);
      setResendCooldown(0);
      setPassword('');
      setShowPassword(false);
      setPasswordError(null);
      setIsLoggingIn(false);
    }
  }, [isOpen]);

  // Focus email input when modal opens
  useEffect(() => {
    if (isOpen && step === 'email') {
      setTimeout(() => emailInputRef.current?.focus(), FOCUS_DELAY_MS);
    }
  }, [isOpen, step]);

  // Focus first digit input on code step
  useEffect(() => {
    if (isOpen && step === 'code') {
      setTimeout(() => digitRefs.current[0]?.focus(), FOCUS_DELAY_MS);
    }
  }, [isOpen, step]);

  // Focus email input on password step (first field, top-to-bottom order)
  useEffect(() => {
    if (isOpen && step === 'password') {
      setTimeout(() => passwordStepEmailRef.current?.focus(), FOCUS_DELAY_MS);
    }
  }, [isOpen, step]);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown(prev => prev - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  // Keyboard: Escape to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // ---------------------------------------------------------------------------
  // Email Step
  // ---------------------------------------------------------------------------

  const handleSendCode = useCallback(async () => {
    const trimmed = email.trim();
    if (!trimmed) return;

    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setEmailError(t('auth.inline.errors.invalidEmail'));
      return;
    }

    setEmailError(null);
    setIsSending(true);

    try {
      const result = await window.electronAPI.inlineAuth.sendCode(trimmed);
      if (!result.success) {
        if (result.data?.retryAfter) {
          setResendCooldown(result.data.retryAfter);
        }
        setEmailError(result.error || t('auth.inline.errors.sendCodeFailed'));
        return;
      }

      // Move to code step
      setDigits(Array(CODE_LENGTH).fill(''));
      setCodeError(null);
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      setStep('code');
    } catch (error) {
      setEmailError(error instanceof Error ? error.message : t('auth.inline.errors.networkError'));
    } finally {
      setIsSending(false);
    }
  }, [email, t]);

  const handleEmailKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && email.trim() && !isSending) {
        e.preventDefault();
        handleSendCode();
      }
    },
    [email, isSending, handleSendCode]
  );

  // ---------------------------------------------------------------------------
  // Code Step
  // ---------------------------------------------------------------------------

  const submitCode = useCallback(async (codeDigits: string[]) => {
    const code = codeDigits.join('');
    if (code.length !== CODE_LENGTH) return;

    setCodeError(null);
    setIsVerifying(true);

    try {
      const result = await window.electronAPI.inlineAuth.verifyCode(email.trim(), code);
      if (!result.success) {
        setCodeError(result.error || t('auth.inline.errors.invalidCode'));
        // Clear digits for retry
        setDigits(Array(CODE_LENGTH).fill(''));
        setTimeout(() => digitRefs.current[0]?.focus(), FOCUS_DELAY_MS);
        return;
      }

      // Success - AuthService emits stateChanged, useAuth auto-updates, modal closes
      onClose();
    } catch (error) {
      setCodeError(error instanceof Error ? error.message : t('auth.inline.errors.networkError'));
      setDigits(Array(CODE_LENGTH).fill(''));
      setTimeout(() => digitRefs.current[0]?.focus(), FOCUS_DELAY_MS);
    } finally {
      setIsVerifying(false);
    }
  }, [email, onClose, t]);

  const handleDigitChange = useCallback(
    (index: number, value: string) => {
      if (isVerifying) return;

      // Only accept digits
      const digit = value.replace(/\D/g, '').slice(-1);

      setDigits(prev => {
        const next = [...prev];
        next[index] = digit;

        // Auto-focus next input
        if (digit && index < CODE_LENGTH - 1) {
          setTimeout(() => digitRefs.current[index + 1]?.focus(), 0);
        }

        // Auto-submit when all digits filled
        if (digit && index === CODE_LENGTH - 1 && next.every(d => d !== '')) {
          setTimeout(() => submitCode(next), 50);
        }

        return next;
      });
    },
    [isVerifying, submitCode]
  );

  const handleDigitKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Backspace' && !digits[index] && index > 0) {
        e.preventDefault();
        setDigits(prev => {
          const next = [...prev];
          next[index - 1] = '';
          return next;
        });
        digitRefs.current[index - 1]?.focus();
      }
    },
    [digits]
  );

  const handleDigitPaste = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault();
      const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, CODE_LENGTH);
      if (!pasted) return;

      const newDigits = Array(CODE_LENGTH).fill('');
      for (let i = 0; i < pasted.length; i++) {
        newDigits[i] = pasted[i];
      }
      setDigits(newDigits);

      // Focus last filled or next empty
      const focusIndex = Math.min(pasted.length, CODE_LENGTH - 1);
      setTimeout(() => digitRefs.current[focusIndex]?.focus(), 0);

      // Auto-submit if all filled
      if (pasted.length === CODE_LENGTH) {
        setTimeout(() => submitCode(newDigits), 50);
      }
    },
    [submitCode]
  );

  const handleResend = useCallback(async () => {
    if (resendCooldown > 0 || isSending) return;
    setIsSending(true);
    setCodeError(null);

    try {
      const result = await window.electronAPI.inlineAuth.sendCode(email.trim());
      if (!result.success) {
        setCodeError(result.error || t('auth.inline.errors.resendFailed'));
        return;
      }
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      setDigits(Array(CODE_LENGTH).fill(''));
      setTimeout(() => digitRefs.current[0]?.focus(), FOCUS_DELAY_MS);
    } catch (error) {
      setCodeError(error instanceof Error ? error.message : t('auth.inline.errors.networkError'));
    } finally {
      setIsSending(false);
    }
  }, [resendCooldown, isSending, email, t]);

  const handleChangeEmail = useCallback(() => {
    setStep('email');
    setCodeError(null);
    setDigits(Array(CODE_LENGTH).fill(''));
  }, []);

  // ---------------------------------------------------------------------------
  // Password Step
  // ---------------------------------------------------------------------------

  const handlePasswordLogin = useCallback(async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) return;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setPasswordError(t('auth.inline.errors.invalidEmail'));
      return;
    }

    setPasswordError(null);
    setIsLoggingIn(true);

    try {
      const result = await window.electronAPI.inlineAuth.loginWithPassword(trimmedEmail, password);
      if (!result.success) {
        setPasswordError(result.error || t('auth.inline.errors.invalidCredentials'));
        return;
      }

      onClose();
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : t('auth.inline.errors.networkError'));
    } finally {
      setIsLoggingIn(false);
    }
  }, [email, password, onClose, t]);

  const handlePasswordKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && email.trim() && password && !isLoggingIn) {
        e.preventDefault();
        handlePasswordLogin();
      }
    },
    [email, password, isLoggingIn, handlePasswordLogin]
  );

  const handleSwitchToCode = useCallback(() => {
    setStep('email');
    setPasswordError(null);
    setPassword('');
    setShowPassword(false);
  }, []);

  // ---------------------------------------------------------------------------
  // Browser fallback
  // ---------------------------------------------------------------------------

  const handleBrowserLogin = useCallback(async () => {
    onClose();
    try {
      await login();
    } catch {
      // Error handled by useAuth hook
    }
  }, [onClose, login]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!isOpen) return null;

  return createPortal(
    <div
      className={cn(
        'fixed inset-0',
        'flex items-center justify-center',
        'bg-black/60 backdrop-blur-[4px]',
        'animate-in fade-in duration-150'
      )}
      style={{ zIndex: Z_INDEX_MODAL }}
      onMouseDown={() => { mouseDownOnBackdropRef.current = true; }}
      onMouseUp={() => {
        if (mouseDownOnBackdropRef.current) onClose();
        mouseDownOnBackdropRef.current = false;
      }}
    >
      <div
        className={cn(
          'relative overflow-hidden',
          step === 'email'
            ? 'w-[min(1040px,calc(100vw-1rem))] md:w-[min(1040px,calc(100vw-3rem))]'
            : 'w-[min(440px,calc(100vw-1rem))]',
          'bg-color-terminal-panel border border-color-terminal-border',
          'rounded-[28px] shadow-2xl shadow-black/60',
          'animate-in zoom-in-95 duration-200'
        )}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(100,255,218,0.16),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(96,165,250,0.18),transparent_32%)]" />

        {/* Close button */}
        <button
          onClick={onClose}
          className={cn(
            'absolute top-4 right-4 z-10',
            'w-8 h-8 flex items-center justify-center rounded-full',
            'text-color-terminal-text-muted hover:text-white hover:bg-white/10',
            'transition-colors'
          )}
        >
          <X className="w-3.5 h-3.5" />
        </button>

        {step === 'email' ? (
          /* ================================================================= */
          /* Email Step                                                        */
          /* ================================================================= */
          <div className="grid md:grid-cols-[minmax(0,1.15fr)_380px]">
            <section className="relative border-b border-white/10 p-6 sm:p-8 md:border-b-0 md:border-r md:p-10">
              <div className="absolute inset-0 opacity-60">
                <div className="absolute left-8 top-8 h-24 w-24 rounded-full bg-color-terminal-accent-teal/10 blur-3xl" />
                <div className="absolute bottom-12 right-10 h-28 w-28 rounded-full bg-blue-400/10 blur-3xl" />
              </div>

              <div className="relative space-y-8">
                <div className="inline-flex items-center gap-2 rounded-full border border-color-terminal-accent-teal/30 bg-color-terminal-accent-teal/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-color-terminal-accent-teal">
                  <Activity className="h-3.5 w-3.5" />
                  {t('auth.inline.hero.badge')}
                </div>

                <div className="max-w-xl space-y-4">
                  <div className="space-y-3">
                    <p className="text-[11px] uppercase tracking-[0.28em] text-color-terminal-text-secondary">
                      StratCraft
                    </p>
                    <h2 className="max-w-lg text-3xl font-semibold leading-tight text-white md:text-[36px] md:leading-[1.1]">
                      {t('auth.inline.hero.heading')}
                    </h2>
                    <p className="max-w-lg text-sm leading-6 text-color-terminal-text-secondary">
                      {t('auth.inline.hero.tagline')}
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    {HERO_STAT_KEYS.map(statKey => (
                      <div
                        key={statKey}
                        className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 backdrop-blur-sm"
                      >
                        <div className="text-sm font-semibold text-white">
                          {t(`auth.inline.hero.stats.${statKey}.value`)}
                        </div>
                        <div className="mt-1 text-[11px] leading-5 text-color-terminal-text-secondary">
                          {t(`auth.inline.hero.stats.${statKey}.label`)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid gap-3">
                  {HERO_PILLAR_KEYS.map(({ key, icon: Icon }) => (
                    <div
                      key={key}
                      className="flex gap-3 rounded-2xl border border-white/8 bg-black/10 px-4 py-4 backdrop-blur-sm"
                    >
                      <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-color-terminal-accent-teal/20 bg-color-terminal-accent-teal/10">
                        <Icon className="h-[18px] w-[18px] text-color-terminal-accent-teal" />
                      </div>
                      <div className="space-y-1">
                        <h3 className="text-sm font-medium text-white">
                          {t(`auth.inline.hero.pillars.${key}.title`)}
                        </h3>
                        <p className="text-[11px] leading-5 text-color-terminal-text-secondary">
                          {t(`auth.inline.hero.pillars.${key}.description`)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="relative p-6 sm:p-8">
              <div className="space-y-5">
                <div className="space-y-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-color-terminal-accent-teal/25 bg-color-terminal-accent-teal/10">
                    <Mail className="h-5 w-5 text-color-terminal-accent-teal" />
                  </div>
                  <div className="space-y-1.5">
                    <h3 className="text-xl font-semibold text-white">
                      {t('auth.inline.email.heading')}
                    </h3>
                    <p className="text-[12px] leading-5 text-color-terminal-text-secondary">
                      {t('auth.inline.email.description')}
                    </p>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/8 bg-black/10 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-[0.22em] text-color-terminal-text-muted">
                      {t('auth.inline.email.secureAccess')}
                    </span>
                    <span className="rounded-full border border-color-terminal-accent-teal/25 bg-color-terminal-accent-teal/10 px-2 py-1 text-[10px] font-medium text-color-terminal-accent-teal">
                      {t('auth.inline.email.emailVerification')}
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    <input
                      ref={emailInputRef}
                      type="email"
                      value={email}
                      onChange={e => {
                        setEmail(e.target.value);
                        setEmailError(null);
                      }}
                      onKeyDown={handleEmailKeyDown}
                      placeholder={t('auth.inline.email.placeholder')}
                      disabled={isSending}
                      className={cn(
                        'w-full rounded-xl px-3 py-3',
                        'bg-color-terminal-bg border',
                        emailError
                          ? 'border-red-500/60 focus:border-red-500'
                          : 'border-color-terminal-border focus:border-color-terminal-accent-teal',
                        'text-[12px] text-white placeholder:text-color-terminal-text-muted/50',
                        'outline-none transition-colors',
                        'disabled:opacity-50'
                      )}
                    />
                    {emailError && (
                      <p className="px-1 text-[10px] text-red-400">{emailError}</p>
                    )}
                  </div>

                  <button
                    onClick={handleSendCode}
                    disabled={!email.trim() || isSending}
                    className={cn(
                      'mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-3',
                      `bg-color-terminal-accent-teal text-[${THEME_COLORS.TEAL_BUTTON_TEXT}] text-[11px] font-bold uppercase tracking-[0.2em]`,
                      'hover:bg-color-terminal-accent-teal/90',
                      'disabled:opacity-40 disabled:cursor-not-allowed',
                      'transition-colors'
                    )}
                  >
                    {isSending ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        {t('auth.inline.email.sending')}
                      </>
                    ) : (
                      t('auth.inline.email.continueButton')
                    )}
                  </button>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    onClick={() => setStep('password')}
                    className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left transition-colors hover:bg-white/[0.06]"
                  >
                    <div className="text-[11px] font-medium text-white">{t('auth.inline.method.password.title')}</div>
                    <div className="mt-1 text-[10px] leading-4 text-color-terminal-text-secondary">
                      {t('auth.inline.method.password.description')}
                    </div>
                  </button>
                  <button
                    onClick={handleBrowserLogin}
                    className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left transition-colors hover:bg-white/[0.06]"
                  >
                    <div className="text-[11px] font-medium text-white">{t('auth.inline.method.browser.title')}</div>
                    <div className="mt-1 text-[10px] leading-4 text-color-terminal-text-secondary">
                      {t('auth.inline.method.browser.description')}
                    </div>
                  </button>
                </div>

                <p className="text-[10px] leading-5 text-color-terminal-text-secondary">
                  {t('auth.inline.footer')}
                </p>
              </div>
            </section>
          </div>
        ) : step === 'code' ? (
          /* ================================================================= */
          /* Code Step                                                         */
          /* ================================================================= */
          <div className="space-y-5 p-8">
            {/* Header */}
            <div className="text-center space-y-1.5">
              <h2 className="text-base font-bold text-white">
                {t('auth.inline.code.heading')}
              </h2>
              <p className="text-[11px] text-color-terminal-text-muted">
                {t('auth.inline.code.sentTo', { email })}
              </p>
            </div>

            {/* Code inputs */}
            <div className="space-y-1.5">
              <div className="flex justify-center gap-2">
                {digits.map((digit, i) => (
                  <input
                    key={i}
                    ref={el => { digitRefs.current[i] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={e => handleDigitChange(i, e.target.value)}
                    onKeyDown={e => handleDigitKeyDown(i, e)}
                    onPaste={i === 0 ? handleDigitPaste : undefined}
                    disabled={isVerifying}
                    className={cn(
                      'w-10 h-12 rounded text-center',
                      'bg-color-terminal-bg border',
                      codeError
                        ? 'border-red-500/60'
                        : 'border-color-terminal-border focus:border-color-terminal-accent-teal',
                      'text-[18px] font-mono font-bold text-white',
                      'outline-none transition-colors',
                      'disabled:opacity-50'
                    )}
                  />
                ))}
              </div>
              {codeError && (
                <p className="text-[10px] text-red-400 text-center px-1">{codeError}</p>
              )}
            </div>

            {/* Verifying indicator */}
            {isVerifying && (
              <div className="flex items-center justify-center gap-2 text-[11px] text-color-terminal-text-muted">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {t('auth.inline.code.verifying')}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-between text-[10px]">
              <button
                onClick={handleChangeEmail}
                disabled={isVerifying}
                className="flex items-center gap-1 text-color-terminal-text-muted hover:text-white transition-colors disabled:opacity-50"
              >
                <ArrowLeft className="w-3 h-3" />
                {t('auth.inline.code.changeEmail')}
              </button>
              <button
                onClick={handleResend}
                disabled={resendCooldown > 0 || isSending || isVerifying}
                className={cn(
                  'text-color-terminal-accent-teal transition-colors',
                  resendCooldown > 0 || isSending
                    ? 'opacity-40 cursor-not-allowed'
                    : 'hover:text-color-terminal-accent-teal/80'
                )}
              >
                {resendCooldown > 0
                  ? t('auth.inline.code.resendCountdown', { seconds: resendCooldown })
                  : t('auth.inline.code.resendCode')}
              </button>
            </div>

            {/* Other sign-in methods */}
            <div className="space-y-1.5">
              <p className="text-[10px] text-color-terminal-text-muted">
                {t('auth.inline.code.otherWays')}
              </p>
              <ul className="list-disc pl-4 space-y-0.5">
                <li>
                  <button
                    onClick={() => setStep('password')}
                    className="text-[10px] text-color-terminal-accent-teal hover:text-color-terminal-accent-teal/80 transition-colors"
                  >
                    {t('auth.inline.code.usePassword')}
                  </button>
                </li>
                <li>
                  <button
                    onClick={handleBrowserLogin}
                    className="text-[10px] text-color-terminal-accent-teal hover:text-color-terminal-accent-teal/80 transition-colors"
                  >
                    {t('auth.inline.code.loginWithBrowser')}
                  </button>
                </li>
              </ul>
            </div>
          </div>
        ) : (
          /* ================================================================= */
          /* Password Step                                                     */
          /* ================================================================= */
          <div className="space-y-5 p-8">
            {/* Header */}
            <div className="text-center space-y-1.5">
              <h2 className="text-base font-bold text-white">
                {t('auth.inline.password.heading')}
              </h2>
              <p className="text-[11px] text-color-terminal-text-muted">
                {t('auth.inline.password.description')}
              </p>
            </div>

            {/* Email input */}
            <div className="space-y-1.5">
              <input
                ref={passwordStepEmailRef}
                type="email"
                value={email}
                onChange={e => {
                  setEmail(e.target.value);
                  setPasswordError(null);
                }}
                onKeyDown={handlePasswordKeyDown}
                placeholder={t('auth.inline.password.emailPlaceholder')}
                disabled={isLoggingIn}
                className={cn(
                  'w-full px-3 py-2.5 rounded',
                  'bg-color-terminal-bg border',
                  passwordError
                    ? 'border-red-500/60 focus:border-red-500'
                    : 'border-color-terminal-border focus:border-color-terminal-accent-teal',
                  'text-[12px] text-white placeholder:text-color-terminal-text-muted/50',
                  'outline-none transition-colors',
                  'disabled:opacity-50'
                )}
              />
            </div>

            {/* Password input */}
            <div className="space-y-1.5">
              <div className="relative">
                <input
                  ref={passwordInputRef}
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => {
                    setPassword(e.target.value);
                    setPasswordError(null);
                  }}
                  onKeyDown={handlePasswordKeyDown}
                  placeholder={t('auth.passwordPlaceholder')}
                  disabled={isLoggingIn}
                  className={cn(
                    'w-full px-3 py-2.5 pr-9 rounded',
                    'bg-color-terminal-bg border',
                    passwordError
                      ? 'border-red-500/60 focus:border-red-500'
                      : 'border-color-terminal-border focus:border-color-terminal-accent-teal',
                    'text-[12px] text-white placeholder:text-color-terminal-text-muted/50',
                    'outline-none transition-colors',
                    'disabled:opacity-50'
                  )}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(prev => !prev)}
                  tabIndex={-1}
                  className={cn(
                    'absolute right-2.5 top-1/2 -translate-y-1/2',
                    'text-color-terminal-text-muted hover:text-white transition-colors'
                  )}
                >
                  {showPassword ? (
                    <EyeOff className="w-3.5 h-3.5" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
              {passwordError && (
                <p className="text-[10px] text-red-400 px-1">{passwordError}</p>
              )}
            </div>

            {/* Log in button */}
            <button
              onClick={handlePasswordLogin}
              disabled={!email.trim() || !password || isLoggingIn}
              className={cn(
                'w-full py-2.5 rounded',
                'bg-color-terminal-accent-teal text-white text-[11px] font-bold uppercase tracking-wider',
                'hover:bg-color-terminal-accent-teal/90',
                'disabled:opacity-40 disabled:cursor-not-allowed',
                'transition-colors flex items-center justify-center gap-2'
              )}
            >
              {isLoggingIn ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {t('auth.inline.password.loggingIn')}
                </>
              ) : (
                t('auth.inline.password.loginButton')
              )}
            </button>

            {/* Other sign-in methods */}
            <div className="space-y-1.5">
              <p className="text-[10px] text-color-terminal-text-muted">
                {t('auth.inline.code.otherWays')}
              </p>
              <ul className="list-disc pl-4 space-y-0.5">
                <li>
                  <button
                    onClick={handleSwitchToCode}
                    disabled={isLoggingIn}
                    className="text-[10px] text-color-terminal-accent-teal hover:text-color-terminal-accent-teal/80 transition-colors disabled:opacity-50"
                  >
                    {t('auth.inline.password.switchToCode')}
                  </button>
                </li>
                <li>
                  <button
                    onClick={handleBrowserLogin}
                    className="text-[10px] text-color-terminal-accent-teal hover:text-color-terminal-accent-teal/80 transition-colors"
                  >
                    {t('auth.inline.code.loginWithBrowser')}
                  </button>
                </li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

export default InlineAuth;
