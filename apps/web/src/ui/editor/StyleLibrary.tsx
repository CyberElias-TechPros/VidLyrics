import { useState } from 'react';
import { applyPreset, presetStorageKey, readPresets, savePreset, type StylePreset } from '../../core/design/savedPresets';
import { useEditor } from '../../state/store';

export function StyleLibrary() {
  const design = useEditor(s => s.project.design), commit = useEditor(s => s.commit);
  const [name, setName] = useState(''), [selected, select] = useState('');
  const [error, setError] = useState('');
  const [items, setItems] = useState<StylePreset[]>([]);
  function refresh() {
    try { setItems(readPresets(localStorage.getItem(presetStorageKey))); setError(''); }
    catch { setError('Your style library could not be read. Stored styles have not been overwritten.'); }
  }
  function change(edit: (list: StylePreset[]) => StylePreset[]) {
    try {
      const next = edit(readPresets(localStorage.getItem(presetStorageKey)));
      localStorage.setItem(presetStorageKey, JSON.stringify({ version: 1, presets: next }));
      setItems(next); setError(''); return true;
    } catch(e) { setError(e instanceof Error ? e.message : 'Could not save the style library.'); return false; }
  }
  const active = items.find(p => p.name === selected);
  return <details className="ed-panel-section" onToggle={e => { if (e.currentTarget.open) refresh(); }}>
    <summary>My style presets</summary>
    <p className="ed-hint">Reuse typography, karaoke, motion and accent across projects on this device. Artwork, scene overrides and canvas size stay unchanged.</p>
    <label className="ed-field">Style name<input className="ed-input" maxLength={60} value={name} onChange={e=>setName(e.target.value)} /></label>
    <button className="btn btn-sm btn-ghost" disabled={!name.trim()} onClick={()=>{ if(change(list=>savePreset(list,name,design))) { select(name.trim()); setName(''); } }}>Save current style</button>
    {items.length>0 && <><label className="ed-field">Saved style<select className="ed-select" value={active?.name ?? ''} onChange={e=>select(e.target.value)}><option value="">Choose a style</option>{items.map(p=><option key={p.name}>{p.name}</option>)}</select></label>
    {active && <><p className="ed-hint">{active.style.typography.fontStack} · {active.style.karaoke.mode} karaoke · {active.style.motion.enter} entry</p>
    <button className="btn btn-sm btn-primary" onClick={()=>commit(`Apply style: ${active.name}`,p=>({...p,design:applyPreset(p.design,active)}))}>Apply to project</button>
    <button className="btn btn-sm btn-ghost" onClick={()=>{ if(change(list=>list.filter(p=>p.name!==selected))) select(''); }}>Delete saved style</button></>}</>}
    {error && <p role="alert" className="ed-generation-error">{error}</p>}
  </details>;
}
