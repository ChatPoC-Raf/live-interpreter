// Brama VAD — wrapper na @ricky0123/vad-web (Silero v5 w AudioWorklet).
// Twardy half-duplex: gate() wycisza WSZYSTKIE zdarzenia VAD (mikrofon dalej
// nagrywa do artefaktow, barge-in mierzy SessionController z poziomu RMS).
// Wersja vad-web PRZYPIETA w package.json (0.0.30) — API 0.0.x bywa niestabilne.
import { MicVAD } from '@ricky0123/vad-web';
import { vadAssetBase } from './vadAssets';
import { PauseTracker } from './vadLogic';

export interface VadGateCallbacks {
  /** Mowca zaczal mowic (próg przekroczony). */
  onSpeechStart: () => void;
  /** Pierwsza cicha ramka po mowie — start okna DOMYKANIE. */
  onProvisionalPause: () => void;
  /** Mowa wrocila w oknie redemption — falszywa pauza. */
  onSpeechResumed: () => void;
  /** Definitywny koniec tury (redemption uplynal) — czas na COMMIT. */
  onTurnEnd: () => void;
  /** Mowa krotsza niz minSpeechMs — stuknięcie/kaszlniecie, nie tura. */
  onMisfire: () => void;
}

export interface VadGateOptions {
  stream: MediaStream;
  redemptionMs: number;
  minSpeechMs: number;
  callbacks: VadGateCallbacks;
}

const POSITIVE_THRESHOLD = 0.5;
const NEGATIVE_THRESHOLD = 0.35;

export class VadGate {
  private mode: 'gated' | 'listening' = 'gated';

  private constructor(
    private readonly vad: MicVAD,
    private readonly tracker: PauseTracker,
  ) {}

  static async create(opts: VadGateOptions): Promise<VadGate> {
    const tracker = new PauseTracker(POSITIVE_THRESHOLD, NEGATIVE_THRESHOLD);
    let gateRef: VadGate | null = null;
    const guard = (fn: () => void) => (): void => {
      if (gateRef && gateRef.mode === 'listening') fn();
    };

    // Absolutny URL wymagany — wzgledny prefix lamie dynamiczny import()
    // modulu ORT ("no available backend found"); szczegoly w vadAssets.ts.
    const assetBase = vadAssetBase(document.baseURI);

    const vad = await MicVAD.new({
      // Strumien nalezy do AudioEngine — pause/resume bramy NIE rusza tracku.
      getStream: async () => opts.stream,
      pauseStream: async () => undefined,
      resumeStream: async () => opts.stream,
      startOnLoad: false,
      processorType: 'AudioWorklet',
      model: 'v5',
      baseAssetPath: assetBase,
      onnxWASMBasePath: assetBase,
      positiveSpeechThreshold: POSITIVE_THRESHOLD,
      negativeSpeechThreshold: NEGATIVE_THRESHOLD,
      redemptionMs: opts.redemptionMs,
      minSpeechMs: opts.minSpeechMs,
      preSpeechPadMs: 128,
      submitUserSpeechOnPause: false,
      onSpeechStart: guard(() => opts.callbacks.onSpeechStart()),
      onSpeechEnd: () => {
        // Audio z VAD ignorujemy — STT dostaje PCM wprost z AudioEngine.
        if (gateRef && gateRef.mode === 'listening') {
          tracker.reset();
          opts.callbacks.onTurnEnd();
        }
      },
      onVADMisfire: () => {
        if (gateRef && gateRef.mode === 'listening') {
          tracker.reset();
          opts.callbacks.onMisfire();
        }
      },
      onFrameProcessed: (probabilities: { isSpeech: number }) => {
        if (!gateRef || gateRef.mode !== 'listening') return;
        const ev = tracker.feed(probabilities.isSpeech);
        if (ev === 'provisional_pause') opts.callbacks.onProvisionalPause();
        else if (ev === 'resumed') opts.callbacks.onSpeechResumed();
      },
    });

    const gate = new VadGate(vad, tracker);
    gateRef = gate;
    return gate;
  }

  /** Otwiera brame — VAD nasluchuje, zdarzenia plyna do maszyny stanow. */
  listen(): void {
    if (this.mode === 'listening') return;
    this.tracker.reset();
    this.mode = 'listening';
    void this.vad.start();
  }

  /** Zamyka brame (half-duplex) — zero zdarzen VAD, mikrofon dalej nagrywa. */
  gate(): void {
    if (this.mode === 'gated') return;
    this.mode = 'gated';
    void this.vad.pause();
    this.tracker.reset();
  }

  isListening(): boolean {
    return this.mode === 'listening';
  }

  destroy(): void {
    this.mode = 'gated';
    void this.vad.destroy();
  }
}
