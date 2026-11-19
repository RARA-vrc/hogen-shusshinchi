// Play logging. Sinks: a no-op sink, a development sink that writes to
// localStorage, and an HTTP sink that posts to the endpoint set in
// site.config.json (logEndpoint). With an empty endpoint the published site
// sends nothing.
//
// A record holds only: question ids, chosen answers, the final estimate, the
// correct area chosen by the player, an optional short comment typed by the
// player, and the date (rounded to the day). The app adds no device
// information; nothing is recorded without consent.

export interface PlayRecord {
  questions: string[]; // question ids, in the order asked
  answers: string[]; // chosen option id for each question
  estimate: { level: string; id: string }; // e.g. { level: 'pref', id: '27' }
  // Cell id, or 'abroad' / 'multiple' / '' (not given).
  correct: string;
  comment: string; // optional free text from the player, '' if none
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
export const COMMENT_LIMIT = 300;

// Trims a comment, collapses control characters to spaces and cuts it to the
// length limit.
export function cleanComment(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out += code < 32 || code === 127 ? ' ' : text.charAt(i);
  }
  out = out.trim();
  if (out.length > COMMENT_LIMIT) out = out.slice(0, COMMENT_LIMIT);
  return out;
}

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

export interface PostRequest {
  method: string;
  mode: string;
  keepalive: boolean;
  headers: Record<string, string>;
  body: string;
}

export type PostFunction = (url: string, init: PostRequest) => unknown;

// Posts each record as JSON to one endpoint (a Google Apps Script web app,
// see gas/README.md). The body is sent as text/plain so the browser makes a
// simple request without a CORS preflight, which Apps Script cannot answer.
// The response is not read; failures are ignored so play is never blocked.
export class HttpSink implements LogSink {
  url: string;
  post: PostFunction;

  constructor(url: string, post: PostFunction) {
    this.url = url;
    this.post = post;
  }

  record(entry: PlayRecord): void {
    try {
      const result = this.post(this.url, {
        method: 'POST',
        mode: 'no-cors',
        keepalive: true,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(entry),
      });
      if (result instanceof Promise) result.catch(() => undefined);
    } catch {
      // offline or blocked: drop the record
    }
  }
}

// Only https endpoints are accepted; anything else means "do not send".
export function isUsableEndpoint(url: string): boolean {
  return url.startsWith('https://') && url.length > 'https://'.length;
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
