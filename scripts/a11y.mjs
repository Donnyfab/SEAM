// Lightweight accessibility audit over the main screens (no external ruleset): accessible names, labels, landmarks,
// heading, touch-target size (>= 44px, WCAG 2.2 AA 2.5.8 uses 24px; 44px is the iOS guideline) and contrast of text on its background.
import { chromium } from 'playwright-core'
import os from 'node:os'; import path from 'node:path'; import fs from 'node:fs'
import { seed } from './seed.mjs'
const url = process.argv[2] ?? 'http://localhost:4182/SEAM/'
const root = path.join(os.homedir(), 'Library/Caches/ms-playwright')
const exe = fs.readdirSync(root).filter(d => d.startsWith('chromium_headless_shell-')).sort().map(d => path.join(root, d, 'chrome-headless-shell-mac-arm64/chrome-headless-shell')).filter(fs.existsSync).pop()
const browser = await chromium.launch({ executablePath: exe })
const issues = []
for (const scheme of ['dark', 'light']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', colorScheme: scheme })
  const page = await ctx.newPage(); await page.goto(url); await seed(page); await page.goto(url); await page.waitForSelector('.pl-card')
  const audit = async label => {
    const r = await page.evaluate(() => {
      const out = []; const vis = e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && r.bottom > 0 && r.top < innerHeight }
      const name = e => (e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || e.textContent || e.getAttribute('title') || e.getAttribute('placeholder') || '').trim()
      for (const b of document.querySelectorAll('button, [role=button], a[href], input, select, textarea')) {
        if (!vis(b)) continue
        const tag = b.tagName.toLowerCase(), r = b.getBoundingClientRect(), id = `${tag}.${(b.className || '').toString().split(' ')[0]}`
        if (!name(b) && !(b.labels && b.labels.length)) out.push(`no accessible name: ${id}`)
        if (tag !== 'input' && (r.width < 44 || r.height < 44) && !b.closest('.vrow')) out.push(`small target ${Math.round(r.width)}x${Math.round(r.height)}: ${id} "${name(b).slice(0, 24)}"`)
        if (tag === 'input' && b.type === 'range' && r.height < 28) out.push(`small slider ${id}`)
      }
      if (!document.querySelector('h1')) out.push('no h1 on screen')
      if (!document.querySelector('main')) out.push('no main landmark')
      if (!document.querySelector('nav[aria-label]')) out.push('nav landmark missing label')
      // contrast: sample text nodes
      const lum = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4 }); return .2126 * r + .7152 * g + .0722 * b }
      const parse = s => (s.match(/[\d.]+/g) || []).map(Number)
      const bgOf = e => { for (let n = e; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c[3] ?? 1) > 0.5) return c.slice(0, 3) } return [0, 0, 0] }
      const seen = new Set()
      for (const e of document.querySelectorAll('.t, .s, .hint, .sub, .name, h1, h2, label span, .times, .np-sub')) {
        if (!vis(e) || !e.textContent.trim()) continue
        const fg = parse(getComputedStyle(e).color).slice(0, 3), bg = bgOf(e), L1 = lum(fg), L2 = lum(bg), ratio = (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05)
        const size = parseFloat(getComputedStyle(e).fontSize), need = size >= 24 ? 3 : 4.5, key = e.className + ratio.toFixed(1)
        if (ratio < need && !seen.has(key)) { seen.add(key); out.push(`low contrast ${ratio.toFixed(2)}:1 (<${need}) ${e.className || e.tagName} "${e.textContent.trim().slice(0, 20)}"`) }
      }
      return out
    })
    for (const x of r) issues.push(`[${scheme}] ${label}: ${x}`)
  }
  await audit('Playlists')
  await page.evaluate(() => document.querySelector('.pl-card button').click()); await page.waitForSelector('.detail-hero'); await page.waitForTimeout(400); await audit('Playlist detail')
  await page.locator('.pl-nav .circle-btn').last().click(); await page.waitForSelector('.glass-menu'); await page.waitForTimeout(450); await audit('Playlist menu'); await page.keyboard.press('Escape')
  await page.evaluate(() => document.querySelector('.pl-nav .circle-btn').click())
  for (const [i, n] of [[1, 'Library'], [2, 'Studio'], [3, 'Connect'], [4, 'Settings']]) { await page.locator('.tabbar button').nth(i).click(); await page.waitForTimeout(700); await audit(n) }
  await ctx.close()
}
console.log(issues.length ? issues.join('\n') : 'No issues found')
console.log(`\n${issues.length} issue(s)`)
await browser.close()
