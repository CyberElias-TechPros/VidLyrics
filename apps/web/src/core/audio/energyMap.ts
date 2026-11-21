import type { EnergyMarker } from '../types';
import type { SpectrumEnvelope } from './spectrum';

/** Coarse spectral dynamics, not a classifier for verse/chorus or vocals. */
export function suggestEnergyMap(env: SpectrumEnvelope, duration: number): EnergyMarker[] {
  if (duration <= 0 || !env.frameCount || env.frameUs <= 0) return [];
  const stride = env.bands.length / env.frameCount;
  if (!Number.isInteger(stride) || stride <= 0) return [];
  const bins: number[] = [], step = Math.max(2_000_000, Math.ceil(duration / 600));
  for (let start = 0; start < duration; start += step) {
    let sum = 0;
    for (let i=0; i<24; i++) {
      const frame = Math.min(env.frameCount-1,Math.floor((start + Math.min(step,duration-start)*(i+0.5)/24)/env.frameUs));
      for(let b=0;b<stride;b++) sum+=env.bands[frame*stride+b]!;
    }
    bins.push(sum/(24*stride));
  }
  const sorted = [...bins].sort((a,b)=>a-b), high=sorted[Math.floor(sorted.length*.75)]!;
  const markers: EnergyMarker[]=[];
  bins.forEach((n,i)=>{
    const level = n < Math.max(1.5, high*0.3) ? 'quiet' : high > sorted[0]!+3 && n >= high ? 'lift' : 'steady';
    if (markers.at(-1)?.level !== level) markers.push({start:i*step,level});
  });
  return markers;
}
