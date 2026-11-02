import { useEffect, useRef } from 'preact/hooks'
import { getEngine, settings } from '../state'

/** Audio-reactive canvas driven by the engine's analyser. Pauses drawing when not visible. */
export function Visualizer({ height = 110 }: { height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const mode = settings.value.visualizer
  useEffect(() => {
    const c = ref.current
    if (!c || mode === 'off') return
    const an = getEngine().analyser
    const bins = new Uint8Array(an.frequencyBinCount), wave = new Uint8Array(an.fftSize)
    const g = c.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    let raf = 0
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#0a84ff'
    const draw = () => {
      const w = c.clientWidth, h = c.clientHeight
      if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr) }
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h)
      g.fillStyle = accent; g.strokeStyle = accent; g.lineWidth = 2
      if (mode === 'bars') {
        an.getByteFrequencyData(bins)
        const n = 32, bw = w / n
        for (let i = 0; i < n; i++) {
          const lo = Math.floor(Math.pow(i / n, 1.8) * bins.length * 0.8), hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1) / n, 1.8) * bins.length * 0.8))
          let m = 0; for (let k = lo; k < hi; k++) m = Math.max(m, bins[k]!)
          const bh = Math.max(2, (m / 255) * h)
          g.globalAlpha = 0.55 + 0.45 * (m / 255); g.beginPath(); g.roundRect(i * bw + 1, h - bh, bw - 2, bh, 3); g.fill()
        }
      } else if (mode === 'wave') {
        an.getByteTimeDomainData(wave); g.beginPath()
        for (let i = 0; i < wave.length; i++) { const x = (i / (wave.length - 1)) * w, y = (wave[i]! / 255) * h; i ? g.lineTo(x, y) : g.moveTo(x, y) }
        g.stroke()
      } else {
        an.getByteFrequencyData(bins)
        const cx = w / 2, cy = h / 2, r0 = Math.min(w, h) * 0.22, n = 64
        for (let i = 0; i < n; i++) {
          const v = bins[Math.floor((i / n) * bins.length * 0.7)]! / 255, a = (i / n) * Math.PI * 2 - Math.PI / 2, r1 = r0 + v * Math.min(w, h) * 0.28
          g.globalAlpha = 0.5 + 0.5 * v; g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); g.stroke()
        }
      }
      raf = requestAnimationFrame(draw)
    }
    const onVis = () => { cancelAnimationFrame(raf); if (!document.hidden) raf = requestAnimationFrame(draw) }
    document.addEventListener('visibilitychange', onVis)
    raf = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', onVis) }
  }, [mode])
  if (mode === 'off') return null
  return <canvas ref={ref} aria-hidden="true" style={{ width: '100%', height, display: 'block', marginTop: 12 }} />
}
