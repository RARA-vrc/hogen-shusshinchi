// Screens: start (with consent) -> question -> result -> answer -> end,
// plus credits. The whole view is re-rendered on every state change; the map
// element is created once and moved between screens.

import type { AppData } from '../app/data.ts';
import {
  answerCurrent,
  answeredCount,
  buildGuesses,
  createGame,
  goBack,
  isFinished,
  leadingRegion,
  type Game,
  type Guess,
} from '../app/game.ts';
import { HOST_CONFIG, chooseVoice, hostLine } from '../app/host.ts';
import { insidePref } from '../app/text.ts';
import { defaultConfig } from '../engine/config.ts';
import { LEVEL_CELL, LEVEL_PREF, topK } from '../engine/engine.ts';
import { COMMENT_LIMIT, cleanComment, dayOf, recordIfConsented, type LogSink } from '../log/sink.ts';
import { clear, h, percent, type Child } from './dom.ts';
import { hostFace, type Expression } from './face.ts';
import { createHeatMap, type HeatMap } from './map.ts';
import { isSoundEnabled, loadSoundSetting, playSound, setSoundEnabled } from './sound.ts';

const ABROAD = 'abroad';
const MULTIPLE = 'multiple';

// Where consented records go: 'send' = the configured endpoint, 'local' =
// this browser only (development), 'none' = nowhere.
export type LogMode = 'send' | 'local' | 'none';

interface State {
  screen: 'start' | 'question' | 'result' | 'answer' | 'end' | 'credits';
  back: 'start' | 'end'; // where the credits screen returns to
  consent: boolean;
  game: Game;
  guesses: Guess[];
  guessIndex: number;
  hit: boolean;
  correct: string; // cell id, ABROAD, MULTIPLE or ''
  answerPref: string; // selected value on the answer screen
  answerCell: string;
  comment: string; // optional free text typed on the answer screen
}

export function startApp(root: HTMLElement, data: AppData, sink: LogSink, logMode: LogMode): void {
  const config = defaultConfig();
  const map: HeatMap = createHeatMap(data.topology, data.modelJson.cellIds, '推定の途中経過を示す日本地図');
  const state: State = {
    screen: 'start',
    back: 'start',
    consent: false,
    game: createGame(data.model, config),
    guesses: [],
    guessIndex: 0,
    hit: false,
    correct: '',
    answerPref: '',
    answerCell: '',
    comment: '',
  };

  // ---------------------------------------------------------------- helpers

  function voice(): string {
    const lead = leadingRegion(state.game);
    return chooseVoice(
      data.modelJson.regionIds[lead.region],
      lead.prob,
      HOST_CONFIG.dialectThreshold,
      data.host,
    );
  }

  function say(key: string, vars: Record<string, string>, forceStandard: boolean): string {
    const v = forceStandard ? 'standard' : voice();
    return hostLine(data.host, v, key, answeredCount(state.game), vars);
  }

  function hostBubble(text: string, expression: Expression): HTMLElement {
    return h(
      'div',
      { class: 'host' },
      h('div', { class: 'host-face', 'aria-hidden': 'true' }, hostFace(expression) as unknown as Node),
      h('p', { class: 'host-line' }, text),
    );
  }

  function guessName(g: Guess): string {
    if (g.level === LEVEL_CELL) return `${data.prefNames[g.pref]} ${data.cellLabels[g.cell]}`;
    if (g.level === LEVEL_PREF) return data.prefNames[g.pref];
    return `${data.regionNames[g.region]}地方`;
  }

  function guessCells(g: Guess): number[] {
    const out: number[] = [];
    const m = data.model;
    for (let c = 0; c < m.cellCount; c++) {
      if (g.level === LEVEL_CELL) {
        if (c === g.cell) out.push(c);
      } else if (g.level === LEVEL_PREF) {
        if (m.cellPref[c] === g.pref) out.push(c);
      } else if (m.cellRegion[c] === g.region) out.push(c);
    }
    return out;
  }

  function showMap(highlight: number[]): HTMLElement {
    map.update(state.game.engine.post);
    map.highlight(highlight);
    return h('div', { class: 'map-box' }, map.element as unknown as Node);
  }

  // Brief press feedback before moving on: the chosen button is marked and
  // the others are disabled, so the choice is visible for a moment.
  function pick(button: HTMLElement, then: () => void): void {
    playSound('select');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const all = root.querySelectorAll('button');
    for (let i = 0; i < all.length; i++) (all[i] as HTMLButtonElement).disabled = true;
    button.classList.add('picked');
    window.setTimeout(then, reduce ? 0 : 220);
  }

  // Top three of a probability list as labelled bars.
  function ranking(title: string, probs: Float32Array, names: string[], suffix: string): HTMLElement {
    const top = new Int32Array(3);
    const n = topK(probs, probs.length, 3, top);
    const rows: Child[] = [];
    for (let i = 0; i < n; i++) {
      const p = probs[top[i]];
      const bar = h('span', { class: 'rank-bar' });
      bar.style.width = `${Math.max(2, Math.round(p * 100))}%`;
      rows.push(
        h(
          'li',
          { class: 'rank-row' },
          h('span', { class: 'rank-name' }, `${names[top[i]]}${suffix}`),
          h('span', { class: 'rank-track' }, bar),
          h('span', { class: 'rank-value' }, percent(p)),
        ),
      );
    }
    return h('div', { class: 'rank' }, h('h4', null, title), h('ol', null, ...rows));
  }

  function soundToggle(): HTMLElement {
    const on = isSoundEnabled();
    return h(
      'button',
      {
        class: 'sound-toggle',
        type: 'button',
        'aria-pressed': on ? 'true' : 'false',
        onclick: () => {
          setSoundEnabled(!on);
          playSound('select');
          render();
        },
      },
      on ? '音:オン' : '音:オフ',
    );
  }

  function finishToResult(): void {
    state.guesses = buildGuesses(state.game);
    state.guessIndex = 0;
    state.screen = 'result';
  }

  function writeLog(): void {
    const e = state.game.engine;
    const questions: string[] = [];
    const answers: string[] = [];
    for (let i = 0; i < e.histLen; i++) {
      const q = data.questions[e.histQ[i]];
      questions.push(q.id);
      answers.push(q.options[e.histA[i]].id);
    }
    const first = state.guesses[0];
    let estimate = { level: 'region', id: '' };
    if (first !== undefined) {
      if (first.level === LEVEL_CELL) estimate = { level: 'cell', id: data.modelJson.cellIds[first.cell] };
      else if (first.level === LEVEL_PREF) estimate = { level: 'pref', id: data.modelJson.prefCodes[first.pref] };
      else estimate = { level: 'region', id: data.modelJson.regionIds[first.region] };
    }
    recordIfConsented(sink, state.consent, {
      questions,
      answers,
      estimate,
      correct: state.correct,
      comment: cleanComment(state.comment),
      day: dayOf(new Date()),
    });
  }

  function restart(): void {
    state.game = createGame(data.model, config);
    state.guesses = [];
    state.guessIndex = 0;
    state.hit = false;
    state.correct = '';
    state.answerPref = '';
    state.answerCell = '';
    state.comment = '';
    state.screen = isFinished(state.game) ? 'result' : 'question';
    if (state.screen === 'result') finishToResult();
    render();
  }

  // ---------------------------------------------------------------- screens

  function startScreen(): Child[] {
    const check = h('input', { type: 'checkbox', id: 'consent' });
    check.checked = state.consent;
    check.addEventListener('change', () => {
      state.consent = check.checked;
    });
    return [
      h('h1', { class: 'title' }, data.title),
      hostBubble(hostLine(data.host, 'standard', 'start', 0, {}), 'happy'),
      h(
        'ul',
        { class: 'notes' },
        h('li', null, 'ここでいう「出身地」は、小・中学生のころを過ごした地域のことです。'),
        h('li', null, '質問は最大 25 問。途中で前の質問に戻れます。'),
        h(
          'li',
          null,
          'これは試作版の遊びです。地域ごとの答えの傾向は作成者の見積もりで、まだ監修を受けていません。当たらなくても、あなたの話し方が変だという意味ではありません。',
        ),
      ),
      h(
        'div',
        { class: 'consent' },
        h('h2', null, '回答の利用について'),
        h(
          'p',
          null,
          '質問への回答、推定結果、最後に選んでもらう正解の地域、任意で書いてもらうコメント、日付(日単位)を、質問の改良に使います。氏名・IPアドレス・端末の情報は保存しません。',
        ),
        h(
          'p',
          null,
          logMode === 'send'
            ? '同意した場合、これらは Google のサービス(Google Apps Script)を通じて、作者が管理する表に送信・保存されます。コメントには、個人が特定できることを書かないでください。'
            : logMode === 'local'
              ? '(開発モード)同意した場合、このブラウザの中にだけ保存します。どこにも送信しません。'
              : '現在のバージョンでは、回答をどこにも送信していません。',
        ),
        h('label', { class: 'consent-check', for: 'consent' }, check, ' 上記の利用に同意する(任意。同意しなくても遊べます)'),
      ),
      h(
        'button',
        {
          class: 'primary',
          type: 'button',
          onclick: () => {
            playSound('select');
            restart();
          },
        },
        'はじめる',
      ),
      h(
        'button',
        {
          class: 'link',
          type: 'button',
          onclick: () => {
            state.back = 'start';
            state.screen = 'credits';
            render();
          },
        },
        'クレジット・ライセンス',
      ),
    ];
  }

  function questionScreen(): Child[] {
    const game = state.game;
    const q = data.questions[game.current];
    const n = answeredCount(game);
    const lead = leadingRegion(game);
    const dialect = voice() !== 'standard';
    let line: string;
    let face: Expression;
    if (n === 0) {
      line = '最初の質問です。直感で答えてください。';
      face = 'smile';
    } else if (dialect && n % 3 === 0) {
      line = say('hunch', {}, false);
      face = 'confident';
    } else {
      line = say('next', {}, false);
      face = n % 2 === 1 ? 'think' : 'smile';
    }

    const options: Child[] = [];
    for (let o = 0; o < q.options.length; o++) {
      const isUnknown = o === q.options.length - 1;
      options.push(
        h(
          'button',
          {
            class: isUnknown ? 'option option-unknown' : 'option',
            type: 'button',
            onclick: (ev: Event) => {
              pick(ev.currentTarget as HTMLElement, () => {
                answerCurrent(game, o);
                if (isFinished(game)) {
                  finishToResult();
                  playSound('result');
                }
                render();
              });
            },
          },
          q.options[o].text,
        ),
      );
    }

    return [
      h('p', { class: 'progress' }, `質問 ${n + 1}`),
      hostBubble(line, face),
      h('h2', { class: 'question' }, q.text),
      h('div', { class: 'options' }, ...options),
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            class: 'secondary',
            type: 'button',
            disabled: n === 0,
            onclick: () => {
              playSound('back');
              goBack(game);
              render();
            },
          },
          '← 前の質問に戻る',
        ),
        n >= 5 &&
          h(
            'button',
            {
              class: 'secondary',
              type: 'button',
              onclick: () => {
                playSound('result');
                finishToResult();
                render();
              },
            },
            'もう答えを見る',
          ),
      ),
      h(
        'section',
        { class: 'estimate' },
        h('h3', null, 'いまの推定'),
        h(
          'p',
          { class: 'estimate-text' },
          n === 0
            ? 'まだ手がかりなし。いまの数字と色は、人口の多さだけで決まっています。'
            : `いちばん有力:${data.regionNames[lead.region]}地方(${percent(lead.prob)})`,
        ),
        h(
          'div',
          { class: 'ranks' },
          ranking('地方', game.regionP, data.regionNames, '地方'),
          ranking('都道府県', game.prefP, data.prefNames, ''),
        ),
        showMap([]),
      ),
    ];
  }

  function resultScreen(): Child[] {
    const g = state.guesses[state.guessIndex];
    const place = guessName(g);
    const vars = {
      pref: g.pref >= 0 ? data.prefNames[g.pref] : '',
      label: g.cell >= 0 ? data.cellLabels[g.cell] : '',
      region: data.regionNames[g.region],
      place,
    };
    let line: string;
    if (state.guessIndex > 0) line = say('retry', vars, true);
    else if (g.level === LEVEL_CELL) line = say('result_cell', vars, false);
    else if (g.level === LEVEL_PREF) line = say('result_pref', vars, false);
    else line = say('result_region', vars, false);
    const face: Expression = state.guessIndex > 0 ? 'surprise' : 'confident';

    const hints: Child[] = [];
    for (let i = 0; i < g.hints.length; i++) {
      const name = g.level === LEVEL_PREF ? data.cellLabels[g.hints[i]] : data.prefNames[g.hints[i]];
      hints.push(h('li', null, `${name}(${percent(g.hintProbs[i])})`));
    }
    const candidates: Child[] = [];
    for (let i = 0; i < state.guesses.length; i++) {
      candidates.push(
        h(
          'li',
          { class: i === state.guessIndex ? 'current' : '' },
          `${guessName(state.guesses[i])}(${percent(state.guesses[i].prob)})`,
        ),
      );
    }

    return [
      h('p', { class: 'progress' }, `${answeredCount(state.game)} 問の回答から推定`),
      hostBubble(line, face),
      h('h2', { class: 'guess' }, place),
      h('p', { class: 'confidence' }, `確信度 ${percent(g.prob)}`),
      g.hints.length > 0 &&
        h(
          'div',
          { class: 'hints' },
          h(
            'h3',
            null,
            g.level === LEVEL_PREF ? `${insidePref(data.prefNames[g.pref])}では、このあたりかも` : 'その中では、このあたりかも',
          ),
          h('ul', null, ...hints),
        ),
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            class: 'primary',
            type: 'button',
            onclick: () => {
              playSound('hit');
              state.hit = true;
              if (g.level === LEVEL_CELL) {
                state.correct = data.modelJson.cellIds[g.cell];
                writeLog();
                state.screen = 'end';
              } else {
                state.answerPref = g.level === LEVEL_PREF ? data.modelJson.prefCodes[g.pref] : '';
                state.answerCell = '';
                state.screen = 'answer';
              }
              render();
            },
          },
          '当たり!',
        ),
        h(
          'button',
          {
            class: 'secondary',
            type: 'button',
            onclick: () => {
              playSound('miss');
              if (state.guessIndex + 1 < state.guesses.length) {
                state.guessIndex += 1;
              } else {
                state.hit = false;
                state.answerPref = '';
                state.answerCell = '';
                state.screen = 'answer';
              }
              render();
            },
          },
          'ちがう',
        ),
      ),
      showMap(guessCells(g)),
      h('h3', null, '上位の候補'),
      h('ol', { class: 'candidates' }, ...candidates),
      h(
        'button',
        {
          class: 'link',
          type: 'button',
          onclick: () => {
            if (goBack(state.game)) {
              state.screen = isFinished(state.game) ? 'result' : 'question';
              if (state.screen === 'result') finishToResult();
              render();
            }
          },
        },
        '← 最後の回答をやり直す',
      ),
    ];
  }

  function answerScreen(): Child[] {
    const prefSelect = h('select', { id: 'answer-pref' });
    prefSelect.appendChild(h('option', { value: '' }, '選んでください'));
    for (let p = 0; p < data.prefNames.length; p++) {
      prefSelect.appendChild(h('option', { value: data.modelJson.prefCodes[p] }, data.prefNames[p]));
    }
    prefSelect.appendChild(h('option', { value: ABROAD }, '日本国外'));
    prefSelect.appendChild(h('option', { value: MULTIPLE }, '複数の地域で育った/ひとつに決められない'));
    prefSelect.value = state.answerPref;
    prefSelect.addEventListener('change', () => {
      state.answerPref = prefSelect.value;
      state.answerCell = '';
      render();
    });

    const isPref = state.answerPref !== '' && state.answerPref !== ABROAD && state.answerPref !== MULTIPLE;
    let cellField: Child = null;
    if (isPref) {
      const cellSelect = h('select', { id: 'answer-cell' });
      cellSelect.appendChild(h('option', { value: '' }, '選んでください'));
      const p = data.modelJson.prefCodes.indexOf(state.answerPref);
      for (let c = 0; c < data.model.cellCount; c++) {
        if (data.model.cellPref[c] !== p) continue;
        cellSelect.appendChild(h('option', { value: data.modelJson.cellIds[c] }, data.cellLabels[c]));
      }
      cellSelect.value = state.answerCell;
      cellSelect.addEventListener('change', () => {
        state.answerCell = cellSelect.value;
        render();
      });
      cellField = h(
        'div',
        { class: 'field' },
        h('label', { for: 'answer-cell' }, `${insidePref(data.prefNames[p])}のどのあたり?(いちばん近いもの)`),
        cellSelect,
      );
    }
    let commentField: Child = null;
    if (state.consent && logMode !== 'none') {
      const box = h('textarea', { id: 'answer-comment', rows: '3', maxlength: String(COMMENT_LIMIT) });
      box.value = state.comment;
      box.addEventListener('input', () => {
        state.comment = box.value;
      });
      commentField = h(
        'div',
        { class: 'field' },
        h('label', { for: 'answer-comment' }, `コメント(任意・${COMMENT_LIMIT}字まで)`),
        box,
        h(
          'p',
          { class: 'small' },
          '「この質問は地元では言い方が違う」「この言葉で分かるはず」など、気づいたことがあれば教えてください。個人が特定できることは書かないでください。',
        ),
      );
    }
    const ready = state.answerPref === ABROAD || state.answerPref === MULTIPLE || (isPref && state.answerCell !== '');

    return [
      hostBubble(
        state.hit ? say('ask_answer', {}, true) : `${say('miss', {}, true)} ${say('ask_answer', {}, true)}`,
        state.hit ? 'smile' : 'sorry',
      ),
      h('h2', null, '正解を教えてください'),
      h('p', { class: 'small' }, '小・中学生のころを過ごした地域を選んでください。市区町村より細かいことは聞きません。'),
      h('div', { class: 'field' }, h('label', { for: 'answer-pref' }, '都道府県'), prefSelect),
      cellField,
      commentField,
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            class: 'primary',
            type: 'button',
            disabled: !ready,
            onclick: () => {
              playSound('select');
              state.correct = isPref ? state.answerCell : state.answerPref;
              writeLog();
              state.screen = 'end';
              render();
            },
          },
          '決定',
        ),
        h(
          'button',
          {
            class: 'secondary',
            type: 'button',
            onclick: () => {
              state.correct = '';
              writeLog();
              state.screen = 'end';
              render();
            },
          },
          '答えずに終わる',
        ),
      ),
    ];
  }

  function correctName(): string {
    if (state.correct === '') return '(未回答)';
    if (state.correct === ABROAD) return '日本国外';
    if (state.correct === MULTIPLE) return '複数の地域';
    const c = data.modelJson.cellIds.indexOf(state.correct);
    if (c < 0) return state.correct;
    return `${data.prefNames[data.model.cellPref[c]]} ${data.cellLabels[c]}`;
  }

  function endScreen(): Child[] {
    const c = data.modelJson.cellIds.indexOf(state.correct);
    return [
      hostBubble(`${state.hit ? say('hit', {}, true) : ''} ${say('thanks', {}, true)}`.trim(), state.hit ? 'happy' : 'smile'),
      h('h2', null, 'おつかれさまでした'),
      h(
        'dl',
        { class: 'summary' },
        h('dt', null, '最初の推定'),
        h('dd', null, state.guesses.length > 0 ? guessName(state.guesses[0]) : '—'),
        h('dt', null, '正解'),
        h('dd', null, correctName()),
        h('dt', null, '答えた質問'),
        h('dd', null, `${answeredCount(state.game)} 問`),
      ),
      showMap(c >= 0 ? [c] : []),
      h('p', { class: 'small' }, '地図の色は最終的な推定の強さ、太い枠は正解の地域です。'),
      h(
        'button',
        {
          class: 'primary',
          type: 'button',
          onclick: () => {
            restart();
          },
        },
        'もう一度あそぶ',
      ),
      h(
        'button',
        {
          class: 'link',
          type: 'button',
          onclick: () => {
            state.back = 'end';
            state.screen = 'credits';
            render();
          },
        },
        'クレジット・ライセンス',
      ),
    ];
  }

  function creditsScreen(): Child[] {
    const titles: Record<string, string> = {
      code: 'コード',
      'own-data': '自作データ',
      'third-party-data': '第三者のデータ',
    };
    const out: Child[] = [h('h1', { class: 'title' }, 'クレジット・ライセンス')];
    const order = ['third-party-data', 'own-data', 'code'];
    for (let k = 0; k < order.length; k++) {
      out.push(h('h2', null, titles[order[k]]));
      for (let i = 0; i < data.credits.entries.length; i++) {
        const e = data.credits.entries[i];
        if (e.category !== order[k]) continue;
        const self = e.source_url === 'self';
        out.push(
          h(
            'article',
            { class: 'credit' },
            h('h3', null, e.name),
            h(
              'dl',
              null,
              h('dt', null, '配布元'),
              h(
                'dd',
                null,
                h(
                  'a',
                  { href: self ? data.credits.repoUrl : e.source_url, rel: 'noopener' },
                  self ? '本リポジトリ' : e.source_url,
                ),
              ),
              h('dt', null, 'ライセンス'),
              h('dd', null, h('a', { href: e.license_url, rel: 'noopener' }, e.license)),
              h('dt', null, 'クレジット表記'),
              h('dd', null, e.credit),
              h('dt', null, '加工内容'),
              h('dd', null, e.processing),
              h('dt', null, '取得日'),
              h('dd', null, e.retrieved === 'n/a' ? '—(自作)' : e.retrieved),
            ),
          ),
        );
      }
    }
    out.push(h('h2', null, '組み込んでいるソフトウェア'));
    const list = h('ul', { class: 'packages' });
    for (let i = 0; i < data.credits.packages.length; i++) {
      const p = data.credits.packages[i];
      if (!p.bundled) continue;
      list.appendChild(
        h('li', null, h('a', { href: p.url, rel: 'noopener' }, p.name), ` ${p.version}(${p.license})`),
      );
    }
    out.push(list);
    out.push(
      h(
        'p',
        { class: 'small' },
        '開発時にのみ使うソフトウェアを含む全体は、リポジトリの LICENSES.md にあります。',
      ),
    );
    out.push(
      h(
        'button',
        {
          class: 'primary',
          type: 'button',
          onclick: () => {
            state.screen = state.back;
            render();
          },
        },
        '戻る',
      ),
    );
    return out;
  }

  function render(): void {
    clear(root);
    let children: Child[];
    if (state.screen === 'start') children = startScreen();
    else if (state.screen === 'question') children = questionScreen();
    else if (state.screen === 'result') children = resultScreen();
    else if (state.screen === 'answer') children = answerScreen();
    else if (state.screen === 'end') children = endScreen();
    else children = creditsScreen();
    const main = h('main', { class: `screen screen-${state.screen}` }, h('div', { class: 'topbar' }, soundToggle()), ...children);
    root.appendChild(main);
    window.scrollTo(0, 0);
  }

  loadSoundSetting();
  render();
}
