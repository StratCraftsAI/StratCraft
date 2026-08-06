import type { GuidedChoiceCard, GuidedAction } from '../types'

const ICONS: Record<string, string> = {
  strategy: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z',
  backtest: 'M3 3v18h18',
  signal: 'M2 12h4l3-9 4 18 3-9h4',
  scoreboard: 'M4 6h16M4 12h16M4 18h10',
  template: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  info: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z',
}

interface Props {
  data: GuidedChoiceCard
  onAction: (action: GuidedAction) => void
}

export function ChoiceCard({ data, onAction }: Props) {
  return (
    <div className="choice-grid">
      {data.choices.map((choice) => (
        <button
          key={choice.id}
          onClick={() => onAction(choice.action)}
          className="choice-card"
        >
          <div className="cc-glyph">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d={ICONS[choice.icon] || ICONS.info} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="cc-meta">
            <div className="cc-title">{choice.title}</div>
            <div className="cc-sub">{choice.description}</div>
            {choice.badge && <span className="fd-chip">{choice.badge}</span>}
          </div>
          <div className="cc-arrow">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </button>
      ))}
    </div>
  )
}
