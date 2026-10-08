import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, loadEnv } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Paketlenmiş uygulamada sayfaya sıkı bir İçerik Güvenliği Politikası (CSP) ekler.
// Geliştirme modunda Vite'in canlı yenilemesi satır içi betik kullandığı için eklenmez.
function contentSecurityPolicy(supabaseUrl: string): Plugin {
  return {
    name: 'turkcord-csp',
    apply: 'build',
    transformIndexHtml(html) {
      const host = supabaseUrl ? new URL(supabaseUrl).host : ''
      const supabase = host ? `https://${host} wss://${host}` : ''
      const policy = [
        "default-src 'self'",
        // wasm-unsafe-eval: sadece WebAssembly derlemeye izin verir (gürültü engelleme), eval'e değil.
        "script-src 'self' 'wasm-unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "font-src 'self' data:",
        `img-src 'self' data: blob: ${host ? `https://${host}` : ''}`,
        // Sohbete gönderilen ses ve video dosyaları Supabase'in geçici bağlantılarından oynatılır.
        `media-src 'self' blob: data: mediastream: ${host ? `https://${host}` : ''}`,
        `connect-src 'self' ${supabase} stun: turn: turns:`,
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-src 'none'",
        "worker-src 'self' blob:",
      ].join('; ')
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
      )
    },
  }
}

// "dosya.wasm?base64" içe aktarımı: wasm dosyası metin olarak koda gömülür. Paketlenmiş uygulamada
// file:// adresinden fetch yapılamadığı için yapay zekâ gürültü engellemenin modeli böyle yüklenir.
function wasmBase64(): Plugin {
  return {
    name: 'turkcord-wasm-base64',
    enforce: 'pre',
    load(id) {
      if (!id.endsWith('.wasm?base64')) return null
      const file = id.slice(0, -'?base64'.length)
      return `export default ${JSON.stringify(readFileSync(file).toString('base64'))}`
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    main: {
      build: { outDir: 'out/main' },
    },
    preload: {
      build: { outDir: 'out/preload' },
    },
    renderer: {
      root: 'src/renderer',
      build: { outDir: 'out/renderer', minify: true },
      resolve: {
        alias: {
          '@': resolve('src/renderer/src'),
          '@shared': resolve('src/shared'),
        },
      },
      plugins: [wasmBase64(), react(), tailwindcss(), contentSecurityPolicy(env.VITE_SUPABASE_URL ?? '')],
    },
  }
})
