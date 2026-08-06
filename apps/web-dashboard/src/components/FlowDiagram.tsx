import { useTranslation } from 'react-i18next'
import type { GuidedFlowDiagram, GuidedAction, FlowNode } from '../types'

interface Props {
  data: GuidedFlowDiagram
  onAction: (action: GuidedAction) => void
}

function nodeStatusClass(status: FlowNode['status']): string {
  if (status === 'recommended') return 'active'
  if (status === 'completed') return 'done'
  if (status === 'locked') return 'future'
  return 'next'
}

const NODE_ICONS: Record<string, string> = {
  strategy: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z',
  backtest: 'M3 3v18h18',
  signal: 'M2 12h4l3-9 4 18 3-9h4',
  scoreboard: 'M4 6h16M4 12h16M4 18h10',
  template: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  plugin: 'M8 3v3M16 3v3M8 18v3M16 18v3M3 8h3M18 8h3M3 16h3M18 16h3M8 8h8v8H8z',
  default: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z',
}

function statusLabel(status: FlowNode['status'], t: (key: string) => string): string | null {
  if (status === 'completed') return '✓'
  if (status === 'recommended') return t('flow.youAreHere')
  return null
}

export function FlowDiagram({ data, onAction }: Props) {
  const { t } = useTranslation('dashboard')
  if (data.nodes.length === 0) return null

  const orderedNodes = orderNodes(data.nodes, data.edges)

  return (
    <div className="flowdiagram fade-in" style={{ marginTop: 12 }}>
      <div className="fd-head">
        <h3>{data.title}</h3>
        {data.subtitle && <p>{data.subtitle}</p>}
      </div>

      <div className="fd-spine">
        {orderedNodes.map((node, i) => {
          const cls = nodeStatusClass(node.status)
          const label = statusLabel(node.status, t)
          const isActive = cls === 'done' || cls === 'active'

          return (
            <div key={node.id} style={{ display: 'contents' }}>
              <button
                className={`flow-node ${cls}`}
                onClick={() => node.action && onAction(node.action)}
                style={{ cursor: node.action ? 'pointer' : 'default' }}
                title={node.description}
                disabled={!node.action}
              >
                <div className="fn-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path
                      d={NODE_ICONS[node.icon ?? ''] || NODE_ICONS.default}
                      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <div className="fn-label">{node.label}</div>
                {label && <div className="fn-status">{label}</div>}
                {node.badge && <span className="fd-chip">{node.badge}</span>}
              </button>

              {i < orderedNodes.length - 1 && (
                <div className={`flow-edge-wrap${isActive ? '' : ' inactive'}`}>
                  <svg width="40" height="2" viewBox="0 0 40 2">
                    <line x1="0" y1="1" x2="40" y2="1" stroke="var(--accent)" strokeWidth="2" strokeDasharray="6 4" />
                  </svg>
                  <span className="fe-particle" />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function orderNodes(nodes: FlowNode[], edges: GuidedFlowDiagram['edges']): FlowNode[] {
  if (edges.length === 0) return nodes

  const childSet = new Set(edges.map((e) => e.to))
  const childMap = new Map<string, string[]>()
  for (const e of edges) {
    const arr = childMap.get(e.from) ?? []
    arr.push(e.to)
    childMap.set(e.from, arr)
  }

  const roots = nodes.filter((n) => !childSet.has(n.id))
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const visited = new Set<string>()
  const result: FlowNode[] = []

  function walk(id: string) {
    if (visited.has(id)) return
    visited.add(id)
    const node = nodeMap.get(id)
    if (node) result.push(node)
    for (const child of childMap.get(id) ?? []) {
      walk(child)
    }
  }

  for (const root of roots) walk(root.id)
  for (const node of nodes) {
    if (!visited.has(node.id)) result.push(node)
  }

  return result
}
