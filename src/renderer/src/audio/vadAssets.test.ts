import { describe, expect, it } from 'vitest';
import { vadAssetBase } from './vadAssets';

describe('vadAssetBase', () => {
  it('rozwiazuje wzgledem dev serwera (http)', () => {
    expect(vadAssetBase('http://localhost:5173/')).toBe('http://localhost:5173/vad/');
  });

  it('rozwiazuje wzgledem buildu produkcyjnego (file:// z index.html)', () => {
    expect(vadAssetBase('file:///C:/app/out/renderer/index.html')).toBe(
      'file:///C:/app/out/renderer/vad/',
    );
  });

  it('zwraca absolutny URL, nigdy bare specifier (dynamiczny import ORT by padl)', () => {
    const href = vadAssetBase('http://localhost:5173/');
    // new URL bez bazy parsuje TYLKO absolutne URL-e — bare specifier by rzucil
    expect(new URL(href).href).toBe(href);
  });
});
