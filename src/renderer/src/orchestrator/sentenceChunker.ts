// Tnie strumien tokenow MT na zdania — kazde zdanie idzie do TTS z flush:true
// (Flash v2.5 generuje audio per zdanie = pierwszy dzwiek szybciej).

// Granica = interpunkcja + bialy znak. Kropka na koncu bufora NIE konczy zdania
// (moze byc "3.5" rozciete miedzy tokeny) — resztke domyka flushRemainder().
const BOUNDARY = /([.!?…]+["')\]]?)\s+/;

export class SentenceChunker {
  private buf = '';

  constructor(private readonly maxLen = 250) {}

  /** Dodaje delte tekstu; zwraca KOMPLETNE zdania gotowe do syntezy. */
  push(delta: string): string[] {
    this.buf += delta;
    const out: string[] = [];
    for (;;) {
      const m = BOUNDARY.exec(this.buf);
      if (m && m.index + m[1].length <= this.buf.length) {
        const end = m.index + m[1].length;
        const sentence = this.buf.slice(0, end).trim();
        this.buf = this.buf.slice(end).replace(/^\s+/, '');
        if (sentence.length > 1) out.push(sentence);
        continue;
      }
      // Twardy limit dlugosci — tnij na ostatniej spacji (ochrona TTS i latencji).
      if (this.buf.length >= this.maxLen) {
        const cut = this.buf.lastIndexOf(' ', this.maxLen);
        const end = cut > 20 ? cut : this.maxLen;
        const piece = this.buf.slice(0, end).trim();
        this.buf = this.buf.slice(end).replace(/^\s+/, '');
        if (piece.length > 1) out.push(piece);
        continue;
      }
      break;
    }
    return out;
  }

  /** Resztka po koncu strumienia MT (ostatnie zdanie bez kropki). */
  flushRemainder(): string | null {
    const rest = this.buf.trim();
    this.buf = '';
    return rest.length > 1 ? rest : null;
  }
}
