# Live Interpreter

Aplikacja desktopowa (Windows) do **tłumaczenia konsekutywnego wystąpień na żywo** z klonem głosu mówcy.

Mówca mówi do mikrofonu → aplikacja wykrywa pauzę (VAD) → streaming STT z auto-detekcją języka
(ElevenLabs Scribe v2 Realtime) → tłumaczenie LLM streamingiem (Gemini / Claude) → synteza głosem
mówcy (ElevenLabs Flash v2.5 + Instant Voice Cloning) → głośnik PA. Aplikacja prowadzi rytm —
mówca widzi na osobnym oknie, kiedy mówić, a kiedy czekać.

## Status

W budowie — szkielet aplikacji + rdzeń domeny. Wymaga kluczy API (ElevenLabs + Gemini lub
Anthropic) wpisywanych w ustawieniach aplikacji (szyfrowane przez `safeStorage`, nigdy plaintext).

## Development

```bash
npm install
npm run dev        # dev server + oba okna (operator + wskaznik mowcy)
                   # wskaznik mowcy otwiera sie w prawym dolnym rogu (always-on-top);
                   # przycisk "Ukryj/Pokaz wskaznik mowcy" w topbarze operatora,
                   # na evencie przeciagnij wskaznik na ekran skierowany do mowcy
npm run test       # testy jednostkowe (vitest)
npm run lint       # eslint
npm run typecheck  # tsc --noEmit (main + renderer)
npm run validate   # wszystko powyzsze + build
npm run dist       # instalator NSIS (release/)
```

## Architektura

```
src/main/          # proces glowny Electrona: okna, IPC, artefakty sesji, ustawienia (safeStorage)
src/preload/       # most contextBridge (window.live)
src/shared/        # kontrakt IPC (tylko typy)
src/renderer/src/
  core/            # CZYSTY TS: maszyna stanow sesji, model segmentu, taksonomia bledow
  audio/           # Web Audio: urzadzenia, tor wej/wyj, VU, VAD (Silero via @ricky0123/vad-web)
  providers/       # adaptery STT / MT / TTS / glosy (IVC) za interfejsami
  orchestrator/    # pipeline segmentu: VAD -> STT -> MT -> TTS -> playback
  ui/              # React: pulpit operatora + okno wskaznika mowcy
```

Kluczowe decyzje i pelny plan: katalog planistyczny projektu (BudgetLighthouse
`docs/active/live-interpreter/`). Najwazniejsze zasady v1:

- **Tryb konsekutywny** — dokladnie 1 segment in-flight, bez kolejki.
- **Twardy half-duplex** — brama mikrofonu zamknieta podczas odtwarzania (+ ogon), barge-in
  jest nagrywany i sygnalizowany, nigdy cichy.
- **Artefakty append-only od t0** — `segments.jsonl` + `original.wav` (strumieniowo) +
  `tts/NNN.wav`; crash recovery przy starcie; eksport ZIP.
- **Bledy**: 429/5xx/timeout = przejsciowe (retry + backoff), 401/quota = terminalne
  (podmiana klucza mid-session, bez restartu).

## ⚠️ Sprzęt — mikrofon

Mikrofon **Bluetooth Classic** przy przechwytywaniu audio ZAWSZE spada do profilu HFP
(8–16 kHz, jakość telefoniczna) — to psuje i transkrypcję, i wrażenie klonu głosu.
**Rekomendacja: mikrofon bezprzewodowy z donglem USB** (np. Rode Wireless GO II, DJI Mic).
Aplikacja wykrywa podejrzenie HFP i ostrzega w soundchecku.

## Licencja

MIT
