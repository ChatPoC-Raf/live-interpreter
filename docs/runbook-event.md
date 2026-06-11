# Runbook — dzien wydarzenia

## Przed wydarzeniem (dzien wczesniej)

- [ ] **Profil mowcy**: nagrana probka 1-2 min, klon IVC utworzony, odsluch zaakceptowany,
      notatka zgody (RODO) wpisana w profilu.
- [ ] **Klucze API**: ElevenLabs (sprawdz quota/credits!) + LLM. Zapasowy klucz ElevenLabs
      w kieszeni (podmiana mid-session dziala bez restartu).
- [ ] **Mikrofon**: bezprzewodowy z donglem USB (Rode Wireless GO / DJI Mic).
      NIE Bluetooth Classic — degraduje do HFP (jakosc telefoniczna), aplikacja ostrzeze.
- [ ] **Internet**: lacze na sali sprawdzone; hotspot z telefonu jako backup skonfigurowany.
- [ ] **Drugi ekran/tablet** dla mowcy (okno wskaznika, always-on-top).
- [ ] Eksport testowej sesji dziala (ZIP).

## Na sali (soundcheck — 30 min przed)

1. Podlacz mikrofon (dongle USB) i glosnik PA.
2. Aplikacja → **Soundcheck** (wizard przeprowadzi przez 6 krokow):
   poziomy + szum sali → HFP check → test PA → pomiar przesluchu (kalibracja barge-in)
   → segment testowy E2E z pomiarem latencji → pre-flight kluczy/profilu.
3. Brief mowcy (przycisk „Jak to dziala?" w oknie wskaznika):
   - mow 1-3 zdania, potem WYRAZNA pauza;
   - patrz na wskaznik: zielony MOW / czerwony CZEKAJ;
   - nie mow podczas odtwarzania (i tak nagrywamy — ale tlumaczenie tego nie obejmie).
4. Ustaw okno wskaznika na ekranie widocznym dla mowcy.

## W trakcie — sciaga operatora

| Sytuacja | Co robic |
|---|---|
| Segment zly/urwany | **Pomin segment** (mowca powtorzy) |
| Publicznosc nie doslyszala | **Powtorz ostatni** |
| Mowca gada bez konca | **Forsuj koniec tury** |
| Alert AWARIA (retry) | Czekaj — auto-retry z backoffem; ew. **Ponow teraz** / **Pomin** |
| AWARIA TERMINALNA (quota/401) | Ustawienia → wpisz zapasowy klucz → Zapisz (auto-podmiana) → **Wznow** |
| Mikrofon odpiety | Sesja sama przejdzie w PAUZE — sprawdz dongle, wybierz urzadzenie, **Wznow** |
| Barge-in (zolty alert) | Tresc jest nagrana w original.wav, ale NIE przetlumaczona — gestem popros mowce o powtorzenie |
| Padl caly laptop | Po restarcie aplikacja sama odzyska artefakty (recovery) — wznow nowa sesje |

## Po wydarzeniu

- [ ] **Koniec sesji** → eksport ZIP (segments.jsonl + original.wav + tts/ + transcript.txt).
- [ ] Skasuj klon glosu z ElevenLabs, jesli zgoda byla jednorazowa (Profile → Usun).
