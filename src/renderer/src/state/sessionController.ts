// SessionController — interpretuje efekty maszyny stanow i spina:
// AudioEngine + VadGate + providery + pipeline segmentu + artefakty (IPC)
// + okno mowcy. Jedyne zrodlo prawdy o sesji dla UI (useSyncExternalStore).
import type { SettingsDto } from '../../../shared/ipc';
import { AudioEngine } from '../audio/audioEngine';
import { VadGate } from '../audio/vadGate';
import { BargeInDetector } from '../audio/vadLogic';
import { PipelineError, toPipelineError } from '../core/errors';
import { addFlag, newSegment, type SegmentView } from '../core/segment';
import {
  INITIAL_STATE,
  reduce,
  type Effect,
  type MachineEvent,
  type MachineState,
} from '../core/sessionMachine';
import { LatencyMeter } from '../orchestrator/latency';
import { PlaybackQueue } from '../orchestrator/playbackQueue';
import { runSegment, translateAndSpeak } from '../orchestrator/segmentPipeline';
import { pcm16ToWavBlob, VOICE_IMPROVE, VoiceImprover } from '../orchestrator/voiceImprover';
import { createProviders, type ProviderBundle } from '../providers/factory';
import { LanguageHysteresis } from '../providers/langHysteresis';
import { backoffDelay } from '../providers/retry';
import type { SttSession } from '../providers/types';
import { alertMessage, type AlertItem, type SessionSnapshot } from './sessionTypes';

const TURN_HARD_LIMIT_MS = 180_000;
const BARGE_IN_SUSTAIN_MS = 300;
const RETRY_BASE_DELAY_MS = 800;

export class SessionController {
  readonly engine = new AudioEngine();
  private machine: MachineState = INITIAL_STATE;
  private listeners = new Set<() => void>();
  private snapshotCache: SessionSnapshot | null = null;

  private settings: SettingsDto | null = null;
  private voiceId: string | null = null;
  private profileName: string | null = null;
  private improver = new VoiceImprover();
  private providers: ProviderBundle | null = null;
  private vad: VadGate | null = null;
  private stt: SttSession | null = null;
  private playback: PlaybackQueue | null = null;
  private abortCtrl: AbortController | null = null;

  private segments: SegmentView[] = [];
  private alerts: AlertItem[] = [];
  private alertSeq = 0;
  private inputLevel = 0;
  private latencyTotals: number[] = [];
  private lastLatencyMs: number | null = null;
  private sessionActive = false;
  private busyStarting = false;

  private hysteresis = new LanguageHysteresis();
  private bargeIn = new BargeInDetector(0.07, BARGE_IN_SUSTAIN_MS);
  private meter = new LatencyMeter();
  private committedText: string | null = null;
  private committedLang: string | null = null;
  private lastTtsPcm: Int16Array | null = null;
  private turnLimitTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribers: (() => void)[] = [];

  constructor() {
    this.engine.onDeviceLost = () => this.dispatch({ type: 'DEVICE_LOST' });
  }

  // ---------- snapshot dla React ----------
  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getSnapshot = (): SessionSnapshot => {
    if (!this.snapshotCache) {
      this.snapshotCache = {
        machine: this.machine,
        segments: [...this.segments].reverse().slice(0, 50),
        alerts: [...this.alerts].reverse().slice(0, 30),
        inputLevel: this.inputLevel,
        inputInfo: this.engine.inputInfo,
        lastLatencyMs: this.lastLatencyMs,
        latencyTotals: this.latencyTotals,
        sessionActive: this.sessionActive,
        busyStarting: this.busyStarting,
      };
    }
    return this.snapshotCache;
  };

  private emit(): void {
    this.snapshotCache = null;
    for (const l of this.listeners) l();
  }

  /** Poziom VU bez pelnego re-renderu feedu — osobny kanal. */
  private emitLevel(rmsValue: number): void {
    this.inputLevel = rmsValue;
    this.snapshotCache = null;
    for (const l of this.listeners) l();
  }

  // ---------- maszyna + efekty ----------
  dispatch(event: MachineEvent): void {
    const { state, effects } = reduce(this.machine, event);
    const changed = state !== this.machine;
    this.machine = state;
    for (const ef of effects) this.runEffect(ef, event);
    if (changed || effects.length > 0) this.emit();
  }

  private runEffect(ef: Effect, cause: MachineEvent): void {
    switch (ef.type) {
      case 'OPEN_MIC':
        this.bargeIn.reset();
        this.vad?.listen();
        break;
      case 'GATE_MIC':
        this.vad?.gate();
        this.bargeIn.reset();
        break;
      case 'START_TRANSLATION':
        void this.startPipeline();
        break;
      case 'RETRY_SEGMENT':
        void this.retryPipeline();
        break;
      case 'FORCE_COMMIT':
        this.vad?.gate();
        this.dispatch({ type: 'COMMIT' });
        break;
      case 'ABORT_SEGMENT':
        this.abortInFlight(ef.reason);
        break;
      case 'PLAY_LAST_AGAIN':
        this.replayLast();
        break;
      case 'SIGNAL_SPEAKER':
        void window.live.setSpeakerStatus({ mode: ef.mode });
        break;
      case 'ALERT':
        this.pushAlert(ef.level, ef.code);
        break;
      case 'LOG':
        this.logEvent(ef.event, cause);
        break;
    }
  }

  private pushAlert(level: AlertItem['level'], code: string): void {
    this.alerts.push({ id: ++this.alertSeq, level, code, message: alertMessage(code), at: Date.now() });
    void window.live.artifactsAppendEvent({ kind: 'alert', level, code });
  }

  private logEvent(event: string, cause: MachineEvent): void {
    const seg = this.machine.ctx.inFlight ?? this.machine.ctx.segmentCounter;
    const row: Record<string, unknown> = { kind: event, segmentNo: seg, phase: this.machine.phase };
    if (cause.type === 'ERROR') {
      row['errorCode'] = cause.code;
      row['errorMessage'] = cause.message;
    }
    void window.live.artifactsAppendEvent(row);
    this.handleEventSideEffects(event);
  }

  private handleEventSideEffects(event: string): void {
    switch (event) {
      case 'speech_start': {
        this.segments.push(newSegment(this.machine.ctx.segmentCounter, Date.now()));
        this.improver.beginTake();
        this.startTurnLimitTimer();
        break;
      }
      case 'speech_misfire': {
        this.clearTurnLimitTimer();
        this.improver.discardTake();
        const seg = this.currentSegment();
        if (seg) {
          seg.status = 'done';
          seg.flags = addFlag(seg.flags, 'FILTERED');
        }
        break;
      }
      case 'commit': {
        this.clearTurnLimitTimer();
        this.improver.commitTake();
        this.meter = new LatencyMeter();
        this.meter.mark('pauseDetected', performance.now());
        const seg = this.currentSegment();
        if (seg) seg.status = 'committing';
        break;
      }
      case 'segment_done': {
        const seg = this.currentSegment();
        if (seg) {
          seg.status = 'done';
          seg.latencyMs = this.lastLatencyMs;
        }
        if (this.improver.shouldUpload(performance.now())) void this.improveVoice();
        break;
      }
      case 'segment_skipped': {
        const seg = this.currentSegment();
        if (seg) {
          seg.status = 'done';
          seg.flags = addFlag(seg.flags, seg.status === 'done' && seg.translatedText ? 'SKIPPED_PARTIAL' : 'SKIPPED');
        }
        break;
      }
      case 'barge_in': {
        const seg = this.currentSegment();
        if (seg) seg.flags = addFlag(seg.flags, 'BARGE_IN');
        break;
      }
      case 'session_end':
        void this.teardownSession();
        break;
    }
  }

  private currentSegment(): SegmentView | undefined {
    const no = this.machine.ctx.inFlight ?? this.machine.ctx.segmentCounter;
    return this.segments.find((s) => s.no === no);
  }

  // ---------- pipeline ----------
  private async startPipeline(): Promise<void> {
    if (!this.providers || !this.stt || !this.settings || !this.voiceId) return;
    const seg = this.currentSegment();
    if (seg) seg.status = 'translating';
    this.committedText = null;
    this.committedLang = null;
    this.abortCtrl = new AbortController();
    const playback = this.createPlayback();
    if (!playback) {
      this.dispatch({ type: 'ERROR', kind: 'terminal', code: 'no_output', message: 'Brak wyjscia audio' });
      return;
    }
    try {
      const outcome = await runSegment(
        {
          stt: this.stt,
          translation: this.providers.translation,
          tts: this.providers.tts,
          playback,
          voiceId: this.voiceId,
          targetLang: this.settings.targetLang,
          sourceLang: this.hysteresis.sourceLang,
          context: this.recentContext(),
          meter: this.meter,
          now: () => performance.now(),
          onTranslationDelta: (full) => {
            const s = this.currentSegment();
            if (s) {
              s.translatedText = full;
              this.emit();
            }
          },
          onCommitted: (text, lang) => {
            this.committedText = text;
            this.committedLang = lang;
            const s = this.currentSegment();
            if (s) {
              s.originalText = text;
              s.sourceLang = lang;
              this.emit();
            }
          },
        },
        this.abortCtrl.signal,
      );
      this.finishPipeline(outcome.kind === 'done' ? outcome : null, outcome.kind === 'filtered' ? outcome.reason : null);
    } catch (err) {
      this.handlePipelineError(err);
    }
  }

  private async retryPipeline(): Promise<void> {
    if (!this.providers || !this.settings || !this.voiceId) return;
    if (!this.committedText) {
      // Awaria przed commit — audio przepadlo z STT, tresc jest tylko w original.wav.
      const seg = this.currentSegment();
      if (seg) seg.flags = addFlag(seg.flags, 'GAP');
      this.pushAlert('warn', 'segment_gap');
      this.dispatch({ type: 'SKIP' });
      return;
    }
    const seg = this.currentSegment();
    if (seg) seg.status = 'translating';
    this.abortCtrl = new AbortController();
    const playback = this.createPlayback();
    if (!playback) return;
    try {
      const result = await translateAndSpeak(
        {
          translation: this.providers.translation,
          tts: this.providers.tts,
          playback,
          voiceId: this.voiceId,
          targetLang: this.settings.targetLang,
          sourceLang: this.committedLang ?? this.hysteresis.sourceLang,
          context: this.recentContext(),
          meter: this.meter,
          now: () => performance.now(),
          onTranslationDelta: (full) => {
            const s = this.currentSegment();
            if (s) {
              s.translatedText = full;
              this.emit();
            }
          },
        },
        this.committedText,
        this.committedLang ?? this.hysteresis.sourceLang,
        this.abortCtrl.signal,
      );
      this.finishPipeline(result, null);
    } catch (err) {
      this.handlePipelineError(err);
    }
  }

  private finishPipeline(
    done: { originalText: string; translatedText: string; sourceLang: string | null; ttsPcm: Int16Array } | null,
    filteredReason: 'empty' | 'target_lang' | null,
  ): void {
    const seg = this.currentSegment();
    if (filteredReason) {
      if (seg) {
        seg.status = 'done';
        seg.flags = addFlag(seg.flags, filteredReason === 'empty' ? 'EMPTY' : 'FILTERED');
      }
      void window.live.artifactsAppendEvent({
        kind: 'segment_filtered',
        segmentNo: seg?.no,
        reason: filteredReason,
        originalText: seg?.originalText ?? '',
      });
      this.dispatch({ type: 'SEGMENT_FILTERED' });
      return;
    }
    if (!done) return;
    this.hysteresis.confirmSegment(done.sourceLang);
    this.lastTtsPcm = done.ttsPcm;
    if (seg) {
      seg.originalText = done.originalText;
      seg.translatedText = done.translatedText;
      seg.sourceLang = done.sourceLang;
      seg.status = 'playing';
    }
    const segNo = seg?.no ?? this.machine.ctx.inFlight ?? 0;
    void window.live.artifactsSaveTts(segNo, toArrayBuffer(done.ttsPcm));
    void window.live.artifactsAppendEvent({
      kind: 'segment_done',
      segmentNo: segNo,
      sourceLang: done.sourceLang,
      originalText: done.originalText,
      translatedText: done.translatedText,
      latencyMs: this.meter.totalMs(),
      breakdown: this.meter.breakdown(),
    });
    this.emit();
  }

  private handlePipelineError(err: unknown): void {
    const pe = err instanceof PipelineError ? err : toPipelineError('other', err);
    if (pe.code === 'aborted') return; // celowe przerwanie — maszyna juz przeszla
    const seg = this.currentSegment();
    if (seg) seg.status = 'failed';
    this.dispatch({ type: 'ERROR', kind: pe.kind, code: pe.code, message: pe.message });
    // Auto-retry po backoffie, jesli maszyna czeka w AWARIA_RETRY.
    if (this.machine.phase === 'AWARIA_RETRY') {
      const attempt = this.machine.ctx.retryCount;
      setTimeout(() => {
        if (this.machine.phase === 'AWARIA_RETRY') this.dispatch({ type: 'RETRY' });
      }, backoffDelay(RETRY_BASE_DELAY_MS, attempt - 1));
    }
  }

  private createPlayback(): PlaybackQueue | null {
    const ctx = this.engine.getOutputContext();
    const gain = this.engine.getOutputGainNode();
    if (!ctx || !gain) return null;
    this.playback?.stop();
    const queue = new PlaybackQueue(ctx, gain);
    queue.onFirstAudio = () => {
      this.meter.mark('playbackStart', performance.now());
      this.lastLatencyMs = this.meter.totalMs();
      if (this.lastLatencyMs !== null) this.latencyTotals.push(this.lastLatencyMs);
      this.dispatch({ type: 'FIRST_AUDIO' });
    };
    queue.onDrained = () => {
      const tail = this.settings?.playbackTailMs ?? 400;
      setTimeout(() => this.dispatch({ type: 'PLAYBACK_DONE' }), tail);
    };
    this.playback = queue;
    return queue;
  }

  private replayLast(): void {
    if (!this.lastTtsPcm) return;
    const playback = this.createPlayback();
    if (!playback) return;
    playback.enqueue(this.lastTtsPcm);
    playback.end();
  }

  private abortInFlight(reason: 'skip' | 'pause' | 'end' | 'error' | 'device'): void {
    this.abortCtrl?.abort();
    this.abortCtrl = null;
    this.playback?.stop();
    const seg = this.currentSegment();
    if (seg && reason !== 'error') {
      seg.status = 'done';
      seg.flags = addFlag(seg.flags, seg.translatedText ? 'SKIPPED_PARTIAL' : 'SKIPPED');
    }
    if (reason === 'error' && seg) {
      seg.flags = addFlag(seg.flags, 'GAP');
    }
  }

  private recentContext(): { original: string; translated: string }[] {
    return this.segments
      .filter((s) => s.status === 'done' && s.translatedText && !s.flags.includes('SKIPPED'))
      .slice(-3)
      .map((s) => ({ original: s.originalText, translated: s.translatedText }));
  }

  private startTurnLimitTimer(): void {
    this.clearTurnLimitTimer();
    this.turnLimitTimer = setTimeout(() => {
      this.pushAlert('warn', 'force_limit');
      this.dispatch({ type: 'FORCE_END_TURN' });
    }, TURN_HARD_LIMIT_MS);
  }

  private clearTurnLimitTimer(): void {
    if (this.turnLimitTimer) clearTimeout(this.turnLimitTimer);
    this.turnLimitTimer = null;
  }

  // ---------- cykl zycia sesji ----------
  async startSession(opts: { voiceId: string; profileName: string }): Promise<void> {
    if (this.busyStarting || this.sessionActive) return;
    this.busyStarting = true;
    this.emit();
    try {
      const settings = await window.live.getSettings();
      const secrets = await window.live.getSecrets();
      if (!secrets.elevenKey || !secrets.llmKey) {
        throw new Error('Brak kluczy API — uzupelnij w Ustawieniach');
      }
      this.settings = settings;
      this.voiceId = opts.voiceId;
      this.profileName = opts.profileName;
      this.improver.reset(settings.voiceImproveEnabled);
      this.providers = createProviders({
        elevenKey: secrets.elevenKey,
        llmKey: secrets.llmKey,
        llmProvider: settings.llmProvider,
      });
      this.bargeIn = new BargeInDetector(settings.bargeInThreshold, BARGE_IN_SUSTAIN_MS);

      if (!this.engine.getInputStream()) {
        await this.engine.startInput(settings.inputDeviceId, settings.inputGain);
      }
      if (!this.engine.getOutputContext()) {
        await this.engine.startOutput(settings.outputDeviceId, settings.outputGain);
      }
      const stream = this.engine.getInputStream();
      if (!stream) throw new Error('Mikrofon nie wystartowal');
      if (this.engine.inputInfo?.likelyHfp) this.pushAlert('warn', 'hfp_detected');

      this.vad = await VadGate.create({
        stream,
        redemptionMs: settings.vadRedemptionMs,
        minSpeechMs: settings.vadMinSpeechMs,
        callbacks: {
          onSpeechStart: () => this.dispatch({ type: 'SPEECH_START' }),
          onProvisionalPause: () => this.dispatch({ type: 'SPEECH_END' }),
          onSpeechResumed: () => this.dispatch({ type: 'SPEECH_RESUMED' }),
          onTurnEnd: () => this.dispatch({ type: 'COMMIT' }),
          onMisfire: () => this.dispatch({ type: 'SPEECH_MISFIRE' }),
        },
      });

      this.unsubscribers.push(
        this.engine.onPcm((pcm) => this.routePcm(pcm)),
        this.engine.onInputLevel((rmsValue) => this.routeLevel(rmsValue)),
      );

      const sessionId = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      await window.live.artifactsStart({
        sessionId,
        startedAt: new Date().toISOString(),
        targetLang: settings.targetLang,
        profileName: opts.profileName,
        voiceId: opts.voiceId,
      });

      this.stt = await this.openStt();
      this.segments = [];
      this.latencyTotals = [];
      this.lastLatencyMs = null;
      this.sessionActive = true;
      this.dispatch({ type: 'SESSION_START' });
    } finally {
      this.busyStarting = false;
      this.emit();
    }
  }

  private async openStt(): Promise<SttSession> {
    if (!this.providers) throw new Error('Brak providerow');
    return this.providers.stt.startSession({
      signal: new AbortController().signal,
      onPartial: (p) => {
        const seg = this.currentSegment();
        if (seg && seg.status === 'recording') {
          seg.partialText = p.text;
          if (p.language) seg.sourceLang = p.language;
          this.emit();
        }
      },
    });
  }

  private routePcm(pcm: Int16Array): void {
    // Artefakty: original.wav od t0 — TAKZE przy zamknietej bramie (barge-in!).
    if (this.sessionActive) {
      void window.live.artifactsAppendPcm(toArrayBuffer(pcm));
    }
    // STT dostaje audio tylko przy otwartej bramie (SLUCHAM/DOMYKANIE).
    if (
      this.stt &&
      (this.machine.phase === 'SLUCHAM' || this.machine.phase === 'DOMYKANIE')
    ) {
      this.stt.sendAudio(pcm);
      // Ta sama czysta mowa (bez przebic z PA) doszkala klon glosu.
      this.improver.feed(pcm);
    }
  }

  /** Doszkolenie klonu IVC partia swiezej mowy — w tle, nigdy nie blokuje pipeline'u. */
  private async improveVoice(): Promise<void> {
    if (!this.providers || !this.voiceId) return;
    const pcm = this.improver.beginUpload();
    if (!pcm) return;
    try {
      await this.providers.voices.addSamples({
        voiceId: this.voiceId,
        name: this.profileName ?? 'Live Interpreter',
        sample: pcm16ToWavBlob(pcm, VOICE_IMPROVE.sampleRate),
      });
      this.improver.finishUpload(true, performance.now());
      this.pushAlert('info', 'voice_improved');
    } catch {
      // Blad doszkolenia NIGDY nie psuje sesji — tylko backoff i notka w alertach.
      this.improver.finishUpload(false, performance.now());
      this.pushAlert('warn', 'voice_improve_failed');
    }
    this.emit();
  }

  private routeLevel(rmsValue: number): void {
    const gated = this.machine.phase === 'TLUMACZE' || this.machine.phase === 'ODTWARZAM';
    if (gated && this.bargeIn.feed(rmsValue, performance.now())) {
      this.dispatch({ type: 'BARGE_IN' });
    }
    this.emitLevel(rmsValue);
  }

  async endSession(): Promise<void> {
    this.dispatch({ type: 'END_SESSION' });
  }

  private async teardownSession(): Promise<void> {
    this.clearTurnLimitTimer();
    // Resztka zebranej mowy doszkala klon na ZAPAS (kolejne sesje) — best-effort.
    if (this.improver.hasFinalBatch()) void this.improveVoice();
    for (const u of this.unsubscribers) u();
    this.unsubscribers = [];
    this.stt?.close();
    this.stt = null;
    this.vad?.destroy();
    this.vad = null;
    this.playback?.stop();
    this.playback = null;
    if (this.sessionActive) {
      await window.live.artifactsFinalize({
        closedAt: new Date().toISOString(),
        segmentsTotal: this.machine.ctx.segmentCounter,
      });
    }
    this.sessionActive = false;
    this.emit();
  }

  /** Podmiana klucza w AWARIA_TERMINALNA — odswieza providery bez restartu sesji. */
  async reloadProvidersAfterKeySwap(): Promise<void> {
    const settings = await window.live.getSettings();
    const secrets = await window.live.getSecrets();
    if (!secrets.elevenKey || !secrets.llmKey) return;
    this.providers = createProviders({
      elevenKey: secrets.elevenKey,
      llmKey: secrets.llmKey,
      llmProvider: settings.llmProvider,
    });
    this.stt?.close();
    this.stt = await this.openStt();
    this.dispatch({ type: 'KEY_REPLACED' });
  }
}

function toArrayBuffer(pcm: Int16Array): ArrayBuffer {
  if (pcm.byteOffset === 0 && pcm.buffer.byteLength === pcm.byteLength && pcm.buffer instanceof ArrayBuffer) {
    return pcm.buffer;
  }
  return pcm.slice().buffer as ArrayBuffer;
}

export const sessionController = new SessionController();
