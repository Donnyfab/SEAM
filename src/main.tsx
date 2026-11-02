import { options, render, type VNode } from 'preact'
import { App } from './ui/App'
import { boot } from './state'
import './ui/styles.css'
import { registerSW } from 'virtual:pwa-register'

// Preact 11 no longer appends "px" to numeric inline styles; keep the ergonomic form working.
const UNITLESS = /^(flex|flexGrow|flexShrink|opacity|zIndex|order|lineHeight|fontWeight|zoom)$/
const prevVNode = options.vnode
options.vnode = (vnode: VNode) => {
  const style = (vnode.props as { style?: unknown } | null)?.style
  if (style && typeof style === 'object') {
    const o = style as Record<string, unknown>
    for (const k in o) { const v = o[k]; if (typeof v === 'number' && v !== 0 && !UNITLESS.test(k)) o[k] = `${v}px` }
  }
  prevVNode?.(vnode)
}

performance.mark('seam:script-start')
registerSW({ immediate: true })
void boot().then(() => performance.mark('seam:ready'))
render(<App />, document.getElementById('app')!)
