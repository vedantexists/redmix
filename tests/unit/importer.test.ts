import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeTrackId,
  parseAudioMetadata,
  validateAudioFile,
  importAudioFile,
  importAudioFiles,
} from '@/library/importer';
import { db } from '@/library/db';

function createMockAudioFile(
  name: string,
  content = 'RIFF1234WAVEfmt mock audio data content',
  type = 'audio/wav'
): File {
  const blob = new Blob([content], { type });
  return new File([blob], name, { type });
}

function createSyntheticId3v2File(title: string, artist: string, name = 'test.mp3'): File {
  // Construct a minimal valid ID3v2.3 tag
  const encodeFrame = (id: string, text: string): Uint8Array => {
    const textBytes = new TextEncoder().encode(text);
    // 1 byte encoding (0 = ISO-8859-1) + textBytes
    const frameSize = 1 + textBytes.length;
    const frame = new Uint8Array(10 + frameSize);
    // ID
    for (let i = 0; i < 4; i++) frame[i] = id.charCodeAt(i);
    // Size (4 bytes)
    frame[4] = (frameSize >> 24) & 0xff;
    frame[5] = (frameSize >> 16) & 0xff;
    frame[6] = (frameSize >> 8) & 0xff;
    frame[7] = frameSize & 0xff;
    // Flags (2 bytes 0)
    frame[8] = 0;
    frame[9] = 0;
    // Encoding byte
    frame[10] = 0;
    // Content
    frame.set(textBytes, 11);
    return frame;
  };

  const titleFrame = encodeFrame('TIT2', title);
  const artistFrame = encodeFrame('TPE1', artist);
  const totalFramesLen = titleFrame.length + artistFrame.length;

  const header = new Uint8Array(10);
  header[0] = 0x49; // 'I'
  header[1] = 0x44; // 'D'
  header[2] = 0x33; // '3'
  header[3] = 3; // version 2.3
  header[4] = 0;
  header[5] = 0;
  // Syncsafe size for header
  header[6] = (totalFramesLen >> 21) & 0x7f;
  header[7] = (totalFramesLen >> 14) & 0x7f;
  header[8] = (totalFramesLen >> 7) & 0x7f;
  header[9] = totalFramesLen & 0x7f;

  const audioPayload = new TextEncoder().encode('MOCK_MP3_AUDIO_STREAM_DATA');
  const fullBytes = new Uint8Array(10 + totalFramesLen + audioPayload.length);
  fullBytes.set(header, 0);
  fullBytes.set(titleFrame, 10);
  fullBytes.set(artistFrame, 10 + titleFrame.length);
  fullBytes.set(audioPayload, 10 + totalFramesLen);

  return new File([fullBytes], name, { type: 'audio/mpeg' });
}

describe('Track ID Generation & Content Hashing', () => {
  it('generates a stable 40-character hexadecimal SHA-1 string', async () => {
    const file = createMockAudioFile('sample.wav', 'audio sample content here');
    const id = await computeTrackId(file);
    expect(id).toMatch(/^[0-9a-f]{40}$/);
  });

  it('generates the identical TrackId for identical content (deduplication)', async () => {
    const file1 = createMockAudioFile('track.wav', 'identical audio content');
    const file2 = createMockAudioFile('track.wav', 'identical audio content');
    const id1 = await computeTrackId(file1);
    const id2 = await computeTrackId(file2);
    expect(id1).toBe(id2);
  });

  it('maps a renamed copy of the same file to the identical TrackId', async () => {
    const file1 = createMockAudioFile('original_name.mp3', 'same exact bytes');
    const file2 = createMockAudioFile('renamed_copy.mp3', 'same exact bytes');
    const id1 = await computeTrackId(file1);
    const id2 = await computeTrackId(file2);
    expect(id1).toBe(id2);
  });

  it('generates different TrackIds for different audio content', async () => {
    const file1 = createMockAudioFile('song1.mp3', 'content of song 1');
    const file2 = createMockAudioFile('song2.mp3', 'different content for song 2');
    const id1 = await computeTrackId(file1);
    const id2 = await computeTrackId(file2);
    expect(id1).not.toBe(id2);
  });
});

describe('Audio File Validation', () => {
  it('validates supported audio extensions and MIME types', async () => {
    const wav = createMockAudioFile('test.wav', 'RIFF...WAVE', 'audio/wav');
    const mp3 = createMockAudioFile('test.mp3', 'ID3...', 'audio/mpeg');
    const flac = createMockAudioFile('test.flac', 'fLaC...', 'audio/flac');

    expect((await validateAudioFile(wav)).valid).toBe(true);
    expect((await validateAudioFile(mp3)).valid).toBe(true);
    expect((await validateAudioFile(flac)).valid).toBe(true);
  });

  it('rejects zero-length empty files with clear error message', async () => {
    const emptyFile = new File([], 'empty.mp3', { type: 'audio/mpeg' });
    const res = await validateAudioFile(emptyFile);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('0 bytes');
  });

  it('rejects unsupported non-audio files (e.g. .pdf, .txt)', async () => {
    const pdf = new File(['%PDF-1.4 mock pdf content'], 'document.pdf', {
      type: 'application/pdf',
    });
    const res = await validateAudioFile(pdf);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('Unsupported file format');
  });
});

describe('Metadata & Tag Extraction', () => {
  it('extracts ID3v2 title and artist from tagged audio files', async () => {
    const taggedFile = createSyntheticId3v2File('Midnight City', 'M83', 'm83.mp3');
    const meta = await parseAudioMetadata(taggedFile);
    expect(meta.title).toBe('Midnight City');
    expect(meta.artist).toBe('M83');
  });

  it('falls back to filename without extension when ID3 tags are missing', async () => {
    const untaggedFile = createMockAudioFile('Summer Vibes.wav');
    const meta = await parseAudioMetadata(untaggedFile);
    expect(meta.title).toBe('Summer Vibes');
    expect(meta.artist).toBeUndefined();
  });

  it('parses "Artist - Title" naming convention from filename fallback', async () => {
    const formattedFile = createMockAudioFile('Daft Punk - One More Time.flac');
    const meta = await parseAudioMetadata(formattedFile);
    expect(meta.artist).toBe('Daft Punk');
    expect(meta.title).toBe('One More Time');
  });
});

describe('IndexedDB Track Persistence & Importer Pipeline', () => {
  beforeEach(async () => {
    await db.clearAll();
  });

  it('saves, retrieves, and persists tracks across queries', async () => {
    const file = createMockAudioFile('song.wav', 'audio bytes 12345');
    const res = await importAudioFile(file, undefined, true);

    expect(res.track).toBeDefined();
    expect(res.isDuplicate).toBe(false);

    // Retrieve from database
    const savedTracks = await db.getTracks();
    expect(savedTracks.length).toBe(1);
    expect(savedTracks[0]?.id).toBe(res.track?.id);
    expect(savedTracks[0]?.fileName).toBe('song.wav');
    expect(savedTracks[0]?.source.kind).toBe('opfs');
  });

  it('detects duplicate files on re-import without duplicating in database', async () => {
    const file1 = createMockAudioFile('beat.mp3', 'same beat content');
    const file2 = createMockAudioFile('renamed_beat.mp3', 'same beat content');

    const res1 = await importAudioFile(file1, undefined, true);
    expect(res1.isDuplicate).toBe(false);

    const res2 = await importAudioFile(file2, undefined, true);
    expect(res2.isDuplicate).toBe(true);
    expect(res2.track?.id).toBe(res1.track?.id);

    const allTracks = await db.getTracks();
    expect(allTracks.length).toBe(1);
  });

  it('batch import processes multiple files, collecting successes and errors cleanly', async () => {
    const validFile1 = createMockAudioFile('track1.wav', 'sound 1');
    const validFile2 = createMockAudioFile('track2.wav', 'sound 2');
    const invalidFile = new File(['text content'], 'notes.txt', { type: 'text/plain' });

    const batch = [{ file: validFile1 }, { file: validFile2 }, { file: invalidFile }];

    const result = await importAudioFiles(batch, true);

    expect(result.imported.length).toBe(2);
    expect(result.failed.length).toBe(1);
    expect(result.failed[0]?.fileName).toBe('notes.txt');
    expect(result.failed[0]?.reason).toContain('Unsupported file format');

    const stored = await db.getTracks();
    expect(stored.length).toBe(2);
  });
});
