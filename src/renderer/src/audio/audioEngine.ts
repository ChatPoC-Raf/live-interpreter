// Silnik audio: tor wejsciowy (mikrofon -> gain -> worklet 16k PCM + VU)
// i wyjsciowy (gain -> setSinkId na glosnik PA). Cala kontrola urzadzen
// i poziomow w aplikacji — zero grzebania w ustawieniach Windows.
import { isLikelyHfp } from './hfp';

export interface InputChainInfo {
  label: string;
  sampleRate: number | undefined;
  echoCancellation: boolean | undefined;
  noiseSuppression: boolean | undefined;
  autoGainControl: boolean | undefined;
  likelyHfp: boolean;
}

type PcmListener = (pcm: Int16Array) => void;
type LevelListener = (rmsValue: number) => void;

export class AudioEngine {
  private inputCtx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private inputGainNode: GainNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private outputCtx: AudioContext | null = null;
  private outputGainNode: GainNode | null = null;
  private outputSinkId: string | null = null;

  private pcmListeners = new Set<PcmListener>();
  private inputLevelListeners = new Set<LevelListener>();
  onDeviceLost: ((kind: 'input') => void) | null = null;

  inputInfo: InputChainInfo | null = null;

  async startInput(deviceId: string | null, gain: number): Promise<InputChainInfo> {
    await this.stopInput();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
    const track = this.stream.getAudioTracks()[0];
    if (!track) throw new Error('Brak sciezki audio w strumieniu mikrofonu');
    track.addEventListener('ended', () => this.onDeviceLost?.('input'));

    const settings = track.getSettings();
    this.inputInfo = {
      label: track.label,
      sampleRate: settings.sampleRate,
      echoCancellation: settings.echoCancellation,
      noiseSuppression: settings.noiseSuppression,
      autoGainControl: settings.autoGainControl,
      likelyHfp: isLikelyHfp({ label: track.label, sampleRate: settings.sampleRate }),
    };

    this.inputCtx = new AudioContext();
    await this.inputCtx.audioWorklet.addModule('worklets/capture-processor.js');
    const source = this.inputCtx.createMediaStreamSource(this.stream);
    this.inputGainNode = this.inputCtx.createGain();
    this.inputGainNode.gain.value = gain;
    this.workletNode = new AudioWorkletNode(this.inputCtx, 'capture-processor');
    this.workletNode.port.onmessage = (e: MessageEvent) => {
      const data = e.data as { type: 'pcm'; pcm: ArrayBuffer } | { type: 'rms'; rms: number };
      if (data.type === 'pcm') {
        const pcm = new Int16Array(data.pcm);
        for (const l of this.pcmListeners) l(pcm);
      } else if (data.type === 'rms') {
        for (const l of this.inputLevelListeners) l(data.rms);
      }
    };
    // Worklet musi byc w grafie do destination, zeby byl przetwarzany — mute 0.
    const mute = this.inputCtx.createGain();
    mute.gain.value = 0;
    source.connect(this.inputGainNode).connect(this.workletNode).connect(mute);
    mute.connect(this.inputCtx.destination);
    return this.inputInfo;
  }

  async stopInput(): Promise<void> {
    this.workletNode?.port.close();
    this.workletNode = null;
    this.inputGainNode = null;
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    if (this.inputCtx) {
      await this.inputCtx.close().catch(() => undefined);
      this.inputCtx = null;
    }
    this.inputInfo = null;
  }

  getInputStream(): MediaStream | null {
    return this.stream;
  }

  setInputGain(value: number): void {
    if (this.inputGainNode) this.inputGainNode.gain.value = value;
  }

  onPcm(listener: PcmListener): () => void {
    this.pcmListeners.add(listener);
    return () => this.pcmListeners.delete(listener);
  }

  onInputLevel(listener: LevelListener): () => void {
    this.inputLevelListeners.add(listener);
    return () => this.inputLevelListeners.delete(listener);
  }

  async startOutput(deviceId: string | null, gain: number): Promise<void> {
    await this.stopOutput();
    // 24 kHz — natywna czestotliwosc PCM z TTS (pcm_24000), system przeprobkuje.
    this.outputCtx = new AudioContext({ sampleRate: 24000 });
    this.outputGainNode = this.outputCtx.createGain();
    this.outputGainNode.gain.value = gain;
    this.outputGainNode.connect(this.outputCtx.destination);
    if (deviceId && 'setSinkId' in this.outputCtx) {
      await (
        this.outputCtx as AudioContext & { setSinkId(id: string): Promise<void> }
      ).setSinkId(deviceId);
      this.outputSinkId = deviceId;
    }
  }

  async stopOutput(): Promise<void> {
    this.outputGainNode = null;
    this.outputSinkId = null;
    if (this.outputCtx) {
      await this.outputCtx.close().catch(() => undefined);
      this.outputCtx = null;
    }
  }

  setOutputGain(value: number): void {
    if (this.outputGainNode) this.outputGainNode.gain.value = value;
  }

  getOutputContext(): AudioContext | null {
    return this.outputCtx;
  }

  /** Id glosnika, na ktory wpieto wyjscie (null = domyslne wyjscie systemowe). */
  getOutputSinkId(): string | null {
    return this.outputSinkId;
  }

  getOutputGainNode(): GainNode | null {
    return this.outputGainNode;
  }

  /** Ton testowy do soundchecku PA (sinus). Zwraca po zakonczeniu. */
  async playTestTone(freq = 440, ms = 800): Promise<void> {
    if (!this.outputCtx || !this.outputGainNode) throw new Error('Wyjscie audio nie uruchomione');
    // Kontekst utworzony bez gestu uzytkownika bywa zawieszony — wtedy oscylator
    // gra "w prozni" i nic nie slychac. Klik w "Ton testowy" to gest, wiec resume
    // tutaj zawsze ma prawo przejsc.
    if (this.outputCtx.state === 'suspended') await this.outputCtx.resume();
    if (this.outputCtx.state !== 'running') {
      throw new Error('Wyjscie audio zawieszone — wybierz glosnik ponownie w panelu Audio');
    }
    const osc = this.outputCtx.createOscillator();
    osc.frequency.value = freq;
    const env = this.outputCtx.createGain();
    env.gain.value = 0.3;
    osc.connect(env).connect(this.outputGainNode);
    osc.start();
    await new Promise((r) => setTimeout(r, ms));
    osc.stop();
    osc.disconnect();
    env.disconnect();
  }

  async dispose(): Promise<void> {
    await this.stopInput();
    await this.stopOutput();
  }
}
