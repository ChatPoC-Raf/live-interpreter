import { describe, expect, it } from 'vitest';
import { parseSse } from './sse';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const out: string[] = [];
  for await (const p of parseSse(stream, new AbortController().signal)) out.push(p);
  return out;
}

describe('parseSse', () => {
  it('parsuje wiersze data: i pomija inne', async () => {
    const out = await collect(streamOf(['event: x\ndata: {"a":1}\n\ndata: {"b":2}\n\n']));
    expect(out).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('skleja payload rozciety miedzy chunki sieci', async () => {
    const out = await collect(streamOf(['data: {"a"', ':1}\n\n']));
    expect(out).toEqual(['{"a":1}']);
  });

  it('pomija [DONE] i puste data', async () => {
    const out = await collect(streamOf(['data: [DONE]\n\ndata:\n\ndata: x\n\n']));
    expect(out).toEqual(['x']);
  });

  it('obsluguje CRLF', async () => {
    const out = await collect(streamOf(['data: abc\r\n\r\n']));
    expect(out).toEqual(['abc']);
  });

  it('payload bez koncowego newline (uciety strumien) tez wychodzi', async () => {
    const out = await collect(streamOf(['data: tail']));
    expect(out).toEqual(['tail']);
  });
});
