// ============================================================
// 変換計画 — 「どのコマを、どの大きさで抜くか」を決める純粋な計算
//
// ここに副作用を入れないのは、**変換前に見積もりを出すため**。
// GIF は撮り直しが高くつく (Discord は 16.4MB を 413 で弾く) ので、
// 押す前に「コマ数・出力サイズ・おおよそのファイル容量」を見せたい。
// ============================================================

/** フレーム指定の方法。fps 固定か、総コマ数固定か */
export type FrameMode = 'fps' | 'count'

export interface PlanInput {
  /** 動画の長さ (秒) */
  duration: number
  /** 元の幅・高さ (px) */
  videoWidth: number
  videoHeight: number
  /** 切り出し範囲 (秒)。end は duration を超えたら丸める */
  start: number
  end: number
  mode: FrameMode
  /** mode='fps' のときの 1 秒あたりコマ数 */
  fps: number
  /** mode='count' のときの総コマ数 */
  count: number
  /** 出力幅 (px)。0 以下なら元サイズ */
  width: number
  /** アスペクト比を維持するか。false なら height をそのまま使う */
  keepAspect: boolean
  /** keepAspect=false のときの出力高さ */
  height: number
  /**
   * 1 画素あたりのバイト数。**前回の変換実測から校正した値**を渡す。
   * 省略時は密な素材向けの既定値 (DEFAULT_BYTES_PER_PX)。
   */
  bytesPerPx?: number
}

export interface Plan {
  /** 各コマの動画内時刻 (秒・昇順) */
  times: number[]
  outWidth: number
  outHeight: number
  /** 実効 fps (再生速度の目安) */
  effectiveFps: number
  /** 1 コマの表示時間 (ms)。GIF は 10ms 単位なので丸めた値 */
  delayMs: number
  /** 見積もり容量 (バイト)。実測とは必ずずれるので目安 */
  estimatedBytes: number
  warnings: string[]
}

/** GIF の遅延は 1/100 秒単位。10ms 未満はブラウザが勝手に補正するので下限を置く */
export const MIN_DELAY_MS = 20

/**
 * 1 画素あたりの既定バイト数。
 *
 * **密な素材から逆算した上限寄りの値**。Minecraft のテクスチャが詰まった GIF
 * (690×505 × 101 コマ = 7.4MB) がほぼこの比だった。逆に**静止が多い素材では
 * 大きく外す** (実測: 画面録画 320×180 × 16 コマ で見積もり 198KB / 実測 31KB)。
 * そのため 1 回変換したら実測から校正する (calibrate)。
 */
export const DEFAULT_BYTES_PER_PX = 0.22

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** 偶数に丸める (エンコーダやスケーラで扱いやすいため) */
const even = (v: number): number => Math.max(2, Math.round(v / 2) * 2)

/**
 * 入力から変換計画を組む。**入力が壊れていても例外を投げず**、warnings に理由を積む。
 * 変換ボタンを押す前にそのまま画面へ出すため。
 */
export function buildPlan(input: PlanInput): Plan {
  const warnings: string[] = []
  const duration = Number.isFinite(input.duration) && input.duration > 0 ? input.duration : 0

  let start = clamp(Number.isFinite(input.start) ? input.start : 0, 0, duration)
  let end = clamp(Number.isFinite(input.end) ? input.end : duration, 0, duration)
  if (end <= start) {
    // 開始と終了が逆・同一。範囲全体に戻して知らせる
    if (duration > 0) warnings.push('切り出し範囲が空なので全体を使います')
    start = 0
    end = duration
  }
  const span = end - start

  // コマ数を決める
  let n: number
  if (input.mode === 'count') {
    n = Math.floor(Number.isFinite(input.count) ? input.count : 0)
    if (n < 1) { n = 1; warnings.push('コマ数が 1 未満なので 1 にしました') }
  } else {
    const fps = Number.isFinite(input.fps) && input.fps > 0 ? input.fps : 10
    n = Math.max(1, Math.round(span * fps))
  }

  // コマ時刻。n=1 なら開始時刻の 1 枚だけ。
  // **末尾は end ぴったりを避ける** (seek が最後のフレームを返さないことがある)
  const times: number[] = []
  if (n === 1 || span === 0) {
    times.push(start)
  } else {
    const step = span / n
    for (let i = 0; i < n; i++) times.push(start + step * i)
  }

  const effectiveFps = span > 0 ? n / span : 0
  const delayMs = Math.max(MIN_DELAY_MS, Math.round((span > 0 ? (span / n) * 1000 : 100) / 10) * 10)

  // 出力サイズ
  const vw = input.videoWidth > 0 ? input.videoWidth : 0
  const vh = input.videoHeight > 0 ? input.videoHeight : 0
  let outWidth: number
  let outHeight: number
  if (vw === 0 || vh === 0) {
    outWidth = 0
    outHeight = 0
  } else if (input.width > 0) {
    outWidth = even(input.width)
    outHeight = input.keepAspect
      ? even(input.width * (vh / vw))
      : even(input.height > 0 ? input.height : vh)
  } else {
    outWidth = even(vw)
    outHeight = input.keepAspect ? even(vh) : even(input.height > 0 ? input.height : vh)
  }

  if (outWidth > 0 && outWidth * outHeight * times.length > 400_000_000) {
    warnings.push('画素数 × コマ数が大きすぎます (時間がかかります)')
  }

  return {
    times,
    outWidth,
    outHeight,
    effectiveFps,
    delayMs,
    estimatedBytes: estimateBytes(outWidth, outHeight, times.length, input.bytesPerPx),
    warnings,
  }
}

/**
 * 容量の見積もり (バイト)。
 *
 * GIF は LZW + フレーム間差分なので内容次第で大きく振れる。既定係数は密な素材
 * 向けの上限寄りなので、**1 回変換したら実測から校正した係数を渡す**こと。
 */
export function estimateBytes(
  width: number, height: number, frames: number, bytesPerPx = DEFAULT_BYTES_PER_PX,
): number {
  if (width <= 0 || height <= 0 || frames <= 0) return 0
  return Math.round(width * height * frames * bytesPerPx)
}

/**
 * 変換の実測から 1 画素あたりバイト数を求める。次回以降の見積もりに使う。
 * 素材が同じならサイズやコマ数を変えてもだいたい当たる。
 */
export function calibrate(actualBytes: number, width: number, height: number, frames: number): number {
  if (actualBytes <= 0 || width <= 0 || height <= 0 || frames <= 0) return DEFAULT_BYTES_PER_PX
  return actualBytes / (width * height * frames)
}

/** 目標容量に収めるための出力幅を逆算する (アスペクト維持前提) */
export function widthForBudget(
  targetBytes: number, videoWidth: number, videoHeight: number, frames: number,
  bytesPerPx = DEFAULT_BYTES_PER_PX,
): number {
  if (targetBytes <= 0 || videoWidth <= 0 || videoHeight <= 0 || frames <= 0) return 0
  if (bytesPerPx <= 0) return even(videoWidth)
  const aspect = videoHeight / videoWidth
  // w * (w*aspect) * frames * bytesPerPx = target
  const w = Math.sqrt(targetBytes / (aspect * frames * bytesPerPx))
  return even(Math.min(w, videoWidth))
}

export const formatBytes = (n: number): string =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB`
  : n >= 1024 ? `${Math.round(n / 1024)} KB`
  : `${n} B`
