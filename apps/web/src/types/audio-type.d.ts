declare module 'audio-type' {
  export default function audioType(buffer: ArrayBuffer | Uint8Array): string | undefined;
}
