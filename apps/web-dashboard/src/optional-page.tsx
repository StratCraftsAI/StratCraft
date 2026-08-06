import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

function createPlaceholder(name: string): ComponentType<any> {
  return function Placeholder() {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', opacity: 0.5 }}>
        <p>{name} is not available in the open-source release.</p>
      </div>
    )
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function optionalPage<P = any>(
  loader: () => Promise<any>,
  exportName: string,
): LazyExoticComponent<ComponentType<P>> {
  return lazy(async () => {
    try {
      const mod = await loader()
      const component = exportName === 'default' ? mod.default : mod[exportName]
      if (!component) throw new Error(`Missing export: ${exportName}`)
      return { default: component as ComponentType<P> }
    } catch {
      return { default: createPlaceholder(exportName) as ComponentType<P> }
    }
  })
}
