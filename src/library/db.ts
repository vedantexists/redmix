import type { Playlist, Track } from '@/shared/types';

const DB_NAME = 'automix-db';
const DB_VERSION = 1;
const TRACKS_STORE = 'tracks';
const PLAYLISTS_STORE = 'playlists';

export class AutoMixDB {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private getDB(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
          reject(new Error('IndexedDB is not available in this environment.'));
          return;
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(TRACKS_STORE)) {
            db.createObjectStore(TRACKS_STORE, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(PLAYLISTS_STORE)) {
            db.createObjectStore(PLAYLISTS_STORE, { keyPath: 'id' });
          }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    return this.dbPromise;
  }

  public async getTracks(): Promise<Track[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TRACKS_STORE, 'readonly');
      const store = tx.objectStore(TRACKS_STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result as Track[]);
      req.onerror = () => reject(req.error);
    });
  }

  public async getTrack(id: string): Promise<Track | undefined> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TRACKS_STORE, 'readonly');
      const store = tx.objectStore(TRACKS_STORE);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result as Track | undefined);
      req.onerror = () => reject(req.error);
    });
  }

  public async saveTrack(track: Track): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TRACKS_STORE, 'readwrite');
      const store = tx.objectStore(TRACKS_STORE);
      const req = store.put(track);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  public async saveTracks(tracks: Track[]): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TRACKS_STORE, 'readwrite');
      const store = tx.objectStore(TRACKS_STORE);
      for (const track of tracks) {
        store.put(track);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  public async deleteTrack(id: string): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TRACKS_STORE, 'readwrite');
      const store = tx.objectStore(TRACKS_STORE);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  public async getPlaylists(): Promise<Playlist[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PLAYLISTS_STORE, 'readonly');
      const store = tx.objectStore(PLAYLISTS_STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result as Playlist[]);
      req.onerror = () => reject(req.error);
    });
  }

  public async savePlaylist(playlist: Playlist): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PLAYLISTS_STORE, 'readwrite');
      const store = tx.objectStore(PLAYLISTS_STORE);
      const req = store.put(playlist);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  public async deletePlaylist(id: string): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PLAYLISTS_STORE, 'readwrite');
      const store = tx.objectStore(PLAYLISTS_STORE);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  public async clearAll(): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([TRACKS_STORE, PLAYLISTS_STORE], 'readwrite');
      tx.objectStore(TRACKS_STORE).clear();
      tx.objectStore(PLAYLISTS_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

export const db = new AutoMixDB();
