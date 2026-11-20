import { DEFAULT_VOICE, DEFAULT_VOICE_B, PIPER_VOICES } from '../audio/voices';
import type { SceneLayout } from '../types';
import { VIDEO_SPEC_VERSION, type SpecScene, type VideoSpec } from './schema';

export interface VideoTemplate {
  id: string;
  name: string;
  badge: string;
  blurb: string;
  spec: VideoSpec;
}

export const VIDEO_TEMPLATES: VideoTemplate[] = [
  {
    id: 'script-explainer',
    name: 'Video as Code',
    badge: '16:9 · Explainer',
    blurb: 'Full motion-graphics pipeline showcasing title, bullets, code window, hero stat and animated chart.',
    spec: {
      kind: 'vidlyrics.spec',
      version: VIDEO_SPEC_VERSION,
      title: 'Video as Code',
      author: 'VidLyrics Studio',
      theme: 'nocturne',
      aspect: '16:9',
      fps: 30,
      voice: {
        voiceId: DEFAULT_VOICE,
        pauseMs: 300,
        wpm: 155
      },
      scenes: [
        {
          id: 'scn_hook',
          layout: 'title',
          kicker: 'PROGRAMMATIC VIDEO',
          text: 'Create Videos as Code',
          subtext: 'Define scenes, motion, data charts and voiceovers in JSON — rendered locally in your browser.',
          duration: 3.6,
          enter: 'spring',
          transition: 'fade',
          accent: '#ffb454',
          background: { kind: 'mesh', colors: ['#070911', '#14233d', '#2b193f', '#5c3314'], motion: 0.35, scrim: 0.38 }
        },
        {
          id: 'scn_workflow',
          layout: 'bullets',
          kicker: '4-STEP PIPELINE',
          text: 'From Written Script to MP4 on Your Device',
          items: [
            'Split your script into structured visual scenes',
            'Generate free on-device Piper TTS voiceovers',
            'Sync animations automatically to audio duration',
            'Export constant-frame-rate H.264 MP4 via WebCodecs'
          ],
          duration: 5.2,
          enter: 'rise',
          transition: 'slide',
          accent: '#38bdf8',
          background: { kind: 'gradient', colors: ['#060b16', '#0d2744', '#08121f'], motion: 0.25, scrim: 0.35 }
        },
        {
          id: 'scn_code',
          layout: 'code',
          kicker: 'video.spec.json',
          text: 'Every frame is a deterministic function of scene and time.',
          items: [
            '{',
            '  "layout": "stat",',
            '  "value": "100%",',
            '  "text": "On-device rendering — zero cloud fees",',
            '  "enter": "spring",',
            '  "transition": "wipe"',
            '}'
          ],
          subtext: 'Live canvas preview and offline MP4 encoder run the exact same renderer.',
          duration: 4.6,
          enter: 'zoom',
          transition: 'wipe',
          accent: '#ffb454',
          background: { kind: 'gradient', colors: ['#07080f', '#131829', '#090b12'], motion: 0.18, scrim: 0.3 }
        },
        {
          id: 'scn_stat',
          layout: 'stat',
          kicker: 'CLOUD COST & WATERMARKS',
          value: '$0',
          text: 'Private, local-first encoding with zero usage limits',
          subtext: 'Audio, scripts and assets never leave your browser.',
          duration: 3.6,
          enter: 'spring',
          transition: 'zoom',
          accent: '#34d399',
          background: { kind: 'mesh', colors: ['#041214', '#0b3b36', '#14532d'], motion: 0.32, scrim: 0.4 }
        },
        {
          id: 'scn_chart',
          layout: 'chart',
          kicker: 'STUDIO BENCHMARK',
          text: 'Built for Creator & Agent Workflows',
          chart: [
            { label: 'On-device privacy', value: 100, color: '#34d399' },
            { label: 'Preview / export parity', value: 100, color: '#38bdf8' },
            { label: 'Frame-accurate TTS sync', value: 99, color: '#ffb454' },
            { label: 'Template reusability', value: 96, color: '#a78bfa' }
          ],
          subtext: 'Edit this spec live or generate new scenes from any prompt.',
          duration: 4.6,
          enter: 'rise',
          transition: 'slide',
          accent: '#38bdf8',
          background: { kind: 'gradient', colors: ['#080914', '#1b1638', '#090d1a'], motion: 0.22, scrim: 0.36 }
        }
      ],
      outro: {
        title: 'Export Your MP4',
        subtitle: 'Click Sync Speech or Export Video anytime',
        duration: 2.4
      }
    }
  },
  {
    id: 'social-reel',
    name: 'Vertical Social Reel',
    badge: '9:16 · Shorts / Reels',
    blurb: 'Fast-paced 9:16 mobile reel keeping every element inside TikTok, Reels and Shorts safe areas.',
    spec: {
      kind: 'vidlyrics.spec',
      version: VIDEO_SPEC_VERSION,
      title: 'Stop Editing Frame by Frame',
      author: '@vidlyrics',
      theme: 'neon-circuit',
      aspect: '9:16',
      fps: 30,
      voice: { voiceId: DEFAULT_VOICE_B, pauseMs: 220, wpm: 168 },
      scenes: [
        {
          id: 'reel_1',
          layout: 'title',
          kicker: 'CREATOR WORKFLOW',
          text: 'Stop Dragging Clips by Hand',
          subtext: 'Turn plain scripts into crisp 9:16 reels in seconds.',
          duration: 2.8,
          enter: 'spring',
          transition: 'fade',
          accent: '#00e5ff',
          background: { kind: 'mesh', colors: ['#05060f', '#0b2a4a', '#4c1d95'], motion: 0.45, scrim: 0.42 }
        },
        {
          id: 'reel_2',
          layout: 'stat',
          kicker: 'FASTER TURNAROUND',
          value: '10x',
          text: 'Write the script once — re-render in any aspect ratio',
          subtext: '16:9, 9:16, 4:5 and 1:1 with automatic safe-area insets.',
          duration: 3.2,
          enter: 'zoom',
          transition: 'wipe',
          accent: '#ffb454',
          background: { kind: 'mesh', colors: ['#12081f', '#581c87', '#9a3412'], motion: 0.45, scrim: 0.45 }
        },
        {
          id: 'reel_3',
          layout: 'bullets',
          kicker: 'HOW IT WORKS',
          text: 'Three Steps. Zero Cloud.',
          items: [
            'Paste a script or JSON spec',
            'Auto-sync with local neural TTS',
            'Download ready-to-post H.264 MP4'
          ],
          duration: 3.8,
          enter: 'rise',
          transition: 'slide',
          accent: '#00e5ff',
          background: { kind: 'gradient', colors: ['#040814', '#0e3756', '#1e1b4b'], motion: 0.35, scrim: 0.4 }
        },
        {
          id: 'reel_4',
          layout: 'quote',
          text: 'Code turns video production from manual timeline labor into a repeatable pipeline.',
          subtext: 'VidLyrics Studio',
          duration: 3.6,
          enter: 'fade',
          transition: 'fade',
          accent: '#f472b6',
          background: { kind: 'gradient', colors: ['#090612', '#2e1042', '#090612'], motion: 0.25, scrim: 0.4 }
        }
      ],
      watermark: { text: '@vidlyrics', position: 'top-left', opacity: 0.75 }
    }
  },
  {
    id: 'data-deck',
    name: 'Data & Metrics Report',
    badge: '16:9 · Charts',
    blurb: 'Animated KPI callouts and spring-driven horizontal bar charts for product updates and explainers.',
    spec: {
      kind: 'vidlyrics.spec',
      version: VIDEO_SPEC_VERSION,
      title: 'Q4 Product Highlights',
      author: 'Analytics Team',
      theme: 'aurora',
      aspect: '16:9',
      fps: 30,
      voice: { voiceId: 'en_GB-alan-medium', pauseMs: 320, wpm: 150 },
      scenes: [
        {
          id: 'kpi_intro',
          layout: 'title',
          kicker: 'QUARTERLY BRIEFING',
          text: 'Q4 Growth & Reliability Report',
          subtext: 'Automated metrics summary generated straight from structured data.',
          duration: 3.4,
          enter: 'spring',
          transition: 'fade',
          accent: '#34d399'
        },
        {
          id: 'kpi_users',
          layout: 'stat',
          kicker: 'ACTIVE CREATORS',
          value: '48,500',
          text: 'Monthly active creators shipping videos worldwide',
          subtext: 'Up 64% quarter-over-quarter with zero server render queue.',
          duration: 3.8,
          enter: 'spring',
          transition: 'wipe',
          accent: '#38bdf8',
          background: { kind: 'gradient', colors: ['#04121c', '#0c3547', '#071926'], motion: 0.2, scrim: 0.38 }
        },
        {
          id: 'kpi_channels',
          layout: 'chart',
          kicker: 'EXPORTS BY FORMAT (K)',
          text: 'Short-Form Vertical Leads Total Output',
          chart: [
            { label: '9:16 Vertical Reels', value: 142, color: '#34d399' },
            { label: '16:9 YouTube HD', value: 98, color: '#38bdf8' },
            { label: '4:5 Social Feed', value: 54, color: '#a78bfa' },
            { label: '1:1 Square Clips', value: 31, color: '#ffb454' }
          ],
          subtext: 'Measured across Q4 completed renders.',
          duration: 4.8,
          enter: 'rise',
          transition: 'slide',
          accent: '#34d399',
          background: { kind: 'mesh', colors: ['#04121a', '#0d3b3f', '#312e81'], motion: 0.25, scrim: 0.42 }
        },
        {
          id: 'kpi_uptime',
          layout: 'stat',
          kicker: 'EXPORT RELIABILITY',
          value: '99.9%',
          text: 'Constant-frame-rate exports completed without dropped frames',
          duration: 3.5,
          enter: 'zoom',
          transition: 'zoom',
          accent: '#ffb454'
        }
      ]
    }
  },
  {
    id: 'podcast-dialogue',
    name: 'Two-Voice Dialogue',
    badge: '16:9 · Dual TTS',
    blurb: 'Alternating Host (A) and Guest (B) script wired to two distinct local Piper neural voices.',
    spec: {
      kind: 'vidlyrics.spec',
      version: VIDEO_SPEC_VERSION,
      title: 'Two-Minute Tech Chat',
      author: 'Studio Podcast',
      theme: 'sunset-drive',
      aspect: '16:9',
      fps: 30,
      karaoke: 'word',
      voice: {
        voiceId: DEFAULT_VOICE,
        voiceIdB: DEFAULT_VOICE_B,
        pauseMs: 360,
        wpm: 155
      },
      scenes: [
        {
          id: 'dlg_1',
          layout: 'caption',
          kicker: 'HOST · VOICE A',
          text: 'Welcome back! Today we are exploring how developers build complete videos using just code.',
          speaker: 'A',
          duration: 4.2,
          enter: 'rise',
          transition: 'fade',
          accent: '#ffd166'
        },
        {
          id: 'dlg_2',
          layout: 'caption',
          kicker: 'GUEST · VOICE B',
          text: 'Instead of nudging clips on a timeline for hours, each sentence becomes a timed scene automatically.',
          speaker: 'B',
          duration: 4.5,
          enter: 'rise',
          transition: 'fade',
          accent: '#38bdf8',
          background: { kind: 'mesh', colors: ['#0b132b', '#1c2541', '#3a506b'], motion: 0.3, scrim: 0.42 }
        },
        {
          id: 'dlg_3',
          layout: 'caption',
          kicker: 'HOST · VOICE A',
          text: 'And because synthesis and encoding happen right inside the browser, nothing is uploaded anywhere.',
          speaker: 'A',
          duration: 4.4,
          enter: 'rise',
          transition: 'fade',
          accent: '#ffd166'
        },
        {
          id: 'dlg_4',
          layout: 'title',
          kicker: 'TRY IT NOW',
          text: 'Click Auto-Time with TTS',
          subtext: 'Speaker A and Speaker B render with distinct voices and exact timing.',
          speaker: 'B',
          duration: 3.6,
          enter: 'spring',
          transition: 'wipe',
          accent: '#ff7a45'
        }
      ]
    }
  },
  {
    id: 'code-walkthrough',
    name: 'Code Tutorial',
    badge: '16:9 · Dev',
    blurb: 'Step-by-step developer walkthrough with animated code cards, terminal commands and takeaway list.',
    spec: {
      kind: 'vidlyrics.spec',
      version: VIDEO_SPEC_VERSION,
      title: 'Deterministic Rendering 101',
      author: 'Dev Docs',
      theme: 'nocturne',
      aspect: '16:9',
      fps: 30,
      voice: { voiceId: DEFAULT_VOICE, pauseMs: 320, wpm: 150 },
      scenes: [
        {
          id: 'dev_1',
          layout: 'title',
          kicker: 'ENGINEERING GUIDE',
          text: 'Deterministic Video Rendering',
          subtext: 'Why every frame should be a pure function of scene and timestamp.',
          duration: 3.5,
          enter: 'spring',
          transition: 'fade',
          accent: '#7dd3fc'
        },
        {
          id: 'dev_2',
          layout: 'code',
          kicker: 'render.ts',
          text: 'Compute pure layout state first, then paint onto any canvas surface.',
          items: [
            'function renderAt(scene, timeUs, ctx) {',
            '  const state = computeFrameState(scene, timeUs);',
            '  paintBackground(ctx, scene, state);',
            '  for (const block of state.blocks) {',
            '    paintBlock(ctx, scene, block);',
            '  }',
            '}'
          ],
          subtext: 'Zero Date.now() or Math.random() — preview and export never diverge.',
          duration: 5.0,
          enter: 'rise',
          transition: 'slide',
          accent: '#7dd3fc',
          background: { kind: 'solid', colors: ['#070a12'], motion: 0, scrim: 0 }
        },
        {
          id: 'dev_3',
          layout: 'bullets',
          kicker: 'KEY TAKEAWAYS',
          text: 'Production Export Checklist',
          items: [
            'Encode offline frame-by-frame at constant FPS',
            'Respect VideoEncoder queue backpressure',
            'Compensate AAC 1024-sample priming silence',
            'Await font readiness before drawing frame 0'
          ],
          duration: 4.8,
          enter: 'rise',
          transition: 'wipe',
          accent: '#34d399',
          background: { kind: 'gradient', colors: ['#060d14', '#0f2938', '#060d14'], motion: 0.15, scrim: 0.3 }
        }
      ]
    }
  }
];

export function getVideoTemplate(id: string): VideoTemplate {
  return VIDEO_TEMPLATES.find((t) => t.id === id) ?? VIDEO_TEMPLATES[0]!;
}

/** Ready-to-append scene snippets surfaced in the Code panel's quick-insert bar. */
export const SCENE_SNIPPETS: { layout: SceneLayout; label: string; create: () => SpecScene }[] = [
  {
    layout: 'title',
    label: '+ Title',
    create: () => ({
      layout: 'title',
      kicker: 'SECTION',
      text: 'Your Scene Headline',
      subtext: 'Supporting line that reinforces the main idea.',
      duration: 3.5,
      enter: 'spring',
      transition: 'fade'
    })
  },
  {
    layout: 'stat',
    label: '+ Stat',
    create: () => ({
      layout: 'stat',
      kicker: 'KEY METRIC',
      value: '98%',
      text: 'Describe what this number proves',
      subtext: 'Optional context or data source.',
      duration: 3.5,
      enter: 'spring',
      transition: 'wipe'
    })
  },
  {
    layout: 'bullets',
    label: '+ Bullets',
    create: () => ({
      layout: 'bullets',
      kicker: 'OVERVIEW',
      text: 'Three Core Takeaways',
      items: ['First clear takeaway', 'Second supporting point', 'Third actionable step'],
      duration: 4.8,
      enter: 'rise',
      transition: 'slide'
    })
  },
  {
    layout: 'code',
    label: '+ Code',
    create: () => ({
      layout: 'code',
      kicker: 'example.ts',
      text: 'Explain what this snippet does in one sentence.',
      items: ['const message = "Hello from code!";', 'console.log(message);'],
      subtext: 'Runs locally with zero setup.',
      duration: 4.5,
      enter: 'zoom',
      transition: 'wipe'
    })
  },
  {
    layout: 'chart',
    label: '+ Chart',
    create: () => ({
      layout: 'chart',
      kicker: 'COMPARISON',
      text: 'Results Across Categories',
      chart: [
        { label: 'Option A', value: 92, color: '#38bdf8' },
        { label: 'Option B', value: 74, color: '#ffb454' },
        { label: 'Option C', value: 58, color: '#a78bfa' }
      ],
      duration: 4.5,
      enter: 'rise',
      transition: 'slide'
    })
  },
  {
    layout: 'quote',
    label: '+ Quote',
    create: () => ({
      layout: 'quote',
      text: 'Simplicity is prerequisite for reliability.',
      subtext: 'Edsger W. Dijkstra',
      duration: 3.8,
      enter: 'fade',
      transition: 'fade'
    })
  },
  {
    layout: 'caption',
    label: '+ Caption',
    create: () => ({
      layout: 'caption',
      text: 'Spoken narration line with synced word highlighting.',
      duration: 'auto',
      enter: 'rise'
    })
  }
];

/**
 * Self-contained prompt users can copy into any AI coding assistant (Claude Code,
 * ChatGPT, Gemini, etc.) to turn a raw script or topic into a valid VidLyrics spec.
 */
export function buildAiSpecPrompt(): string {
  return `Convert my script or topic below into a single valid JSON object matching VidLyrics's \`vidlyrics.spec\` v1 format (output JSON only, no markdown commentary):

{
  "kind": "vidlyrics.spec",
  "version": 1,
  "title": "Video Title",
  "author": "Channel Name",
  "theme": "nocturne | neon-circuit | paper-light | sunset-drive | mono-brutal | aurora | cinema-classic | karaoke-stage",
  "aspect": "16:9 | 9:16 | 1:1 | 4:5 | 4:3",
  "fps": 30,
  "voice": {
    "voiceId": "${DEFAULT_VOICE}",
    "voiceIdB": "${DEFAULT_VOICE_B}",
    "pauseMs": 300,
    "wpm": 155
  },
  "scenes": [
    {
      "layout": "title | caption | stat | bullets | quote | code | chart",
      "kicker": "OPTIONAL EYEBROW OR FILENAME",
      "text": "On-screen headline or caption (required)",
      "value": "Required for stat layout (e.g. '10x', '$0', '99.5%')",
      "subtext": "Optional supporting line or quote author",
      "narration": "Optional spoken override for local TTS (helpful on code/chart/stat scenes)",
      "items": ["Bullet points for bullets layout, or code lines for code layout"],
      "chart": [{ "label": "Bar name", "value": 85, "color": "#38bdf8" }],
      "duration": "auto (or a positive number of seconds)",
      "speaker": "A | B",
      "enter": "spring | rise | fade | zoom | clip | blur | wordCascade",
      "transition": "fade | slide | wipe | zoom | none",
      "accent": "#ffb454",
      "background": { "kind": "mesh | gradient | solid", "colors": ["#070911", "#14233d", "#2b193f"], "motion": 0.3, "scrim": 0.38 }
    }
  ],
  "outro": { "title": "Thanks for watching", "subtitle": "Optional call to action", "duration": 2.5 }
}

Guidelines:
- Use ${DEFAULT_VOICE} for US English narration or ${DEFAULT_VOICE_B} for a female US voice. Both models are public domain. Other bundled IDs if requested: ${PIPER_VOICES.map(v => v.id).join(', ')}.
- Split the script into punchy 3–6 second scenes mixing \`title\`, \`bullets\`, \`stat\`, \`chart\`, \`code\`, \`quote\`, and \`caption\` layouts where they fit naturally.
- Use \`"duration": "auto"\` so VidLyrics's local Piper TTS can auto-sync exact scene durations to spoken voiceover.
- Put words viewers should see in "text" or "subtext". "narration" is for speech only. Split long passages across scenes instead of crowding a card.
- Keep colors high-contrast and legible inside mobile/desktop safe areas.

MY SCRIPT / TOPIC:
[Paste your script or topic here]`;
}
