import type { Microseconds } from '../../core/types';
import { usFromSeconds, usToSeconds } from '../../core/time';

/**
 * Playback engine.
 *
 * The single rule that matters: the playhead is derived from
 * `AudioContext.currentTime - startedAt + seekOffset`, never from
 * `performance.now()` or `Date.now()`. The audio clock and the wall clock drift
 * apart over a three-minute song, and tap-sync timestamps taken from the wall
 * clock produce a video that is progressively late.
 *
 * iOS requires a user gesture before an AudioContext will start; `resume()` is
 * therefore called from the click handler, and a blocked start is reported as
 * AUDIOCONTEXT_BLOCKED rather than silently doing nothing.
 */

export type PlaybackState = 'idle' | 'playing' | 'paused' | 'blocked';

export interface LoopRegion {
  startUs: Microseconds;
  endUs: Microseconds;
}

export interface PlaybackSnapshot {
  state: PlaybackState;
  positionUs: Microseconds;
  durationUs: Microseconds;
  loop: LoopRegion | null;
  rate: number;
}

export interface PlayerEvents {
  onTick?: (positionUs: Microseconds) => void;
  onStateChange?: (state: PlaybackState) => void;
  onEnded?: () => void;
}

export class PlaybackEngine {
  private context: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private buffer: AudioBuffer | null = null;
  private gain: GainNode | null = null;
  private startedAt = 0;
  private seekOffsetUs: Microseconds = 0;
  private state: PlaybackState = 'idle';
  private rafId: number | null = null;
  private loop: LoopRegion | null = null;
  private rate = 1;
  private volume = 1;

  constructor(private events: PlayerEvents = {}) {}

  get durationUs(): Microseconds {
    return this.buffer ? usFromSeconds(this.buffer.duration) : 0;
  }

  get currentState(): PlaybackState {
    return this.state;
  }

  /** Must be called from a user gesture on iOS/Safari. */
  async ensureContext(): Promise<AudioContext> {
    if (this.context) {
      if (this.context.state === 'suspended') {
        await this.context.resume().catch(() => undefined);
      }
      return this.context;
    }
    const Ctor: typeof AudioContext | undefined =
      (globalThis as { AudioContext?: typeof AudioContext }).AudioContext ??
      (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) throw new Error('Web Audio is unavailable.');
    this.context = new Ctor();
    this.gain = this.context.createGain();
    this.gain.gain.value = this.volume;
    this.gain.connect(this.context.destination);
    return this.context;
  }

  setBuffer(pcmInterleaved: Float32Array, sampleRate: number, channels: number): void {
    this.stopSource();
    const context = this.context ?? new ((globalThis as { AudioContext: typeof AudioContext }).AudioContext)();
    this.context = context;
    if (!this.gain) {
      this.gain = context.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(context.destination);
    }
    const frames = Math.floor(pcmInterleaved.length / Math.max(1, channels));
    const buffer = context.createBuffer(channels, frames, sampleRate);
    for (let c = 0; c < channels; c += 1) {
      const channel = buffer.getChannelData(c);
      for (let i = 0; i < frames; i += 1) channel[i] = pcmInterleaved[i * channels + c] ?? 0;
    }
    this.buffer = buffer;
    this.seekOffsetUs = 0;
    this.setState('paused');
  }

  private setState(state: PlaybackState): void {
    if (this.state === state) return;
    this.state = state;
    this.events.onStateChange?.(state);
  }

  private stopSource(): void {
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop();
      } catch {
        /* already stopped */
      }
      this.source.disconnect();
      this.source = null;
    }
  }

  /** Returns false when the browser refused to start (needs a gesture). */
  async play(fromUs?: Microseconds): Promise<boolean> {
    if (!this.buffer || !this.context || !this.gain) return false;
    try {
      await this.ensureContext();
    } catch {
      this.setState('blocked');
      return false;
    }
    if (this.context.state !== 'running') {
      this.setState('blocked');
      return false;
    }

    this.stopSource();
    const start = fromUs ?? this.seekOffsetUs;
    const clamped = Math.max(0, Math.min(start, this.durationUs));
    this.seekOffsetUs = clamped;

    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.playbackRate.value = this.rate;
    source.connect(this.gain);
    source.onended = () => {
      if (this.source !== source) return;
      this.setState('paused');
      this.events.onEnded?.();
    };
    source.start(0, usToSeconds(clamped));
    this.source = source;
    this.startedAt = this.context.currentTime;
    this.setState('playing');
    this.startTicker();
    return true;
  }

  pause(): void {
    if (this.state !== 'playing') return;
    const position = this.positionUs;
    this.stopSource();
    this.seekOffsetUs = position;
    this.setState('paused');
    this.stopTicker();
  }

  async toggle(): Promise<boolean> {
    if (this.state === 'playing') {
      this.pause();
      return false;
    }
    return this.play();
  }

  seek(positionUs: Microseconds): void {
    const clamped = Math.max(0, Math.min(positionUs, this.durationUs));
    if (this.state === 'playing') {
      void this.play(clamped);
      return;
    }
    this.seekOffsetUs = clamped;
    this.events.onTick?.(clamped);
  }

  nudge(deltaUs: Microseconds): void {
    this.seek(this.positionUs + deltaUs);
  }

  setLoop(region: LoopRegion | null): void {
    this.loop = region;
  }

  getLoop(): LoopRegion | null {
    return this.loop;
  }

  setRate(rate: number): void {
    this.rate = Math.max(0.25, Math.min(2, rate));
    if (this.source) this.source.playbackRate.value = this.rate;
  }

  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.gain) this.gain.gain.value = this.volume;
  }

  /**
   * Position on the audio clock.
   * Note `positionUs` is a getter reading live state, which is exactly what
   * tap-sync needs — it is sampled at the moment of the keypress.
   */
  get positionUs(): Microseconds {
    if (!this.context) return this.seekOffsetUs;
    if (this.state !== 'playing') return this.seekOffsetUs;
    const elapsedUs = usFromSeconds((this.context.currentTime - this.startedAt) * this.rate);
    return Math.max(0, Math.min(this.durationUs, this.seekOffsetUs + elapsedUs));
  }

  private startTicker(): void {
    this.stopTicker();
    const tick = () => {
      const position = this.positionUs;
      this.events.onTick?.(position);
      if (this.loop && position >= this.loop.endUs) {
        void this.play(this.loop.startUs);
        return;
      }
      if (this.state === 'playing') this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopTicker(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  snapshot(): PlaybackSnapshot {
    return {
      state: this.state,
      positionUs: this.positionUs,
      durationUs: this.durationUs,
      loop: this.loop,
      rate: this.rate
    };
  }

  dispose(): void {
    this.stopTicker();
    this.stopSource();
    void this.context?.close().catch(() => undefined);
    this.context = null;
    this.buffer = null;
    this.gain = null;
  }
}
