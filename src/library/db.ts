// IndexedDB storage stub
import type { Track, Playlist } from '@/shared/types';

export interface StorageAdapter {
  getTracks(): Promise<Track[]>;
  saveTrack(track: Track): Promise<void>;
  getPlaylists(): Promise<Playlist[]>;
  savePlaylist(playlist: Playlist): Promise<void>;
}
