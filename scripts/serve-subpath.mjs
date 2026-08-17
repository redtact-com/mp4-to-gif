// GitHub Pages の project site と同じ配信をローカルで再現する小さなサーバ。
//
// `vite preview` では確認にならない: base 外のパスも index.html で拾ってしまうため、
// base を間違えた (アセットを `/assets/...` と絶対参照する) ビルドでも読み込めてしまう。
// Pages の project site は `/{repo}/` の外を一切持たないので、**外は 404 で返す**必要がある。
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const PREFIX = process.env.SUBPATH ?? '/mp4-to-gif/'
const ROOT = process.env.SERVE_ROOT ?? 'dist'
const PORT = Number(process.env.PORT ?? 5179)

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
}

createServer(async (req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0])
  if (!path.startsWith(PREFIX)) {
    // Pages ではリポジトリ配下の外は存在しない
    res.writeHead(404).end('not found')
    return
  }
  const rel = path.slice(PREFIX.length) || 'index.html'
  const file = join(ROOT, normalize('/' + rel))
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body)
  } catch {
    // SPA なので不明なパスは index.html。ただし拡張子付き (アセット) は 404 のまま
    if (extname(rel)) { res.writeHead(404).end('not found'); return }
    try {
      res.writeHead(200, { 'content-type': 'text/html' }).end(await readFile(join(ROOT, 'index.html')))
    } catch { res.writeHead(404).end('not found') }
  }
}).listen(PORT, '127.0.0.1', () => console.log(`serving ${ROOT} at http://127.0.0.1:${PORT}${PREFIX}`))
