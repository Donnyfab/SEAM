import { Component, type ComponentChildren, type ComponentType } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { t as translate } from '../i18n'

export function ScreenSkeleton() {
  return (
    <div aria-busy="true" aria-label={translate('Loading…')} role="status">
      <div class="skeleton" style={{ height: '34px', width: '45%', margin: '14px 16px 18px' }} />
      {[0, 1, 2, 3, 4, 5].map(i => <div class="skeleton sk-row" style={{ opacity: `${1 - i * 0.12}` }} />)}
    </div>
  )
}

/** Code-split screen: the chunk loads on first use (or earlier via preload()) and shows a skeleton meanwhile. */
export function lazyScreen<P extends object>(load: () => Promise<Record<string, unknown>>, pick: string) {
  let C: ComponentType<P> | null = null
  let p: Promise<void> | null = null
  const preload = () => (p ??= load().then(m => { C = m[pick] as ComponentType<P> }).catch(e => { p = null; throw e }))
  const Screen = (props: P) => {
    const [, bump] = useState(0)
    const [failed, setFailed] = useState(false)
    useEffect(() => { if (!C) preload().then(() => bump(n => n + 1), () => setFailed(true)) }, [failed])
    if (C) return <C {...props} />
    if (failed) return <div class="err-box" role="alert"><p>{translate('This screen could not be loaded. Check your connection and try again.')}</p><button class="btn" onClick={() => setFailed(false)}>{translate('Try again')}</button></div>
    return <ScreenSkeleton />
  }
  return { Screen, preload }
}

/** Keeps one broken screen from blanking the whole app. */
export class Boundary extends Component<{ children: ComponentChildren; resetKey?: string }, { err: Error | null; key?: string }> {
  override state = { err: null as Error | null, key: this.props.resetKey }
  static override getDerivedStateFromError(err: Error) { return { err } }
  static override getDerivedStateFromProps(props: { resetKey?: string }, state: { err: Error | null; key?: string }) {
    return props.resetKey !== state.key ? { err: null, key: props.resetKey } : null
  }
  override componentDidCatch(err: Error) { console.error('SEAM screen error', err) }
  override render() {
    if (!this.state.err) return this.props.children
    return (
      <div class="err-box" role="alert">
        <h2>{translate('Something went wrong')}</h2>
        <p style={{ color: 'var(--fg2)' }}>{translate('Your music and playlists are safe. You can try this screen again or reload the app.')}</p>
        <button class="btn" onClick={() => this.setState({ err: null })}>{translate('Try again')}</button>{' '}
        <button class="btn secondary" onClick={() => location.reload()}>{translate('Reload app')}</button>
      </div>
    )
  }
}
