import { defineConfig, devices } from '@playwright/test'

// Pages 配信の確認専用。**base の設定ミスは真っ白なページになるだけで静かに壊れる**ので、
// project site と同じ `/mp4-to-gif/` 配下で実際に読み込めることを確かめる。
const PORT = Number(process.env.E2E_PAGES_PORT ?? 5179)
const BASE = `http://127.0.0.1:${PORT}/mp4-to-gif/`

export default defineConfig({
  testDir: './e2e',
  testMatch: 'pages-smoke.spec.ts',
  workers: 1,
  timeout: 120_000,
  reporter: 'list',
  use: { baseURL: BASE, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chromium' } }],
  webServer: {
    // GITHUB_PAGES=1 で base が /mp4-to-gif/ になる。
    // 配信は vite preview ではなく scripts/serve-subpath.mjs を使う
    // (preview は base 外も index.html で拾うため確認にならない)
    command: `GITHUB_PAGES=1 npm run build && PORT=${PORT} node scripts/serve-subpath.mjs`,
    url: BASE,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
