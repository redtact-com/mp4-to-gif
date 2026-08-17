// ============================================================
// 変換の実行 — <video> をコマ送りして canvas に描き、gifenc で GIF にする
//
// ffmpeg.wasm を使わない方針 (#1)。依存が gifenc だけで済み、
// COOP/COEP ヘッダも不要でオフラインでも動く。
// 代償はブラウザが再生できるコーデックに限られること。
// ============================================================

import { GIFEncoder, quantize, applyPalette } from 'gifenc'
import type { Plan } from './plan'

export interface EncodeOptions {
  /** パレットの色数 (2..256)。少ないほど軽いがざらつく */
  colors: number
  /** ディザをかけるか。写真的な素材では有効、ドット絵では切った方が綺麗 */
  dither: boolean
  /** 最後のコマだけ長く止める (ms)。0 なら均一 */
  holdLastMs: number
}

export interface EncodeProgress {
  done: number
  total: number
  phase: 'seek' | 'quantize' | 'finish'
}

/**
 * 指定時刻へシークして 1 コマ描けるまで待つ。
 *
 * `currentTime` を代入しても即座には反映されないので `seeked` を待つ。
 * **`seeked` が来ないブラウザ/素材があるのでタイムアウトを置く** (来なくても
 * その時点のフレームで描いてしまう方が、無言で止まるより良い)。
 */
async function seekTo(video: HTMLVideoElement, t: number, timeoutMs = 3000): Promise<void> {
  if (Math.abs(video.currentTime - t) < 1e-3) return
  await new Promise<void>((resolve) => {
    let settled = false
    const done = () => { if (!settled) { settled = true; cleanup(); resolve() } }
    const cleanup = () => {
      video.removeEventListener('seeked', done)
      clearTimeout(timer)
    }
    const timer = setTimeout(done, timeoutMs)
    video.addEventListener('seeked', done, { once: true })
    video.currentTime = t
  })
}

/**
 * 計画に従って GIF を作る。戻り値はそのまま Blob にできるバイト列。
 * onProgress は 1 コマごとに呼ばれるので、UI 側で await を挟んで描画を通す。
 */
export async function encodeGif(
  video: HTMLVideoElement,
  plan: Plan,
  opts: EncodeOptions,
  onProgress?: (p: EncodeProgress) => void | Promise<void>,
): Promise<Uint8Array> {
  const { outWidth: w, outHeight: h, times, delayMs, crop } = plan
  if (w <= 0 || h <= 0 || times.length === 0) throw new Error('出力サイズかコマ数が 0 です')

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('canvas 2d コンテキストが取れません')
  // 縮小時のにじみを抑える。ドット絵素材で効く
  ctx.imageSmoothingEnabled = false

  const gif = GIFEncoder()
  const colors = Math.min(256, Math.max(2, Math.round(opts.colors)))

  for (let i = 0; i < times.length; i++) {
    await seekTo(video, times[i])
    // 元矩形にクロップを渡す。plan 側ではみ出しは補正済み
    ctx.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, w, h)
    const { data } = ctx.getImageData(0, 0, w, h)
    await onProgress?.({ done: i, total: times.length, phase: 'seek' })

    const palette = quantize(data, colors)
    const indexed = applyPalette(data, palette, opts.dither ? 'atkinson' : undefined)
    const last = i === times.length - 1
    gif.writeFrame(indexed, w, h, {
      palette,
      delay: last && opts.holdLastMs > 0 ? opts.holdLastMs : delayMs,
    })
    await onProgress?.({ done: i + 1, total: times.length, phase: 'quantize' })
  }

  await onProgress?.({ done: times.length, total: times.length, phase: 'finish' })
  gif.finish()
  return gif.bytes()
}
