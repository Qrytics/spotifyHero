declare module "wav-decoder" {
  export function decode(
    buffer: ArrayBuffer | Uint8Array | Buffer
  ): Promise<{ sampleRate: number; channelData: Float32Array[] }>;
}
