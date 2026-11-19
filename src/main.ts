import { loadAppData } from './app/data.ts';
import { LocalSink, NoopSink, type LogSink } from './log/sink.ts';
import './style.css';
import { startApp } from './ui/app.ts';

async function main(): Promise<void> {
  const root = document.getElementById('app');
  if (root === null) return;
  root.textContent = '読み込み中…';
  try {
    const data = await loadAppData();
    // Nothing is sent anywhere. In development, plays (with consent) are kept
    // in localStorage for inspection; the published site records nothing.
    const sink: LogSink = import.meta.env.DEV ? new LocalSink(window.localStorage) : new NoopSink();
    startApp(root, data, sink);
  } catch (err) {
    root.textContent = 'データの読み込みに失敗しました。ページを再読み込みしてください。';
    console.error(err);
  }
}

void main();
