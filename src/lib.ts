/**
 * Strip WAV header from audio buffer and return raw PCM data
 * WAV header is typically 44 bytes for standard PCM format
 */
export const stripWavHeader = (buffer: Buffer): Buffer => {
  // Look for 'data' chunk marker in the WAV file
  const dataMarker = Buffer.from("data");
  let dataIndex = -1;

  // Find the 'data' chunk
  for (let i = 0; i < Math.min(buffer.length, 200); i++) {
    if (buffer.slice(i, i + 4).equals(dataMarker)) {
      dataIndex = i;
      break;
    }
  }

  if (dataIndex === -1) {
    console.warn(
      "Could not find 'data' chunk in WAV file, returning original buffer"
    );
    return buffer;
  }

  // Skip 'data' marker (4 bytes) + data size (4 bytes) = 8 bytes total
  const pcmDataStart = dataIndex + 8;

  // Return only the PCM data portion
  return buffer.slice(pcmDataStart);
};
