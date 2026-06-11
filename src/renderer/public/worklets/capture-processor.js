// AudioWorkletProcessor toru wejsciowego:
// 1) downsampling (interpolacja liniowa) z sampleRate kontekstu do 16 kHz Int16 PCM
// 2) agregowany RMS do VU (post co ~50 ms)
// Czysty JS (worklet nie przechodzi przez bundler) — serwowany z public/.

const TARGET_RATE = 16000;
const OUT_CHUNK = 1024; // 64 ms @ 16 kHz
const RMS_POST_EVERY_BLOCKS = 16; // ~46 ms przy blokach 128 @ 44.1/48 kHz

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_RATE;
    this.readPos = 0; // pozycja ulamkowa w strumieniu wejsciowym
    this.prevSample = 0; // ostatnia probka poprzedniego bloku (do interpolacji)
    this.out = new Int16Array(OUT_CHUNK);
    this.outLen = 0;
    this.rmsAcc = 0;
    this.rmsCount = 0;
    this.blockCounter = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch || ch.length === 0) return true;

    let sum = 0;
    for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
    this.rmsAcc += sum;
    this.rmsCount += ch.length;
    this.blockCounter += 1;
    if (this.blockCounter >= RMS_POST_EVERY_BLOCKS) {
      const rms = Math.sqrt(this.rmsAcc / this.rmsCount);
      this.port.postMessage({ type: 'rms', rms });
      this.rmsAcc = 0;
      this.rmsCount = 0;
      this.blockCounter = 0;
    }

    // Downsampling: probkujemy wirtualny strumien [prevSample, ...ch] co `ratio`.
    let pos = this.readPos;
    while (pos < ch.length) {
      const i = Math.floor(pos);
      const frac = pos - i;
      const s0 = i === 0 ? this.prevSample : ch[i - 1];
      const s1 = ch[i];
      const sample = s0 + (s1 - s0) * frac;
      const clamped = Math.max(-1, Math.min(1, sample));
      this.out[this.outLen++] = (clamped * 0x7fff) | 0;
      if (this.outLen === OUT_CHUNK) {
        const copy = this.out.slice();
        this.port.postMessage({ type: 'pcm', pcm: copy.buffer }, [copy.buffer]);
        this.outLen = 0;
      }
      pos += this.ratio;
    }
    this.readPos = pos - ch.length;
    this.prevSample = ch[ch.length - 1];
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
