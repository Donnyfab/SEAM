// Visual check: seeds artwork in different colours and screenshots the glass screens. Usage: node scripts/shots.mjs <outdir>
import { chromium } from 'playwright-core'
import os from 'node:os'; import path from 'node:path'; import fs from 'node:fs'
import { seed } from './seed.mjs'
const out = process.argv[2] ?? '.'; const url = 'http://localhost:4182/SEAM/'
const root = path.join(os.homedir(), 'Library/Caches/ms-playwright')
const exe = fs.readdirSync(root).filter(d => d.startsWith('chromium_headless_shell-')).sort().map(d => path.join(root, d, 'chrome-headless-shell-mac-arm64/chrome-headless-shell')).filter(fs.existsSync).pop()
const b = await chromium.launch({ executablePath: exe }); const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' }); const p = await c.newPage()
p.on('pageerror', e => console.log('ERR', e.message))
await p.goto(url); await seed(p)
await p.evaluate(async () => {
  const mk = async (c1, c2) => { const cv = document.createElement('canvas'); cv.width = cv.height = 256; const g = cv.getContext('2d'); const gr = g.createLinearGradient(0, 0, 256, 256); gr.addColorStop(0, c1); gr.addColorStop(1, c2); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); return new Promise(r => cv.toBlob(r, 'image/jpeg', .9)) }
  const db = await new Promise(res => { const r = indexedDB.open('seam-art'); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result) })
  const arts = [['#1b5bd6', '#0a2a66'], ['#d83a3a', '#5a1010'], ['#e0a020', '#6a3a10'], ['#2fa87a', '#0c3a30']]
  const blobs = []; for (const a of arts) blobs.push(await mk(...a))
  const tx = db.transaction('kv', 'readwrite'); blobs.forEach((bl, i) => tx.objectStore('kv').put(bl, 'seed-' + (i * 61 % 3000))); await new Promise(r => tx.oncomplete = r)
})
await p.goto(url); await p.waitForSelector('.pl-card'); await p.waitForTimeout(800)
await p.screenshot({ path: `${out}/1-playlists.png` })
const open = async n => { await p.locator('.pl-card', { hasText: 'Playlist ' + n }).locator('button').first().evaluate(b => b.click()); await p.waitForSelector('.pd-hero'); await p.waitForTimeout(1600) }
await open(0); await p.screenshot({ path: `${out}/2-detail-blue.png` })
await p.locator('.pd-nav .pd-circle').first().click(); await p.waitForSelector('.pl-card'); await open(1); await p.screenshot({ path: `${out}/3-detail-red.png` })
await p.locator('.pd-actions button[aria-label="Play all"]').click(); await p.waitForSelector('.mini'); await p.waitForTimeout(600)
await p.locator('.mini .mini-main').click(); await p.waitForSelector('.sheet.np'); await p.waitForTimeout(1500); await p.screenshot({ path: `${out}/4-now-playing.png` })
await b.close()
