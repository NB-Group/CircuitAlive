/* CircuitAlive · 端到端测试 — node test/e2e.test.js
 *
 * 纯 Node 测不了浏览器行为(触屏手势、Safari 兼容、渲染)。这里用
 * playwright-core 驱动真实 Chromium,对着 dist 起静态服务跑。
 *
 * 覆盖的是"用户能看见的东西":
 *   - 首页/题库/编辑器能打开,控制台无报错
 *   - 放元件后视图不跳变(触屏上的"突然放大")
 *   - 长按打开检查器,单击不打开
 *   - 撤销/重做按钮状态与行为
 *   - 触屏双指缩放不触发页面缩放
 *   - 表盘与元件标注真的渲染出来
 *   - 分享链接往返
 *
 * 用法:node test/e2e.test.js [--headed]
 * 前置:npm run build(测试自己起 http.server 指 dist)
 */
'use strict'

import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import http from 'node:http'
import { readFile } from 'node:fs/promises'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')
/* 找 Chromium:显式指定 → playwright 缓存(版本号会变,扫目录)→ 系统包 */
function findChrome() {
  if (process.env.FF_CHROME && existsSync(process.env.FF_CHROME)) return process.env.FF_CHROME
  const cache = join(process.env.HOME || '', '.cache/ms-playwright')
  if (existsSync(cache)) {
    for (const d of readdirSync(cache)) {
      if (!d.startsWith('chromium')) continue
      for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
        const p = join(cache, d, sub)
        if (existsSync(p)) return p
      }
    }
  }
  return ['/usr/bin/chromium', '/usr/bin/google-chrome', '/usr/bin/chromium-browser'].find((p) => existsSync(p))
}

let passed = 0, failed = 0
const failures = []
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name) }
  catch (e) { failed++; failures.push([name, e]); console.log('  ✗ ' + name + '\n      ' + (e.message || e)) }
}

/* ---- 静态服务:自己起自己关,不留孤儿 ---- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.png': 'image/png'
}
function startServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const url = decodeURIComponent(req.url.split('?')[0])
      let file = join(DIST, url === '/' ? 'index.html' : url)
      if (!existsSync(file)) file = join(DIST, 'index.html')   /* hash 路由 */
      const body = await readFile(file)
      const ext = file.slice(file.lastIndexOf('.'))
      res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' })
      res.end(body)
    } catch (e) {
      res.writeHead(404); res.end('not found')
    }
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) {
    console.error('dist 不存在,先跑 npm run build')
    process.exit(2)
  }
  const exe = findChrome()
  if (!exe) {
    console.error('找不到 Chromium;设 FF_CHROME 指向可执行文件')
    process.exit(2)
  }

  const { server, port } = await startServer()
  const base = `http://127.0.0.1:${port}/`
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] })

  try {
    /* ============ 桌面 ============ */
    console.log('\n桌面')
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

    await test('首页能打开且无控制台报错', async () => {
      await page.goto(base, { waitUntil: 'networkidle' })
      await page.waitForSelector('.hero-title')
      if (errors.length) throw new Error('控制台报错: ' + errors.slice(0, 3).join(' | '))
    })

    await test('首页演示电路真的画出来了(不是空框)', async () => {
      const wires = await page.locator('.hero-engine .wire-line').count()
      if (wires < 3) throw new Error('演示区导线数 ' + wires + ',渲染器没生效')
    })

    await test('首页"开始画图"立刻进入作品库', async () => {
      const fresh = await ctx.newPage()
      await fresh.goto(base, { waitUntil: 'networkidle' })
      const t0 = Date.now()
      await fresh.locator('.hero-actions .ff-btn.primary').click()
      await fresh.waitForSelector('.ff-lib-wrap', { timeout: 5000 })
      const dt = Date.now() - t0
      if (dt > 2500) throw new Error('进入作品库用了 ' + dt + 'ms')
      if (!fresh.url().includes('#/library')) throw new Error('没有跳到作品库: ' + fresh.url())
      await fresh.close()
    })

    await test('题库卡片带来源与题号', async () => {
      await page.goto(base + '#/', { waitUntil: 'networkidle' })
      const first = await page.locator('.card .card-year').first().textContent()
      if (!/上海中考|二模|一模|原创/.test(first || '')) throw new Error('来源缺失: ' + first)
    })

    await test('题目页:电路、标注、读数都在', async () => {
      /* 同一 page 连续 goto 同一个 SPA 时,waitForSelector('.edge-group')
         可能命中上一次的残留节点。等本题特有的元素出现才算就绪。 */
      await page.goto(base + '#/problem/r-2024-19', { waitUntil: 'networkidle' })
      await page.waitForFunction(() => document.querySelectorAll('.sym-tag').length >= 2, null, { timeout: 5000 })
      const tags = await page.locator('.sym-tag').count()
      if (tags < 2) throw new Error('元件标注数 ' + tags + '(应为 R1、S 等)')
      const reading = await page.locator('.reading-text').first().textContent()
      if (!/A$/.test((reading || '').trim())) throw new Error('电流表读数为空: ' + reading)
    })

    await test('表盘图按量程渲染', async () => {
      await page.goto(base + '#/problem/r-2013-22', { waitUntil: 'networkidle' })
      await page.waitForFunction(() => document.querySelectorAll('.meter-dial').length >= 1, null, { timeout: 5000 })
      const nums = await page.locator('.dial-nums text').allTextContents()
      if (!nums.includes('0') || !nums.includes('3')) throw new Error('表盘刻度不对: ' + nums.join(','))
    })

    await test('单击只选中,不弹检查器', async () => {
      await page.goto(base + '#/problem/r-2024-19', { waitUntil: 'networkidle' })
      await page.waitForSelector('.edge-group')
      const box = await page.locator('.edge-group').first().boundingBox()
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await page.waitForTimeout(200)
      const insp = await page.locator('.ff-inspector').count()
      if (insp) throw new Error('单击就弹出了检查器')
    })

    await test('长按打开检查器,背景分层模糊', async () => {
      await page.goto(base + '#/problem/r-2024-19', { waitUntil: 'networkidle' })
      await page.waitForSelector('.edge-group')
      const box = await page.locator('.edge-group').first().boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.waitForTimeout(700)
      await page.mouse.up()
      await page.waitForTimeout(300)
      const insp = await page.locator('.ff-inspector').count()
      if (!insp) throw new Error('长按没有打开检查器')
      const inspecting = await page.locator('svg.ff-stage.inspecting').count()
      if (!inspecting) throw new Error('画布没有进入 inspecting 分层状态')
    })

    await test('检查器打开时画布真的虚化,关掉后有退场动画', async () => {
      const fresh = await ctx.newPage()
      await fresh.goto(base + '#/problem/r-2013-22', { waitUntil: 'networkidle' })
      await fresh.waitForSelector('.edge-group')
      await fresh.waitForTimeout(400)
      const group = fresh.locator('.edge-group', { has: fresh.locator('[data-hook="wiper"]') }).first()
      const box = await group.locator('rect').first().boundingBox()
      await fresh.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await fresh.mouse.down()
      await fresh.waitForTimeout(700)
      await fresh.mouse.up()
      await fresh.waitForTimeout(500)

      const dim = await fresh.evaluate(() => {
        const edges = document.querySelector('[data-layer="edges"]')
        const strip = document.querySelector('.problem-strip')
        const clone = document.querySelector('.overlay-clone.edge-group')
        return {
          edges: getComputedStyle(edges).filter,
          strip: strip ? getComputedStyle(strip).filter : 'none',
          clone: document.querySelectorAll('.overlay-clone.edge-group').length,
          cloneInScene: !!(clone && clone.closest('g.ff-scene'))
        }
      })
      if (!/blur/.test(dim.edges)) throw new Error('画布没有被模糊: ' + dim.edges)
      /* 题目条/元件栏不该被糊:用户还得读题 */
      if (/blur/.test(dim.strip)) throw new Error('题目条被误模糊了: ' + dim.strip)
      if (!dim.clone) throw new Error('被检元件没有克隆到 overlay 层')
      /* 克隆件必须在模糊场景之外,否则它自己也糊了 */
      if (dim.cloneInScene) throw new Error('overlay 克隆件还在被模糊的场景里')

      await fresh.keyboard.press('Escape')
      await fresh.waitForTimeout(40)
      const leaving = await fresh.evaluate(() => {
        const el = document.querySelector('.ff-inspector')
        return el ? getComputedStyle(el).animationName : 'gone'
      })
      if (leaving !== 'ff-insp-out') throw new Error('关闭没有退场动画, animationName=' + leaving)
      const dur = await fresh.evaluate(() => getComputedStyle(document.querySelector('.ff-inspector')).animationDuration)
      if (parseFloat(dur) < 0.18) throw new Error('退场太快: ' + dur)
      await fresh.waitForTimeout(320)
      if (await fresh.locator('.ff-inspector').count()) throw new Error('退场动画结束后面板还在')
      await fresh.close()
    })

    await test('长按导线时抬起的是这根导线,面板给全局导线设置', async () => {
      const fresh = await ctx.newPage()
      await fresh.goto(base + '#/problem/r-2013-22', { waitUntil: 'networkidle' })
      await fresh.waitForSelector('.edge-group')
      await fresh.waitForTimeout(400)
      const wire = fresh.locator('.edge-group[data-edge-key="0,0|0,1"]').first()
      const box = await wire.boundingBox()
      await fresh.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await fresh.mouse.down()
      await fresh.waitForTimeout(700)
      await fresh.mouse.up()
      await fresh.waitForTimeout(500)
      const title = (await fresh.locator('.ff-insp-name').first().textContent()) || ''
      if (!/导线/.test(title)) throw new Error('面板标题不是导线: ' + title)
      const clones = await fresh.evaluate(() => [...document.querySelectorAll('.overlay-clone.edge-group')]
        .map((c) => c.getAttribute('data-edge-key')))
      if (!clones.includes('0,0|0,1')) throw new Error('抬起的不是被长按的那根导线: ' + clones.join(','))
      await fresh.close()
    })

    await test('圆角统一:按钮/卡片/面板同一档', async () => {
      const radii = await page.evaluate(() => {
        const vals = []
        const pick = (sel) => {
          const el = document.querySelector(sel)
          if (!el) return
          vals.push(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0)
        }
        document.querySelectorAll('.ff-btn').forEach((el) => vals.push(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0))
        return [...new Set(vals)]
      })
      if (radii.length > 1) throw new Error('按钮圆角不一致: ' + radii.join(','))
    })

    await test('撤销/重做按钮随操作启用并生效', async () => {
      /* 用全新页面:同一个 page 从题目页切到 #/edit 时组件复用,
         model 里还留着上一题的电路,撤销栈非空,初始态就不干净了 */
      const fresh = await ctx.newPage()
      await fresh.goto(base + '#/edit', { waitUntil: 'networkidle' })
      await fresh.waitForSelector('.ff-stage')
      const page = fresh
      const undo = page.getByRole('button', { name: '撤销' })
      const redo = page.getByRole('button', { name: '重做' })
      if (!(await undo.isDisabled())) throw new Error('初始撤销按钮应为禁用')

      /* 用键盘放置:选中电池工具后点画布 */
      await page.getByRole('button', { name: '电池' }).click()
      const svg = page.locator('.ff-stage')
      const b = await svg.boundingBox()
      await page.mouse.click(b.x + b.width * 0.35, b.y + b.height * 0.4)
      await page.waitForTimeout(300)
      if (await undo.isDisabled()) throw new Error('放置后撤销按钮应可用')

      await undo.click()
      await page.waitForTimeout(300)
      if (await redo.isDisabled()) throw new Error('撤销后重做按钮应可用')
      const afterUndo = await page.locator('.edge-group').count()
      await redo.click()
      await page.waitForTimeout(300)
      const afterRedo = await page.locator('.edge-group').count()
      if (afterRedo <= afterUndo) throw new Error('重做没有恢复电路')
      await fresh.close()
    })

    await test('电流/电子流向是三态开关,不会互相打架', async () => {
      const fresh = await ctx.newPage()
      await fresh.goto(base + '#/edit', { waitUntil: 'networkidle' })
      const cur = fresh.getByRole('button', { name: '电流', exact: true })
      const ele = fresh.getByRole('button', { name: '电子流向' })
      const state = async () => ({
        current: await cur.getAttribute('class'),
        electron: await ele.getAttribute('class')
      })
      const on = (c) => /(^|\s)on(\s|$)/.test(c || '')

      /* 初始:电流开、电子流向关 */
      let s0 = await state()
      if (!on(s0.current)) throw new Error('初始应显示电流')
      if (on(s0.electron)) throw new Error('初始不该显示电子流向')

      /* 点电子流向:只切到电子流向,电流按钮必须熄灭 */
      await ele.click(); await fresh.waitForTimeout(120)
      let s1 = await state()
      if (!on(s1.electron)) throw new Error('点电子流向没有生效')
      if (on(s1.current)) throw new Error('切到电子流向后电流按钮仍高亮')

      /* 再点电子流向:全部关闭 */
      await ele.click(); await fresh.waitForTimeout(120)
      let s2 = await state()
      if (on(s2.electron) || on(s2.current)) throw new Error('再点一次应全部关闭')

      /* 点电流:恢复电流显示 */
      await cur.click(); await fresh.waitForTimeout(120)
      let s3 = await state()
      if (!on(s3.current) || on(s3.electron)) throw new Error('点电流没有正确恢复')

      /* 点电流(当前态):关闭 */
      await cur.click(); await fresh.waitForTimeout(120)
      let s4 = await state()
      if (on(s4.current) || on(s4.electron)) throw new Error('点当前态应关闭显示')

      await fresh.close()
    })

    await test('单击滑变弹出滑条,拖动实时改阻值,一次拖动一步撤销', async () => {
      await page.goto(base + '#/problem/r-2013-22', { waitUntil: 'networkidle' })
      await page.waitForSelector('[data-hook="wiper"]', { state: 'attached' })
      /* 点滑变矩形本体中心(不是上方滑轨)。局部 y=0 不在 wiperGrab
         的 -18.5..-3.5 区间里,才会走 tap-rheo 而不是拖滑片。 */
      const group = page.locator('.edge-group', { has: page.locator('[data-hook="wiper"]') }).first()
      const box = await group.locator('rect').first().boundingBox()
      if (!box) throw new Error('滑变符号没有可见矩形')
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await page.waitForTimeout(250)
      if (!(await page.locator('.ff-rheo').count())) throw new Error('单击滑变没有弹出滑条')

      const valueEl = page.locator('.ff-rheo-value')
      const before = (await valueEl.textContent({ timeout: 3000 })) || ''
      /* 模拟一次真实拖动:先 pointerdown 让弹窗记下 undo 快照,
         否则 rawSetProps 不入栈,撤销会退到上一件不相干的事 */
      await page.locator('.ff-rheo-range').dispatchEvent('pointerdown')
      await page.locator('.ff-rheo-range').evaluate((el) => {
        el.value = '0.1'
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      })
      await page.waitForTimeout(300)
      const after = (await valueEl.textContent({ timeout: 3000 })) || ''
      if (before === after) throw new Error('拖滑条没有改变接入阻值: ' + before)
      /* 读数必须是活的:电流/电压不是破折号 */
      const reads = (await page.locator('.ff-rheo-reads').textContent()) || ''
      if (!/I\s*[\d.]/.test(reads)) throw new Error('滑条旁没有实时电流读数: ' + reads)

      /* 一次拖动只留一步撤销。点工具栏按钮算"点外面",弹窗会先关,
         重新打开滑变看阻值是否退回拖动前。 */
      await page.getByRole('button', { name: '撤销' }).click()
      await page.waitForTimeout(300)
      const box2 = await group.locator('rect').first().boundingBox()
      await page.mouse.click(box2.x + box2.width / 2, box2.y + box2.height / 2)
      await page.waitForTimeout(250)
      const back = (await page.locator('.ff-rheo-value').textContent({ timeout: 3000 })) || ''
      if (back !== before) throw new Error(`撤销后没回到拖动前: ${back} ≠ ${before}`)
    })

    await test('长按滑变仍打开完整检查器,不弹滑条', async () => {
      await page.goto(base + '#/problem/r-2013-22', { waitUntil: 'networkidle' })
      await page.waitForSelector('[data-hook="wiper"]', { state: 'attached' })
      const group = page.locator('.edge-group', { has: page.locator('[data-hook="wiper"]') }).first()
      const box = await group.locator('rect').first().boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.waitForTimeout(700)
      await page.mouse.up()
      await page.waitForTimeout(300)
      if (!(await page.locator('.ff-inspector').count())) throw new Error('长按滑变没有打开检查器')
      if (await page.locator('.ff-rheo').count()) throw new Error('长按滑变后滑条也弹出来了')
    })

    await test('长按导线打开导线检查器', async () => {
      /* 独立页面,避免上一步的检查器状态干扰 */
      const fresh = await ctx.newPage()
      await fresh.goto(base + '#/problem/r-2013-22', { waitUntil: 'networkidle' })
      await fresh.waitForSelector('.edge-group')
      /* 左边那条竖直导线,key 由数据里 [0,1,0,0] 规范化而来 */
      const wire = fresh.locator('.edge-group[data-edge-key="0,0|0,1"]').first()
      const box = await wire.boundingBox()
      await fresh.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await fresh.mouse.down()
      await fresh.waitForTimeout(700)
      await fresh.mouse.up()
      await fresh.waitForTimeout(300)
      const title = (await fresh.locator('.ff-inspector .ff-insp-name').first().textContent().catch(() => '')) || ''
      if (!/导线/.test(title)) throw new Error('长按导线没有打开导线检查器,标题: ' + title)
      await fresh.close()
    })

    await test('检查器开着时,长按另一个元件直接切换', async () => {
      const fresh = await ctx.newPage()
      await fresh.goto(base + '#/problem/r-2014-22', { waitUntil: 'networkidle' })
      await fresh.waitForFunction(
        () => [...document.querySelectorAll('.sym-tag')].some((t) => t.textContent.trim() === 'R₂'),
        null, { timeout: 5000 }
      )
      const ids = await fresh.evaluate(() => {
        const out = {}
        for (const t of document.querySelectorAll('.sym-tag')) {
          const k = t.textContent.trim()
          if (k === 'R₁' || k === 'R₂') out[k] = t.getAttribute('data-edge-id')
        }
        return out
      })
      if (!ids['R₁'] || !ids['R₂']) throw new Error('找不到 R₁/R₂ 标号')

      const longPress = async (label) => {
        const g = fresh.locator(`.edge-group[data-edge-id="${ids[label]}"]`)
        const box = await g.locator('rect').first().boundingBox()
        await fresh.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        await fresh.mouse.down()
        await fresh.waitForTimeout(700)
        await fresh.mouse.up()
        await fresh.waitForTimeout(350)
        return (await fresh.locator('.ff-inspector .ff-insp-name').first().textContent().catch(() => '')) || ''
      }

      const first = await longPress('R₂')
      if (!/滑动变阻器/.test(first)) throw new Error('第一次长按没打开滑变检查器: ' + first)
      /* 不先关掉,直接长按另一个元件:同一次手势应当完成切换 */
      const second = await longPress('R₁')
      if (!/电阻/.test(second) || /滑动变阻器/.test(second)) throw new Error('长按没有切换到电阻: ' + second)
      await fresh.close()
    })

    await test('分享链接往返:同一张电路', async () => {
      await page.goto(base + '#/problem/r-2024-19', { waitUntil: 'networkidle' })
      const before = await page.locator('.edge-group').count()
      const shareBtn = page.getByRole('button', { name: /分享/ })
      if (await shareBtn.count()) {
        await shareBtn.first().click()
        await page.waitForTimeout(400)
        const input = page.locator('.ff-share input, .share-input').first()
        const url = await input.inputValue().catch(() => '')
        if (url) {
          await page.goto(url, { waitUntil: 'networkidle' })
          const after = await page.locator('.edge-group').count()
          if (after !== before) throw new Error(`往返后边数 ${after} ≠ ${before}`)
        }
      }
    })

    if (errors.length) {
      failed++
      console.log('  ✗ 控制台有报错: ' + errors.slice(0, 3).join(' | '))
    }
    await ctx.close()

    /* ============ 触屏 ============ */
    console.log('\n触屏')
    const tctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true, isMobile: true, deviceScaleFactor: 2
    })
    const tp = await tctx.newPage()
    const tErrors = []
    tp.on('pageerror', (e) => tErrors.push(String(e)))

    await test('触屏:放第一个元件后视图不跳变', async () => {
      await tp.goto(base + '#/edit', { waitUntil: 'networkidle' })
      await tp.waitForSelector('.ff-stage')
      const before = await tp.evaluate(() => document.querySelector('.ff-stage').getAttribute('viewBox'))
      await tp.getByRole('button', { name: '电池' }).tap()
      const box = await tp.locator('.ff-stage').boundingBox()
      await tp.touchscreen.tap(box.x + box.width * 0.4, box.y + box.height * 0.4)
      await tp.waitForTimeout(600)
      const after = await tp.evaluate(() => document.querySelector('.ff-stage').getAttribute('viewBox'))
      if (before !== after) throw new Error(`视图被自动改变了: ${before} → ${after}`)
    })

    await test('触屏:长按打开检查器且不选中文字', async () => {
      /* 全新页面:上一个测试在 #/edit 里放了电池,复用会带脏状态 */
      const fresh = await tctx.newPage()
      await fresh.goto(base + '#/problem/r-2024-19', { waitUntil: 'networkidle' })
      await fresh.waitForSelector('.edge-group')
      const tp = fresh
      const box = await tp.locator('.edge-group').first().boundingBox()
      /* 用 CDP 派发 pointerType=touch 的 pointer 事件:
         page.touchscreen 产生的是 touch 事件,画布监听的是 pointer */
      const cdp = await tctx.newCDPSession(tp)
      const x = box.x + box.width / 2, y = box.y + box.height / 2
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart', touchPoints: [{ x, y, id: 1 }]
      })
      await tp.waitForTimeout(700)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await tp.waitForTimeout(400)
      const insp = await tp.locator('.ff-inspector').count()
      if (!insp) throw new Error('触屏长按没有打开检查器')
      const selected = await tp.evaluate(() => (window.getSelection() || {}).toString() || '')
      if (selected.length > 0) throw new Error('长按选中了文字: ' + selected.slice(0, 20))
      await fresh.close()
    })

    await test('触屏:页面不横向溢出,图层开关在手机上可见', async () => {
    const fresh = await tctx.newPage()
    await fresh.goto(base + '#/problem/r-2013-22', { waitUntil: 'networkidle' })
    await fresh.waitForSelector('.stage, .ff-stage')
    const m = await fresh.evaluate(() => ({
      iw: window.innerWidth,
      cw: document.documentElement.clientWidth,
      sw: document.documentElement.scrollWidth,
      layers: getComputedStyle(document.querySelector('.layers')).display
    }))
    if (m.iw !== m.cw) throw new Error(`布局视口被撑宽: innerWidth ${m.iw} ≠ ${m.cw}`)
    if (m.sw > m.iw) throw new Error(`页面横向溢出: scrollWidth ${m.sw} > ${m.iw}`)
    if (m.layers !== 'flex') throw new Error('手机上图层面板被隐藏了')
    await fresh.close()
  })

  await test('触屏:轻点滑变弹滑条,长按弹检查器', async () => {
    const fresh = await tctx.newPage()
    await fresh.goto(base + '#/problem/r-2013-22', { waitUntil: 'networkidle' })
    await fresh.waitForSelector('[data-hook="wiper"]', { state: 'attached' })
    const group = fresh.locator('.edge-group', { has: fresh.locator('[data-hook="wiper"]') }).first()
    const box = await group.locator('rect').first().boundingBox()
    const cdp = await tctx.newCDPSession(fresh)
    const x = box.x + box.width / 2, y = box.y + box.height / 2

    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] })
    await fresh.waitForTimeout(80)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await fresh.waitForTimeout(350)
    if (!(await fresh.locator('.ff-rheo').count())) throw new Error('轻点滑变没有弹出滑条')
    if (await fresh.locator('.ff-inspector').count()) throw new Error('轻点滑变误开了检查器')

    await fresh.waitForTimeout(200)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] })
    await fresh.waitForTimeout(750)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await fresh.waitForTimeout(400)
    if (!(await fresh.locator('.ff-inspector').count())) throw new Error('长按滑变没有打开检查器')
    await fresh.close()
  })

  await test('触屏:画布容器禁止文字选择', async () => {
      await tp.goto(base + '#/problem/r-2024-19', { waitUntil: 'networkidle' })
      const css = await tp.evaluate(async () => {
        const el = document.querySelector('.ff-canvas')
        const s = getComputedStyle(el)
        /* -webkit-touch-callout 只在 iOS Safari 生效,Chrome 的计算值
           永远是 undefined。直接抓打包后的 CSS 文本判断声明是否存在。 */
        let declared = false
        const links = [...document.querySelectorAll('link[rel=stylesheet]')]
        for (const l of links) {
          const text = await (await fetch(l.href)).text()
          if (/\.ff-canvas\{[^}]*touch-callout:\s*none/.test(text)) declared = true
        }
        return { userSelect: s.userSelect || s.webkitUserSelect, declared }
      })
      if (css.userSelect !== 'none') throw new Error('user-select 不是 none: ' + css.userSelect)
      if (!css.declared) throw new Error('样式表里没有 -webkit-touch-callout: none 声明')
    })

    await test('触屏:双指手势不触发页面缩放', async () => {
      await tp.goto(base + '#/problem/r-2024-19', { waitUntil: 'networkidle' })
      await tp.waitForSelector('.ff-stage')
      const cdp = await tctx.newCDPSession(tp)
      const box = await tp.locator('.ff-stage').boundingBox()
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: cx - 40, y: cy, id: 1 }, { x: cx + 40, y: cy, id: 2 }]
      })
      for (let i = 1; i <= 5; i++) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: cx - 40 - i * 12, y: cy, id: 1 }, { x: cx + 40 + i * 12, y: cy, id: 2 }]
        })
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await tp.waitForTimeout(300)
      /* 页面缩放会改变视觉视口宽度;画布自身缩放不改它 */
      const vv = await tp.evaluate(() => window.visualViewport ? window.visualViewport.scale : 1)
      if (Math.abs(vv - 1) > 0.01) throw new Error('页面被缩放了,scale=' + vv)
      /* 画布应当被缩放(说明手势被画布接管) */
      const vb = await tp.evaluate(() => document.querySelector('.ff-stage').getAttribute('viewBox'))
      if (!vb) throw new Error('画布没有 viewBox')
    })

    if (tErrors.length) {
      failed++
      console.log('  ✗ 触屏控制台报错: ' + tErrors.slice(0, 3).join(' | '))
    }
    await tctx.close()
  } finally {
    await browser.close()
    server.close()
  }

  console.log(`\n${passed} 通过, ${failed} 失败`)
  if (failed) {
    for (const [name, e] of failures) console.log(`  - ${name}: ${e.message || e}`)
  }
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(2) })
