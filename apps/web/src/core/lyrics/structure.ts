import type { Line, Section, SectionKind } from '../types';
import { extractStructuralTag, isInstrumentalMarker, normalizeForMatch } from './normalize';

/**
 * Song-structure inference.
 *
 * Two evidence sources, in order of trust:
 *   1. Explicit structural tags the author left behind — `[Chorus]`, `(Verse 2)`
 *   2. Repetition analysis — a block of lines that recurs verbatim is almost
 *      certainly a chorus or hook
 *
 * Everything produced here is a SUGGESTION. The editor always allows manual
 * correction and never rewrites the user's lyric text.
 */

const TAG_ALIASES: Record<string, SectionKind> = {
  INTRO: 'INTRO',
  INTRODUCTION: 'INTRO',
  VERSE: 'VERSE',
  'VERSE 1': 'VERSE',
  'VERSE 2': 'VERSE',
  'VERSE 3': 'VERSE',
  'V1': 'VERSE',
  'V2': 'VERSE',
  CHORUS: 'CHORUS',
  REFRAIN: 'REFRAIN',
  HOOK: 'HOOK',
  'PRE-CHORUS': 'PRE_CHORUS',
  PRECHORUS: 'PRE_CHORUS',
  'PRE CHORUS': 'PRE_CHORUS',
  BRIDGE: 'BRIDGE',
  BREAKDOWN: 'BREAKDOWN',
  INSTRUMENTAL: 'INSTRUMENTAL',
  INTERLUDE: 'INSTRUMENTAL',
  OUTRO: 'OUTRO',
  END: 'OUTRO'
};

function kindFromTag(tag: string): SectionKind {
  const upper = tag.toUpperCase().trim();
  if (TAG_ALIASES[upper]) return TAG_ALIASES[upper];
  const base = upper.replace(/\s*\d+$/, '').replace(/[_-]/g, ' ').trim();
  return TAG_ALIASES[base] ?? 'UNKNOWN';
}

export function labelForKind(kind: SectionKind, occurrence: number): string {
  if (kind === 'UNKNOWN') return `Part ${occurrence}`;
  const pretty = kind.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return occurrence > 1 ? `${pretty} ${occurrence}` : pretty;
}

/** Lines whose normalised text recurs — a strong chorus/hook signal. */
export function findRepeatedLines(lines: Line[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const sig = normalizeForMatch(line.text);
    if (sig.length < 3) continue;
    counts.set(sig, (counts.get(sig) ?? 0) + 1);
  }
  for (const [sig, count] of counts) {
    if (count < 2) counts.delete(sig);
  }
  return counts;
}

export interface StructureResult {
  sections: Section[];
  /** lineId -> sectionId */
  assignment: Map<string, string>;
  /** Normalised signatures that repeat, so the UI can offer "style all choruses". */
  repeated: Map<string, number>;
}

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${counter.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Reset the deterministic id counter — used by tests to keep output stable. */
export function resetSectionIdCounter(): void {
  counter = 0;
}

/**
 * Assign every lyric line to a section.
 *
 * Strategy: walk the lines, opening a new section whenever an explicit tag
 * appears. Untagged lyrics get a repetition-derived label: lines whose text
 * repeats elsewhere become CHORUS, everything else alternates VERSE.
 */
export function inferSections(lines: Line[]): StructureResult {
  const repeated = findRepeatedLines(lines);
  const sections: Section[] = [];
  const assignment = new Map<string, string>();
  const occurrenceByKind = new Map<SectionKind, number>();
  let current: Section | null = null;

  const open = (kind: SectionKind): Section => {
    const occurrence = (occurrenceByKind.get(kind) ?? 0) + 1;
    occurrenceByKind.set(kind, occurrence);
    const section: Section = { id: nextId('sec'), kind, label: labelForKind(kind, occurrence), occurrence };
    sections.push(section);
    current = section;
    return section;
  };

  for (const line of lines) {
    const tag = extractStructuralTag(line.text);
    if (tag) {
      open(kindFromTag(tag));
      continue;
    }
    if (!current) current = open('INTRO');

    if (isInstrumentalMarker(line.text)) {
      if (current.kind !== 'INSTRUMENTAL') current = open('INSTRUMENTAL');
    } else {
      const sig = normalizeForMatch(line.text);
      const repeats = sig.length >= 3 && (repeated.get(sig) ?? 0) >= 2;
      if (repeats && current.kind !== 'CHORUS') current = open('CHORUS');
      else if (!repeats && current.kind === 'CHORUS') current = open('VERSE');
    }
    assignment.set(line.id, current.id);
  }

  return { sections, assignment, repeated };
}

/** Group line ids by repeated signature, so one edit can propagate. */
export function groupByRepetition(lines: Line[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const line of lines) {
    const sig = normalizeForMatch(line.text);
    if (sig.length < 3) continue;
    const list = groups.get(sig) ?? [];
    list.push(line.id);
    groups.set(sig, list);
  }
  for (const [sig, ids] of groups) {
    if (ids.length < 2) groups.delete(sig);
  }
  return groups;
}
