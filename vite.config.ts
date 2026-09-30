import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// GitHub Pages(https://<user>.github.io/miri-stock/)에서도 동작하도록 상대 경로
// 화면에 표시할 빌드 버전(배포 시각 + 커밋) — 캐시된 옛 버전인지 확인용
const built = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(5, 16).replace('T', ' ')
const sha = (process.env.GITHUB_SHA ?? 'local').slice(0, 7)

export default defineConfig({
  base: './',
  define: { __BUILD__: JSON.stringify(`${built} · ${sha}`) },
  plugins: [react()],
})
