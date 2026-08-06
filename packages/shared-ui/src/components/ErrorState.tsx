import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';

export type ErrorStateVariant = 'inline' | 'block' | 'page';

export interface ErrorStateAction {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
}

export interface ErrorStateProps {
  icon?: React.ReactNode;
  title: string;
  message: string;
  details?: string;
  actions?: ErrorStateAction[];
  variant?: ErrorStateVariant;
  className?: string;
  i18nNamespace?: string;
  primaryActionStyle?: React.CSSProperties;
}

const SLATE_400 = '#94a3b8';
const SLATE_500 = '#64748b';
const SKY_400 = '#38bdf8';
const BG_DEEP = '#0a0a0a';

const dangerBg = 'rgba(239, 68, 68, 0.1)';
const dangerBorder = 'rgba(239, 68, 68, 0.3)';
const dangerText = 'var(--color-danger, rgb(239, 68, 68))';

const secondaryText = `var(--color-text-secondary, ${SLATE_400})`;
const tertiaryText = `var(--color-text-tertiary, ${SLATE_500})`;

function defaultPrimaryStyle(): React.CSSProperties {
  return {
    border: `1px solid var(--color-terminal-accent-primary, ${SKY_400})`,
    background: `var(--color-terminal-accent-primary, ${SKY_400})`,
    color: `var(--color-terminal-bg, ${BG_DEEP})`,
    cursor: 'pointer',
  };
}

function actionStyle(
  variant: ErrorStateAction['variant'],
  primaryOverride?: React.CSSProperties,
): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: variant === 'primary' ? 600 : 500,
    borderRadius: 4,
  };
  if (variant === 'primary') {
    return { ...base, ...(primaryOverride ?? defaultPrimaryStyle()) };
  }
  return {
    ...base,
    border: '1px solid var(--color-terminal-border, rgba(148, 163, 184, 0.3))',
    background: 'transparent',
    color: secondaryText,
    cursor: 'pointer',
  };
}

function ActionButtons({
  actions,
  gap,
  justify,
  primaryActionStyle: primaryOverride,
}: {
  actions: ErrorStateAction[];
  gap: number;
  justify?: string;
  primaryActionStyle?: React.CSSProperties;
}): React.ReactElement | null {
  if (actions.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap, flexWrap: 'wrap', justifyContent: justify }}>
      {actions.map((action, i) => (
        <button
          key={i}
          type="button"
          onClick={action.onClick}
          style={actionStyle(action.variant, primaryOverride)}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

function TechnicalDetails({
  details,
  label,
  marginTop,
  maxWidth,
  width,
  marginBottom,
}: {
  details: string;
  label: string;
  marginTop?: number;
  maxWidth?: number;
  width?: string;
  marginBottom?: number;
}): React.ReactElement {
  return (
    <details style={{ marginTop, maxWidth, width, marginBottom }}>
      <summary style={{ fontSize: marginTop ? 11 : 12, color: tertiaryText, cursor: 'pointer' }}>
        {label}
      </summary>
      <pre style={{
        marginTop: marginTop ? 6 : 8,
        padding: marginTop ? 8 : 12,
        fontSize: 11,
        fontFamily: '"JetBrains Mono", "Fira Code", monospace',
        color: secondaryText,
        background: 'rgba(0, 0, 0, 0.2)',
        borderRadius: 4,
        overflow: 'auto',
        textAlign: maxWidth ? 'left' as const : undefined,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}>
        {details}
      </pre>
    </details>
  );
}

function renderInline(props: ErrorStateProps): React.ReactElement {
  const { title, message, className } = props;
  return (
    <div
      role="alert"
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        color: dangerText,
      }}
    >
      <span style={{ fontWeight: 600 }}>{title}</span>
      <span>{message}</span>
    </div>
  );
}

function renderBlock(props: ErrorStateProps, technicalDetailsLabel: string): React.ReactElement {
  const { icon, title, message, details, actions, className, primaryActionStyle: primaryOverride } = props;
  return (
    <div
      role="alert"
      className={className}
      style={{
        padding: 16,
        borderRadius: 4,
        background: dangerBg,
        border: `1px solid ${dangerBorder}`,
        borderLeft: `3px solid ${dangerText}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span style={{ color: dangerText, flexShrink: 0, marginTop: 2 }}>
          {icon ?? <AlertTriangle size={16} />}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: dangerText, marginBottom: 4 }}>
            {title}
          </div>
          <div style={{ fontSize: 12, color: secondaryText, lineHeight: 1.5 }}>
            {message}
          </div>
          {details && (
            <TechnicalDetails details={details} label={technicalDetailsLabel} marginTop={8} />
          )}
          {actions && actions.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <ActionButtons actions={actions} gap={8} primaryActionStyle={primaryOverride} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function renderPage(props: ErrorStateProps, technicalDetailsLabel: string): React.ReactElement {
  const { icon, title, message, details, actions, className, primaryActionStyle: primaryOverride } = props;
  return (
    <div
      role="alert"
      className={className}
      style={{
        minHeight: '60vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        textAlign: 'center',
      }}
    >
      <span style={{ color: dangerText, marginBottom: 16 }}>
        {icon ?? <AlertTriangle size={48} />}
      </span>
      <div style={{ fontSize: 18, fontWeight: 600, color: dangerText, marginBottom: 8 }}>
        {title}
      </div>
      <div style={{
        fontSize: 14,
        color: secondaryText,
        maxWidth: 480,
        lineHeight: 1.5,
        marginBottom: 16,
      }}>
        {message}
      </div>
      {details && (
        <TechnicalDetails
          details={details}
          label={technicalDetailsLabel}
          maxWidth={600}
          width="100%"
          marginBottom={16}
        />
      )}
      {actions && actions.length > 0 && (
        <ActionButtons actions={actions} gap={12} justify="center" primaryActionStyle={primaryOverride} />
      )}
    </div>
  );
}

export const ErrorState: React.FC<ErrorStateProps> = (props) => {
  const { t } = useTranslation(props.i18nNamespace ?? 'ui');
  const technicalDetailsLabel = t('errorState.technicalDetails');
  const variant = props.variant ?? 'block';
  if (variant === 'inline') return renderInline(props);
  if (variant === 'page') return renderPage(props, technicalDetailsLabel);
  return renderBlock(props, technicalDetailsLabel);
};

export default ErrorState;
