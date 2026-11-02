import { useEffect, useState } from 'preact/hooks'
import { artworkUrl } from '../state'
import { formatTime } from '../core/arrangement'

export const fmt = formatTime

export function Art({ id, big }: { id?: string; big?: boolean }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => { let live = true; setUrl(null); if (id) void artworkUrl(id).then(u => live && setUrl(u)); return () => { live = false } }, [id])
  return <div class={`art${big ? ' big' : ''}`} style={url ? { backgroundImage: `url(${url})` } : undefined}>{url ? '' : '♪'}</div>
}

export interface MenuItem { label: string; run: () => void; danger?: boolean }
export function ActionMenu({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  return (
    <div class="menu" onClick={onClose}>
      <div class="panel" onClick={e => e.stopPropagation()}>
        {items.map(i => <button class={i.danger ? 'danger' : ''} onClick={() => { onClose(); i.run() }}>{i.label}</button>)}
        <button onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}

export function fmtBytes(n: number) { return n > 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${(n / 1e6).toFixed(1)} MB` }

/** Save/share a file: iOS share sheet when available, otherwise a normal download. */
export async function saveBlob(blob: Blob, name: string) {
  const file = new File([blob], name, { type: blob.type })
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (nav.canShare?.({ files: [file] })) { try { await nav.share({ files: [file], title: name }); return } catch { /* cancelled → fall through to download */ } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000)
}

