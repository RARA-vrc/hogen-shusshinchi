import site from '../site.config.json';
import { loadAppData } from './app/data.ts';
import { HttpSink, LocalSink, NoopSink, isUsableEndpoint, type LogSink, type PostRequest } from './log/sink.ts';
import './style.css';
import { startApp } from './ui/app.ts';

async function main(): Promise<void> {
  const root = document.getElementById('app');
  if (root === null) return;
  root.textContent = '読み込み中…';
  try {
    const data = await loadAppData();
    // Development: plays (with consent) stay in localStorage for inspection.
    // Published site: sent to site.config.json's logEndpoint when one is set,
    // otherwise nothing is recorded.
    const sending = !import.meta.env.DEV && isUsableEndpoint(site.logEndpoint);
    let sink: LogSink;
    if (import.meta.env.DEV) sink = new LocalSink(window.localStorage);
    else if (sending) {
      sink = new HttpSink(site.logEndpoint, (url: string, init: PostRequest) => fetch(url, init as RequestInit));
    } else sink = new NoopSink();
    const mode = import.meta.env.DEV ? 'local' : sending ? 'send' : 'none';
    startApp(root, data, sink, mode);
  } catch (err) {
    root.textContent = 'データの読み込みに失敗しました。ページを再読み込みしてください。';
    console.error(err);
  }
}

void main();
