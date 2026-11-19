export const maxRecordingBytes = 64 * 1024 * 1024;
export const recordingTypes = Object.freeze({
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
});

export function recordingExtension(file) {
  const extension = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.([a-z0-9]+)$/.exec(file)?.[1];
  if (!extension || !Object.hasOwn(recordingTypes, extension)) throw new Error('Invalid recording name');
  return extension;
}

export function recordingType(file) {
  return recordingTypes[recordingExtension(file)];
}
