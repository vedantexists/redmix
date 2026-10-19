// File access abstraction (FileSystemFileHandle vs OPFS fallback) stub
export type FileAccessMode = 'fileHandle' | 'opfs';

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showOpenFilePicker' in window;
}
