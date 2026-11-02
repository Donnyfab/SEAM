import { useEffect, useState } from 'preact/hooks'
import { signal } from '@preact/signals'
import { createPasscodeRecord, nextLockout, verifyPasscode, type PasscodeRecord } from '../security/passcode'
import { loadPasscode, savePasscode } from '../library/store'
import { notify, settings } from '../state'

export const passcode = signal<PasscodeRecord | null>(null)
export const locked = signal(false)
let hiddenAt = 0

export async function initLock() {
  passcode.value = (await loadPasscode()) ?? null
  locked.value = !!passcode.value
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now()
    else if (passcode.value && hiddenAt && Date.now() - hiddenAt > settings.value.lockAfter * 1000) locked.value = true
  })
}

export function LockScreen() {
  const [code, setCode] = useState(''), [fails, setFails] = useState(0), [wait, setWait] = useState(0), [busy, setBusy] = useState(false)
  useEffect(() => { if (wait <= 0) return; const t = setTimeout(() => setWait(wait - 1), 1000); return () => clearTimeout(t) }, [wait])
  const press = async (d: string) => {
    if (wait > 0 || busy || !passcode.value) return
    const next = (code + d).slice(0, 8); setCode(next)
    if (next.length < 4) return
    // try to verify at every length from 4 up, so any 4–8 digit passcode unlocks without a confirm key
    setBusy(true)
    const ok = await verifyPasscode(next, passcode.value)
    setBusy(false)
    if (ok) { locked.value = false; setCode(''); setFails(0); return }
    if (next.length >= 8) { const f = fails + 1; setFails(f); setWait(nextLockout(f)); setCode('') }
  }
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫']
  return (
    <div class="sheet" role="dialog" aria-label="Locked" style={{ zIndex: 100, alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
      <h2 style={{ margin: '0 0 6px' }}>SEAM is locked</h2>
      <div class="s" style={{ color: 'var(--fg2)', marginBottom: 18 }}>{wait > 0 ? `Too many attempts. Try again in ${wait}s` : 'Enter your passcode'}</div>
      <div aria-live="polite" style={{ fontSize: 28, letterSpacing: 8, height: 40 }}>{'●'.repeat(code.length)}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 76px)', gap: 14, marginTop: 14 }}>
        {keys.map(k => k === '' ? <span /> : (
          <button class="btn secondary" aria-label={k === '⌫' ? 'Delete' : k} disabled={wait > 0} style={{ width: 76, height: 76, borderRadius: 38, fontSize: 28, background: 'var(--bg2)', color: 'var(--fg)' }} onClick={() => (k === '⌫' ? setCode(code.slice(0, -1)) : void press(k))}>{k}</button>))}
      </div>
    </div>
  )
}

export function PasscodeSettings() {
  const rec = passcode.value
  const [mode, setMode] = useState<'idle' | 'set' | 'confirm' | 'remove'>('idle')
  const [first, setFirst] = useState(''), [val, setVal] = useState('')
  const reset = () => { setMode('idle'); setFirst(''); setVal('') }
  const submit = async () => {
    if (!/^\d{4,8}$/.test(val)) return notify('Use 4 to 8 digits')
    if (mode === 'set') { setFirst(val); setVal(''); setMode('confirm'); return }
    if (mode === 'confirm') {
      if (val !== first) { notify('Passcodes did not match'); reset(); return }
      const r = await createPasscodeRecord(val); await savePasscode(r); passcode.value = r; notify('Passcode set'); reset(); return
    }
    if (mode === 'remove' && rec) {
      if (!(await verifyPasscode(val, rec))) { notify('Wrong passcode'); setVal(''); return }
      await savePasscode(null); passcode.value = null; locked.value = false; notify('Passcode removed'); reset()
    }
  }
  return (
    <div class="group">
      {mode === 'idle' && <button class="row" style={{ color: 'var(--accent)' }} onClick={() => setMode(rec ? 'remove' : 'set')}>{rec ? 'Remove passcode' : 'Set passcode…'}</button>}
      {mode !== 'idle' && <>
        <label class="field"><span>{mode === 'confirm' ? 'Repeat passcode' : mode === 'remove' ? 'Current passcode' : 'New passcode (4–8 digits)'}</span>
          <input type="password" inputMode="numeric" maxLength={8} autocomplete="off" value={val} onInput={e => setVal((e.target as HTMLInputElement).value.replace(/\D/g, ''))} style={{ width: 110, background: 'none', border: 0, textAlign: 'right', outline: 0 }} /></label>
        <div class="actions"><button class="btn small" onClick={submit}>Continue</button><button class="btn small secondary" onClick={reset}>Cancel</button></div></>}
      {rec && mode === 'idle' && <label class="field"><span>Lock after leaving app</span><select value={settings.value.lockAfter} onChange={e => void import('../state').then(m => m.updateSettings({ lockAfter: Number((e.target as HTMLSelectElement).value) }))} style={{ background: 'var(--bg2)', border: 0, borderRadius: 8, padding: '6px 8px' }}><option value={0}>Immediately</option><option value={60}>1 minute</option><option value={300}>5 minutes</option><option value={900}>15 minutes</option></select></label>}
    </div>
  )
}
