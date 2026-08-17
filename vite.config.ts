import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages の project site は /{repo}/ 配下に置かれるので、
  // アセット参照を相対にするために base を付ける。
  // dev / preview / E2E は `/` のままにしたいので env で切り替える。
  base: process.env.GITHUB_PAGES ? '/mp4-to-gif/' : '/',
  plugins: [react()],
  test: {
    // e2e/ は playwright が回す。vitest が拾うと
    // "Playwright Test did not expect test() to be called here" で落ちる
    include: ['src/**/*.test.ts'],
  },
})
