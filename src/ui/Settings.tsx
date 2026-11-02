import { Sound } from './Sound'
import { getEngine, settings, updateSettings } from '../state'

export function Settings() {
  const s = settings.value
  const standalone = (navigator as unknown as { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches
  return (
    <>
      <div class="large-title">Settings</div>
      <div class="group">
        <label class="field"><span>Default crossfade</span><span class="num">{s.crossfade === 0 ? 'Off' : `${s.crossfade}s`}</span></label>
        <div style={{ padding: '0 14px 10px' }}><input type="range" min={0} max={15} step={1} value={s.crossfade} aria-label="Default crossfade" style={{ '--p': `${(s.crossfade / 15) * 100}%` } as never} onChange={e => void updateSettings({ crossfade: Number((e.target as HTMLInputElement).value) })} /></div>
        <label class="field"><span>Repeat</span>
          <select value={s.repeat} onChange={e => void updateSettings({ repeat: (e.target as HTMLSelectElement).value as typeof s.repeat })} style={{ background: 'var(--bg2)', border: 0, borderRadius: 8, padding: '6px 8px' }}><option value="off">Off</option><option value="all">All</option><option value="one">One</option></select></label>
      </div>
      <Sound />
      <div class="hint">Gapless playback is on whenever crossfade is off. Per-transition crossfades for EPs are set in Studio.</div>
      <div class="group">
        <div class="kv"><span>Installed as app</span><span>{standalone ? 'Yes' : 'No — Share → Add to Home Screen'}</span></div>
        <div class="kv"><span>Audio output rate</span><span>{getEngine().ctx.sampleRate} Hz</span></div>
        <div class="kv"><span>Version</span><span>0.1.0</span></div>
      </div>
      <div class="hint">Everything stays on your device. SEAM has no account, ads or tracking.</div>
    </>
  )
}
