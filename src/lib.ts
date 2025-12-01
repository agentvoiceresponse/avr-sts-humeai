/**
 * WAV header parsing utilities
 */

// Pre-allocated constants to avoid Buffer creation on each call
const DATA_MARKER = Buffer.from("data");
const FMT_MARKER = Buffer.from("fmt ");

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  pcmData: Buffer;
}

/**
 * Parse WAV header and extract audio info + raw PCM data
 */
export const parseWav = (buffer: Buffer): WavInfo | null => {
  const searchLimit = Math.min(buffer.length, 200);

  // Find 'fmt ' chunk to get audio format info
  const fmtIndex = buffer.subarray(0, searchLimit).indexOf(FMT_MARKER);
  if (fmtIndex === -1) {
    console.warn("Could not find 'fmt ' chunk in WAV file");
    return null;
  }

  // fmt chunk structure (after 'fmt ' marker):
  // 4 bytes: chunk size
  // 2 bytes: audio format (1 = PCM)
  // 2 bytes: num channels
  // 4 bytes: sample rate
  // 4 bytes: byte rate
  // 2 bytes: block align
  // 2 bytes: bits per sample
  const fmtDataStart = fmtIndex + 8; // skip 'fmt ' (4) + chunk size (4)
  const channels = buffer.readUInt16LE(fmtDataStart + 2);
  const sampleRate = buffer.readUInt32LE(fmtDataStart + 4);
  const bitsPerSample = buffer.readUInt16LE(fmtDataStart + 14);

  // Find 'data' chunk
  const dataIndex = buffer.subarray(0, searchLimit).indexOf(DATA_MARKER);
  if (dataIndex === -1) {
    console.warn("Could not find 'data' chunk in WAV file");
    return null;
  }

  // Skip 'data' marker (4 bytes) + data size (4 bytes) = 8 bytes total
  const pcmDataStart = dataIndex + 8;
  const pcmData = buffer.subarray(pcmDataStart);

  return { sampleRate, channels, bitsPerSample, pcmData };
};

/**
 * Strip WAV header from audio buffer and return raw PCM data
 * @deprecated Use parseWav() instead to also get sample rate info
 */
export const stripWavHeader = (buffer: Buffer): Buffer => {
  const searchLimit = Math.min(buffer.length, 200);
  const dataIndex = buffer.subarray(0, searchLimit).indexOf(DATA_MARKER);

  if (dataIndex === -1) {
    console.warn(
      "Could not find 'data' chunk in WAV file, returning original buffer"
    );
    return buffer;
  }

  const pcmDataStart = dataIndex + 8;
  return buffer.subarray(pcmDataStart);
};
