import { t as translate } from '../i18n'
import { Sound } from './Sound'
import { AccessibilitySettings, BackupSettings, LastFmSettings } from './SettingsMore'
import { PasscodeSettings } from './Security'
import { getEngine, settings, updateSettings } from '../state'

const SectionTitle = ({ children }: { children: unknown }) => <div class="hint" style={{ margin: '18px 16px 0', textTransform: 'uppercase' }}>{children as never}</div>

export function Settings() {
  const s = settings.value
  const standalone = (navigator as unknown as { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches
  return (
    <>
      <div class="large-title">{translate("Settings")}</div>
      <div class="group">
        <label class="field"><span>{translate('Language')}</span><select value={s.language} onChange={e => void updateSettings({ language: (e.target as HTMLSelectElement).value as typeof s.language })} style={{ background: 'var(--bg2)', border: 0, borderRadius: 8, padding: '6px 8px' }}><option value="auto">{translate('Automatic')}</option><option value="en">{translate('English')}</option><option value="es">{translate('Spanish')}</option><option value="fr">{translate('French')}</option><option value="de">{translate('German')}</option></select></label>
        <label class="field"><span>{translate("Default crossfade")}</span><span class="num">{s.crossfade === 0 ? translate("Off") : translate('{value}s', { value: s.crossfade })}</span></label>
        <div style={{ padding: '0 14px 10px' }}><input type="range" min={0} max={15} step={1} value={s.crossfade} aria-label={translate("Default crossfade")} style={{ '--p': `${(s.crossfade / 15) * 100}%` } as never} onChange={e => void updateSettings({ crossfade: Number((e.target as HTMLInputElement).value) })} /></div>
        <label class="field"><span>{translate("Normalize volume")}</span><input type="checkbox" checked={s.normalize} onChange={e => void updateSettings({ normalize: (e.target as HTMLInputElement).checked })} /></label>
        {s.normalize && <label class="field"><span>{translate("Target loudness")}</span>
          <select value={s.targetLufs} onChange={e => void updateSettings({ targetLufs: Number((e.target as HTMLSelectElement).value) })} style={{ background: 'var(--bg2)', border: 0, borderRadius: 8, padding: '6px 8px' }}><option value={-14}>{translate("-14 LUFS (streaming)")}</option><option value={-16}>{translate("-16 LUFS")}</option><option value={-18}>{translate("-18 LUFS (quiet)")}</option><option value={-23}>{translate("-23 LUFS (broadcast)")}</option></select></label>}
        <label class="field"><span>{translate("Repeat")}</span>
          <select value={s.repeat} onChange={e => void updateSettings({ repeat: (e.target as HTMLSelectElement).value as typeof s.repeat })} style={{ background: 'var(--bg2)', border: 0, borderRadius: 8, padding: '6px 8px' }}><option value="off">{translate("Off")}</option><option value="all">{translate("All")}</option><option value="one">{translate("One")}</option></select></label>
      </div>
      <div class="group">
        <label class="field"><span>{translate("Visualizer")}</span><select value={s.visualizer} onChange={e => void updateSettings({ visualizer: (e.target as HTMLSelectElement).value as typeof s.visualizer })} style={{ background: 'var(--bg2)', border: 0, borderRadius: 8, padding: '6px 8px' }}><option value="bars">{translate("Bars")}</option><option value="wave">{translate("Waveform")}</option><option value="radial">{translate("Radial")}</option><option value="off">{translate("Off")}</option></select></label>
        <label class="field"><span>{translate("Audiobook skip back")}</span><select value={s.skipBack} onChange={e => void updateSettings({ skipBack: Number((e.target as HTMLSelectElement).value) })} style={{ background: 'var(--bg2)', border: 0, borderRadius: 8, padding: '6px 8px' }}>{[10, 15, 30, 45].map(v => <option value={v}>{v}{translate(" s")}</option>)}</select></label>
        <label class="field"><span>{translate("Audiobook skip forward")}</span><select value={s.skipForward} onChange={e => void updateSettings({ skipForward: Number((e.target as HTMLSelectElement).value) })} style={{ background: 'var(--bg2)', border: 0, borderRadius: 8, padding: '6px 8px' }}>{[10, 15, 30, 45, 60].map(v => <option value={v}>{v}{translate(" s")}</option>)}</select></label>
      </div>
      <Sound />
      <div class="hint">{translate("Gapless playback is on whenever crossfade is off. Per-transition crossfades for EPs are set in Studio.")}</div>
      <SectionTitle>{translate("Accessibility")}</SectionTitle><AccessibilitySettings />
      <SectionTitle>{translate("Last.fm")}</SectionTitle><LastFmSettings />
      <SectionTitle>{translate("Privacy")}</SectionTitle><PasscodeSettings />
      <div class="hint">{translate("The passcode hides SEAM’s screens on this device. It is a convenience lock, not encryption: the files themselves are not encrypted.")}</div>
      <SectionTitle>{translate("Backup & restore")}</SectionTitle><BackupSettings />
      <div class="group">
        <div class="kv"><span>{translate("Installed as app")}</span><span>{standalone ? translate("Yes") : translate("No — Share → Add to Home Screen")}</span></div>
        <div class="kv"><span>{translate("Audio output rate")}</span><span>{getEngine().ctx.sampleRate}{translate(" Hz")}</span></div>
        <div class="kv"><span>{translate("Version")}</span><span>0.1.0</span></div>
      </div>
      <div class="hint">{translate("Everything stays on your device. SEAM has no account, ads or tracking.")}</div>
    </>
  )
}
