import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

// ============================================================
// 変換の通し確認 (#1)
//
// **動きが確実にある動画をブラウザ内で作る**のが要点。手元にあった画面録画で
// 試したら 16 コマ中 4 コマしか内容が違わず、「シークが効いていないのか、
// 素材が静止しているだけなのか」が判別できなかった。素材を自分で作れば
// 「N コマ抜いたら N 通りの絵になる」を assert できる。
// ============================================================

/** canvas を 1 コマずつ塗り替えながら MediaRecorder で録る。戻り値は dataURL */
async function makeMovingVideo(page: Page, seconds = 2): Promise<string> {
  return page.evaluate(async (sec) => {
    const c = document.createElement('canvas')
    c.width = 160; c.height = 120
    const ctx = c.getContext('2d')!
    const stream = c.captureStream(30)
    const chunks: Blob[] = []
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm' })
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
    rec.start()
    const t0 = performance.now()
    await new Promise<void>((resolve) => {
      const draw = () => {
        const el = performance.now() - t0
        // 背景色を時間で回し、位置の分かるバーも描く (どの時刻のコマかが絵で分かる)
        ctx.fillStyle = `hsl(${Math.floor(el / 8) % 360}, 80%, 45%)`
        ctx.fillRect(0, 0, c.width, c.height)
        ctx.fillStyle = '#000'
        ctx.fillRect((el / (sec * 1000)) * c.width, 0, 10, c.height)
        if (el < sec * 1000) requestAnimationFrame(draw)
        else resolve()
      }
      requestAnimationFrame(draw)
    })
    rec.stop()
    await new Promise<void>(r => { rec.onstop = () => r() })
    const blob = new Blob(chunks, { type: 'video/webm' })
    return await new Promise<string>((res) => {
      const fr = new FileReader()
      fr.onload = () => res(fr.result as string)
      fr.readAsDataURL(blob)
    })
  }, seconds)
}

/**
 * 左半分が赤・右半分が青の動画。**どこを切り抜いたか色で分かる**ようにする。
 * 動きも入れておく (静止画だとコマ抜きの確認にならない)。
 */
async function makeSplitVideo(page: Page, seconds = 1.5): Promise<string> {
  return page.evaluate(async (sec) => {
    const c = document.createElement('canvas')
    c.width = 200; c.height = 100
    const ctx = c.getContext('2d')!
    const chunks: Blob[] = []
    const rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm' })
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
    rec.start()
    const t0 = performance.now()
    await new Promise<void>((resolve) => {
      const draw = () => {
        const el = performance.now() - t0
        ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, c.width / 2, c.height)
        ctx.fillStyle = '#0000ff'; ctx.fillRect(c.width / 2, 0, c.width / 2, c.height)
        // 上端で動く白い点。左右の色は塗り潰さない位置に置く
        ctx.fillStyle = '#ffffff'
        ctx.fillRect((el / (sec * 1000)) * c.width, 0, 6, 4)
        if (el < sec * 1000) requestAnimationFrame(draw); else resolve()
      }
      requestAnimationFrame(draw)
    })
    rec.stop()
    await new Promise<void>(r => { rec.onstop = () => r() })
    return await new Promise<string>((res) => {
      const fr = new FileReader()
      fr.onload = () => res(fr.result as string)
      fr.readAsDataURL(new Blob(chunks, { type: 'video/webm' }))
    })
  }, seconds)
}

/** 変換結果 GIF の 1 コマ目の中央画素 (RGB) */
async function centerPixel(page: Page): Promise<[number, number, number]> {
  return page.evaluate(async () => {
    const img = document.querySelector('[data-testid="result"]') as HTMLImageElement
    if (!img.complete) await new Promise<void>(r => { img.onload = () => r() })
    const c = document.createElement('canvas')
    c.width = img.naturalWidth; c.height = img.naturalHeight
    const ctx = c.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    const d = ctx.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data
    return [d[0], d[1], d[2]] as [number, number, number]
  })
}

/** dataURL を file input に流し込む */
async function attach(page: Page, dataUrl: string, name: string): Promise<void> {
  const base64 = dataUrl.split(',')[1]
  await page.setInputFiles('[data-testid="file"]', {
    name, mimeType: 'video/webm', buffer: Buffer.from(base64, 'base64'),
  })
}

/** 変換結果の GIF を取り出す */
async function resultBytes(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(async () => {
    const img = document.querySelector('[data-testid="result"]') as HTMLImageElement
    const buf = await (await fetch(img.src)).arrayBuffer()
    let s = ''
    const u = new Uint8Array(buf)
    for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i])
    return btoa(s)
  })
  return Buffer.from(b64, 'base64')
}

/**
 * GIF を Graphic Control Extension (0x21 0xF9) 区切りでコマ単位に切る。
 *
 * 同じ絵は同じパレット・同じ LZW 出力になるのでバイト列も一致する。
 * つまり**切片が全て違えばコマの中身も違う** (シークが進んでいる)。
 * 逆は成り立たない (別の絵でも偶然一致はしない、が判定は片側だけで十分)。
 */
function gifFrameChunks(buf: Buffer): Buffer[] {
  const starts: number[] = []
  for (let i = 0; i < buf.length - 1; i++) if (buf[i] === 0x21 && buf[i + 1] === 0xf9) starts.push(i)
  return starts.map((s, i) => buf.subarray(s, starts[i + 1] ?? buf.length))
}

test('動画を読み込むとメタ情報と見積もりが出る', async ({ page }) => {
  const errs: string[] = []
  page.on('pageerror', e => errs.push(String(e)))
  await page.goto('/')
  await attach(page, await makeMovingVideo(page, 1.5), 'moving.webm')

  await expect(page.getByTestId('frames')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('outsize')).toContainText('×')
  await expect(page.getByTestId('estimate')).toContainText('見積もり')
  expect(errs, 'page error が出ている').toEqual([])
})

test('指定したコマ数だけ抜き、各コマの中身が違う (シークが進んでいる)', async ({ page }) => {
  await page.goto('/')
  await attach(page, await makeMovingVideo(page, 2), 'moving.webm')
  await expect(page.getByTestId('frames')).toBeVisible({ timeout: 20_000 })

  // コマ数指定で 6 コマ / 幅 80 に絞る
  await page.getByTestId('width').fill('80')
  await page.locator('input[type=radio]').nth(1).check()
  await page.getByTestId('count').fill('6')
  await expect(page.getByTestId('frames')).toHaveText('6')

  await page.getByTestId('convert').click()
  await expect(page.getByTestId('actual')).toBeVisible({ timeout: 90_000 })

  const gif = await resultBytes(page)
  expect(gif.subarray(0, 3).toString(), 'GIF ヘッダが無い').toBe('GIF')

  const chunks = gifFrameChunks(gif)
  expect(chunks.length, 'コマ数が指定と違う').toBe(6)
  // 素材は毎コマ色が変わるので、6 コマすべて別の中身になるはず。
  // 重複が出たらシークが進んでおらず同じ絵を焼き回している
  const unique = new Set(chunks.map(c => c.toString('base64')))
  expect(unique.size, `6 コマ中 ${unique.size} 種類しか無い = シークが進んでいない`).toBe(6)
})

test('出力サイズの指定が効く', async ({ page }) => {
  await page.goto('/')
  await attach(page, await makeMovingVideo(page, 1), 'moving.webm')
  await expect(page.getByTestId('frames')).toBeVisible({ timeout: 20_000 })

  await page.getByTestId('width').fill('64')
  // 160×120 の素材 → 幅 64 でアスペクト維持なら 48
  await expect(page.getByTestId('outsize')).toHaveText('64×48')
})

test('壊れたファイルを渡してもクラッシュせず理由を出す', async ({ page }) => {
  const errs: string[] = []
  page.on('pageerror', e => errs.push(String(e)))
  await page.goto('/')
  await page.setInputFiles('[data-testid="file"]', {
    name: 'broken.mp4', mimeType: 'video/mp4', buffer: Buffer.from('これは動画ではない'),
  })
  await expect(page.getByTestId('error')).toBeVisible({ timeout: 20_000 })
  expect(errs, 'page error が出ている').toEqual([])
})

test('1 回変換すると見積もりが実測から校正される', async ({ page }) => {
  await page.goto('/')
  await attach(page, await makeMovingVideo(page, 1.5), 'moving.webm')
  await expect(page.getByTestId('frames')).toBeVisible({ timeout: 20_000 })

  await page.getByTestId('width').fill('80')
  await page.locator('input[type=radio]').nth(1).check()
  await page.getByTestId('count').fill('4')

  // 初回は既定係数なので「粗い目安」と出る
  await expect(page.getByTestId('estimate')).toContainText('初回は粗い目安')
  const before = await page.getByTestId('estimate').innerText()

  await page.getByTestId('convert').click()
  await expect(page.getByTestId('actual')).toBeVisible({ timeout: 90_000 })

  // 変換後は校正済みになり、見積もりの値も変わる
  await expect(page.getByTestId('estimate')).toContainText('前回の実測で校正済み')
  expect(await page.getByTestId('estimate').innerText(), '校正されていない').not.toBe(before)

  // 別の動画を読み直したら校正値は捨てる (素材が変われば比も変わる)
  await attach(page, await makeMovingVideo(page, 1), 'other.webm')
  await expect(page.getByTestId('estimate')).toContainText('初回は粗い目安')
})

test('切り抜いた範囲だけが GIF になる (左半分 → 赤・右半分 → 青)', async ({ page }) => {
  await page.goto('/')
  await attach(page, await makeSplitVideo(page), 'split.webm')
  await expect(page.getByTestId('frames')).toBeVisible({ timeout: 20_000 })
  await page.locator('input[type=radio]').nth(1).check()
  await page.getByTestId('count').fill('3')

  // 左半分 (0,0)-(100,100) → 中央は赤
  await page.getByTestId('cropx').fill('0')
  await page.getByTestId('cropy').fill('0')
  await page.getByTestId('cropw').fill('100')
  await page.getByTestId('croph').fill('100')
  await expect(page.getByTestId('outsize')).toHaveText('100×100')
  await page.getByTestId('convert').click()
  await expect(page.getByTestId('actual')).toBeVisible({ timeout: 90_000 })
  const left = await centerPixel(page)
  expect(left[0], `左半分が赤くない: ${left}`).toBeGreaterThan(180)
  expect(left[2], `左半分に青が混じっている: ${left}`).toBeLessThan(80)

  // 右半分 (100,0)-(200,100) → 中央は青
  await page.getByTestId('cropx').fill('100')
  await page.getByTestId('convert').click()
  await expect(page.getByTestId('actual')).toBeVisible({ timeout: 90_000 })
  await expect(page.getByTestId('cropinfo')).toContainText('100×100 @ 100,0')
  const right = await centerPixel(page)
  expect(right[2], `右半分が青くない: ${right}`).toBeGreaterThan(180)
  expect(right[0], `右半分に赤が混じっている: ${right}`).toBeLessThan(80)
})

test('切り抜きの縦横比が出力サイズの基準になる', async ({ page }) => {
  await page.goto('/')
  await attach(page, await makeSplitVideo(page), 'split.webm')
  await expect(page.getByTestId('frames')).toBeVisible({ timeout: 20_000 })

  // 200×100 (2:1) から 100×100 (1:1) を切り抜き、幅 60 → 高さも 60
  await page.getByTestId('cropw').fill('100')
  await page.getByTestId('croph').fill('100')
  await page.getByTestId('width').fill('60')
  await expect(page.getByTestId('outsize')).toHaveText('60×60')

  // 全体に戻すと 2:1 に戻る
  await page.getByTestId('cropfull').click()
  await expect(page.getByTestId('outsize')).toHaveText('60×30')
})

test('プレビュー上のドラッグで範囲を取れる', async ({ page }) => {
  await page.goto('/')
  await attach(page, await makeSplitVideo(page), 'split.webm')
  await expect(page.getByTestId('frames')).toBeVisible({ timeout: 20_000 })

  await page.getByTestId('cropmode').check()
  const box = await page.getByTestId('cropper').boundingBox()
  if (!box) throw new Error('cropper が見つからない')

  // 表示上の右下 1/4 をドラッグ → 元動画 200×100 の (100,50)-(200,100) に対応する
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 1, box.y + box.height - 1, { steps: 6 })
  await page.mouse.up()

  // 端の 1px 分は誤差として許容する
  expect(Number(await page.getByTestId('cropx').inputValue())).toBeGreaterThanOrEqual(95)
  expect(Number(await page.getByTestId('cropy').inputValue())).toBeGreaterThanOrEqual(45)
  expect(Number(await page.getByTestId('cropw').inputValue())).toBeGreaterThan(90)
  expect(Number(await page.getByTestId('croph').inputValue())).toBeGreaterThan(40)

  // 選択枠が見えている
  await expect(page.locator('.crop-box')).toBeVisible()
})
