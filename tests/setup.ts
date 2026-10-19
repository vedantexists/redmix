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

// Lightweight Web Audio API polyfill for jsdom unit testing
if (typeof globalThis.AudioContext === 'undefined') {
  class MockAudioParam {
    public value: number;
    public scheduledEvents: { type: string; value: number; time: number }[] = [];

    constructor(initialValue = 1.0) {
      this.value = initialValue;
    }

    cancelScheduledValues(time: number) {
      this.scheduledEvents = this.scheduledEvents.filter((e) => e.time < time);
    }

    setValueAtTime(value: number, time: number) {
      this.value = value;
      this.scheduledEvents.push({ type: 'set', value, time });
    }

    linearRampToValueAtTime(value: number, time: number) {
      this.value = value;
      this.scheduledEvents.push({ type: 'linear', value, time });
    }

    exponentialRampToValueAtTime(value: number, time: number) {
      this.value = value;
      this.scheduledEvents.push({ type: 'exponential', value, time });
    }
  }

  class MockAudioNode {
    public connections: MockAudioNode[] = [];

    connect(destination: MockAudioNode) {
      this.connections.push(destination);
      return destination;
    }

    disconnect() {
      this.connections = [];
    }
  }

  class MockGainNode extends MockAudioNode {
    public gain = new MockAudioParam(1.0);
  }

  class MockBiquadFilterNode extends MockAudioNode {
    public type = 'lowpass';
    public frequency = new MockAudioParam(350);
    public Q = new MockAudioParam(1);
    public gain = new MockAudioParam(0);
  }

  class MockAudioBufferSourceNode extends MockAudioNode {
    public buffer: MockAudioBuffer | null = null;
    public playbackRate = new MockAudioParam(1.0);
    public onended: (() => void) | null = null;
    public started = false;
    public stopped = false;

    start(_when?: number, _offset?: number) {
      this.started = true;
    }

    stop(_when?: number) {
      this.stopped = true;
      this.onended?.();
    }
  }

  class MockAudioBuffer {
    public numberOfChannels: number;
    public length: number;
    public sampleRate: number;
    public duration: number;
    private channels: Float32Array[];

    constructor(options: { numberOfChannels: number; length: number; sampleRate: number }) {
      this.numberOfChannels = options.numberOfChannels;
      this.length = options.length;
      this.sampleRate = options.sampleRate;
      this.duration = options.length / options.sampleRate;
      this.channels = Array.from(
        { length: this.numberOfChannels },
        () => new Float32Array(this.length)
      );
    }

    getChannelData(channel: number) {
      return this.channels[channel] || new Float32Array(this.length);
    }
  }

  class MockAudioContext {
    public state: AudioContextState = 'running';
    public sampleRate = 44100;
    public currentTime = 0;
    public destination = new MockAudioNode();

    createGain() {
      return new MockGainNode();
    }

    createBiquadFilter() {
      return new MockBiquadFilterNode();
    }

    createBufferSource() {
      return new MockAudioBufferSourceNode();
    }

    createBuffer(numberOfChannels: number, length: number, sampleRate: number) {
      return new MockAudioBuffer({ numberOfChannels, length, sampleRate });
    }

    async resume() {
      this.state = 'running';
    }

    async suspend() {
      this.state = 'suspended';
    }

    async decodeAudioData(arrayBuffer: ArrayBuffer) {
      return new MockAudioBuffer({
        numberOfChannels: 2,
        length: Math.max(1024, arrayBuffer.byteLength),
        sampleRate: 44100,
      });
    }
  }

  globalThis.AudioContext = MockAudioContext as unknown as typeof AudioContext;
  (globalThis as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext =
    MockAudioContext as unknown as typeof AudioContext;

  class MockOfflineAudioContext extends MockAudioContext {
    public length: number;
    constructor(_numberOfChannels: number, length: number, sampleRate: number) {
      super();
      this.length = length;
      this.sampleRate = sampleRate;
    }

    async startRendering(): Promise<MockAudioBuffer> {
      return new MockAudioBuffer({
        numberOfChannels: 1,
        length: this.length,
        sampleRate: this.sampleRate,
      });
    }
  }

  globalThis.OfflineAudioContext = MockOfflineAudioContext as unknown as typeof OfflineAudioContext;
}

