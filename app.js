'use strict';
// 클라이언트: 서버가 보내준 state를 그리기만 한다. 규칙 판정은 모두 서버가 한다.
// 색 목록·순서는 서버 state(game.colors)를 따른다. 여기는 색 → 성계 표시(이름·아이콘)만.
// 게임 용어: 원정대 = 항로, 버린 더미 = 중고 시장, 덱 = 탐사 덱, 투자 카드 = 투자 계약
const SECTORS = {
  yellow: { name: '태양권', short: '태양' },
  white: { name: '빙결 위성', short: '빙결' },
  blue: { name: '해양 행성', short: '해양' },
  green: { name: '테라포밍 행성', short: '테라' },
  red: { name: '화산 행성', short: '화산' },
  purple: { name: '성운', short: '성운' },
};
const sectorName = (c) => (SECTORS[c] ? SECTORS[c].name : c);
const sectorShort = (c) => (SECTORS[c] ? SECTORS[c].short : c);

// 성계 아이콘 (24×24, 선 = currentColor). 정적 문자열만 innerHTML로 넣는다.
const ICONS = {
  yellow: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  white: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7"/><path d="M9.5 3.5 12 6l2.5-2.5M9.5 20.5 12 18l2.5 2.5"/>',
  blue: '<circle cx="12" cy="12" r="8.5"/><path d="M4.5 10.5c2-1.5 3.5 1.5 5.5 0s3.5 1.5 5.5 0 2.5-.5 3.5 0M4.5 14.5c2-1.5 3.5 1.5 5.5 0s3.5 1.5 5.5 0 2.5-.5 3.5 0"/>',
  green: '<path d="M5 19C5 10 11 4 20 4c0 9-6 15-15 15z"/><path d="M5 19 14 10"/>',
  red: '<path d="M2 20 9 9h6l7 11z"/><path d="M9 9l3 3 3-3M12 6V2M9.5 4.5 8 3M14.5 4.5 16 3"/>',
  purple: '<ellipse cx="12" cy="13" rx="9.5" ry="3.8" transform="rotate(-24 12 13)"/><circle class="fill" cx="12" cy="13" r="2.4"/><path class="fill" d="m18 1.5.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7zM5 18l.5 1.1 1.1.5-1.1.5L5 21.2l-.5-1.1-1.1-.5 1.1-.5z"/>',
};

function iconEl(color) {
  const span = document.createElement('span');
  span.className = 'art';
  span.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[color] || ''}</svg>`;
  return span;
}

const $ = (id) => document.getElementById(id);

// 브라우저 전용 빌드(npm run build:offline)는 engine.js가 LCEngine을 만든다.
// 이때는 서버 대신 LocalSocket(같은 메시지 형식)으로 혼자 하기만 한다.
const OFFLINE = !!window.LCEngine;
// 입장 정보 저장소: 서버판은 탭 단위, 오프라인판은 앱을 껐다 켜도 이어 하도록 기기 단위
const joinStorage = () => (OFFLINE ? localStorage : sessionStorage);
if (OFFLINE) {
  $('friend-mode').hidden = true;
  $('lobby-sub').textContent = '우주 개척 카드게임 · 컴퓨터와 1:1 · 3라운드 합산 · 인터넷 없이 플레이';
  $('lobby-note').textContent = '기록은 이 기기에만 저장됩니다.';
}

let ws = null;
let state = null; // 마지막으로 받은 서버 메시지
let selectedId = null;
let joinInfo = null;
let resultHidden = false; // 결과 창을 닫고 보드를 보는 중
let undoDeadline = 0; // 무르기 버튼을 감출 시각 (0이면 무르기 불가). 서버판 전용.
let undoTicker = null;
let lastRoundKey = null; // 라운드가 바뀌면 resultHidden 초기화

// ---------- 공통 ----------
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
}

const signed = (n) => (n > 0 ? `+${n}` : String(n));

// kind: 'error'(빨강, 기본) | 'info'(알림)
function toast(msg, kind) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('info', kind === 'info');
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- 탭 ----------
function showTab(name) {
  document.querySelectorAll('#tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  $('view-play').hidden = name !== 'play';
  $('view-history').hidden = name !== 'history';
  if (name === 'history') loadHistory();
}
document.querySelectorAll('#tabs [data-tab]').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));

// ---------- 접속 ----------
// 탭 단위 토큰: 새로고침·재연결 시 같은 자리로 복귀, 다른 탭은 다른 플레이어
function getToken() {
  try {
    let t = sessionStorage.getItem('lc-token');
    if (!t) {
      t = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem('lc-token', t);
    }
    return t;
  } catch {
    return 'anon-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

let reconnectTimer = null;
let syncTimer = null;
let replaced = false; // 같은 토큰으로 다른 탭이 접속해 이 탭이 밀려난 상태

function connect() {
  clearTimeout(reconnectTimer);
  if (ws) { ws.onclose = null; try { ws.close(); } catch {} } // 이전 소켓의 재연결 루프 차단
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock = OFFLINE ? new window.LCEngine.LocalSocket() : new WebSocket(`${proto}://${location.host}`);
  ws = sock;
  sock.onopen = () => sock.send(JSON.stringify({ type: 'join', ...joinInfo }));
  sock.onmessage = (ev) => {
    if (sock !== ws) return; // 나가기 등으로 버린 소켓
    clearTimeout(syncTimer); // 서버가 응답했으니 연결은 살아 있다
    const msg = JSON.parse(ev.data);
    if (msg.type === 'error') {
      if (!state) {
        $('lobby-error').textContent = msg.message;
        try { joinStorage().removeItem('lc-join'); } catch {} // 실패한 입장 정보로 자동 재입장을 반복하지 않도록
      } else toast(msg.message);
      return;
    }
    if (msg.type === 'notice') {
      toast(msg.message, 'info');
      return;
    }
    if (msg.type === 'state') {
      const prevTurn = state && state.game && state.game.myTurn;
      state = msg;
      if (joinInfo.solo) {
        // 서버가 만든 방 코드로 바꿔 두면 새로고침·재연결은 일반 입장으로 같은 자리에 돌아온다
        joinInfo = { name: joinInfo.name, room: msg.room, token: joinInfo.token };
        saveJoin();
      }
      if (!msg.game || !msg.game.myTurn || msg.game.phase !== 'play') selectedId = null;
      if (state.game && state.game.myTurn && !prevTurn) document.title = '● 내 차례 - 프론티어 식스';
      else if (!state.game || !state.game.myTurn) document.title = '프론티어 식스';
      // 무르기 남은 시간: 서버가 보낸 시점 기준이므로 받은 순간부터 로컬 시계로 센다
      undoDeadline = msg.undo && msg.undo.leftMs > 0 ? Date.now() + msg.undo.leftMs : 0;
      render();
    }
  };
  sock.onclose = (ev) => {
    if (sock !== ws || !state) return;
    if (ev.code === 4000) {
      // iOS Safari '탭 복제'는 sessionStorage까지 복사한다. 두 탭이 서로 밀어내며 무한 재접속하지 않도록 멈춘다.
      replaced = true;
      $('status').textContent = '다른 창에서 이 자리로 접속해 연결을 넘겼습니다. 이 창을 다시 쓰려면 새로고침하세요.';
      return;
    }
    $('status').textContent = '연결이 끊어졌습니다. 재연결 중…';
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 1500); // 같은 토큰으로 자동 재입장
  };
}

// 모바일: 앱 전환·화면 잠금 후 돌아오면 소켓이 조용히 죽어 있는 경우가 많다.
// 복귀 시 닫혀 있으면 즉시 재접속, 열려 있어 보이면 sync로 확인하고 3초 안에 답이 없으면 새로 연결.
function checkConnection() {
  if (!joinInfo || !state || replaced || document.visibilityState !== 'visible') return;
  if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
    connect();
    return;
  }
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'sync' }));
    clearTimeout(syncTimer);
    syncTimer = setTimeout(connect, 3000);
  }
}
document.addEventListener('visibilitychange', checkConnection);
window.addEventListener('pageshow', (e) => { if (e.persisted) checkConnection(); }); // iOS 뒤로가기 캐시 복원
window.addEventListener('online', checkConnection);

function saveJoin() {
  try { joinStorage().setItem('lc-join', JSON.stringify({ name: joinInfo.name, room: joinInfo.room })); } catch {}
}

function readName() {
  const name = $('name').value.trim();
  if (!name) {
    $('lobby-error').textContent = '이름을 입력하세요.';
    $('name').focus();
    return null;
  }
  $('lobby-error').textContent = '';
  return name;
}

// 친구와 대전
$('join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (OFFLINE) return startSolo(); // 이름 칸에서 엔터를 누른 경우
  const name = readName();
  if (!name) return;
  const room = $('room').value.trim();
  if (!room) {
    $('lobby-error').textContent = '방 코드를 입력하세요.';
    $('room').focus();
    return;
  }
  joinInfo = { name, room, token: getToken() };
  saveJoin();
  connect();
});

// 혼자 하기: 방 코드는 서버가 만든다
function startSolo() {
  const name = readName();
  if (!name) return;
  const checked = document.querySelector('input[name="level"]:checked');
  joinInfo = { name, solo: true, level: checked ? checked.value : 'normal', token: getToken() };
  connect();
}
$('solo-btn').addEventListener('click', startSolo);

// 나가기: 실수 방지를 위해 두 번 눌러야 한다 (confirm 대화상자는 모바일에서 거슬리므로 쓰지 않음)
$('leave').addEventListener('click', () => {
  const btn = $('leave');
  if (!btn.dataset.armed) {
    btn.dataset.armed = '1';
    btn.textContent = state && state.solo ? '한 번 더 누르면 나갑니다' : '한 번 더 누르면 나갑니다 (상대에게는 연결 끊김으로 보임)';
    setTimeout(() => { delete btn.dataset.armed; btn.textContent = '나가기'; }, 3000);
    return;
  }
  delete btn.dataset.armed;
  btn.textContent = '나가기';
  clearTimeout(reconnectTimer);
  clearTimeout(syncTimer);
  if (ws) { ws.onclose = null; try { ws.close(); } catch {} }
  ws = null;
  state = null;
  joinInfo = null;
  selectedId = null;
  lastRoundKey = null;
  try { joinStorage().removeItem('lc-join'); } catch {}
  document.title = '프론티어 식스';
  undoDeadline = 0;
  renderUndo();
  $('game').hidden = true;
  $('result').hidden = true;
  $('lobby').hidden = false;
});

// 새로고침 시 같은 탭이면 자동 재입장
(function autoRejoin() {
  try {
    const saved = JSON.parse(joinStorage().getItem('lc-join') || 'null');
    if (saved && saved.name && saved.room) {
      $('name').value = saved.name;
      $('room').value = saved.room;
      joinInfo = { ...saved, token: getToken() };
      connect();
    }
  } catch {}
})();

function send(msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

// ---------- 게임 화면 ----------
// 트럼프식 카드: 왼쪽 위·오른쪽 아래 모서리 숫자 + 가운데 성계 아이콘. 투자 계약은 $.
// 항로에 겹쳐 쌓이면 CSS가 왼쪽 위 숫자만 보이게 한다.
function cardEl(card, extraClass = '') {
  const wager = card.value === 0;
  const label = wager ? '$' : String(card.value);
  const cls = `card ${card.color}${wager ? ' wager' : ''} ${extraClass}`.trim();
  return el('div', { class: cls, title: `${sectorName(card.color)} · ${wager ? '투자 계약' : `${card.value}단계`}` },
    el('span', { class: 'idx tl' }, label),
    iconEl(card.color),
    wager ? el('span', { class: 'band' }, '투자') : null,
    el('span', { class: 'idx br' }, label)
  );
}

// 무르기 버튼 (서버판 전용 — 오프라인판 state에는 undo가 없어 항상 숨김)
function renderUndo() {
  const btn = $('undo');
  const left = undoDeadline - Date.now();
  if (left <= 0) {
    btn.hidden = true;
    clearInterval(undoTicker);
    undoTicker = null;
    return;
  }
  btn.hidden = false;
  btn.textContent = `↶ 무르기 ${Math.ceil(left / 1000)}`;
  if (!undoTicker) undoTicker = setInterval(renderUndo, 200);
}
$('undo').addEventListener('click', () => {
  undoDeadline = 0;
  renderUndo();
  send({ type: 'undo' });
});

function colorDot(color) {
  return el('span', { class: `dot ${color}` });
}

function render() {
  if (!state) return;
  $('lobby').hidden = true;
  $('game').hidden = false;
  const g = state.game;
  const m = state.match;

  if (!g) {
    $('round-label').textContent = `방 ${state.room}`;
    $('status').textContent = '상대를 기다리는 중…';
    $('status').className = '';
    $('scores').textContent = '방 코드를 친구에게 알려주세요.';
    $('board').replaceChildren();
    $('hand').replaceChildren();
    $('hint').textContent = '';
    $('deck').hidden = true;
    $('opp-info').textContent = '';
    $('show-result').hidden = true;
    $('result').hidden = true;
    return;
  }

  const roundKey = `${m.round}-${m.rounds.length}-${m.over}`;
  if (roundKey !== lastRoundKey) {
    lastRoundKey = roundKey;
    resultHidden = false;
  }

  const COLORS = g.colors;
  const selected = g.hand.find((c) => c.id === selectedId) || null;
  if (!selected) selectedId = null;
  const inPlay = g.myTurn && g.phase === 'play';
  const inDraw = g.myTurn && g.phase === 'draw';

  // 상단: 라운드 · 상태 · 점수(이번 라운드 / 누적)
  $('round-label').textContent = `${state.solo ? '혼자 하기 · ' : ''}라운드 ${m.round} / ${m.totalRounds}`;
  const status = $('status');
  if (g.over) status.textContent = m.over ? '경기 종료' : '라운드 종료';
  else if (g.myTurn) status.textContent = inPlay ? '내 차례 — 카드를 내세요' : '내 차례 — 카드를 뽑으세요';
  else if (state.solo) status.textContent = '컴퓨터가 생각하는 중…';
  else status.textContent = `${state.names.opp} 님의 차례${state.oppConnected ? '' : ' (연결 끊김)'}`;
  status.className = g.myTurn ? 'mine' : '';

  // 진행 중인 라운드의 점수는 아직 m.totals에 없으므로 더해서 보여준다
  const roundDone = m.rounds.length >= m.round;
  const totalMe = m.totals.me + (roundDone ? 0 : g.scores.me);
  const totalOpp = m.totals.opp + (roundDone ? 0 : g.scores.opp);
  $('scores').replaceChildren(
    el('div', { class: 'score-row' }, el('span', { class: 'who' }, state.names.me), el('b', {}, String(g.scores.me)), el('span', { class: 'total' }, `누적 ${totalMe}`)),
    el('div', { class: 'score-row' }, el('span', { class: 'who' }, state.names.opp), el('b', {}, String(g.scores.opp)), el('span', { class: 'total' }, `누적 ${totalOpp}`))
  );

  // 보드: 색마다 [상대 원정대 / 버린 더미 / 내 원정대]
  const board = $('board');
  board.replaceChildren();
  board.style.gridTemplateColumns = `repeat(${COLORS.length}, 1fr)`;
  for (const color of COLORS) {
    board.append(el('div', { class: 'col' },
      expeditionZone(g.oppExpeditions[color], 'opp', g.scores.oppByColor[color], g.scores.oppBest.includes(color)),
      discardZone(color, g, selected, inDraw),
      myZone(color, g, selected, inPlay)
    ));
  }

  // 탐사 덱 (카드 뒷면 모양)
  const deck = $('deck');
  deck.hidden = false;
  deck.replaceChildren(el('span', { class: 'deck-label' }, '탐사 덱'), el('b', {}, `${g.deckCount}`));
  deck.className = `card-back${inDraw ? ' target' : ''}`;
  deck.setAttribute('aria-label', `탐사 덱 ${g.deckCount}장${inDraw ? ', 눌러서 뽑기' : ''}`);
  deck.onclick = inDraw ? () => send({ type: 'draw', source: 'deck' }) : null;
  $('opp-info').textContent = `${state.names.opp} 손패 ${g.oppHandCount}장`;
  $('show-result').hidden = !(g.over && resultHidden);
  $('show-result').onclick = () => { resultHidden = false; render(); };

  // 손패는 색 → 값 순으로 정렬해 표시 (서버 순서와 무관)
  const hand = $('hand');
  hand.replaceChildren();
  const sortedHand = g.hand.slice().sort((a, b) => COLORS.indexOf(a.color) - COLORS.indexOf(b.color) || a.value - b.value);
  for (const c of sortedHand) {
    const cls = [c.id === selectedId ? 'selected' : '', inPlay && !g.playableIds.includes(c.id) ? 'unplayable' : ''].join(' ');
    const node = cardEl(c, cls);
    node.onclick = inPlay ? () => { selectedId = selectedId === c.id ? null : c.id; render(); } : null;
    hand.append(node);
  }

  $('hint').textContent = hintText(g, selected, inPlay, inDraw);
  renderUndo();
  renderResult(g, m, COLORS);
}

function expeditionZone(cards, who, score, isBest) {
  const zone = el('div', { class: `zone ${who}${isBest ? ' best' : ''}` });
  const stack = el('div', { class: 'stack' });
  cards.forEach((c) => stack.append(cardEl(c)));
  zone.append(stack);
  if (cards.length) {
    zone.append(el('span', { class: 'score', title: isBest ? '이번 라운드 최고 항로' : '' }, `${isBest ? '★ ' : ''}${signed(score)}`));
  }
  return zone;
}

function myZone(color, g, selected, inPlay) {
  const zone = expeditionZone(g.myExpeditions[color], 'mine', g.scores.meByColor[color], g.scores.meBest.includes(color));
  if (inPlay && selected && selected.color === color && g.playableIds.includes(selected.id)) {
    zone.classList.add('target');
    zone.onclick = () => send({ type: 'play', cardId: selected.id, target: 'expedition' });
  }
  return zone;
}

function discardZone(color, g, selected, inDraw) {
  const zone = el('div', { class: 'zone discard' });
  const pile = g.discards[color];
  if (pile.length) {
    zone.append(cardEl(pile[pile.length - 1]), el('span', { class: 'count' }, `${pile.length}장`));
  } else {
    zone.append(el('span', { class: 'empty-label' }, `${sectorShort(color)}\n시장`));
  }
  if (g.myTurn && g.phase === 'play' && selected && selected.color === color) {
    zone.classList.add('target');
    zone.onclick = () => send({ type: 'play', cardId: selected.id, target: 'discard' });
  } else if (inDraw && pile.length && g.lastDiscard !== color) {
    zone.classList.add('target');
    zone.onclick = () => send({ type: 'draw', source: color });
  }
  return zone;
}

function hintText(g, selected, inPlay, inDraw) {
  if (g.over) return '';
  if (inDraw) return '탐사 덱 또는 중고 시장(방금 내놓은 곳 제외)에서 한 장 가져오세요.';
  if (inPlay) {
    if (!selected) return '손패에서 카드를 고르세요. ★는 이번 라운드 최고 항로입니다.';
    const where = g.playableIds.includes(selected.id) ? '내 항로에 놓거나' : '(항로에 놓을 수 없음)';
    return `${sectorName(selected.color)} ${selected.value ? `${selected.value}단계` : '투자 계약'} — ${where} 가운데 시장에 내놓으세요.`;
  }
  return '';
}

// ---------- 라운드/경기 결과 ----------
function renderResult(g, m, COLORS) {
  const box = $('result');
  box.hidden = !g.over || resultHidden;
  if (!g.over) return;
  const last = m.rounds[m.rounds.length - 1];
  if (!last) return;

  if (m.over) {
    const titles = { me: '최종 승리!', opp: '최종 패배', draw: '최종 무승부' };
    $('result-title').textContent = titles[m.winner];
    $('result-sub').textContent = `${m.totalRounds}라운드 합계 ${state.names.me} ${m.totals.me} : ${m.totals.opp} ${state.names.opp} · 대전 기록에 저장되었습니다.`;
  } else {
    $('result-title').textContent = `라운드 ${m.rounds.length} 결과`;
    const lead = m.totals.me === m.totals.opp ? '동점' : m.totals.me > m.totals.opp ? `${state.names.me} ${m.totals.me - m.totals.opp}점 앞섬` : `${state.names.opp} ${m.totals.opp - m.totals.me}점 앞섬`;
    $('result-sub').textContent = `이번 라운드 ${last.me} : ${last.opp} · 누적 ${lead}`;
  }

  // 이번 라운드 색별 점수 (최고 원정대 ★ 강조)
  const rt = $('round-table');
  rt.replaceChildren(el('tr', {}, el('th', {}, '항로'), el('th', {}, state.names.me), el('th', {}, state.names.opp)));
  for (const c of COLORS) {
    rt.append(el('tr', {},
      el('td', {}, colorDot(c), sectorName(c)),
      scoreCell(last.meByColor[c], g.myExpeditions[c].length, last.meBest.includes(c)),
      scoreCell(last.oppByColor[c], g.oppExpeditions[c].length, last.oppBest.includes(c))
    ));
  }
  rt.append(el('tr', { class: 'sum' }, el('td', {}, '라운드 합계'), el('td', {}, String(last.me)), el('td', {}, String(last.opp))));

  // 라운드별 + 누적
  const mt = $('match-table');
  mt.replaceChildren(el('tr', {}, el('th', {}, ''), el('th', {}, state.names.me), el('th', {}, state.names.opp)));
  for (let i = 0; i < m.totalRounds; i++) {
    const r = m.rounds[i];
    mt.append(el('tr', { class: i === m.rounds.length - 1 ? 'current' : '' },
      el('td', {}, `라운드 ${i + 1}`),
      el('td', {}, r ? String(r.me) : '–'),
      el('td', {}, r ? String(r.opp) : '–')
    ));
  }
  mt.append(el('tr', { class: 'sum' }, el('td', {}, '합계'), el('td', {}, String(m.totals.me)), el('td', {}, String(m.totals.opp))));

  $('hide-result').onclick = () => { resultHidden = true; render(); };
  const btn = $('next');
  const label = m.over ? '새 경기 (3라운드)' : `라운드 ${m.round + 1} 시작`;
  btn.disabled = state.readyRequested;
  btn.textContent = state.readyRequested ? '상대 기다리는 중…' : state.oppReady && !state.solo ? `${label} (상대 준비됨)` : label;
  btn.onclick = () => send({ type: 'next' });
}

function scoreCell(score, count, isBest) {
  if (!count) return el('td', { class: 'muted' }, '–');
  return el('td', { class: isBest ? 'best-cell' : '' }, `${isBest ? '★ ' : ''}${signed(score)}`);
}

// ---------- 대전 기록 탭 ----------
async function loadHistory() {
  let data;
  try {
    if (OFFLINE) {
      data = window.LCEngine.history(); // 이 기기의 localStorage 기록
    } else {
      const res = await fetch('/api/history', { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      data = await res.json();
    }
  } catch {
    toast('기록을 불러오지 못했습니다.');
    return;
  }
  const empty = data.matches.length === 0;
  $('history-empty').hidden = !empty;
  $('stats-section').hidden = empty;
  $('matches-section').hidden = empty;
  renderStats(data.stats);
  renderMatches(data.matches);
}
$('refresh-history').onclick = loadHistory;

function renderStats(stats) {
  const t = $('stats-table');
  t.replaceChildren(el('tr', {},
    ...['플레이어', '경기', '승', '무', '패', '승률', '평균 합계', '최고 합계', '최고 라운드', '최고 항로', '주력 성계'].map((h) => el('th', {}, h))
  ));
  for (const s of stats) {
    t.append(el('tr', {},
      el('td', { class: 'name' }, s.name),
      el('td', {}, String(s.games)),
      el('td', {}, String(s.wins)),
      el('td', {}, String(s.draws)),
      el('td', {}, String(s.losses)),
      el('td', {}, `${Math.round(s.winRate * 100)}%`),
      el('td', {}, String(s.avgScore)),
      el('td', {}, String(s.bestTotal)),
      el('td', {}, String(s.bestRound)),
      s.bestExpedition ? el('td', {}, colorDot(s.bestExpedition.color), signed(s.bestExpedition.score)) : el('td', { class: 'muted' }, '–'),
      s.favoriteColor ? el('td', {}, colorDot(s.favoriteColor), sectorName(s.favoriteColor)) : el('td', { class: 'muted' }, '–')
    ));
  }
}

function renderMatches(matches) {
  const list = $('match-list');
  list.replaceChildren();
  for (const rec of matches) {
    const [a, b] = rec.players;
    const when = new Date(rec.endedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const result = rec.winner === null ? '무승부' : `${rec.players[rec.winner]} 승`;
    const rounds = el('div', { class: 'rounds' });
    rec.rounds.forEach((r, i) => {
      const chip = el('span', { class: 'round-chip' }, `R${i + 1} ${r.scores[0]}:${r.scores[1]}`);
      // 라운드 최고 원정대 색 (양쪽 다 없으면 생략)
      if (r.best[0].length || r.best[1].length) {
        chip.append(' ★', ...r.best[0].map(colorDot), el('span', { class: 'vs' }, '/'), ...r.best[1].map(colorDot));
        chip.title = '라운드 최고 항로 (왼쪽 / 오른쪽 플레이어)';
      }
      rounds.append(chip);
    });
    list.append(el('article', { class: 'match' },
      el('div', { class: 'match-head' },
        el('span', { class: rec.winner === 0 ? 'win' : '' }, a),
        el('b', {}, ` ${rec.totals[0]} : ${rec.totals[1]} `),
        el('span', { class: rec.winner === 1 ? 'win' : '' }, b),
        el('span', { class: 'meta' }, `${result} · ${when} · 방 ${rec.room}`)
      ),
      rounds
    ));
  }
}
