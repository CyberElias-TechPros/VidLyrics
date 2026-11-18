import type { AspectId, Line, Project, SceneVisual, Section, SectionKind } from '../types';
import {
  ASPECTS,
  EXPORT_PRESETS,
  THEMES,
  designFromTheme,
  exportSettingsFromPreset,
  getTheme
} from '../design/tokens';
import { createLine, createProject, newId, PROJECT_FORMAT_VERSION } from '../project/factory';
import { usFromMs, usFromSeconds, usToSeconds } from '../time';
import { buildTimedWords, estimateSceneDurationUs } from '../lyrics/script';
import { VIDEO_SPEC_VERSION, type SpecScene, type VideoSpec } from './schema';

/**
 * Bidirectional compiler between the declarative `VideoSpec` DSL and the
 * internal `Project` representation.
 *
 *   compileVideoSpec(spec, base?) -> Project
 *   projectToVideoSpec(project)   -> VideoSpec
 *   serialiseVideoSpec(project)   -> formatted JSON string
 *
 * Every visual editor mutation (timeline drag, theme change, TTS sync) updates
 * the Project, which re-emits clean spec JSON; every code edit compiles back
 * into a Project through the undoable command history.
 */

export interface CompileSpecOptions {
  /** Existing project to preserve identity, linked audio and matching line IDs from. */
  baseProject?: Project;
}

function evenPx(value: number): number {
  const rounded = Math.max(128, Math.min(7680, Math.round(value)));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

function presetForAspect(aspectId: AspectId): string {
  switch (aspectId) {
    case '9:16':
      return 'youtube-shorts';
    case '1:1':
      return 'instagram-square';
    case '4:5':
      return 'instagram-post';
    case 'custom':
      return 'custom';
    case '4:3':
    case '16:9':
    default:
      return 'youtube';
  }
}

function sectionKindFromLabel(label: string): SectionKind {
  const upper = label.trim().toUpperCase().replace(/[\s-]+/g, '_');
  const known: SectionKind[] = [
    'INTRO', 'VERSE', 'PRE_CHORUS', 'CHORUS', 'HOOK', 'REFRAIN',
    'BRIDGE', 'BREAKDOWN', 'INSTRUMENTAL', 'OUTRO'
  ];
  return known.includes(upper as SectionKind) ? (upper as SectionKind) : 'UNKNOWN';
}

function buildSceneVisual(scene: SpecScene): SceneVisual | undefined {
  const visual: SceneVisual = {};
  if (scene.layout && scene.layout !== 'caption') visual.layout = scene.layout;
  if (scene.kicker?.trim()) visual.kicker = scene.kicker.trim();
  if (scene.subtext?.trim()) visual.subtext = scene.subtext.trim();
  if (scene.value?.trim()) visual.value = scene.value.trim();
  if (scene.narration?.trim()) visual.narration = scene.narration.trim();
  if (scene.language?.trim()) visual.language = scene.language.trim();
  if (scene.items && scene.items.length > 0) visual.items = [...scene.items];
  if (scene.chart && scene.chart.length > 0) visual.chart = scene.chart.map((d) => ({ ...d }));
  if (scene.background && Object.keys(scene.background).length > 0) {
    visual.background = {
      ...(scene.background.kind !== undefined ? { kind: scene.background.kind } : {}),
      ...(scene.background.assetId !== undefined ? { assetId: scene.background.assetId } : {}),
      ...(scene.background.colors !== undefined ? { colors: [...scene.background.colors] } : {}),
      ...(scene.background.motion !== undefined ? { motion: scene.background.motion } : {}),
      ...(scene.background.scrim !== undefined ? { scrim: scene.background.scrim } : {})
    };
  }
  if (scene.enter) visual.enter = scene.enter;
  if (scene.exit) visual.exit = scene.exit;
  if (scene.transition) visual.transition = scene.transition;
  if (scene.accent?.trim()) visual.accent = scene.accent.trim();
  return Object.keys(visual).length > 0 ? visual : undefined;
}

/** Compile a validated `VideoSpec` into a complete `Project`. */
export function compileVideoSpec(spec: VideoSpec, options: CompileSpecOptions = {}): Project {
  const base = options.baseProject ?? createProject();
  const requestedTheme = spec.theme ?? base.design.themeId ?? 'nocturne';
  const themeId = THEMES.some((t) => t.id === requestedTheme) ? requestedTheme : getTheme(requestedTheme).id;
  const aspectId: AspectId = spec.aspect ?? base.design.aspectId ?? '16:9';

  const design = designFromTheme(themeId, aspectId);
  if (aspectId === 'custom') {
    const fallback = base.design.customSize ?? { width: 1280, height: 720 };
    const src = spec.customSize ?? fallback;
    design.customSize = { width: evenPx(src.width), height: evenPx(src.height) };
  }

  if (spec.accent !== undefined) {
    design.accent = spec.accent;
  }

  if (spec.background) {
    design.background = {
      ...design.background,
      ...(spec.background.kind !== undefined ? { kind: spec.background.kind } : {}),
      ...(spec.background.assetId !== undefined ? { assetId: spec.background.assetId } : {}),
      ...(spec.background.colors !== undefined ? { colors: [...spec.background.colors] } : {}),
      ...(spec.background.motion !== undefined ? { motion: spec.background.motion } : {}),
      ...(spec.background.scrim !== undefined ? { scrim: spec.background.scrim } : {})
    };
  } else if (base.design.background.kind === 'image' && base.design.background.assetId && spec.theme === base.design.themeId) {
    design.background.assetId = base.design.background.assetId;
  }

  if (spec.typography) {
    design.typography = { ...design.typography, ...spec.typography };
  }

  if (spec.karaoke) {
    design.karaoke = { ...design.karaoke, mode: spec.karaoke };
  }

  if (spec.motion) {
    design.motion = {
      enter: spec.motion.enter ?? design.motion.enter,
      exit: spec.motion.exit ?? design.motion.exit,
      enterUs: spec.motion.enterMs !== undefined ? usFromMs(spec.motion.enterMs) : design.motion.enterUs,
      exitUs: spec.motion.exitMs !== undefined ? usFromMs(spec.motion.exitMs) : design.motion.exitUs,
      overlapUs: spec.motion.overlapMs !== undefined ? usFromMs(spec.motion.overlapMs) : design.motion.overlapUs,
      intensity: spec.motion.intensity ?? design.motion.intensity
    };
  }

  if (spec.intro) {
    design.intro = {
      enabled: true,
      title: spec.intro.title,
      subtitle: spec.intro.subtitle ?? '',
      durationUs: usFromSeconds(spec.intro.duration ?? 2.5)
    };
  } else {
    design.intro = { ...design.intro, enabled: false };
  }

  if (spec.outro) {
    design.outro = {
      enabled: true,
      title: spec.outro.title,
      subtitle: spec.outro.subtitle ?? '',
      durationUs: usFromSeconds(spec.outro.duration ?? 2.5)
    };
  } else {
    design.outro = { ...design.outro, enabled: false };
  }

  if (spec.watermark && spec.watermark.text.trim().length > 0) {
    design.brand = {
      enabled: true,
      text: spec.watermark.text.trim(),
      logoAssetId: base.design.brand.logoAssetId,
      position: spec.watermark.position ?? 'bottom-right',
      opacity: spec.watermark.opacity ?? 0.8
    };
  } else {
    design.brand = { ...design.brand, enabled: false };
  }

  // Compile sections and timed scenes.
  const pauseUs = usFromMs(spec.voice?.pauseMs ?? 250);
  const wpm = spec.voice?.wpm ?? 155;
  const sections: Section[] = [];
  const sectionMap = new Map<string, Section>();
  const kindCounts = new Map<SectionKind, number>();
  const existingById = new Map(base.lyrics.lines.map((l) => [l.id, l]));
  const usedIds = new Set<string>();

  let cursorUs = 0;
  const lines: Line[] = spec.scenes.map((sceneSpec, index) => {
    const visual = buildSceneVisual(sceneSpec);
    const candidateId =
      sceneSpec.id && !usedIds.has(sceneSpec.id)
        ? sceneSpec.id
        : base.lyrics.lines[index]?.id && !usedIds.has(base.lyrics.lines[index]!.id)
          ? base.lyrics.lines[index]!.id
          : newId('scn');
    usedIds.add(candidateId);
    const previous = existingById.get(candidateId);

    const startUs = sceneSpec.start !== undefined ? usFromSeconds(sceneSpec.start) : cursorUs;
    let endUs: number;
    if (sceneSpec.end !== undefined) {
      endUs = usFromSeconds(sceneSpec.end);
    } else if (typeof sceneSpec.duration === 'number') {
      endUs = startUs + usFromSeconds(sceneSpec.duration);
    } else {
      endUs = startUs + estimateSceneDurationUs(sceneSpec.text, { wordsPerMinute: wpm, scene: visual });
    }
    endUs = Math.max(startUs + usFromMs(200), Math.round(endUs));
    const afterPause = sceneSpec.pauseAfter !== undefined ? usFromSeconds(sceneSpec.pauseAfter) : pauseUs;
    cursorUs = endUs + (index < spec.scenes.length - 1 ? afterPause : usFromMs(200));

    let sectionId: string | null = null;
    if (sceneSpec.section?.trim()) {
      const label = sceneSpec.section.trim();
      let sec = sectionMap.get(label);
      if (!sec) {
        const kind = sectionKindFromLabel(label);
        const occ = (kindCounts.get(kind) ?? 0) + 1;
        kindCounts.set(kind, occ);
        sec = { id: newId('sec'), kind, label, occurrence: occ };
        sectionMap.set(label, sec);
        sections.push(sec);
      }
      sectionId = sec.id;
    }

    const explicitTiming = sceneSpec.start !== undefined || sceneSpec.end !== undefined || typeof sceneSpec.duration === 'number';
    const source: Line['source'] =
      previous?.source === 'tts' && previous.start === Math.round(startUs) && previous.end === endUs && previous.text === sceneSpec.text
        ? 'tts'
        : explicitTiming
          ? 'human'
          : 'estimate';
    const confidence = source === 'estimate' ? 0.75 : 1;

    const line = createLine(sceneSpec.text, {
      id: candidateId,
      start: Math.round(startUs),
      end: endUs,
      sectionId,
      locked: sceneSpec.locked ?? false,
      style: sceneSpec.style ? { ...sceneSpec.style } : {},
      scene: visual,
      speaker: sceneSpec.speaker ?? null,
      translation: null,
      source,
      confidence
    });
    line.words = buildTimedWords(line.id, line.text, line.start, line.end, source, confidence);
    return line;
  });

  const lastSceneEnd = lines.reduce((max, l) => Math.max(max, l.end), 0);
  const introUs = design.intro.enabled ? design.intro.durationUs : 0;
  const outroUs = design.outro.enabled ? design.outro.durationUs : 0;
  const sceneSpanUs = lastSceneEnd > 0 ? lastSceneEnd + usFromMs(200) : usFromSeconds(5);
  const totalCompositionUs = Math.max(
    base.audio?.durationUs ?? 0,
    introUs + sceneSpanUs + outroUs
  );

  // Resolve export resolution from aspect + preset.
  const presetId = presetForAspect(aspectId);
  const baseExport = exportSettingsFromPreset(presetId, totalCompositionUs);
  const aspectDef = ASPECTS.find((a) => a.id === aspectId) ?? ASPECTS[0]!;
  const width = aspectId === 'custom' && design.customSize ? design.customSize.width : aspectDef.width;
  const height = aspectId === 'custom' && design.customSize ? design.customSize.height : aspectDef.height;

  // Store voice preferences cleanly in notes envelope or voiceover metadata.
  const updatedVoiceover = base.voiceover
    ? {
        ...base.voiceover,
        voiceId: spec.voice?.voiceId ?? base.voiceover.voiceId,
        voiceIdB: spec.voice?.voiceIdB !== undefined ? spec.voice.voiceIdB : (base.voiceover.voiceIdB ?? null),
        pauseMs: spec.voice?.pauseMs ?? base.voiceover.pauseMs
      }
    : null;

  const voicePrefsNote = spec.voice
    ? encodeVoiceHint(base.meta.notes, spec.voice)
    : base.meta.notes;

  return {
    ...base,
    formatVersion: PROJECT_FORMAT_VERSION,
    updatedAt: Date.now(),
    meta: {
      ...base.meta,
      title: spec.title ?? base.meta.title,
      artist: spec.author ?? base.meta.artist,
      language: spec.language ?? base.meta.language,
      notes: voicePrefsNote
    },
    voiceover: updatedVoiceover,
    lyrics: {
      source: 'spec',
      originalText: lines.map((l) => l.text).join('\n'),
      originalFileName: base.lyrics.originalFileName,
      lines
    },
    sections,
    design,
    export: {
      ...baseExport,
      presetId: EXPORT_PRESETS.some((p) => p.id === presetId) ? presetId : 'youtube',
      width: evenPx(width),
      height: evenPx(height),
      fps: spec.fps ?? base.export.fps,
      codec: spec.codec ?? base.export.codec,
      globalOffsetUs: base.export.globalOffsetUs,
      fileName: base.export.fileName,
      includeAudio: base.export.includeAudio,
      rangeStartUs: 0,
      rangeEndUs: Math.max(usFromSeconds(1), totalCompositionUs)
    }
  };
}

const VOICE_HINT_RE = /\n?\[vidlyrics\.voice:(\{[^\n]*\})\]$/;

function encodeVoiceHint(existingNotes: string, voice: NonNullable<VideoSpec['voice']>): string {
  const clean = existingNotes.replace(VOICE_HINT_RE, '').trimEnd();
  const payload = JSON.stringify({
    ...(voice.voiceId ? { voiceId: voice.voiceId } : {}),
    ...(voice.voiceIdB ? { voiceIdB: voice.voiceIdB } : {}),
    ...(voice.pauseMs !== undefined ? { pauseMs: voice.pauseMs } : {}),
    ...(voice.wpm !== undefined ? { wpm: voice.wpm } : {})
  });
  if (payload === '{}') return clean;
  return `${clean}${clean ? '\n' : ''}[vidlyrics.voice:${payload}]`.slice(0, 8000);
}

/** Extract preferred voice settings specified in a compiled `VideoSpec`, if any. */
export function readProjectVoicePrefs(project: Project): NonNullable<VideoSpec['voice']> | null {
  const match = VOICE_HINT_RE.exec(project.meta.notes);
  if (match?.[1]) {
    try {
      const parsed = JSON.parse(match[1]) as NonNullable<VideoSpec['voice']>;
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      /* ignore malformed note */
    }
  }
  if (project.voiceover) {
    return {
      voiceId: project.voiceover.voiceId,
      ...(project.voiceover.voiceIdB ? { voiceIdB: project.voiceover.voiceIdB } : {}),
      ...(project.voiceover.pauseMs !== undefined ? { pauseMs: project.voiceover.pauseMs } : {})
    };
  }
  return null;
}

function roundSec(us: number): number {
  return Math.round(usToSeconds(us) * 100) / 100;
}

/** Decompile any `Project` into a clean, minimal, human-readable `VideoSpec`. */
export function projectToVideoSpec(project: Project): VideoSpec {
  const theme = getTheme(project.design.themeId);
  const bg = project.design.background;
  const themeBg = theme.background;
  const typo = project.design.typography;
  const themeTypo = theme.typography;
  const motion = project.design.motion;
  const themeMotion = theme.motion;
  const sectionById = new Map(project.sections.map((s) => [s.id, s]));

  const bgChanged =
    bg.kind !== themeBg.kind ||
    bg.assetId !== themeBg.assetId ||
    Math.abs(bg.motion - themeBg.motion) > 0.001 ||
    Math.abs(bg.scrim - themeBg.scrim) > 0.001 ||
    JSON.stringify(bg.colors) !== JSON.stringify(themeBg.colors);

  const typoDiff: NonNullable<VideoSpec['typography']> = {};
  if (typo.weight !== themeTypo.weight) typoDiff.weight = typo.weight;
  if (Math.abs(typo.sizeRatio - themeTypo.sizeRatio) > 0.0005) typoDiff.sizeRatio = Math.round(typo.sizeRatio * 1000) / 1000;
  if (typo.align !== themeTypo.align) typoDiff.align = typo.align;
  if (typo.anchor !== themeTypo.anchor) typoDiff.anchor = typo.anchor;
  if (typo.uppercase !== themeTypo.uppercase) typoDiff.uppercase = typo.uppercase;
  if (typo.color !== themeTypo.color) typoDiff.color = typo.color;
  if (typo.activeColor !== themeTypo.activeColor) typoDiff.activeColor = typo.activeColor;
  if (typo.outlineWidth !== themeTypo.outlineWidth) typoDiff.outlineWidth = typo.outlineWidth;

  const motionDiff: NonNullable<VideoSpec['motion']> = {};
  if (motion.enter !== themeMotion.enter) motionDiff.enter = motion.enter;
  if (motion.exit !== themeMotion.exit) motionDiff.exit = motion.exit;
  if (motion.enterUs !== themeMotion.enterUs) motionDiff.enterMs = Math.round(motion.enterUs / 1000);
  if (motion.exitUs !== themeMotion.exitUs) motionDiff.exitMs = Math.round(motion.exitUs / 1000);
  if (Math.abs(motion.intensity - themeMotion.intensity) > 0.001) motionDiff.intensity = motion.intensity;

  const voicePrefs = readProjectVoicePrefs(project);

  const sortedLines = [...project.lyrics.lines].sort((a, b) => a.start - b.start);
  const scenes: SpecScene[] = sortedLines.map((line) => {
    const s: SpecScene = {
      id: line.id,
      ...(line.scene?.layout && line.scene.layout !== 'caption' ? { layout: line.scene.layout } : {}),
      ...(line.scene?.kicker ? { kicker: line.scene.kicker } : {}),
      text: line.text,
      ...(line.scene?.value ? { value: line.scene.value } : {}),
      ...(line.scene?.subtext ? { subtext: line.scene.subtext } : line.translation ? { subtext: line.translation } : {}),
      ...(line.scene?.narration ? { narration: line.scene.narration } : {}),
      ...(line.scene?.language ? { language: line.scene.language } : {}),
      ...(line.scene?.items && line.scene.items.length > 0 ? { items: line.scene.items } : {}),
      ...(line.scene?.chart && line.scene.chart.length > 0 ? { chart: line.scene.chart } : {}),
      start: roundSec(line.start),
      end: roundSec(Math.max(line.start + 100_000, line.end)),
      ...(line.speaker ? { speaker: line.speaker } : {}),
      ...(line.sectionId && sectionById.get(line.sectionId) ? { section: sectionById.get(line.sectionId)!.label } : {}),
      ...(line.locked ? { locked: true } : {}),
      ...(line.scene?.enter ? { enter: line.scene.enter } : {}),
      ...(line.scene?.exit ? { exit: line.scene.exit } : {}),
      ...(line.scene?.transition ? { transition: line.scene.transition } : {}),
      ...(line.scene?.accent ? { accent: line.scene.accent } : {}),
      ...(line.scene?.background && Object.keys(line.scene.background).length > 0 ? { background: line.scene.background } : {}),
      ...(Object.keys(line.style).length > 0 ? { style: line.style } : {})
    };
    return s;
  });

  const spec: VideoSpec = {
    kind: 'vidlyrics.spec',
    version: VIDEO_SPEC_VERSION,
    ...(project.meta.title ? { title: project.meta.title } : {}),
    ...(project.meta.artist ? { author: project.meta.artist } : {}),
    ...(project.meta.language && project.meta.language !== 'en' ? { language: project.meta.language } : {}),
    theme: project.design.themeId,
    aspect: project.design.aspectId,
    ...(project.design.aspectId === 'custom' && project.design.customSize ? { customSize: project.design.customSize } : {}),
    fps: project.export.fps,
    ...(project.export.codec !== 'h264' ? { codec: project.export.codec } : {}),
    ...(project.design.accent ? { accent: project.design.accent } : {}),
    ...(bgChanged
      ? {
          background: {
            kind: bg.kind,
            ...(bg.assetId ? { assetId: bg.assetId } : {}),
            colors: bg.colors,
            motion: bg.motion,
            scrim: bg.scrim
          }
        }
      : {}),
    ...(Object.keys(typoDiff).length > 0 ? { typography: typoDiff } : {}),
    ...(project.design.karaoke.mode !== theme.karaoke.mode ? { karaoke: project.design.karaoke.mode } : {}),
    ...(Object.keys(motionDiff).length > 0 ? { motion: motionDiff } : {}),
    ...(voicePrefs ? { voice: voicePrefs } : {}),
    ...(project.design.intro.enabled
      ? {
          intro: {
            title: project.design.intro.title,
            ...(project.design.intro.subtitle ? { subtitle: project.design.intro.subtitle } : {}),
            duration: roundSec(project.design.intro.durationUs)
          }
        }
      : {}),
    ...(project.design.outro.enabled
      ? {
          outro: {
            title: project.design.outro.title,
            ...(project.design.outro.subtitle ? { subtitle: project.design.outro.subtitle } : {}),
            duration: roundSec(project.design.outro.durationUs)
          }
        }
      : {}),
    ...(project.design.brand.enabled && project.design.brand.text
      ? {
          watermark: {
            text: project.design.brand.text,
            position: project.design.brand.position,
            opacity: project.design.brand.opacity
          }
        }
      : {}),
    scenes
  };

  return spec;
}

/** Format a Project's declarative `VideoSpec` as 2-space indented JSON. */
export function serialiseVideoSpec(project: Project): string {
  return `${JSON.stringify(projectToVideoSpec(project), null, 2)}\n`;
}
