/**
 * Strip WAV header from audio buffer and return raw PCM data
 * WAV header is typically 44 bytes for standard PCM format
 */

// Pre-allocated constant to avoid Buffer creation on each call
const DATA_MARKER = Buffer.from("data");

export const stripWavHeader = (buffer: Buffer): Buffer => {
  // Use indexOf for efficient byte sequence search (limited to first 200 bytes)
  const searchLimit = Math.min(buffer.length, 200);
  const dataIndex = buffer.subarray(0, searchLimit).indexOf(DATA_MARKER);

  if (dataIndex === -1) {
    console.warn(
      "Could not find 'data' chunk in WAV file, returning original buffer"
    );
    return buffer;
  }

  // Skip 'data' marker (4 bytes) + data size (4 bytes) = 8 bytes total
  const pcmDataStart = dataIndex + 8;

  // Return only the PCM data portion (subarray creates a view, no copy)
  return buffer.subarray(pcmDataStart);
};
