import type { Project, SceneVisual, EnergyMarker } from '../types';
import type { SpectrumEnvelope } from '../audio/spectrum';

export const treatments = {
  sanctuary: { name: 'Sanctuary', colors: ['#101221', '#643949', '#efae78'], accent: '#ffe2ab' },
  afterglow: { name: 'Afterglow', colors: ['#0b1027', '#422276', '#337697'], accent: '#9cf5ff' },
  editorial: { name: 'Editorial', colors: ['#191a1c', '#353a40', '#535a5f'], accent: '#ffdf99' }
};
export type Treatment = keyof typeof treatments;
export interface Shot { id: string; text: string; reason: string; visual: SceneVisual }

/** Sample each cue's envelope on its own media clock. Bounded even for overlapping/very long cues. */
function strength(env: SpectrumEnvelope | null, start: number, end: number): number | null {
  if (!env || !env.frameCount || env.frameUs <= 0) return null;
  const stride = env.bands.length / env.frameCount;
  if (!Number.isInteger(stride) || stride < 1) return null;
  let sum = 0, count = 0;
  for (let i = 0; i < 24; i++) {
    const f = Math.floor((start + (end - start) * (i + 0.5) / 24) / env.frameUs);
    if (f < 0 || f >= env.frameCount) continue;
    for (let b = 0; b < stride; b++) { sum += env.bands[f * stride + b]!; count++; }
  }
  return count ? sum / (count * 255) : null;
}

export function planShots(project: Project, env: SpectrumEnvelope | null, family: Treatment, still: boolean): Shot[] {
  const palette = treatments[family];
  const sections = new Map(project.sections.map(s => [s.id, s]));
  const energies = project.lyrics.lines.map(l => strength(env, l.start, l.end));
  const sorted = energies.filter((e): e is number => e !== null).sort((a,b) => a-b);
  const upper = sorted[Math.floor(sorted.length * 0.65)] ?? 1;
  const low = sorted[0] ?? 0;
  return project.lyrics.lines.map((line, index) => {
    const energy = energies[index];
    const section = sections.get(line.sectionId ?? '');
    const marker = project.audio?.energyMap?.reduce<EnergyMarker | null>((prev, m) => m.start <= (line.start + line.end) / 2 && (!prev || m.start > prev.start) ? m : prev, null);
    const lift = marker ? marker.level === 'lift' : (energy != null && energy > low + 0.04 && energy >= upper) || ['CHORUS','HOOK','REFRAIN'].includes(section?.kind ?? '');
    const quiet = marker ? marker.level === 'quiet' : energy != null && energy < 0.025;
    const moving = !still && !quiet;
    const world = family === 'afterglow' ? 'horizon' : family === 'sanctuary' ? 'mesh' : 'gradient';
    return { id: line.id, text: line.text,
      reason: [section?.label || `Scene ${index + 1}`, energy == null ? 'no audio analysis' : `${Math.round(energy * 100)}% spectral energy`, marker ? `accepted ${marker.level}` : lift ? 'emphasis' : 'hold'].join(' · '),
      visual: { accent: palette.accent, enter: moving ? (lift ? 'rise' : 'fade') : 'none', exit: moving ? 'fade' : 'none',
        transition: moving ? (lift && family !== 'editorial' ? 'wipe' : 'fade') : 'none',
        background: { kind: world, colors: [...palette.colors], scrim: lift ? 0.32 : 0.46, motion: moving ? (lift ? 0.7 : 0.24) : 0 } }
    };
  });
}

/** Keep semantic fields, authored images, narration, word IDs and timing. */
export function applyShots(project: Project, shots: Shot[]): Project {
  const byId = new Map(shots.map(shot => [shot.id, shot.visual]));
  return { ...project, lyrics: { ...project.lyrics, lines: project.lyrics.lines.map(line => {
    const patch = byId.get(line.id);
    if (!patch) return line;
    const hasArt = (line.scene?.background?.kind ?? project.design.background.kind) === 'image';
    const scene = { ...line.scene, ...patch };
    if (hasArt) scene.background = line.scene?.background;
    return { ...line, scene };
  }) } };
}
