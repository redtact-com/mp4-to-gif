import { describe, it, expect } from 'vitest'
import { DEFAULT_BYTES_PER_PX, MIN_DELAY_MS, buildPlan, calibrate, estimateBytes, formatBytes, widthForBudget } from './plan'
import type { PlanInput } from './plan'

const base: PlanInput = {
  duration: 10, videoWidth: 1920, videoHeight: 1080,
  start: 0, end: 10, mode: 'fps', fps: 10, count: 50,
  width: 0, keepAspect: true, height: 0,
}
const p = (o: Partial<PlanInput> = {}) => buildPlan({ ...base, ...o })

describe('コマ時刻の算出', () => {
  it('fps 指定: 範囲 × fps 分のコマを作る', () => {
    const r = p({ start: 2, end: 4, fps: 5 })
    expect(r.times).toHaveLength(10)
    expect(r.times[0]).toBe(2)
    // **末尾は end ぴったりにしない** (seek が最後のフレームを返さないことがある)
    expect(r.times[r.times.length - 1]).toBeLessThan(4)
  })

  it('コマ数指定: ちょうどその数になる', () => {
    expect(p({ mode: 'count', count: 7 }).times).toHaveLength(7)
  })

  it('コマは昇順で範囲内に収まる', () => {
    const r = p({ start: 1, end: 3, fps: 12 })
    for (let i = 1; i < r.times.length; i++) expect(r.times[i]).toBeGreaterThan(r.times[i - 1])
    expect(r.times[0]).toBeGreaterThanOrEqual(1)
    expect(Math.max(...r.times)).toBeLessThan(3)
  })

  it('遅延は 10ms 単位に丸め、下限を持つ', () => {
    expect(p({ start: 0, end: 1, fps: 10 }).delayMs).toBe(100)
    // 200fps 相当 = 5ms は下限へ引き上げ (ブラウザが勝手に補正する領域を避ける)
    expect(p({ start: 0, end: 1, fps: 200 }).delayMs).toBe(MIN_DELAY_MS)
  })
})

describe('壊れた入力でも例外を投げない', () => {
  it.each([
    ['開始と終了が逆', { start: 5, end: 2 }],
    ['範囲が同一', { start: 3, end: 3 }],
    ['負の開始', { start: -5, end: 4 }],
    ['duration を超える終了', { start: 0, end: 999 }],
    ['NaN', { start: NaN, end: NaN }],
    ['コマ数 0', { mode: 'count' as const, count: 0 }],
    ['負の fps', { fps: -3 }],
  ] as [string, Partial<PlanInput>][])('%s', (_l, o) => {
    const r = p(o)
    expect(r.times.length).toBeGreaterThanOrEqual(1)
    expect(r.times.every(t => Number.isFinite(t) && t >= 0)).toBe(true)
  })

  it('範囲が空なら全体に戻し、理由を warnings に出す', () => {
    const r = p({ start: 5, end: 2 })
    expect(r.warnings.some(w => w.includes('全体'))).toBe(true)
    expect(r.times[0]).toBe(0)
  })

  it('コマ数 0 は 1 に丸めて知らせる', () => {
    const r = p({ mode: 'count', count: 0 })
    expect(r.times).toHaveLength(1)
    expect(r.warnings.some(w => w.includes('コマ数'))).toBe(true)
  })

  it('動画サイズ 0 でも落ちない', () => {
    const r = p({ videoWidth: 0, videoHeight: 0 })
    expect(r.outWidth).toBe(0)
    expect(r.estimatedBytes).toBe(0)
  })
})

describe('出力サイズ', () => {
  it('幅指定 + アスペクト維持で高さが従う', () => {
    const r = p({ width: 640 })
    expect(r.outWidth).toBe(640)
    expect(r.outHeight).toBe(360)   // 1920x1080 → 16:9
  })

  it('アスペクト維持を切ると高さをそのまま使う', () => {
    const r = p({ width: 640, keepAspect: false, height: 500 })
    expect([r.outWidth, r.outHeight]).toEqual([640, 500])
  })

  it('幅未指定なら元サイズ', () => {
    const r = p()
    expect([r.outWidth, r.outHeight]).toEqual([1920, 1080])
  })

  it('**偶数に丸める** (エンコーダやスケーラで扱いやすくするため)', () => {
    const r = p({ width: 641 })
    expect(r.outWidth % 2).toBe(0)
    expect(r.outHeight % 2).toBe(0)
  })
})

describe('容量の見積もりと逆算', () => {
  it('実測に合わせた係数になっている', () => {
    // 断面 GIF の実測: 690×505 × 101 コマ = 7.4MB。±35% に収まれば目安として使える
    const est = estimateBytes(690, 505, 101)
    const actual = 7541 * 1024
    expect(Math.abs(est - actual) / actual).toBeLessThan(0.35)
  })

  it('目標容量から幅を逆算できる', () => {
    const w = widthForBudget(8 * 1024 * 1024, 1920, 1080, 101)
    expect(w).toBeGreaterThan(0)
    expect(w).toBeLessThanOrEqual(1920)
    // 逆算した幅で見積もると目標付近に収まる
    const est = estimateBytes(w, Math.round(w * 1080 / 1920), 101)
    expect(est).toBeLessThan(8 * 1024 * 1024 * 1.15)
  })

  it('元より大きい幅は返さない (拡大しても情報は増えない)', () => {
    expect(widthForBudget(999 * 1024 * 1024, 320, 240, 10)).toBeLessThanOrEqual(320)
  })

  it('壊れた入力は 0 を返す', () => {
    expect(widthForBudget(0, 100, 100, 10)).toBe(0)
    expect(estimateBytes(-1, 100, 10)).toBe(0)
  })
})

describe('容量の表示', () => {
  it.each([
    [512, '512 B'], [2048, '2 KB'], [7541 * 1024, '7.4 MB'], [16.4 * 1024 * 1024, '16.4 MB'],
  ] as [number, string][])('%i → %s', (n, s) => expect(formatBytes(n)).toBe(s))
})

describe('calibrate — 実測から見積もり係数を合わせる', () => {
  it('実測値から 1 画素あたりバイト数を出す', () => {
    // 実測: 320×180 × 16 コマ = 31KB だった画面録画
    const bpp = calibrate(31 * 1024, 320, 180, 16)
    expect(bpp).toBeCloseTo(0.034, 3)
    // 既定値より小さい = 静止が多い素材
    expect(bpp).toBeLessThan(DEFAULT_BYTES_PER_PX)
  })

  it('校正した係数を使うと見積もりが実測に近づく', () => {
    const actual = 31 * 1024
    const naive = estimateBytes(320, 180, 16)
    const tuned = estimateBytes(320, 180, 16, calibrate(actual, 320, 180, 16))
    expect(naive / actual).toBeGreaterThan(5)       // 既定値では 5 倍以上外す
    expect(tuned).toBeCloseTo(actual, -1)           // 校正後はほぼ一致
  })

  it('同じ素材ならサイズやコマ数を変えても比例で当たる', () => {
    const bpp = calibrate(31 * 1024, 320, 180, 16)
    // 幅を倍・コマ数を倍にすれば約 8 倍
    expect(estimateBytes(640, 360, 32, bpp)).toBeCloseTo(31 * 1024 * 8, -2)
  })

  it('壊れた実測値では既定値に戻す (0 除算で Infinity を出さない)', () => {
    expect(calibrate(0, 320, 180, 16)).toBe(DEFAULT_BYTES_PER_PX)
    expect(calibrate(1000, 0, 180, 16)).toBe(DEFAULT_BYTES_PER_PX)
    expect(calibrate(1000, 320, 0, 16)).toBe(DEFAULT_BYTES_PER_PX)
    expect(calibrate(1000, 320, 180, 0)).toBe(DEFAULT_BYTES_PER_PX)
  })

  it('校正した係数は widthForBudget にも効く (小さい係数ほど大きく出せる)', () => {
    const budget = 9 * 1024 * 1024
    const wDefault = widthForBudget(budget, 1920, 1080, 60)
    const wTuned = widthForBudget(budget, 1920, 1080, 60, calibrate(31 * 1024, 320, 180, 16))
    expect(wTuned).toBeGreaterThan(wDefault)
  })

  it('係数が 0 以下でも元幅を返して壊れない', () => {
    expect(widthForBudget(9 * 1024 * 1024, 640, 360, 30, 0)).toBe(640)
  })

  it('buildPlan に係数を渡すと見積もりに反映される', () => {
    const base = { duration: 10, videoWidth: 640, videoHeight: 360, start: 0, end: 10,
      mode: 'count' as const, fps: 10, count: 20, width: 320, keepAspect: true, height: 0 }
    const a = buildPlan(base)
    const b = buildPlan({ ...base, bytesPerPx: 0.02 })
    expect(b.estimatedBytes).toBeLessThan(a.estimatedBytes)
    expect(b.estimatedBytes).toBe(Math.round(320 * 180 * 20 * 0.02))
  })
})
