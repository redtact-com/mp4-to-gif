import { useCallback, useMemo, useRef, useState } from 'react'
import { buildPlan, calibrate, formatBytes, widthForBudget } from './core/plan'
import type { FrameMode } from './core/plan'
import { encodeGif } from './core/encode'
import './App.css'

/** Discord の上限。20MB と言われているが実測で 16.4MB が 413 になったので控えめに置く */
const DISCORD_BUDGET = 9 * 1024 * 1024

interface Meta { duration: number; width: number; height: number; name: string; size: number }

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [src, setSrc] = useState<string | null>(null)

  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(0)
  const [mode, setMode] = useState<FrameMode>('fps')
  const [fps, setFps] = useState(10)
  const [count, setCount] = useState(60)
  const [width, setWidth] = useState(0)
  const [keepAspect, setKeepAspect] = useState(true)
  const [height, setHeight] = useState(0)
  const [colors, setColors] = useState(256)
  const [dither, setDither] = useState(false)
  const [holdLastMs, setHoldLastMs] = useState(0)

  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<{ url: string; bytes: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  /**
   * 1 画素あたりバイト数。変換するたび実測から更新する。
   * 既定値は密な素材向けなので、静止の多い素材では初回だけ大きく外す
   * (画面録画で 6 倍過大だった)。2 回目からはこの素材に合った値で出る。
   */
  const [bytesPerPx, setBytesPerPx] = useState<number | undefined>(undefined)

  const plan = useMemo(() => buildPlan({
    duration: meta?.duration ?? 0,
    videoWidth: meta?.width ?? 0,
    videoHeight: meta?.height ?? 0,
    start, end: end || (meta?.duration ?? 0),
    mode, fps, count, width, keepAspect, height, bytesPerPx,
  }), [meta, start, end, mode, fps, count, width, keepAspect, height, bytesPerPx])

  const onFile = useCallback((file: File) => {
    setError(null); setResult(null); setBytesPerPx(undefined)
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.onloadedmetadata = () => {
      if (!Number.isFinite(v.duration) || v.duration <= 0) {
        setError('この動画の長さが読めませんでした (ブラウザが対応していないコーデックかもしれません)')
        return
      }
      setMeta({ duration: v.duration, width: v.videoWidth, height: v.videoHeight, name: file.name, size: file.size })
      setStart(0); setEnd(v.duration)
      setWidth(0); setHeight(0)
      setSrc(url)
    }
    v.onerror = () => setError('動画を読み込めませんでした (ブラウザが再生できる形式か確認してください)')
    v.src = url
  }, [])

  const convert = useCallback(async () => {
    const video = videoRef.current
    if (!video || !meta) return
    setBusy(true); setError(null); setResult(null); setProgress({ done: 0, total: plan.times.length })
    try {
      if (video.readyState < 2) {
        await new Promise<void>(r => { video.addEventListener('loadeddata', () => r(), { once: true }) })
      }
      const bytes = await encodeGif(video, plan, { colors, dither, holdLastMs }, async (p) => {
        setProgress({ done: p.done, total: p.total })
        // 進捗を描画させるため 1 フレーム譲る
        await new Promise(r => requestAnimationFrame(() => r(null)))
      })
      const blob = new Blob([bytes as unknown as ArrayBuffer], { type: 'image/gif' })
      setResult({ url: URL.createObjectURL(blob), bytes: blob.size })
      setBytesPerPx(calibrate(blob.size, plan.outWidth, plan.outHeight, plan.times.length))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false); setProgress(null)
    }
  }, [meta, plan, colors, dither, holdLastMs])

  const fitToBudget = useCallback(() => {
    if (!meta) return
    const w = widthForBudget(DISCORD_BUDGET, meta.width, meta.height, plan.times.length, bytesPerPx)
    if (w > 0) { setWidth(w); setKeepAspect(true) }
  }, [meta, plan.times.length, bytesPerPx])

  const overBudget = plan.estimatedBytes > DISCORD_BUDGET

  return (
    <div className="wrap">
      <header>
        <h1>MP4 → GIF</h1>
        <p className="sub">ブラウザだけで変換します。動画はどこにも送信されません。</p>
      </header>

      <section
        className="drop"
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) onFile(f) }}
      >
        <input type="file" accept="video/*" data-testid="file"
               onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
        <span>ここに MP4 をドロップしてもいいです</span>
      </section>

      {error && <p className="err" data-testid="error">{error}</p>}

      {meta && (
        <>
          <section className="panel">
            <video ref={videoRef} src={src ?? undefined} controls muted playsInline preload="auto" />
            <dl className="meta">
              <dt>ファイル</dt><dd>{meta.name} ({formatBytes(meta.size)})</dd>
              <dt>元サイズ</dt><dd>{meta.width} × {meta.height}</dd>
              <dt>長さ</dt><dd>{meta.duration.toFixed(2)} 秒</dd>
            </dl>
          </section>

          <section className="panel grid">
            <fieldset>
              <legend>切り出す範囲</legend>
              <label>開始 (秒)
                <input type="number" step="0.1" min={0} max={meta.duration} value={start}
                       data-testid="start" onChange={e => setStart(Number(e.target.value))} />
              </label>
              <label>終了 (秒)
                <input type="number" step="0.1" min={0} max={meta.duration} value={end}
                       data-testid="end" onChange={e => setEnd(Number(e.target.value))} />
              </label>
            </fieldset>

            <fieldset>
              <legend>フレーム</legend>
              <label className="row">
                <input type="radio" checked={mode === 'fps'} onChange={() => setMode('fps')} /> fps 指定
                <input type="number" min={1} max={50} value={fps} disabled={mode !== 'fps'}
                       data-testid="fps" onChange={e => setFps(Number(e.target.value))} />
              </label>
              <label className="row">
                <input type="radio" checked={mode === 'count'} onChange={() => setMode('count')} /> コマ数指定
                <input type="number" min={1} max={2000} value={count} disabled={mode !== 'count'}
                       data-testid="count" onChange={e => setCount(Number(e.target.value))} />
              </label>
              <label>最後のコマだけ止める (ms)
                <input type="number" min={0} step={100} value={holdLastMs}
                       onChange={e => setHoldLastMs(Number(e.target.value))} />
              </label>
            </fieldset>

            <fieldset>
              <legend>出力サイズ</legend>
              <label>幅 (px・0 で元サイズ)
                <input type="number" min={0} value={width}
                       data-testid="width" onChange={e => setWidth(Number(e.target.value))} />
              </label>
              <label className="row">
                <input type="checkbox" checked={keepAspect}
                       onChange={e => setKeepAspect(e.target.checked)} /> アスペクト比を保つ
              </label>
              {!keepAspect && (
                <label>高さ (px)
                  <input type="number" min={0} value={height} onChange={e => setHeight(Number(e.target.value))} />
                </label>
              )}
              <div className="row wrap-btn">
                {[0, 320, 480, 690, 960].map(w => (
                  <button key={w} type="button" className="chip" onClick={() => setWidth(w)}>
                    {w === 0 ? '元' : w}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend>画質</legend>
              <label>色数 ({colors})
                <input type="range" min={2} max={256} value={colors}
                       data-testid="colors" onChange={e => setColors(Number(e.target.value))} />
              </label>
              <label className="row">
                <input type="checkbox" checked={dither} onChange={e => setDither(e.target.checked)} />
                ディザをかける
              </label>
              <p className="hint">
                色数を削ると軽くなりますが、平坦な色がざらつきます。ドット絵ならディザは切った方が綺麗です。
              </p>
            </fieldset>
          </section>

          <section className="panel est">
            <div>
              <strong data-testid="frames">{plan.times.length}</strong> コマ ・
              <strong data-testid="outsize">{plan.outWidth}×{plan.outHeight}</strong> ・
              実効 {plan.effectiveFps.toFixed(1)} fps ・1 コマ {plan.delayMs}ms
            </div>
            <div className={overBudget ? 'budget over' : 'budget'} data-testid="estimate">
              見積もり {formatBytes(plan.estimatedBytes)}
              {bytesPerPx === undefined
                ? <span className="hint"> (初回は粗い目安。1 回変換すると実測から合わせます)</span>
                : <span className="hint"> (前回の実測で校正済み)</span>}
              {overBudget && <> — Discord には大きすぎるかもしれません</>}
            </div>
            {overBudget && (
              <button type="button" onClick={fitToBudget} className="chip">
                {formatBytes(DISCORD_BUDGET)} に収まる幅にする
              </button>
            )}
            {plan.warnings.map(w => <p key={w} className="warn">{w}</p>)}
            <p className="hint">
              見積もりは画素数から出した目安です。動きが少ない素材では小さく、多い素材では大きく出ます。
            </p>
          </section>

          <section className="panel">
            <button type="button" className="go" disabled={busy || plan.outWidth === 0}
                    data-testid="convert" onClick={convert}>
              {busy ? '変換中…' : 'GIF に変換'}
            </button>
            {progress && (
              <progress value={progress.done} max={progress.total} data-testid="progress">
                {progress.done}/{progress.total}
              </progress>
            )}
            {progress && <span className="hint"> {progress.done} / {progress.total} コマ</span>}
          </section>

          {result && (
            <section className="panel result">
              <img src={result.url} alt="変換結果" data-testid="result" />
              <div>
                <p>
                  実測 <strong data-testid="actual">{formatBytes(result.bytes)}</strong>
                  {' '}(見積もり {formatBytes(plan.estimatedBytes)})
                </p>
                <a className="go" href={result.url}
                   download={`${meta.name.replace(/\.[^.]+$/, '')}.gif`}>ダウンロード</a>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
