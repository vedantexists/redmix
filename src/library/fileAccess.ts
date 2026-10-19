import type { TrackSource } from '@/shared/types';

/**
 * File access abstraction:
 * Supports Chromium File System Access API (showOpenFilePicker)
 * and fallback to <input type="file"> with Origin Private File System (OPFS) storage.
 */

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showOpenFilePicker' in window;
}

export function isOpfsSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'storage' in navigator &&
    typeof navigator.storage.getDirectory === 'function'
  );
}

export interface PickedFileWithHandle {
  file: File;
  handle?: FileSystemFileHandle;
}

/**
 * Open file picker using File System Access API.
 * Returns array of File with attached FileSystemFileHandle.
 */
export async function pickAudioFilesWithHandles(): Promise<PickedFileWithHandle[]> {
  if (!isFileSystemAccessSupported()) {
    throw new Error('File System Access API is not supported in this browser.');
  }

  const pickerOpts = {
    multiple: true,
    types: [
      {
        description: 'Audio Files',
        accept: {
          'audio/*': ['.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg'],
        },
      },
    ],
  };

  const handles = await (window as unknown as {
    showOpenFilePicker: (opts: typeof pickerOpts) => Promise<FileSystemFileHandle[]>;
  }).showOpenFilePicker(pickerOpts);

  const results: PickedFileWithHandle[] = [];
  for (const handle of handles) {
    const file = await handle.getFile();
    results.push({ file, handle });
  }

  return results;
}

const inMemoryBlobCache = new Map<string, Blob>();

/**
 * Save file to Origin Private File System (OPFS).
 * Returns the relative path in OPFS.
 */
export async function saveToOpfs(trackId: string, file: File): Promise<string> {
  const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '.audio';
  const path = `tracks/${trackId}${ext}`;

  if (!isOpfsSupported()) {
    inMemoryBlobCache.set(path, file);
    return path;
  }

  try {
    const root = await navigator.storage.getDirectory();
    // Ensure tracks directory exists
    let tracksDir: FileSystemDirectoryHandle;
    try {
      tracksDir = await root.getDirectoryHandle('tracks', { create: true });
    } catch {
      tracksDir = root;
    }

    const filename = `${trackId}${ext}`;
    const fileHandle = await tracksDir.getFileHandle(filename, { create: true });
    const writable = await (fileHandle as unknown as {
      createWritable: () => Promise<FileSystemWritableFileStream>;
    }).createWritable();

    await file.stream().pipeTo(writable);
    return path;
  } catch (err) {
    if (err instanceof Error && err.name === 'QuotaExceededError') {
      throw new Error('Storage quota exceeded. Please free up space on your device.');
    }
    // Fall back to memory if OPFS writes fail
    inMemoryBlobCache.set(path, file);
    return path;
  }
}

/**
 * Retrieve File from TrackSource (either FileSystemFileHandle or OPFS).
 */
export async function getFileFromSource(source: TrackSource): Promise<File | Blob> {
  if (source.kind === 'fileHandle') {
    return await source.handle.getFile();
  }

  if (source.kind === 'opfs') {
    if (inMemoryBlobCache.has(source.path)) {
      return inMemoryBlobCache.get(source.path)!;
    }

    if (!isOpfsSupported()) {
      throw new Error('OPFS is not supported in this browser.');
    }
    const root = await navigator.storage.getDirectory();
    const parts = source.path.split('/');
    const filename = parts[1];
    if (parts.length > 1 && parts[0] === 'tracks' && filename) {
      const tracksDir = await root.getDirectoryHandle('tracks', { create: false });
      const fileHandle = await tracksDir.getFileHandle(filename, { create: false });
      return await fileHandle.getFile();
    }
    const fileHandle = await root.getFileHandle(source.path, { create: false });
    return await fileHandle.getFile();
  }

  throw new Error(`Unsupported track source: ${(source as { kind: string }).kind}`);
}
