import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// GitHub Pages(https://<user>.github.io/miri-stock/)에서도 동작하도록 상대 경로
export default defineConfig({
  base: './',
  plugins: [react()],
})
