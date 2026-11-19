// Play logging. Nothing is sent anywhere in this version: the only
// implementations are a no-op sink and a development sink that writes to
// localStorage. A network sink (e.g. Cloudflare Workers) can be added later
// by implementing LogSink.
//
// A record holds only: question ids, chosen answers, the final estimate, the
// correct area chosen by the player, and the date (rounded to the day).
// No IP address, device information or free text is handled.

export interface PlayRecord {
  questions: string[]; // question ids, in the order asked
  answers: string[]; // chosen option id for each question
  estimate: { level: string; id: string }; // e.g. { level: 'pref', id: '27' }
  // Cell id, or 'abroad' / 'multiple' / '' (not given).
  correct: string;
  day: string; // YYYY-MM-DD
}

export interface LogSink {
  record(entry: PlayRecord): void;
}

export class NoopSink implements LogSink {
  record(_entry: PlayRecord): void {
    // intentionally empty
  }
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const LOCAL_LOG_KEY = 'hogen-play-log';
export const LOCAL_LOG_LIMIT = 200;

// Development only: keeps the latest records in localStorage.
export class LocalSink implements LogSink {
  store: KeyValueStore;

  constructor(store: KeyValueStore) {
    this.store = store;
  }

  record(entry: PlayRecord): void {
    let list: PlayRecord[] = [];
    try {
      const raw = this.store.getItem(LOCAL_LOG_KEY);
      if (raw !== null) list = JSON.parse(raw) as PlayRecord[];
      if (!Array.isArray(list)) list = [];
    } catch {
      list = [];
    }
    list.push(entry);
    if (list.length > LOCAL_LOG_LIMIT) list = list.slice(list.length - LOCAL_LOG_LIMIT);
    try {
      this.store.setItem(LOCAL_LOG_KEY, JSON.stringify(list));
    } catch {
      // storage full or unavailable: drop the record
    }
  }
}

// Rounds a timestamp to the day (UTC), so no time of day is kept.
export function dayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// The single gate for logging: without consent nothing reaches the sink.
export function recordIfConsented(sink: LogSink, consent: boolean, entry: PlayRecord): boolean {
  if (!consent) return false;
  sink.record(entry);
  return true;
}
