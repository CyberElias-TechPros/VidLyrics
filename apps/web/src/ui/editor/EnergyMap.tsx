import { useMemo, useState } from 'react';
import { useEditor } from '../../state/store';
import { suggestEnergyMap } from '../../core/audio/energyMap';
import { formatTimecode } from '../../core/time';
import { seekTo } from '../../media/session';
import type { EnergyMarker } from '../../core/types';

export function EnergyMap() {
  const audio=useEditor(s=>s.project.audio), env=useEditor(s=>s.spectrum), commit=useEditor(s=>s.commit);
  const suggested=useMemo(()=>audio && env ? suggestEnergyMap(env,audio.durationUs) : [],[env,audio?.durationUs]);
  const [time,setTime]=useState('0'), [level,setLevel]=useState<EnergyMarker['level']>('steady'), [error,setError]=useState('');
  if (!audio) return null;
  const markers=audio.energyMap ?? suggested;
  function save(next: EnergyMarker[]) {
    commit('Edit track energy map',p=>!p.audio || p.audio.contentHash!==audio?.contentHash ? p : {...p,audio:{...p.audio,energyMap:next}});
    setError('');
  }
  return <details className="ed-panel-section"><summary>Track energy map</summary>
    <p className="ed-hint">{audio.energyMap ? 'Accepted sections.' : 'Suggested sections from spectral energy.'} Each marker lasts until the next. Accept or edit the map to guide scene direction; it does not retime lyrics.</p>
    <div className="ed-generated-lines">{markers.map(m=><div className="ed-row" key={m.start}><button className="btn btn-sm btn-ghost" onClick={()=>{seekTo(m.start);setTime(String(m.start/1e6));setLevel(m.level);}}>{formatTimecode(m.start)} · {m.level}</button><button className="btn btn-sm btn-ghost" aria-label={`Remove marker at ${formatTimecode(m.start)}`} onClick={()=>save(markers.filter(x=>x.start!==m.start))}>Remove</button></div>)}</div>
    {!audio.energyMap && suggested.length>0 && <button className="btn btn-sm btn-primary" onClick={()=>save(suggested)}>Accept energy map</button>}
    <label className="ed-field">Marker time (s)<input className="ed-input" type="number" step="any" min="0" value={time} onChange={e=>setTime(e.target.value)} /></label>
    <label className="ed-field">Energy<select className="ed-select" value={level} onChange={e=>setLevel(e.target.value as EnergyMarker['level'])}><option>quiet</option><option>steady</option><option>lift</option></select></label>
    <button className="btn btn-sm btn-ghost" onClick={()=>{const start=Math.round(Number(time)*1e6);const rest=markers.filter(m=>m.start!==start);if(!time.trim() || !Number.isSafeInteger(start) || start<0 || start>=audio.durationUs || rest.length>=1000){setError('Use a time inside the track and at most 1000 markers.');return;}save([...rest,{start,level}].sort((a,b)=>a.start-b.start));}}>Set marker</button>
    {error && <span role="alert">{error}</span>}
  </details>;
}
