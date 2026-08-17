import { test, expect } from '@playwright/test'

// GitHub Pages と同じ /mp4-to-gif/ 配下で配信した時に動くか。
// base を間違えるとアセットが 404 になり、エラーも出さず真っ白になるので
// 「読み込めた」だけでなく「JS が動いて UI が組み立てられた」ところまで見る。
test('サブパス配信 (/mp4-to-gif/) で読み込めて JS が動く', async ({ page }) => {
  const failed: string[] = []
  page.on('requestfailed', r => failed.push(r.url()))
  page.on('response', r => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`) })

  // '/' だと baseURL のサブパスを捨ててルートへ飛ぶ。'./' で /mp4-to-gif/ 配下に入る
  await page.goto('./')

  // React が描いた要素。静的な index.html だけでは出ない
  await expect(page.getByRole('heading', { name: 'MP4 → GIF' })).toBeVisible()
  await expect(page.locator('[data-testid="file"]')).toBeVisible()
  expect(failed, 'アセットの取得に失敗している (base が違う)').toEqual([])
})
