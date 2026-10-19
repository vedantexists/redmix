import type { Track, TrackSource } from '@/shared/types';
import { db } from './db';
import { isFileSystemAccessSupported, saveToOpfs, type PickedFileWithHandle } from './fileAccess';

export interface AudioMetadata {
  title: string;
  artist?: string;
  durationSec?: number;
}

export interface ImportFailure {
  fileName: string;
  reason: string;
}

export interface ImportResult {
  imported: Track[];
  duplicates: Track[];
  failed: ImportFailure[];
}

/**
 * Supported audio extensions and MIME types.
 */
const SUPPORTED_EXTENSIONS = new Set([
  '.mp3',
  '.m4a',
  '.aac',
  '.wav',
  '.flac',
  '.ogg',
  '.opus',
  '.weba',
  '.aiff',
]);

/**
 * Check if file is a supported audio format based on extension, MIME, or magic bytes.
 */
export async function validateAudioFile(file: File): Promise<{ valid: boolean; error?: string }> {
  if (file.size === 0) {
    return { valid: false, error: 'File is empty (0 bytes).' };
  }

  const name = file.name.toLowerCase();
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';

  // Check extension or MIME type
  const hasAudioExt = SUPPORTED_EXTENSIONS.has(ext);
  const hasAudioMime = file.type.startsWith('audio/') || file.type === 'video/mp4';

  if (!hasAudioExt && !hasAudioMime) {
    return {
      valid: false,
      error: `Unsupported file format: "${file.name}". Please import audio files (.mp3, .m4a, .wav, .flac, .ogg).`,
    };
  }

  // Inspect first 32 bytes for valid magic headers
  try {
    const headerBuffer = await sliceToArrayBuffer(file.slice(0, 32));
    const bytes = new Uint8Array(headerBuffer);

    // ID3v2 (ID3)
    const isId3 = (bytes[0] ?? 0) === 0x49 && (bytes[1] ?? 0) === 0x44 && (bytes[2] ?? 0) === 0x33;
    // MP3 Frame sync (0xFF 0xE0 mask)
    const isMp3Sync = (bytes[0] ?? 0) === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0;
    // RIFF (WAV)
    const isRiff =
      (bytes[0] ?? 0) === 0x52 &&
      (bytes[1] ?? 0) === 0x49 &&
      (bytes[2] ?? 0) === 0x46 &&
      (bytes[3] ?? 0) === 0x46;
    // FLAC (fLaC)
    const isFlac =
      (bytes[0] ?? 0) === 0x66 &&
      (bytes[1] ?? 0) === 0x4c &&
      (bytes[2] ?? 0) === 0x61 &&
      (bytes[3] ?? 0) === 0x43;
    // Ogg (OggS)
    const isOgg =
      (bytes[0] ?? 0) === 0x4f &&
      (bytes[1] ?? 0) === 0x67 &&
      (bytes[2] ?? 0) === 0x67 &&
      (bytes[3] ?? 0) === 0x53;
    // MP4/M4A (ftyp at offset 4)
    const isMp4 =
      (bytes[4] ?? 0) === 0x66 &&
      (bytes[5] ?? 0) === 0x74 &&
      (bytes[6] ?? 0) === 0x79 &&
      (bytes[7] ?? 0) === 0x70;

    // If file has a supported extension or matching magic bytes, consider valid
    if (isId3 || isMp3Sync || isRiff || isFlac || isOgg || isMp4 || hasAudioExt) {
      return { valid: true };
    }

    return {
      valid: false,
      error: `Corrupted or unreadable audio format in "${file.name}".`,
    };
  } catch (err) {
    return {
      valid: false,
      error: `Unable to read audio file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function sliceToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') {
    return await blob.arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * Computes a stable content hash for the track.
 * Formula: SHA-1 of (file size + first 1 MB + last 1 MB).
 */
export async function computeTrackId(file: File): Promise<string> {
  const ONE_MB = 1024 * 1024;
  const size = file.size;

  const firstSlice = await sliceToArrayBuffer(file.slice(0, Math.min(size, ONE_MB)));
  const lastSliceStart = Math.max(0, size - ONE_MB);
  const lastSlice = await sliceToArrayBuffer(file.slice(lastSliceStart, size));

  const sizePrefix = new TextEncoder().encode(
    `size:${size}|first:${firstSlice.byteLength}|last:${lastSlice.byteLength}|`
  );

  const totalBytes = sizePrefix.byteLength + firstSlice.byteLength + lastSlice.byteLength;
  const combined = new Uint8Array(totalBytes);
  combined.set(sizePrefix, 0);
  combined.set(new Uint8Array(firstSlice), sizePrefix.byteLength);
  combined.set(new Uint8Array(lastSlice), sizePrefix.byteLength + firstSlice.byteLength);

  const hashBuffer = await crypto.subtle.digest('SHA-1', combined);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Lightweight ID3v2 tag parser with fallback to filename.
 */
export async function parseAudioMetadata(file: File): Promise<AudioMetadata> {
  let title = file.name;
  let artist: string | undefined;

  // Remove extension for clean default title
  if (title.includes('.')) {
    title = title.slice(0, title.lastIndexOf('.'));
  }

  // Parse "Artist - Title" format from filename if common pattern
  if (title.includes(' - ')) {
    const parts = title.split(' - ');
    const firstPart = parts[0];
    if (parts.length >= 2 && firstPart) {
      artist = firstPart.trim();
      title = parts.slice(1).join(' - ').trim();
    }
  }

  // Attempt ID3v2 header extraction
  try {
    const headerBuffer = await sliceToArrayBuffer(file.slice(0, 10));
    const header = new Uint8Array(headerBuffer);

    if ((header[0] ?? 0) === 0x49 && (header[1] ?? 0) === 0x44 && (header[2] ?? 0) === 0x33) {
      // ID3v2 found. Calculate tag size using syncsafe integer (bytes 6-9)
      const tagSize =
        (((header[6] ?? 0) & 0x7f) << 21) |
        (((header[7] ?? 0) & 0x7f) << 14) |
        (((header[8] ?? 0) & 0x7f) << 7) |
        ((header[9] ?? 0) & 0x7f);

      // Read tag body (capped at 128KB to keep parsing lightweight)
      const readLength = Math.min(tagSize, 128 * 1024);
      const tagBuffer = await sliceToArrayBuffer(file.slice(10, 10 + readLength));
      const tagData = new Uint8Array(tagBuffer);

      let offset = 0;
      while (offset + 10 < tagData.length) {
        // Frame ID (4 ASCII characters)
        const frameId = String.fromCharCode(
          tagData[offset] ?? 0,
          tagData[offset + 1] ?? 0,
          tagData[offset + 2] ?? 0,
          tagData[offset + 3] ?? 0
        );

        if (!/^[A-Z0-9]{4}$/.test(frameId)) break;

        // Frame size (4 bytes)
        const frameSize =
          ((tagData[offset + 4] ?? 0) << 24) |
          ((tagData[offset + 5] ?? 0) << 16) |
          ((tagData[offset + 6] ?? 0) << 8) |
          (tagData[offset + 7] ?? 0);

        if (frameSize <= 0 || offset + 10 + frameSize > tagData.length) break;

        const frameContent = tagData.slice(offset + 10, offset + 10 + frameSize);

        // Decode text frames (TIT2 = Title, TPE1 = Artist)
        if (frameId === 'TIT2' || frameId === 'TPE1') {
          const encoding = frameContent[0] ?? 0;
          const textBytes = frameContent.slice(1);
          let decodedText = '';

          if (encoding === 0 || encoding === 3) {
            // ISO-8859-1 or UTF-8
            decodedText = new TextDecoder('utf-8').decode(textBytes);
          } else if (encoding === 1 || encoding === 2) {
            // UTF-16
            decodedText = new TextDecoder('utf-16').decode(textBytes);
          }

          // Strip null terminators
          decodedText = decodedText.replace(/\0/g, '').trim();

          if (decodedText) {
            if (frameId === 'TIT2') title = decodedText;
            if (frameId === 'TPE1') artist = decodedText;
          }
        }

        offset += 10 + frameSize;
      }
    }
  } catch {
    // Graceful fallback to filename on tag parse error
  }

  return { title, artist };
}

/**
 * Import a single audio file, handling hashing, metadata, OPFS/handle storage, and deduplication.
 */
export async function importAudioFile(
  file: File,
  handle?: FileSystemFileHandle,
  forceFallback = false
): Promise<{ track?: Track; isDuplicate?: boolean; error?: string }> {
  const validation = await validateAudioFile(file);
  if (!validation.valid) {
    return { error: validation.error };
  }

  const id = await computeTrackId(file);

  // Check deduplication in database
  const existing = await db.getTrack(id);
  if (existing) {
    return { track: existing, isDuplicate: true };
  }

  const metadata = await parseAudioMetadata(file);

  let source: TrackSource;
  if (!forceFallback && handle && isFileSystemAccessSupported()) {
    source = { kind: 'fileHandle', handle };
  } else {
    // Fallback: Store file in OPFS
    try {
      const opfsPath = await saveToOpfs(id, file);
      source = { kind: 'opfs', path: opfsPath };
    } catch (err) {
      return {
        error: `Failed to persist file in OPFS: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  const track: Track = {
    id,
    title: metadata.title,
    artist: metadata.artist,
    fileName: file.name,
    sizeBytes: file.size,
    source,
  };

  await db.saveTrack(track);
  return { track, isDuplicate: false };
}

/**
 * Batch import audio files with yield to keep UI responsive on large batches (50+ tracks).
 */
export async function importAudioFiles(
  items: PickedFileWithHandle[],
  forceFallback = false,
  onProgress?: (processed: number, total: number) => void
): Promise<ImportResult> {
  const result: ImportResult = {
    imported: [],
    duplicates: [],
    failed: [],
  };

  const total = items.length;

  for (let i = 0; i < total; i++) {
    const item = items[i];
    if (!item) continue;
    const { file, handle } = item;

    try {
      const importRes = await importAudioFile(file, handle, forceFallback);
      if (importRes.error) {
        result.failed.push({ fileName: file.name, reason: importRes.error });
      } else if (importRes.track) {
        if (importRes.isDuplicate) {
          result.duplicates.push(importRes.track);
        } else {
          result.imported.push(importRes.track);
        }
      }
    } catch (err) {
      result.failed.push({
        fileName: file.name,
        reason: err instanceof Error ? err.message : String(err),
      });
    }

    if (onProgress) {
      onProgress(i + 1, total);
    }

    // Yield to the browser event loop every 5 files to avoid freezing UI
    if (i % 5 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return result;
}
