import { t as translate } from '../i18n'
import { EQ_BANDS, EQ_PRESETS, EQ_RANGE_DB, defaultFx, normalizeFx, type FxSettings } from '../audio/presets'
import { settings, updateSettings } from '../state'

const label = (f: number) => (f >= 1000 ? translate('{value}k', { value: f / 1000 }) : `${f}`)

function Slider({ name, value, min, max, step, unit, onChange }: { name: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <>
      <label class="field" style={{ paddingBottom: 0 }}><span>{name}</span><span class="num">{unit === '%' ? Math.round(value * 100) : value.toFixed(step < 0.1 ? 2 : 1)}{unit ?? ''}</span></label>
      <div style={{ padding: '0 14px 8px' }}>
        <input type="range" aria-label={name} min={min} max={max} step={step} value={value} style={{ '--p': `${((value - min) / (max - min)) * 100}%` } as never} onInput={e => onChange(Number((e.target as HTMLInputElement).value))} />
      </div>
    </>
  )
}

export function Sound() {
  const fx = normalizeFx(settings.value.fx)
  const set = (p: Partial<FxSettings>) => void updateSettings({ fx: normalizeFx({ ...fx, ...p }) })
  const presetName = Object.entries(EQ_PRESETS).find(([, g]) => g.every((v, i) => v === fx.eq[i]))?.[0] ?? 'Custom'
  return (
    <>
      <div class="hint" style={{ margin: '14px 16px 0', textTransform: 'uppercase' }}>{translate("Sound")}</div>
      <div class="group">
        <label class="field"><span>{translate("Equalizer preset")}</span>
          <select value={presetName} onChange={e => { const n = (e.target as HTMLSelectElement).value; if (EQ_PRESETS[n]) set({ eq: EQ_PRESETS[n] }) }} style={{ background: 'var(--bg2)', border: 0, borderRadius: 8, padding: '6px 8px' }}>
            {presetName === 'Custom' && <option value="Custom">{translate("Custom")}</option>}
            {Object.keys(EQ_PRESETS).map(n => <option value={n}>{translate(n)}</option>)}
          </select></label>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 10px 12px', height: 168 }}>
          {EQ_BANDS.map((f, i) => (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '10%' }}>
              <div style={{ height: 120, width: 28, display: 'grid', placeItems: 'center' }}>
                <input type="range" aria-label={translate("{f} Hz", { f: f })} min={-EQ_RANGE_DB} max={EQ_RANGE_DB} step={0.5} value={fx.eq[i]!} style={{ width: 110, transform: 'rotate(-90deg)', '--p': `${((fx.eq[i]! + EQ_RANGE_DB) / (EQ_RANGE_DB * 2)) * 100}%` } as never}
                  onInput={e => { const eq = [...fx.eq]; eq[i] = Number((e.target as HTMLInputElement).value); set({ eq }) }} />
              </div>
              <span style={{ fontSize: 10, color: 'var(--fg2)' }}>{label(f)}</span>
              <span class="num" style={{ fontSize: 10, color: 'var(--fg2)' }}>{fx.eq[i]! > 0 ? '+' : ''}{fx.eq[i]!.toFixed(0)}</span>
            </div>))}
        </div>
        <Slider name={translate("Preamp")} value={fx.preamp} min={-12} max={12} step={0.5} unit={translate(" dB")} onChange={v => set({ preamp: v })} />
      </div>
      <div class="group">
        <Slider name={translate("Reverb")} value={fx.reverb} min={0} max={1} step={0.01} unit={translate("%")} onChange={v => set({ reverb: v })} />
        <Slider name={translate("Delay mix")} value={fx.delayMix} min={0} max={1} step={0.01} unit={translate("%")} onChange={v => set({ delayMix: v })} />
        <Slider name={translate("Delay time")} value={fx.delayTime} min={0.05} max={1.5} step={0.01} unit={translate(" s")} onChange={v => set({ delayTime: v })} />
        <Slider name={translate("Delay feedback")} value={fx.delayFeedback} min={0} max={0.9} step={0.01} unit={translate("%")} onChange={v => set({ delayFeedback: v })} />
        <Slider name={translate("Distortion")} value={fx.drive} min={0} max={1} step={0.01} unit={translate("%")} onChange={v => set({ drive: v })} />
        <label class="field"><span>{translate("Compressor")}</span><input type="checkbox" checked={fx.compressor} onChange={e => set({ compressor: (e.target as HTMLInputElement).checked })} /></label>
        <button class="row" style={{ color: 'var(--accent)' }} onClick={() => set({ ...defaultFx })}>{translate("Reset all sound settings")}</button>
      </div>
    </>
  )
}
