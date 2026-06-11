# Drille awaryjne (Unit 12)

Kazdy drill ma oczekiwane przejscia maszyny stanow. Logika przejsc jest w 100% pokryta
testami (`src/renderer/src/core/sessionMachine.test.ts` — pelna tabela przejsc), a artefakty
testami crash-recovery (`src/main/artifacts/artifactsCore.test.ts`). Ponizsze drille to
scenariusze MANUALNE do wykonania na realnym sprzecie/API przed pierwszym wydarzeniem.

## D1 — odciecie sieci w TLUMACZE

**Jak**: w trakcie tlumaczenia segmentu wylacz Wi-Fi.
**Oczekiwane**: `TLUMACZE → AWARIA_RETRY` (alert zolty, wskaznik mowcy AWARIA) → auto-retry
z backoffem (0.8 s / 1.6 s) → po 2 nieudanych retry `AWARIA_TERMINALNA`. Po wlaczeniu sieci
w oknie retry: segment dokonczony normalnie. Wiersz `segment_error_transient` w segments.jsonl.
**Pokrycie testowe**: `bledy: transient -> retry -> terminal` w sessionMachine.test.ts.

## D2 — wyczerpany klucz (quota) → podmiana mid-session

**Jak**: uzyj klucza z wyczerpanym limitem (albo zrewokowanego).
**Oczekiwane**: `AWARIA_TERMINALNA` od razu (bez retry — quota = terminal), alert czerwony.
Ustawienia → wpisanie nowego klucza → `KEY_REPLACED → PAUZA` → Wznow → `SLUCHAM`.
Segment z awaria ma flage GAP (tresc w original.wav).
**Pokrycie testowe**: `blad terminalny od razu -> AWARIA_TERMINALNA` + `KEY_REPLACED`.

## D3 — odpiecie mikrofonu w SLUCHAM

**Jak**: wyciagnij dongle USB w trakcie nasluchu.
**Oczekiwane**: `→ PAUZA` automatycznie + czerwony alert `device_lost`. Wznowienie TYLKO
reczne po wybraniu urzadzenia (fallback po label+groupId jesli deviceId sie zmienil).
**Pokrycie testowe**: `DEVICE_LOST w SLUCHAM/TLUMACZE/ODTWARZAM -> PAUZA`.

## D4 — kill procesu → recovery

**Jak**: w trakcie sesji zabij proces (Menedzer zadan → Zakoncz zadanie).
**Oczekiwane**: po restarcie aplikacji baner „Odzyskano niedomkniete sesje". W katalogu sesji:
segments.jsonl kompletny do ostatniego appendu, original.wav odtwarzalny (naglowek zalatany),
session.json z flaga `recovered`, transcript.txt wygenerowany.
**Pokrycie testowe**: `ArtifactsManager — crash recovery` (kill w polowie = brak finalize).

## D5 — sesja 45 minut

**Jak**: pelna proba generalna ≥45 min.
**Sprawdz**: pamiec procesu (Menedzer zadan) stabilna; WS STT przezywa albo jest
transparentnie odnawiany miedzy segmentami; original.wav rosnie liniowo (~2 MB/min);
latencja nie degraduje; brak leakow alertow.

## D6 — barge-in

**Jak**: mow glosno podczas odtwarzania tlumaczenia.
**Oczekiwane**: zolty alert barge-in (po ~300 ms utrzymanej energii ponad skalibrowany prog),
flaga BARGE_IN na segmencie, wpis w segments.jsonl. Tresc JEST w original.wav. Zadnych
zaklocen odtwarzania.
**Pokrycie testowe**: `barge-in sygnalizowany w ODTWARZAM` + BargeInDetector (vadLogic.test.ts).

## Regresje

Kazdy defekt znaleziony w drillach dostaje test regresyjny PRZED naprawa
(test najpierw failuje, fix, test zielony — patrz coding rules repo).
