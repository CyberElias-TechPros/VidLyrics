import { useMemo, useState } from 'react';
import { useEditor } from '../../state/store';
import { applyShots, planShots, treatments, type Treatment } from '../../core/director/plan';
import { confirmWord, pendingWords } from '../../core/timing/review';
import { seekTo } from '../../media/session';
import type { Line, Word } from '../../core/types';

export function SceneDirector() {
  const project = useEditor(s => s.project), env = useEditor(s => s.spectrum);
  const commit = useEditor(s => s.commit), notify = useEditor(s => s.notify);
  const [family, setFamily] = useState<Treatment>('sanctuary');
  const [still, setStill] = useState(false), [scope, setScope] = useState('');
  const shots = useMemo(() => planShots(project, env, family, still), [project, env, family, still]);
  const selected = shots.find(s => s.id === scope);
  const shown = selected ? [selected] : shots;
  if (!shots.length) return null;
  return <section className="ed-panel-section ed-generation-section" aria-label="Scene director">
    <strong>Scene director</strong><p className="ed-hint">Local, rule-based storyboard. Review the treatment, then apply it without replacing words, timings, narration or artwork.</p>
    <label className="ed-field">Visual treatment<select className="ed-select" value={family} onChange={e => setFamily(e.target.value as Treatment)}>{Object.entries(treatments).map(([key,t]) => <option key={key} value={key}>{t.name}</option>)}</select></label>
    <label className="ed-field">Apply to<select className="ed-select" value={selected?.id ?? ''} onChange={e => setScope(e.target.value)}><option value="">All scenes</option>{shots.map((s,i) => <option key={s.id} value={s.id}>{i+1}. {s.text.slice(0,60)}</option>)}</select></label>
    <label><input type="checkbox" checked={still} onChange={e => setStill(e.target.checked)} /> Still background and no scene transitions</label>
    <div className="ed-generated-lines">{shown.slice(0,8).map(s => <div key={s.id}><b>{s.text.slice(0,60)}</b><p className="ed-hint">{s.reason} · {s.visual.background?.kind} / {s.visual.enter}</p></div>)}{shown.length > 8 && <small>+ {shown.length - 8} more. Choose one scene above to inspect it.</small>}</div>
    <button className="btn btn-sm btn-primary" onClick={() => { commit('Apply scene direction', p => applyShots(p, shown)); notify({kind:'success', title:'Scene direction applied', detail:`${shown.length} scenes. Undo to restore the previous styling.`}); }}>Apply scene direction</button>
  </section>;
}

function WordForm({ line, word }: { line: Line; word: Word }) {
  const [a,setA] = useState(String(word.start / 1e6)), [b,setB] = useState(String(word.end / 1e6));
  const [error,setError] = useState('');
  const commit = useEditor(s => s.commit);
  function save() {
    try {
      if (!a.trim() || !b.trim()) throw new Error('Enter both times in seconds.');
      const updated = confirmWord(line, word.id, Math.round(Number(a)*1e6), Math.round(Number(b)*1e6));
      commit('Confirm word timing', p => ({ ...p, lyrics: { ...p.lyrics, lines: p.lyrics.lines.map(l => l.id === line.id ? updated : l) } }));
    } catch (e) { setError((e as Error).message); }
  }
  return <><b>{word.text}</b><span className="ed-hint">{line.text}</span>
    <div className="ed-generation-controls">{[a,b].map((value,i) => <label key={i} className="ed-field">{i ? 'Word end' : 'Word start'} (s)<input className="ed-input" type="number" step="any" min="0" value={value} onChange={e => (i ? setB : setA)(e.target.value)} /></label>)}</div>
    {error && <span role="alert">{error}</span>}<button className="btn btn-sm btn-primary" onClick={save}>Confirm word timing</button></>;
}

export function TimingReview() {
  const p = useEditor(s => s.project), select = useEditor(s => s.setSelection);
  const pending = useMemo(() => pendingWords(p.lyrics.lines), [p.lyrics.lines]);
  const [id,setId] = useState('');
  const target = pending.find(t => t.word.id === id);
  if (!p.lyrics.lines.length) return null;
  const review = () => {
    const i = pending.findIndex(t => t.word.id === id), t = pending[(i + 1) % pending.length];
    if (!t) return;
    setId(t.word.id); select([t.line.id]);
    seekTo(Math.max(0, t.word.start - 160000 + p.export.globalOffsetUs + (p.design.intro.enabled ? p.design.intro.durationUs : 0)));
  };
  return <section className="ed-panel-section ed-generation-section" aria-label="Word timing review"><strong>Word timing review</strong>
    <span className="ed-hint">{pending.length} estimated or low-confidence words. Review against the track before export.</span>
    <button className="btn btn-sm btn-ghost" disabled={!pending.length} onClick={review}>{target ? 'Next uncertain word' : 'Review uncertain timings'}</button>
    {target && <WordForm key={`${target.word.id}:${target.word.start}:${target.word.end}`} {...target} />}
  </section>;
}
