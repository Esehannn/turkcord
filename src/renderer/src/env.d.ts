// "dosya.wasm?base64": electron.vite.config.ts'deki eklenti wasm dosyasını base64 metin olarak verir.
declare module '*.wasm?base64' {
  const base64: string
  export default base64
}
