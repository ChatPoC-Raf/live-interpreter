// Budowa promptu tlumacza konsekutywnego — czysta funkcja, wspolna dla LLM-ow.
import type { TranslationRequest } from '../types';

export const SYSTEM_PROMPT =
  'Jestes tlumaczem konsekutywnym wystapien na zywo. Tlumacz wiernie sens wypowiedzi ' +
  'na jezyk docelowy, naturalnym jezykiem MOWIONYM (tekst trafia do syntezy mowy). ' +
  'Zachowaj rejestr i ton mowcy. NIE dodawaj zadnych komentarzy, wyjasnien ani prefiksow — ' +
  'zwracasz WYLACZNIE tlumaczenie. Liczby, nazwy wlasne i cytaty zachowuj doslownie.';

export function buildUserPrompt(req: Pick<TranslationRequest, 'text' | 'sourceLang' | 'targetLang' | 'context'>): string {
  const lines: string[] = [];
  if (req.context.length > 0) {
    lines.push('Kontekst (poprzednie segmenty, dla spojnosci terminologii):');
    for (const c of req.context.slice(-3)) {
      lines.push(`- "${c.original}" -> "${c.translated}"`);
    }
    lines.push('');
  }
  const src = req.sourceLang ? `z jezyka "${req.sourceLang}"` : 'z jezyka wykrytego automatycznie';
  lines.push(`Przetlumacz ${src} na jezyk "${req.targetLang}":`);
  lines.push(req.text);
  return lines.join('\n');
}
