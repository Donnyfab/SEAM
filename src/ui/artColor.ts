import { useEffect } from 'preact/hooks'
import { artworkUrl } from '../state'
import { extractPalette, mute, NEUTRAL, rgbCss, type Palette } from '../core/palette'

/** Palettes are cached by the artwork's blob URL, which changes whenever the artwork does — so entries never go stale. */
const byUrl = new Map<string, Promise<Palette>>()
const SIZE = 32

function sample(url: string): Promise<Palette> {
  let hit = byUrl.get(url)
  if (!hit) {
    hit = new Promise<Palette>(resolve => {
      const img = new Image(); img.decoding = 'async'
      img.onload = () => {
        try {
          const c = document.createElement('canvas'); c.width = c.height = SIZE
          const ctx = c.getContext('2d', { willReadFrequently: true })!
          ctx.drawImage(img, 0, 0, SIZE, SIZE)
          resolve(extractPalette(ctx.getImageData(0, 0, SIZE, SIZE).data))
        } catch { resolve(NEUTRAL) }
      }
      img.onerror = () => resolve(NEUTRAL)
      img.src = url
    })
    byUrl.set(url, hit)
    if (byUrl.size > 400) byUrl.delete(byUrl.keys().next().value as string)
  }
  return hit
}

export async function artPalette(artId: string | undefined): Promise<Palette> {
  if (!artId) return NEUTRAL
  const url = await artworkUrl(artId, 'sm')
  return url ? sample(url) : NEUTRAL
}

/** A playlist's palette comes from its custom cover, else the first song that has artwork. */
export async function playlistPalette(p: { id: string; customArt?: boolean; trackIds: string[] }): Promise<Palette> {
  if (p.customArt) return artPalette(`pl:${p.id}`)
  for (const id of p.trackIds.slice(0, 6)) {
    const url = await artworkUrl(id, 'sm')
    if (url) return sample(url)
  }
  return NEUTRAL
}

// ---- who owns the backdrop right now: the newest mounted glass screen wins; leaving it hands the colours back ----
interface Entry { id: symbol; pal: Palette }
const stack: Entry[] = []
let shown: Palette = NEUTRAL

function apply() {
  const top = stack[stack.length - 1]
  const root = document.documentElement
  root.classList.toggle('glass-on', !!top)
  if (!top) return // keep the last colours while the backdrop fades out
  shown = top.pal
  root.style.setProperty('--g1', rgbCss(shown.a))
  root.style.setProperty('--g2', rgbCss(shown.b))
  root.style.setProperty('--gl', shown.neutral ? 'rgb(10 132 255)' : rgbCss(mute(shown.a, 0.58, 0.75)))
}

/**
 * Tints the app backdrop with the artwork `resolve` finds. The colours cross-fade in CSS (registered colour
 * properties); a screen that opens starts from whatever is on screen so the change is never a flash.
 */
export function useGlow(resolve: () => Promise<Palette>, key: string) {
  useEffect(() => {
    const entry: Entry = { id: Symbol('glow'), pal: shown }
    stack.push(entry); apply()
    let live = true
    void resolve().then(p => { if (live) { entry.pal = p; apply() } })
    return () => { live = false; const i = stack.indexOf(entry); if (i >= 0) stack.splice(i, 1); apply() }
  }, [key])
}
