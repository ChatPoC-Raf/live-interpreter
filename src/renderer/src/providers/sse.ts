// Parser strumienia SSE (Server-Sent Events) z fetch Response.body.
// Yielduje payloady linii `data:` (bez prefiksu), pomija komentarze i [DONE].

export async function* parseSse(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<string, void, undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      if (signal.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload && payload !== '[DONE]') yield payload;
      }
    }
    const tail = buffer.trim();
    if (tail.startsWith('data:')) {
      const payload = tail.slice(5).trim();
      if (payload && payload !== '[DONE]') yield payload;
    }
  } finally {
    reader.releaseLock();
  }
}
