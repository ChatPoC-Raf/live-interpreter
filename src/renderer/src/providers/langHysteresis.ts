// Histereza jezyka zrodlowego: MT przelacza jezyk dopiero po PELNYM segmencie
// w nowym jezyku. Partials nie zmieniaja jezyka (code-switching w srodku
// segmentu -> jezyk dominujacy raportowany przez STT przy commit).

export class LanguageHysteresis {
  private current: string | null = null;

  /** Jezyk zrodlowy do uzycia dla NADCHODZACEGO segmentu (null = auto). */
  get sourceLang(): string | null {
    return this.current;
  }

  /** Wolane po commit segmentu z finalnie wykrytym jezykiem. */
  confirmSegment(detectedLang: string | null): void {
    if (detectedLang) this.current = detectedLang;
  }

  reset(): void {
    this.current = null;
  }
}
