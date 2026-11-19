import site from '../site.config.json';
import credits from './generated/credits.json';
import './style.css';

// Phase 0 placeholder. The real screens (start, question, result, answer,
// credits) are built in phase 4.
const app = document.getElementById('app');
if (app !== null) {
  const h1 = document.createElement('h1');
  h1.textContent = site.title;
  app.appendChild(h1);

  const p = document.createElement('p');
  p.textContent = '準備中です。';
  app.appendChild(p);

  const h2 = document.createElement('h2');
  h2.textContent = 'クレジット';
  app.appendChild(h2);

  const list = document.createElement('ul');
  for (let i = 0; i < credits.entries.length; i++) {
    const e = credits.entries[i];
    const li = document.createElement('li');
    li.textContent = `${e.name}:${e.license}(${e.credit})`;
    list.appendChild(li);
  }
  app.appendChild(list);
}
