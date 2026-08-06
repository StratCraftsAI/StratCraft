import { useTranslation } from 'react-i18next'
import type { GuidedInfoPanel, GuidedAction } from '../types'
import { DEFAULT_INFO_PANEL_HEIGHT_PX } from '../constants'
import { ChatContent } from './ChatContent.tsx'

interface Props {
  data: GuidedInfoPanel
  onAction: (action: GuidedAction) => void
}

export function InfoPanel({ data, onAction }: Props) {
  const { t } = useTranslation('dashboard')
  return (
    <div className="panel" style={{ marginTop: 12, padding: 16 }}>
      <div className="ip-title">{data.title}</div>
      {data.sections.map((section, i) => (
        <div key={i} className="ip-section">
          <div className="ip-heading">{section.heading}</div>
          {/* TICKET_1318 AC9: shared AST, not a second local markdown parser. */}
          <ChatContent className="ip-body" content={section.body} />
        </div>
      ))}
      {data.iframe_url && (
        <div className="viz-wrap" style={{ marginTop: 12 }}>
          <iframe
            src={data.iframe_url}
            style={{ width: '100%', height: data.iframe_height ?? DEFAULT_INFO_PANEL_HEIGHT_PX, border: 'none', display: 'block' }}
            sandbox="allow-scripts allow-same-origin"
            title={data.title}
          />
        </div>
      )}
      {data.next_action && (
        <button
          onClick={() => onAction(data.next_action!)}
          className="btn"
          style={{ marginTop: 12 }}
        >
          {t('infoPanel.continue')}
        </button>
      )}
    </div>
  )
}
