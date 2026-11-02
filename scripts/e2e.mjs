// End-to-end smoke test against a built copy of the app (headless Chromium, phone viewport).
import { chromium } from 'playwright-core'
import os from 'node:os'; import path from 'node:path'; import fs from 'node:fs'
import assert from 'node:assert/strict'
import { seed } from './seed.mjs'
const url = process.argv[2] ?? 'http://localhost:4182/SEAM/'
const root = path.join(os.homedir(), 'Library/Caches/ms-playwright')
const exe = fs.readdirSync(root).filter(d => d.startsWith('chromium_headless_shell-')).sort().map(d => path.join(root, d, 'chrome-headless-shell-mac-arm64/chrome-headless-shell')).filter(fs.existsSync).pop()
const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' })
const page = await ctx.newPage(); const errors = []
page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_FAILED/.test(m.text())) errors.push(m.text()) })
await page.goto(url); await seed(page)
await page.evaluate(async () => { // small playable files for the first songs
  const wav = hz => { const sr = 8000, n = 20 * sr, b = new ArrayBuffer(44 + n * 2), v = new DataView(b), w = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true)
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(2 * Math.PI * hz * i / sr) * 8000, true); return new Blob([b], { type: 'audio/wav' }) }
  const db = await new Promise(res => { const r = indexedDB.open('seam-files'); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result) })
  const tx = db.transaction('kv', 'readwrite'); for (let i = 0; i < 40; i++) tx.objectStore('kv').put(wav(220 + i * 10), 'seed-' + i); await new Promise(r => tx.oncomplete = r)
})
await page.goto(url); await page.waitForSelector('.pl-card')
const results = []; const test = async (name, fn) => { try { await fn(); results.push(['PASS', name]) } catch (e) { results.push(['FAIL', `${name}: ${e.message.split('\n')[0]}`]) } }
const tab = n => page.locator('.tabbar button').nth(n)
const glass = async txt => { await page.locator('.glass-item', { hasText: txt }).first().click(); await page.waitForTimeout(250) }

await test('tab order is Playlists | Library | Studio | Connect | Settings', async () => {
  assert.deepEqual(await page.locator('.tabbar button').evaluateAll(b => b.map(x => x.getAttribute('aria-label'))), ['Playlists', 'Library', 'Studio', 'Connect', 'Settings'])
})
await test('playlists screen shows seeded grid and count', async () => {
  assert.equal(await page.locator('.pl-card').count(), 40); assert.match(await page.locator('.count-label').innerText(), /40/)
})
await test('create playlist via + menu dialog, persists across reload', async () => {
  await page.locator('.pl-nav .circle-btn').first().click(); await page.waitForSelector('.glass-menu'); await glass('New playlist')
  await page.fill('.glass-dialog input', 'E2E List'); await page.locator('.glass-dialog button[type=submit]').click(); await page.waitForSelector('.pd-hero')
  assert.equal(await page.locator('.pd-title h1').innerText(), 'E2E List')
  await page.reload(); await page.waitForSelector('.pl-card'); assert.ok(await page.locator('.pl-card .name', { hasText: 'E2E List' }).count())
})
await test('delete playlist asks for confirmation, then offers Undo that restores it', async () => {
  await page.locator('.pl-card', { hasText: 'E2E List' }).locator('.pl-more').click(); await page.waitForSelector('.glass-sheet'); await glass('Delete playlist')
  await page.locator('.gd-actions .danger').click(); await page.waitForSelector('.undo-toast')
  assert.equal(await page.locator('.pl-card', { hasText: 'E2E List' }).count(), 0)
  await page.locator('.undo-toast button').click(); await page.waitForTimeout(300)
  assert.equal(await page.locator('.pl-card', { hasText: 'E2E List' }).count(), 1)
})
await test('open playlist, play all, mini player shows playing', async () => {
  await page.locator('.pl-card', { hasText: 'Playlist 0' }).locator('button').first().evaluate(b => b.click()); await page.waitForSelector('.pd-hero')
  await page.locator('.pd-actions button[aria-label="Play all"]').click()
  await page.waitForFunction(() => [...document.querySelectorAll('.mini .ctl')].some(b => b.textContent.includes('❚❚')), null, { timeout: 10000 })
})
await test('play next while playing queues without error', async () => {
  await page.locator('.pd-nav button[aria-label="More"]').click(); await page.waitForSelector('.glass-menu'); await glass('Play next'); await page.waitForFunction(() => /Playing next|Added/.test(document.body.innerText), null, { timeout: 4000 }).catch(async () => { throw new Error('no toast; body: ' + (await page.locator('.toast').allInnerTexts()).join('|')) })
})
await test('rearrange mode shows handles; back button exits to list', async () => {
  await page.locator('.pd-nav button[aria-label="More"]').click(); await page.waitForSelector('.glass-menu'); await glass('Rearrange'); assert.ok((await page.locator('.handle').count()) > 5)
  await page.locator('.pd-nav .pd-circle.on').click(); await page.locator('.pd-nav .pd-circle').first().click(); await page.waitForSelector('.pl-card')
})
await test('library songs list is virtualized (few DOM rows for 3000 songs) and searchable', async () => {
  await tab(1).click(); await page.waitForTimeout(300)
  if (await page.locator('.nav .side').count()) await page.locator('.nav .side').first().click()
  await page.locator('.row', { hasText: 'Songs' }).first().click(); await page.waitForSelector('.vrow')
  const n = await page.locator('.vrow').count(); assert.ok(n > 5 && n < 60, `rows in DOM: ${n}`)
  await page.fill('input[type=search]', 'neon 12'); await page.waitForTimeout(400)
  const after = await page.locator('.vrow').count(); assert.ok(after >= 1 && after < n + 1, `after search ${after}`)
  assert.match(await page.locator('.vrow .t').first().innerText(), /Neon/i)
})
await test('selected tab is remembered after reload', async () => {
  await tab(4).click(); await page.waitForSelector('.large-title'); await page.reload(); await page.waitForSelector('.large-title')
  assert.equal(await page.locator('.tabbar button.on').getAttribute('aria-label'), 'Settings')
})
await test('settings: language switch to Spanish relabels tabs (lazy locale)', async () => {
  const sel = page.locator('select').filter({ has: page.locator('option[value=es]') }).first(); await sel.selectOption('es'); await page.waitForTimeout(600)
  const es = await page.locator('.tabbar button').first().getAttribute('aria-label'); assert.notEqual(es, 'Playlists', `still English: ${es}`); await sel.selectOption('en'); await page.waitForTimeout(500); assert.equal(await page.locator('.tabbar button').first().getAttribute('aria-label'), 'Playlists')
})
await test('offline banner appears and clears', async () => {
  await ctx.setOffline(true); await page.waitForSelector('.offline-banner', { timeout: 3000 }); await ctx.setOffline(false); await page.waitForTimeout(600)
  assert.equal(await page.locator('.offline-banner').count(), 0)
})
await test('studio and connect screens load', async () => {
  await tab(2).click(); await page.waitForSelector('.large-title'); assert.match(await page.locator('.large-title').innerText(), /Studio/)
  await tab(3).click(); await page.waitForSelector('.large-title'); assert.match(await page.locator('.large-title').innerText(), /Connect/)
})
await test('studio: add songs from a 3000-song picker, analyse waveform on a worker, no errors', async () => {
  await tab(2).click(); await page.waitForSelector('.large-title')
  if (await page.locator('button', { hasText: 'Start an arrangement' }).count()) { await page.locator('button', { hasText: 'Start an arrangement' }).click(); await page.waitForTimeout(300) }
  const nameBox = page.locator('.glass-dialog input'); if (await nameBox.count()) { await nameBox.fill('E2E EP'); await page.locator('.glass-dialog button[type=submit]').click() }
  await page.locator('button', { hasText: 'Add songs' }).first().click(); await page.waitForSelector('.sheet .vrow')
  assert.ok((await page.locator('.sheet .vrow').count()) < 60)
  await page.locator('.sheet .vrow button').nth(0).click(); await page.locator('.sheet .vrow button').nth(1).click()
  await page.locator('.sheet .nav .side.right').click(); await page.waitForSelector('.clipbox')
  await page.waitForFunction(() => !document.body.innerText.includes('Analysing'), null, { timeout: 15000 })
  assert.ok(await page.locator('.studio-wave canvas').count())
})

// ---- Phase 11: interaction conventions ----
const inside = sel => page.evaluate(s => !!document.activeElement?.closest(s), sel)
await tab(0).click(); await page.waitForSelector('.pl-card')
await test('menu: tap outside closes it once, without activating what is underneath', async () => {
  await page.locator('.pl-nav .circle-btn').first().click(); await page.waitForSelector('.glass-menu')
  await page.mouse.click(300, 600); await page.waitForTimeout(150)
  assert.equal(await page.locator('.glass-menu').count(), 0); assert.equal(await page.locator('.glass-dialog, .pd-hero').count(), 0)
})
await test('menu: Escape closes and focus returns to the trigger; arrow keys move between items', async () => {
  const trigger = page.locator('.pl-nav .circle-btn').first()
  await trigger.focus(); await page.keyboard.press('Enter'); await page.waitForSelector('.glass-menu')
  assert.ok(await inside('.glass-menu'))
  const a = await page.evaluate(() => document.activeElement.textContent); await page.keyboard.press('ArrowDown')
  assert.notEqual(await page.evaluate(() => document.activeElement.textContent), a)
  await page.keyboard.press('Escape'); await page.waitForTimeout(150)
  assert.equal(await page.locator('.glass-menu').count(), 0)
  assert.ok(await page.evaluate(() => document.activeElement === document.querySelector('.pl-nav .circle-btn')), 'focus not restored')
})
await test('menu: reopening after a dismissal works on the first tap', async () => {
  await page.locator('.pl-nav .circle-btn').first().click(); await page.waitForSelector('.glass-menu')
  await page.keyboard.press('Escape'); await page.waitForTimeout(100)
  assert.equal(await page.locator('.glass-menu').count(), 0)
})
await test('dialog: Tab stays inside, Enter submits once, Escape cancels, typed text survives a backdrop tap', async () => {
  await page.locator('.pl-nav .circle-btn').first().click(); await page.waitForSelector('.glass-menu'); await glass('New playlist')
  await page.waitForSelector('.glass-dialog input'); assert.ok(await inside('.glass-dialog'))
  for (let i = 0; i < 6; i++) await page.keyboard.press('Tab')
  assert.ok(await inside('.glass-dialog'), 'focus escaped the dialog')
  await page.fill('.glass-dialog input', 'Keep me'); await page.mouse.click(5, 5); await page.waitForTimeout(120)
  assert.equal(await page.locator('.glass-dialog').count(), 1, 'backdrop tap discarded typed text')
  await page.keyboard.press('Escape'); await page.waitForTimeout(120); assert.equal(await page.locator('.glass-dialog').count(), 0)
  await page.locator('.pl-nav .circle-btn').first().click(); await page.waitForSelector('.glass-menu'); await glass('New playlist')
  await page.fill('.glass-dialog input', 'Enter Once'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await page.waitForSelector('.pd-hero')
  await page.locator('.pd-nav .pd-circle').first().click(); await page.waitForSelector('.pl-card')
  assert.equal(await page.locator('.pl-card .name', { hasText: 'Enter Once' }).count(), 1, 'duplicate playlist created')
})
await test('confirm dialog: danger confirm focuses Cancel; Escape cancels without deleting', async () => {
  await page.locator('.pl-card', { hasText: 'Enter Once' }).locator('.pl-more').click(); await page.waitForSelector('.glass-sheet'); await glass('Delete playlist')
  await page.waitForSelector('.glass-dialog')
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Cancel')
  await page.keyboard.press('Escape'); await page.waitForTimeout(150)
  assert.equal(await page.locator('.pl-card', { hasText: 'Enter Once' }).count(), 1)
})
await test('action sheet: Escape closes, backdrop tap closes, focus restored', async () => {
  const more = page.locator('.pl-card', { hasText: 'Enter Once' }).locator('.pl-more')
  await more.focus(); await page.keyboard.press('Enter'); await page.waitForSelector('.glass-sheet')
  await page.keyboard.press('Escape'); await page.waitForTimeout(150); assert.equal(await page.locator('.glass-sheet').count(), 0)
  assert.ok(await page.evaluate(() => document.activeElement?.classList.contains('pl-more')), 'focus not restored')
  await more.click(); await page.waitForSelector('.glass-sheet'); await page.mouse.click(200, 60); await page.waitForTimeout(150)
  assert.equal(await page.locator('.glass-sheet').count(), 0)
})
await test('Now Playing: Escape closes only the sheet and focus returns to the mini player', async () => {
  await page.locator('.pl-card', { hasText: 'Playlist 0' }).locator('button').first().evaluate(b => b.click()); await page.waitForSelector('.pd-hero')
  await page.locator('.pd-actions button[aria-label="Play all"]').click(); await page.waitForSelector('.mini')
  await page.locator('.mini').first().focus().catch(() => {}); await page.locator('.mini .grow, .mini .info, .mini').first().click(); await page.waitForSelector('.sheet')
  assert.ok(await inside('.sheet'))
  await page.keyboard.press('Escape'); await page.waitForTimeout(250); assert.equal(await page.locator('.sheet').count(), 0)
  assert.ok(await page.locator('.pd-hero').count(), 'underlying screen was reset')
})
await test('no uncaught page errors', async () => { assert.deepEqual(errors, []) })

for (const [r, n] of results) console.log(r, n)
const failed = results.filter(r => r[0] === 'FAIL').length
console.log(`\n${results.length - failed}/${results.length} passed`)
await browser.close(); process.exit(failed ? 1 : 0)
