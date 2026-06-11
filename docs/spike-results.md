# Spike E2E latencji (Unit 2 — GATE)

> **Status: OCZEKUJE NA KLUCZE API.** Kod spike'a jest gotowy — panel „Spike" w aplikacji
> (pulpit operatora → przycisk Spike). Po wpisaniu kluczy w Ustawieniach i utworzeniu
> profilu mowcy uruchom spike i wklej tutaj raport JSON (przycisk „Kopiuj raport JSON").

## Jak uruchomic

1. `npm run dev`
2. Ustawienia → wpisz klucz ElevenLabs + klucz LLM (Gemini lub Anthropic)
3. Profile → nagraj probke 1-2 min → „Utworz klon glosu" (IVC)
4. Wybierz profil jako aktywny (radio) + wybierz glosnik w panelu Audio
5. Spike → „Uruchom spike" (10 segmentow przez realne API)

## Co mierzy

- **Panel Spike**: MT TTFT + TTS TTFB + playback (bez VAD/STT) — 10 przebiegow, median/p95.
- **Pelne E2E z mikrofonem**: kazdy segment realnej sesji ma zmierzona latencje
  pauza→pierwszy dzwiek (chip w feedzie segmentow + mediana w topbarze).

## Budzet z planu (do weryfikacji)

| Etap | Budzet |
|---|---|
| VAD cisza (redemption) | 300-500 ms (ustawienie, domyslnie 800) |
| STT final po commit | ~150 ms |
| MT TTFT (Gemini Flash-Lite) | 200-600 ms |
| TTS TTFB (Flash v2.5, WS) | 100-150 ms |
| Bufor/playback | ~50 ms |
| **Razem** | **0.8-1.6 s** (cel ≤2 s) |

## Wyniki

```json
(wklej raport JSON ze Spike panelu)
```

## Weryfikacja IVC (voice captcha)

- [ ] Klon utworzony z probki 1-2 min PL — jakosc?
- [ ] Czy `requires_verification` w odpowiedzi `/v1/voices/add`? (UI pokazuje ostrzezenie)
- [ ] A/B Flash v2.5 vs Multilingual v2 (odsluch w panelu Profile — model w previewVoice)

## Weryfikacja protokolu Scribe v2 Realtime

Adapter `src/renderer/src/providers/stt/scribeRealtime.ts` ma TOLERANCYJNY parser
(partial/final po typie wiadomosci) i stale protokolu zebrane na gorze pliku.
Przy pierwszym realnym uruchomieniu zweryfikowac w DevTools (Network → WS):

- [ ] format wiadomosci audio (binarne vs JSON base64 — obecnie JSON `input_audio`)
- [ ] nazwa zdarzenia commit (obecnie `{"type":"commit"}`)
- [ ] auth przez query param `xi-api-key` dziala
- [ ] zmiana jezyka mid-session raportowana w `language_code`

## Decyzja GATE

- [ ] **GO** — median ≤2 s → Fazy 2+ (juz zaimplementowane, decyzja dotyczy uzycia na evencie)
- [ ] **NO-GO** — median >2 s → optymalizacje: `x-region` EU, krotsze zdania, inny LLM
