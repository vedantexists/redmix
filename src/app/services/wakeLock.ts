/**
 * Screen Wake Lock API manager.
 * Prevents mobile devices from sleeping or locking the screen during active playback.
 */
class WakeLockManager {
  private sentinel: WakeLockSentinel | null = null;
  private isActive = false;

  constructor() {
    this.setupVisibilityListener();
  }

  private setupVisibilityListener(): void {
    if (typeof document === 'undefined') return;

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.isActive && !this.sentinel) {
        void this.acquireLock();
      }
    });
  }

  public async acquireLock(): Promise<boolean> {
    this.isActive = true;

    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
      return false;
    }

    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      this.sentinel.addEventListener('release', () => {
        this.sentinel = null;
      });
      return true;
    } catch {
      // Gracefully handle permission denials or battery-saver restrictions
      this.sentinel = null;
      return false;
    }
  }

  public releaseLock(): void {
    this.isActive = false;

    if (this.sentinel) {
      try {
        void this.sentinel.release();
      } catch {
        // Ignore release errors
      }
      this.sentinel = null;
    }
  }

  public get isLocked(): boolean {
    return this.sentinel !== null && !this.sentinel.released;
  }

  public get isRequested(): boolean {
    return this.isActive;
  }
}

export const wakeLockManager = new WakeLockManager();
