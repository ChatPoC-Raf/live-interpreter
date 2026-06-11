// Baza URL assetow VAD/ORT (public/vad/ — kopiowane przez scripts/copy-vad-assets.mjs).
//
// MUSI byc absolutnym URL-em: onnxruntime-web laduje swoj modul
// ort-wasm-simd-threaded.mjs dynamicznym import(), a wzgledny prefix ('vad/')
// jest tam bare module specifierem -> TypeError "Failed to resolve module
// specifier" -> "no available backend found" przy starcie sesji.
// fetch() modelu i audioWorklet.addModule() znosza sciezki wzgledne,
// dynamiczny import() — nie.

/** Absolutna baza URL assetow VAD: 'vad/' rozwiazane wzgledem strony (dev http i prod file://). */
export function vadAssetBase(baseURI: string): string {
  return new URL('vad/', baseURI).href;
}
