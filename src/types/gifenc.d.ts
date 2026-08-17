// gifenc は型定義を同梱していないので、使う分だけ宣言する。
// 参照: https://github.com/mattdesl/gifenc の README
declare module 'gifenc' {
  export interface WriteFrameOptions {
    palette?: number[][]
    delay?: number
    transparent?: boolean
    dispose?: number
    repeat?: number
  }
  export interface Encoder {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: WriteFrameOptions): void
    finish(): void
    bytes(): Uint8Array
    reset(): void
  }
  export function GIFEncoder(opts?: { auto?: boolean; initialCapacity?: number }): Encoder
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    opts?: { format?: 'rgb565' | 'rgb444' | 'rgba4444'; oneBitAlpha?: boolean; clearAlpha?: boolean },
  ): number[][]
  /** format を省略すると量子化のみ。'atkinson' 等を渡すとディザがかかる */
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: number[][],
    format?: 'rgb565' | 'rgb444' | 'rgba4444' | 'atkinson' | 'floyd-steinberg' | 'false-floyd-steinberg' | 'stucki' | 'sierra',
  ): Uint8Array
}
