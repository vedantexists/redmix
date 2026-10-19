import '@testing-library/jest-dom';

// Polyfill Blob.prototype.arrayBuffer for jsdom if needed
if (typeof Blob !== 'undefined' && !Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function (this: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

// Lightweight in-memory IndexedDB polyfill for jsdom unit testing
if (typeof globalThis.indexedDB === 'undefined') {
  class MockIDBRequest {
    public result: unknown = undefined;
    public error: Error | null = null;
    public onsuccess: (() => void) | null = null;
    public onerror: (() => void) | null = null;
    public onupgradeneeded: (() => void) | null = null;
  }

  class MockIDBObjectStore {
    constructor(private storeMap: Map<string, unknown>, public keyPath: string) {}

    put(value: Record<string, unknown>) {
      const key = String(value[this.keyPath]);
      this.storeMap.set(key, value);
      const req = new MockIDBRequest();
      setTimeout(() => {
        req.result = key;
        req.onsuccess?.();
      }, 0);
      return req;
    }

    get(key: string) {
      const req = new MockIDBRequest();
      setTimeout(() => {
        req.result = this.storeMap.get(key);
        req.onsuccess?.();
      }, 0);
      return req;
    }

    getAll() {
      const req = new MockIDBRequest();
      setTimeout(() => {
        req.result = Array.from(this.storeMap.values());
        req.onsuccess?.();
      }, 0);
      return req;
    }

    delete(key: string) {
      this.storeMap.delete(key);
      const req = new MockIDBRequest();
      setTimeout(() => {
        req.result = undefined;
        req.onsuccess?.();
      }, 0);
      return req;
    }

    clear() {
      this.storeMap.clear();
      const req = new MockIDBRequest();
      setTimeout(() => {
        req.result = undefined;
        req.onsuccess?.();
      }, 0);
      return req;
    }
  }

  class MockIDBTransaction {
    public oncomplete: (() => void) | null = null;
    public onerror: (() => void) | null = null;

    constructor(private db: MockIDBDatabase, public storeNames: string[]) {
      setTimeout(() => {
        this.oncomplete?.();
      }, 1);
    }

    objectStore(name: string) {
      return this.db.getObjectStore(name);
    }
  }

  class MockIDBDatabase {
    public objectStoreNames = {
      contains: (name: string) => this.stores.has(name),
    };
    private stores = new Map<string, MockIDBObjectStore>();
    private storeMaps = new Map<string, Map<string, unknown>>();

    createObjectStore(name: string, options: { keyPath: string }) {
      const storeMap = new Map<string, unknown>();
      this.storeMaps.set(name, storeMap);
      const store = new MockIDBObjectStore(storeMap, options.keyPath);
      this.stores.set(name, store);
      return store;
    }

    getObjectStore(name: string) {
      let store = this.stores.get(name);
      if (!store) {
        let storeMap = this.storeMaps.get(name);
        if (!storeMap) {
          storeMap = new Map();
          this.storeMaps.set(name, storeMap);
        }
        store = new MockIDBObjectStore(storeMap, 'id');
        this.stores.set(name, store);
      }
      return store;
    }

    transaction(storeNames: string | string[]) {
      const names = Array.isArray(storeNames) ? storeNames : [storeNames];
      return new MockIDBTransaction(this, names);
    }
  }

  const mockDbInstance = new MockIDBDatabase();

  globalThis.indexedDB = {
    open: () => {
      const req = new MockIDBRequest();
      req.result = mockDbInstance;
      setTimeout(() => {
        req.onupgradeneeded?.();
        req.onsuccess?.();
      }, 0);
      return req as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;
}
