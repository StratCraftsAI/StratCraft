import { useTranslation } from 'react-i18next';
import { DASHBOARD_COLORS, DIAGRAM_GRADIENT_COLORS } from '../constants';

export function WelcomeDiagram() {
  const { t } = useTranslation('dashboard');
  return (
    <div
      style={{
        width: '100%',
        border: '1px solid var(--border)',
        borderRadius: 18,
        overflow: 'hidden',
        background: `linear-gradient(180deg, ${DIAGRAM_GRADIENT_COLORS.BG_START} 0%, ${DIAGRAM_GRADIENT_COLORS.BG_END} 100%)`,
        boxShadow: '0 1px 0 rgba(255,255,255,0.02) inset, 0 24px 80px -20px rgba(0,0,0,0.5)',
        marginTop: 16,
      }}
    >
      {/* Iconify for icons */}
      <svg
        viewBox="0 0 1200 650"
        xmlns="http://www.w3.org/2000/svg"
        style={{ display: 'block', width: '100%', height: 'auto' }}
      >
        <defs>
          {/* Flow paths */}
          <path id="p_user_to_dashboard" d="M 220 325 C 280 325, 310 325, 350 325" />
          <path id="p_dashboard_to_mcp" d="M 630 325 C 690 325, 710 325, 740 325" />
          <path id="p_mcp_to_strat" d="M 960 280 C 1010 280, 1030 200, 1060 200" />
          <path id="p_mcp_to_signals" d="M 960 325 C 1010 325, 1030 325, 1060 325" />
          <path id="p_mcp_to_backtest" d="M 960 370 C 1010 370, 1030 450, 1060 450" />

          {/* Gradients */}
          <linearGradient id="cardGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={DIAGRAM_GRADIENT_COLORS.CARD_START} />
            <stop offset="100%" stopColor={DIAGRAM_GRADIENT_COLORS.BG_END} />
          </linearGradient>
          <linearGradient id="tealGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={DIAGRAM_GRADIENT_COLORS.TEAL_CARD_START} />
            <stop offset="100%" stopColor={DIAGRAM_GRADIENT_COLORS.TEAL_CARD_END} />
          </linearGradient>
          <linearGradient id="amberGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={DIAGRAM_GRADIENT_COLORS.AMBER_CARD_START} />
            <stop offset="100%" stopColor={DIAGRAM_GRADIENT_COLORS.AMBER_CARD_END} />
          </linearGradient>

          {/* Glow filters */}
          <filter id="glowTeal" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feFlood floodColor={DASHBOARD_COLORS.TEAL} floodOpacity="0.3" />
            <feComposite in2="blur" operator="in" />
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="glowAmber" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feFlood floodColor={DASHBOARD_COLORS.AMBER} floodOpacity="0.3" />
            <feComposite in2="blur" operator="in" />
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="glowPrimary" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feFlood floodColor={DASHBOARD_COLORS.PRIMARY} floodOpacity="0.25" />
            <feComposite in2="blur" operator="in" />
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* ===== Stage labels ===== */}
        <text
          x="135" y="72" textAnchor="middle"
          style={stageNumStyle}
        >
          01
        </text>
        <text
          x="135" y="92" textAnchor="middle"
          style={{ ...stageLabelStyle, fill: DASHBOARD_COLORS.TEAL }}
        >
          {t('diagram.stageUserInput')}
        </text>

        <text
          x="490" y="72" textAnchor="middle"
          style={stageNumStyle}
        >
          02
        </text>
        <text
          x="490" y="92" textAnchor="middle"
          style={{ ...stageLabelStyle, fill: DASHBOARD_COLORS.PRIMARY }}
        >
          {t('diagram.stageWebDashboard')}
        </text>

        <text
          x="850" y="72" textAnchor="middle"
          style={stageNumStyle}
        >
          03
        </text>
        <text
          x="850" y="92" textAnchor="middle"
          style={{ ...stageLabelStyle, fill: DASHBOARD_COLORS.AMBER }}
        >
          {t('diagram.stageMcpServer')}
        </text>

        <text
          x="1100" y="72" textAnchor="middle"
          style={stageNumStyle}
        >
          04
        </text>
        <text
          x="1100" y="92" textAnchor="middle"
          style={{ ...stageLabelStyle, fill: DASHBOARD_COLORS.PRIMARY }}
        >
          {t('diagram.stageDataLayer')}
        </text>

        {/* ===== Flow lines ===== */}
        <use href="#p_user_to_dashboard" style={flowTeal} />
        <use href="#p_dashboard_to_mcp" style={flowPrimary} />
        <use href="#p_mcp_to_strat" style={flowAmber} />
        <use href="#p_mcp_to_signals" style={flowAmber} />
        <use href="#p_mcp_to_backtest" style={flowAmber} />

        {/* ===== Moving packets ===== */}
        <circle r="5" fill={DASHBOARD_COLORS.TEAL}>
          <animateMotion dur="1.6s" repeatCount="indefinite">
            <mpath href="#p_user_to_dashboard" />
          </animateMotion>
        </circle>
        <circle r="4" fill={DASHBOARD_COLORS.TEAL} opacity="0.6">
          <animateMotion dur="1.6s" begin="0.5s" repeatCount="indefinite">
            <mpath href="#p_user_to_dashboard" />
          </animateMotion>
        </circle>

        <circle r="4.5" fill={DASHBOARD_COLORS.PRIMARY}>
          <animateMotion dur="1.8s" repeatCount="indefinite">
            <mpath href="#p_dashboard_to_mcp" />
          </animateMotion>
        </circle>
        <circle r="3.5" fill={DASHBOARD_COLORS.PRIMARY} opacity="0.6">
          <animateMotion dur="1.8s" begin="0.6s" repeatCount="indefinite">
            <mpath href="#p_dashboard_to_mcp" />
          </animateMotion>
        </circle>

        <circle r="4" fill={DASHBOARD_COLORS.AMBER}>
          <animateMotion dur="2.0s" repeatCount="indefinite">
            <mpath href="#p_mcp_to_strat" />
          </animateMotion>
        </circle>
        <circle r="4" fill={DASHBOARD_COLORS.AMBER}>
          <animateMotion dur="2.0s" begin="0.3s" repeatCount="indefinite">
            <mpath href="#p_mcp_to_signals" />
          </animateMotion>
        </circle>
        <circle r="4" fill={DASHBOARD_COLORS.AMBER}>
          <animateMotion dur="2.0s" begin="0.6s" repeatCount="indefinite">
            <mpath href="#p_mcp_to_backtest" />
          </animateMotion>
        </circle>

        {/* ===== 01: User Input card ===== */}
        <foreignObject x="40" y="230" width="180" height="190">
          <div
            // @ts-expect-error xmlns
            xmlns="http://www.w3.org/1999/xhtml"
            style={{
              width: '100%', height: '100%',
              background: `linear-gradient(135deg, ${DIAGRAM_GRADIENT_COLORS.TEAL_CARD_START} 0%, ${DIAGRAM_GRADIENT_COLORS.TEAL_CARD_END} 100%)`,
              border: `1.5px solid ${DASHBOARD_COLORS.TEAL}`,
              borderRadius: 14,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 10, padding: 16,
              boxShadow: '0 0 36px -10px rgba(93,212,194,0.3), 0 12px 28px -14px rgba(93,212,194,0.3)',
            }}
          >
            <div style={{
              width: 52, height: 52, borderRadius: 13,
              background: DASHBOARD_COLORS.TEAL_BG_DARK, border: `1px solid ${DASHBOARD_COLORS.TEAL}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 16px -4px rgba(93,212,194,0.4)',
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" fill={DASHBOARD_COLORS.TEAL} />
              </svg>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: DASHBOARD_COLORS.TEAL_TEXT_LIGHT, lineHeight: 1.2 }}>
                {t('diagram.userTitle')}
              </div>
              <div style={{
                fontSize: 10, letterSpacing: '0.06em', color: DASHBOARD_COLORS.TEAL_TEXT_MUTED,
                fontFamily: "var(--mono)", marginTop: 4, textTransform: 'uppercase' as const,
              }}>
                {t('diagram.browserInput')}
              </div>
            </div>
            <div style={{
              fontSize: 10, fontWeight: 600, letterSpacing: '0.04em',
              padding: '3px 8px', borderRadius: 99,
              background: 'rgba(93,212,194,0.1)', color: DASHBOARD_COLORS.TEAL,
              border: `1px solid ${DASHBOARD_COLORS.TEAL}`,
              fontFamily: "var(--mono)",
            }}>
              {t('diagram.nlCommands')}
            </div>
          </div>
        </foreignObject>

        {/* ===== 02: Web Dashboard card ===== */}
        <foreignObject x="350" y="190" width="280" height="270">
          <div
            // @ts-expect-error xmlns
            xmlns="http://www.w3.org/1999/xhtml"
            style={{
              width: '100%', height: '100%',
              background: `linear-gradient(135deg, ${DIAGRAM_GRADIENT_COLORS.PRIMARY_CARD_START} 0%, ${DIAGRAM_GRADIENT_COLORS.BG_END} 100%)`,
              border: `1.5px solid ${DASHBOARD_COLORS.PRIMARY}`,
              borderRadius: 14,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 12, padding: 20,
              boxShadow: '0 0 36px -10px rgba(122,143,255,0.25), 0 12px 28px -14px rgba(122,143,255,0.3)',
            }}
          >
            <div style={{
              width: 60, height: 60, borderRadius: '50%',
              background: `radial-gradient(circle at 50% 40%, ${DIAGRAM_GRADIENT_COLORS.CIRCLE_CENTER} 0%, ${DIAGRAM_GRADIENT_COLORS.CIRCLE_EDGE} 100%)`,
              border: `2px solid ${DASHBOARD_COLORS.PRIMARY}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 30px -4px rgba(122,143,255,0.3)',
              position: 'relative' as const,
            }}>
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="3" width="18" height="14" rx="2" stroke={DASHBOARD_COLORS.PRIMARY} strokeWidth="2" />
                <path d="M8 21h8M12 17v4" stroke={DASHBOARD_COLORS.PRIMARY} strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: DASHBOARD_COLORS.PRIMARY_TEXT, lineHeight: 1 }}>
                {t('diagram.dashboardTitle')}
              </div>
              <div style={{
                fontSize: 10, letterSpacing: '0.18em', color: DASHBOARD_COLORS.PRIMARY,
                fontFamily: "var(--mono)", marginTop: 6, textTransform: 'uppercase' as const, fontWeight: 600,
              }}>
                {t('diagram.reactVite')}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 5, alignItems: 'center' }}>
              {[t('diagram.chatUi'), t('diagram.tablesCharts'), t('diagram.iframeViz')].map((label) => (
                <div key={label} style={{
                  fontSize: 10, fontWeight: 600, letterSpacing: '0.04em',
                  padding: '3px 10px', borderRadius: 99,
                  background: 'rgba(122,143,255,0.08)', color: DASHBOARD_COLORS.PRIMARY,
                  border: '1px solid rgba(122,143,255,0.3)',
                  fontFamily: "var(--mono)",
                }}>
                  {label}
                </div>
              ))}
            </div>
          </div>
        </foreignObject>

        {/* ===== 03: MCP Streamable HTTP card (amber black-box style) ===== */}
        <foreignObject x="740" y="210" width="220" height="230">
          <div
            // @ts-expect-error xmlns
            xmlns="http://www.w3.org/1999/xhtml"
            style={{
              width: '100%', height: '100%',
              borderRadius: '50%',
              background: `radial-gradient(circle at 50% 40%, ${DIAGRAM_GRADIENT_COLORS.MCP_ORB_MID} 0%, ${DIAGRAM_GRADIENT_COLORS.MCP_ORB_OUTER} 55%, ${DIAGRAM_GRADIENT_COLORS.MCP_ORB_EDGE} 100%)`,
              border: `2px solid ${DASHBOARD_COLORS.AMBER}`,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 8,
              boxShadow: '0 0 80px -10px rgba(245,176,74,0.22), 0 0 140px -20px rgba(245,176,74,0.3), 0 22px 60px -20px rgba(245,176,74,0.4)',
              position: 'relative' as const,
              overflow: 'hidden',
            }}
          >
            {/* Dashed spinning ring */}
            <div style={{
              position: 'absolute' as const, inset: 8, borderRadius: '50%',
              border: `1px dashed ${DASHBOARD_COLORS.AMBER}`, opacity: 0.35,
              animation: 'spin 26s linear infinite',
              pointerEvents: 'none' as const,
            }} />
            <div style={{
              width: 56, height: 56, borderRadius: '50%',
              background: `radial-gradient(circle at 50% 40%, ${DIAGRAM_GRADIENT_COLORS.AMBER_CARD_START} 0%, ${DIAGRAM_GRADIENT_COLORS.MCP_ICON_EDGE} 100%)`,
              border: `1.5px solid ${DASHBOARD_COLORS.AMBER}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 0 4px rgba(245,176,74,0.1), 0 0 30px -4px rgba(245,176,74,0.22) inset',
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="3" fill={DASHBOARD_COLORS.AMBER} />
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke={DASHBOARD_COLORS.AMBER} strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: DASHBOARD_COLORS.AMBER_TEXT_CREAM, lineHeight: 1, zIndex: 1 }}>
              {t('diagram.mcpTitle')}
            </div>
            <div style={{
              fontSize: 10, letterSpacing: '0.22em', color: DASHBOARD_COLORS.AMBER_TEXT_MUTED,
              fontFamily: "var(--mono)", textTransform: 'uppercase' as const, fontWeight: 600, zIndex: 1,
            }}>
              {t('diagram.streamableHttp')}
            </div>
            <div style={{
              fontSize: 10, color: DASHBOARD_COLORS.AMBER_TEXT_MUTED, fontFamily: "var(--mono)", zIndex: 1, opacity: 0.7,
            }}>
              {t('diagram.toolCount')}
            </div>
            {/* Floating particles */}
            {[
              { left: '22%', top: '25%', delay: '0s', dur: '3.2s' },
              { left: '74%', top: '22%', delay: '0.6s', dur: '3.6s' },
              { left: '18%', top: '72%', delay: '1.2s', dur: '3.4s' },
              { left: '78%', top: '74%', delay: '1.8s', dur: '3.8s' },
            ].map((p, i) => (
              <div key={i} style={{
                position: 'absolute' as const, width: 5, height: 5, borderRadius: '50%',
                background: DASHBOARD_COLORS.AMBER, left: p.left, top: p.top,
                boxShadow: `0 0 8px ${DASHBOARD_COLORS.AMBER}`,
                animation: `float ${p.dur} ease-in-out infinite ${p.delay}`,
                opacity: 0,
              }} />
            ))}
          </div>
        </foreignObject>

        {/* ===== 04: Three output cards ===== */}
        {/* Strategies */}
        <foreignObject x="1060" y="130" width="130" height="140">
          <div
            // @ts-expect-error xmlns
            xmlns="http://www.w3.org/1999/xhtml"
            style={outputCardStyle}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke={DASHBOARD_COLORS.PRIMARY} strokeWidth="2" strokeLinecap="round" />
              <path d="M14 2v6h6M10 13l2 2 4-4" stroke={DASHBOARD_COLORS.PRIMARY} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div style={{ fontSize: 14, fontWeight: 700, color: DASHBOARD_COLORS.PRIMARY_TEXT }}>{t('diagram.strategiesTitle')}</div>
            <div style={outputSubStyle}>{t('diagram.strategiesCount')}</div>
          </div>
        </foreignObject>

        {/* Signals */}
        <foreignObject x="1060" y="280" width="130" height="140">
          <div
            // @ts-expect-error xmlns
            xmlns="http://www.w3.org/1999/xhtml"
            style={outputCardStyle}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M2 12h4l3-9 4 18 3-9h4" stroke={DASHBOARD_COLORS.PRIMARY} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div style={{ fontSize: 14, fontWeight: 700, color: DASHBOARD_COLORS.PRIMARY_TEXT }}>{t('diagram.signalsTitle')}</div>
            <div style={outputSubStyle}>{t('diagram.signalsCount')}</div>
          </div>
        </foreignObject>

        {/* Backtests */}
        <foreignObject x="1060" y="410" width="130" height="140">
          <div
            // @ts-expect-error xmlns
            xmlns="http://www.w3.org/1999/xhtml"
            style={outputCardStyle}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M3 3v18h18" stroke={DASHBOARD_COLORS.PRIMARY} strokeWidth="2" strokeLinecap="round" />
              <path d="M7 14l4-4 4 4 5-5" stroke={DASHBOARD_COLORS.TEAL} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div style={{ fontSize: 14, fontWeight: 700, color: DASHBOARD_COLORS.PRIMARY_TEXT }}>{t('diagram.backtestsTitle')}</div>
            <div style={outputSubStyle}>{t('diagram.backtestsCount')}</div>
          </div>
        </foreignObject>

        {/* ===== Bottom info ===== */}
        <text
          x="600" y="595" textAnchor="middle"
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10, fontWeight: 500, letterSpacing: '0.18em',
            fill: DASHBOARD_COLORS.TEXT_SECONDARY_MUTED, textTransform: 'uppercase' as const,
          }}
        >
          {t('diagram.bottomLabel')}
        </text>

        {/* Legend */}
        <g transform="translate(340, 550)">
          <circle r="4" cx="0" cy="0" fill={DASHBOARD_COLORS.TEAL} />
          <text x="10" y="4" style={legendTextStyle}>{t('diagram.legendUserInput')}</text>

          <circle r="4" cx="130" cy="0" fill={DASHBOARD_COLORS.PRIMARY} />
          <text x="140" y="4" style={legendTextStyle}>{t('diagram.legendDashboardApi')}</text>

          <circle r="4" cx="290" cy="0" fill={DASHBOARD_COLORS.AMBER} />
          <text x="300" y="4" style={legendTextStyle}>{t('diagram.legendMcpTools')}</text>

          <line x1="400" y1="0" x2="430" y2="0" stroke={DASHBOARD_COLORS.PRIMARY} strokeWidth="2" strokeDasharray="5 3" opacity="0.7" />
          <text x="440" y="4" style={legendTextStyle}>{t('diagram.legendAnimatedFlow')}</text>
        </g>

        {/* CSS animations via style tag */}
        <style>{`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
          @keyframes float {
            0%   { opacity: 0; transform: translate(0,0) scale(0.5); }
            20%  { opacity: 0.9; }
            100% { opacity: 0; transform: translate(15px, -20px) scale(1); }
          }
          @keyframes pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.1); }
          }
        `}</style>
      </svg>
    </div>
  )
}

const stageNumStyle: React.CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: 11, fontWeight: 600, fill: DASHBOARD_COLORS.TEXT_SECONDARY_MUTED, letterSpacing: '0.18em',
}

const stageLabelStyle: React.CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: 11, fontWeight: 700, letterSpacing: '0.22em',
  textTransform: 'uppercase',
}

const flowTeal: React.CSSProperties = {
  fill: 'none', stroke: DASHBOARD_COLORS.TEAL, strokeWidth: 2.4,
  strokeLinecap: 'round', strokeDasharray: '7 5', opacity: 0.85,
}

const flowPrimary: React.CSSProperties = {
  fill: 'none', stroke: DASHBOARD_COLORS.PRIMARY, strokeWidth: 2.4,
  strokeLinecap: 'round', strokeDasharray: '7 5', opacity: 0.85,
}

const flowAmber: React.CSSProperties = {
  fill: 'none', stroke: DASHBOARD_COLORS.AMBER, strokeWidth: 2.4,
  strokeLinecap: 'round', strokeDasharray: '7 5', opacity: 0.85,
}

const outputCardStyle: React.CSSProperties = {
  width: '100%', height: '100%',
  background: `linear-gradient(135deg, ${DIAGRAM_GRADIENT_COLORS.PRIMARY_CARD_START} 0%, ${DIAGRAM_GRADIENT_COLORS.BG_END} 100%)`,
  border: `1px solid ${DASHBOARD_COLORS.CARD_BORDER}`, borderRadius: 14,
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  gap: 8, padding: 14,
  boxShadow: '0 6px 18px -10px rgba(0,0,0,0.6)',
}

const outputSubStyle: React.CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: 10, fontWeight: 600, letterSpacing: '0.06em',
  color: DASHBOARD_COLORS.TEXT_MUTED, textTransform: 'uppercase',
}

const legendTextStyle: React.CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: 11, fill: DASHBOARD_COLORS.TEXT_MUTED, fontWeight: 500,
}
