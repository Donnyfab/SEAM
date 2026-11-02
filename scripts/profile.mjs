// CPU profile of one interaction. Usage: node scripts/profile.mjs <baseUrl> <openPlaylist|songs|library>
import { chromium } from 'playwright-core'
import { seed } from './seed.mjs'
import os from 'node:os'; import path from 'node:path'; import fs from 'node:fs'
const url = process.argv[2], what = process.argv[3] ?? 'openPlaylist'
const root = path.join(os.homedir(), 'Library/Caches/ms-playwright')
const exe = fs.readdirSync(root).filter(d => d.startsWith('chromium_headless_shell-')).sort().map(d => path.join(root, d, 'chrome-headless-shell-mac-arm64/chrome-headless-shell')).filter(fs.existsSync).pop()
const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' })
const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page)
await page.goto(url); await seed(page); await page.goto(url); await page.waitForSelector('.pl-card')
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 })
if (what === 'songs') { await page.locator('.tabbar button').nth(1).click(); await page.waitForSelector('.large-title') }
await cdp.send('Profiler.start')
const t0 = Date.now()
if (what === 'openPlaylist') { await page.locator('.pl-card button').first().click(); await page.waitForSelector('.detail-hero') }
if (what === 'songs') { await page.locator('.row', { hasText: 'Songs' }).first().click(); await page.waitForSelector('.row .art') }
if (what === 'library') { await page.locator('.tabbar button').nth(1).click(); await page.waitForSelector('.large-title') }
await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
const ms = Date.now() - t0
const { profile } = await cdp.send('Profiler.stop')
const self = new Map(); const dt = profile.timeDeltas; const idIdx = new Map(profile.nodes.map(n => [n.id, n]))
profile.samples.forEach((id, i) => { const n = idIdx.get(id); const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) ?? 0) + (dt[i] ?? 0)) })
console.log(`${what}: ${ms} ms wall`)
for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log((v / 1000).toFixed(1).padStart(8), 'ms', k)
await browser.close()
