// Repeatable UI benchmark: headless Chromium, phone viewport, 4x CPU throttle, 3000-song seeded library.
// Usage: node scripts/bench.mjs <baseUrl>   (e.g. http://localhost:4173/SEAM/)
import { chromium } from 'playwright-core'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { seed } from './seed.mjs'

const url = process.argv[2] ?? 'http://localhost:4173/SEAM/'
const root = path.join(os.homedir(), 'Library/Caches/ms-playwright')
const exe = fs.readdirSync(root).filter(d => d.startsWith('chromium_headless_shell-')).sort().map(d => path.join(root, d, 'chrome-headless-shell-mac-arm64/chrome-headless-shell')).filter(fs.existsSync).pop()
const THROTTLE = Number(process.env.THROTTLE ?? 4)

const browser = await chromium.launch({ executablePath: exe, headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block' })
const page = await ctx.newPage()
const cdp = await ctx.newCDPSession(page)

// ---- seed 3000 songs + 40 playlists (metadata only) ----
await page.goto(url)
await seed(page)

await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE })
const out = { throttle: `${THROTTLE}x CPU`, viewport: '390x844' }

// ---- startup ----
await page.goto(url, { waitUntil: 'load' })
await page.waitForSelector('.pl-card', { timeout: 20000 })
out.startup = await page.evaluate(() => {
  const m = Object.fromEntries(performance.getEntriesByType('mark').map(x => [x.name, Math.round(x.startTime)]))
  const res = performance.getEntriesByType('resource').filter(r => r.name.endsWith('.js'))
  return { ...m, jsFiles: res.length, jsKB: Math.round(res.reduce((s, r) => s + (r.decodedBodySize || 0), 0) / 1024), fcp: Math.round(performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? -1), dom: document.querySelectorAll('*').length }
})
out.startup.lcp = await page.evaluate(() => new Promise(r => { let v = -1; new PerformanceObserver(l => { const e = l.getEntries(); v = Math.round(e[e.length - 1].startTime) }).observe({ type: 'largest-contentful-paint', buffered: true }); setTimeout(() => r(v), 200) }))
out.startup.cls = await page.evaluate(() => new Promise(r => { let s = 0; new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) s += e.value }).observe({ type: 'layout-shift', buffered: true }); setTimeout(() => r(+s.toFixed(3)), 200) }))

const frame = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
async function timed(label, action, ready) {
  const t0 = Date.now(); await action(); await frame(); out[label + '_toFrameMs'] = Date.now() - t0
  if (ready) { await page.waitForSelector(ready, { timeout: 15000 }); out[label + '_toReadyMs'] = Date.now() - t0 }
}
const tab = n => page.locator('.tabbar button').nth(n)

// ---- navigation ----
await timed('library', () => tab(1).click(), '.large-title')
await timed('songs', () => page.evaluate(() => [...document.querySelectorAll('.row')].find(r => r.textContent.includes('Songs')).click()), '.row .art') // direct click: Playwright would wait for entrance animations to finish
await page.waitForTimeout(500)
out.songsDom = await page.evaluate(() => document.querySelectorAll('*').length)

// ---- scroll smoothness over the 3000 songs ----
out.scroll = await page.evaluate(async () => {
  const view = document.querySelector('.view'); const ft = []; let last = performance.now()
  for (let i = 0; i < 120; i++) { view.scrollTop += 180; await new Promise(r => requestAnimationFrame(r)); const n = performance.now(); ft.push(n - last); last = n }
  ft.sort((a, b) => a - b)
  return { frames: ft.length, p50: +ft[60].toFixed(1), p95: +ft[Math.floor(ft.length * 0.95)].toFixed(1), max: +ft.at(-1).toFixed(1), over33ms: ft.filter(x => x > 33.4).length }
})

// ---- search typing latency (time to next frame after each keystroke) ----
await page.evaluate(() => { document.querySelector('.view').scrollTop = 0 })
const lat = []
const box = page.locator('input[type=search]').first()
await box.click()
for (const ch of 'neon 12') { const t0 = Date.now(); await page.keyboard.type(ch); await frame(); lat.push(Date.now() - t0) }
out.searchKeystrokeMs = lat
await page.waitForTimeout(400)

// ---- tab switching / playlists grid ----
await timed('toPlaylists', () => tab(0).click(), '.pl-card')
out.playlistsDom = await page.evaluate(() => document.querySelectorAll('*').length)
await timed('openPlaylist', () => page.evaluate(() => document.querySelector('.pl-card button').click()), '.detail-hero') // direct click: Playwright's click would wait out the card entrance animation
await timed('toSettings', () => tab(4).click(), '.large-title')

// ---- playback: tap-to-sound latency and render cost while the Now Playing sheet is open ----
await page.evaluate(async () => {
  const wav = (secs, hz) => { const sr = 8000, n = secs * sr, b = new ArrayBuffer(44 + n * 2), v = new DataView(b), w = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true)
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(2 * Math.PI * hz * i / sr) * 8000, true); return new Blob([b], { type: 'audio/wav' }) }
  const db = await new Promise((res, rej) => { const r = indexedDB.open('seam-files'); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
  const tx = db.transaction('kv', 'readwrite'); for (let i = 0; i < 40; i++) tx.objectStore('kv').put(wav(60, 200 + i * 20), 'seed-' + i); await new Promise(r => tx.oncomplete = r)
})
await tab(1).click(); await page.waitForTimeout(400)
if (await page.locator('.nav .side').count()) { await page.locator('.nav .side').first().click(); await page.waitForTimeout(300) }
await page.waitForSelector('.large-title')
await page.locator('.row', { hasText: 'Songs' }).first().click(); await page.waitForSelector('.row .art')
await page.locator('input[type=search]').first().fill('') // ensure full list
const firstRow = page.locator('.group .row button.row, .group .row.row').first()
await page.evaluate(() => { window.__t = performance.now() })
await page.evaluate(() => { document.querySelector('.group .row button').click() })
await page.waitForFunction(() => [...document.querySelectorAll('.mini .ctl')].some(b => b.textContent.includes('❚❚')), null, { timeout: 15000 })
out.tapToPlayingMs = Math.round(await page.evaluate(() => performance.now() - window.__t))
await page.evaluate(() => { (document.querySelector('.mini-main') ?? document.querySelector('.mini > div')).click() })
await page.waitForSelector('.sheet')
await page.waitForTimeout(600)
out.playback = await page.evaluate(async () => {
  let muts = 0; const mo = new MutationObserver(l => { muts += l.length }); mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true })
  const long = []; new PerformanceObserver(l => long.push(...l.getEntries().map(e => Math.round(e.duration)))).observe({ entryTypes: ['longtask'] })
  const ft = []; let last = performance.now(); const end = last + 4000
  while (performance.now() < end) { await new Promise(r => requestAnimationFrame(r)); const n = performance.now(); ft.push(n - last); last = n }
  mo.disconnect(); ft.sort((a, b) => a - b)
  return { seconds: 4, mutationsPerSec: Math.round(muts / 4), longTasks: long.length, frames: ft.length, p95: +ft[Math.floor(ft.length * 0.95)].toFixed(1) }
})
console.log(JSON.stringify(out, null, 2))
await browser.close()
