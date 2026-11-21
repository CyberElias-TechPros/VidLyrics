import { fft } from './fft';

/** Stereo centre emphasis for transcription ONLY. A mid/side spectral mask
 * attenuates wide/panned bins. It cannot distinguish a centred drum from a
 * centred singer; this is deliberately optional, not a stem-separation model. */
export function focusCentre(mid: Float32Array, side: Float32Array): Float32Array {
  if (mid.length !== side.length) throw new RangeError('Mid and side lengths differ');
  const n=512, hop=n/2, win=Float32Array.from({length:n},(_,i)=>Math.sin(Math.PI*(i+0.5)/n));
  const m=new Float32Array(n*2),s=new Float32Array(n*2),out=new Float32Array(mid.length);
  for(let base=-hop;base<mid.length;base+=hop) {
    m.fill(0);s.fill(0);
    for(let i=0;i<n;i++){ m[2*i]=(mid[base+i]??0)*win[i]!;s[2*i]=(side[base+i]??0)*win[i]!; }
    fft(m,n);fft(s,n);
    for(let k=0;k<2*n;k+=2) {
      const power=m[k]!**2+m[k+1]!**2, lateral=s[k]!**2+s[k+1]!**2;
      const gain=Math.max(0.12,power/(power+5*lateral+1e-15));
      m[k]=m[k]!*gain;m[k+1]=-m[k+1]!*gain;
    }
    fft(m,n); // real part of inverse FFT = real(FFT(conjugate(X))) / N
    for(let i=Math.max(0,-base);i<n && base+i<out.length;i++) out[base+i]! += m[2*i]!*win[i]!/n;
  }
  return out;
}
