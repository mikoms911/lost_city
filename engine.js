// 자동 생성 파일 (scripts/build-offline.js). 직접 고치지 말 것.
(function () {
  'use strict';
  var defs = {};
  var cache = {};
  function req(spec) {
    var name = spec.replace(/^.*\//, '').replace(/\.js$/, '');
    if (cache[name]) return cache[name].exports;
    if (!defs[name]) throw new Error('engine: 모듈 없음 ' + spec);
    var module = { exports: {} };
    cache[name] = module;
    defs[name](module, module.exports, req);
    return module.exports;
  }
defs["rules"] = function (module, exports, require) {
'use strict';
// 프론티어 식스 규칙 엔진 (Lost Cities 계열 규칙) (순수 함수, I/O 없음)
// 카드 값: 0 = 투자(wager) 카드, 2~10 = 숫자 카드

// 기본 5색 + 확장판 보라. 클라이언트도 state의 색 순서를 그대로 쓰므로 여기만 고치면 된다.
const COLORS = ['yellow', 'white', 'blue', 'green', 'red', 'purple'];
const HAND_SIZE = 8;
const WAGER_COUNT = 3;
const EXPEDITION_COST = 20;
const BONUS_THRESHOLD = 8;
const BONUS_POINTS = 20;

function buildDeck() {
  const deck = [];
  for (const color of COLORS) {
    for (let i = 1; i <= WAGER_COUNT; i++) {
      deck.push({ id: `${color}-w${i}`, color, value: 0 });
    }
    for (let v = 2; v <= 10; v++) {
      deck.push({ id: `${color}-${v}`, color, value: v });
    }
  }
  return deck;
}

function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// deckLimit: 배분 후 덱을 N장으로 줄인다 (테스트에서 라운드를 빨리 끝내기 위한 용도)
function createGame({ rng = Math.random, firstPlayer = 0, deckLimit = null } = {}) {
  const deck = shuffle(buildDeck(), rng);
  const hands = [[], []];
  for (let i = 0; i < HAND_SIZE; i++) {
    hands[0].push(deck.pop());
    hands[1].push(deck.pop());
  }
  if (deckLimit != null && deckLimit < deck.length) deck.splice(0, deck.length - deckLimit);
  const emptyBoard = () => Object.fromEntries(COLORS.map((c) => [c, []]));
  return {
    deck,
    hands,
    expeditions: [emptyBoard(), emptyBoard()],
    discards: emptyBoard(),
    turn: firstPlayer,
    phase: 'play', // 'play' → 'draw' → 다음 플레이어 'play'
    lastDiscard: null, // 이번 턴에 버린 색 (그 더미에서는 다시 못 뽑음)
    over: false,
  };
}

// 원정대에 카드를 놓을 수 있는가: 투자 카드는 숫자 카드 전에만, 숫자는 오름차순(같은 값 불가)
function canPlayOnExpedition(expedition, card) {
  const last = expedition[expedition.length - 1];
  if (!last) return true;
  if (card.value === 0) return last.value === 0;
  return card.value > last.value; // last가 투자(0)이면 항상 true
}

function scoreExpedition(cards) {
  if (cards.length === 0) return 0;
  const wagers = cards.filter((c) => c.value === 0).length;
  const sum = cards.reduce((s, c) => s + c.value, 0);
  const bonus = cards.length >= BONUS_THRESHOLD ? BONUS_POINTS : 0;
  return (sum - EXPEDITION_COST) * (1 + wagers) + bonus;
}

function scorePlayer(game, p) {
  return COLORS.reduce((s, c) => s + scoreExpedition(game.expeditions[p][c]), 0);
}

function scoresByColor(game, p) {
  return Object.fromEntries(COLORS.map((c) => [c, scoreExpedition(game.expeditions[p][c])]));
}

// 이번 라운드 최고 원정대: 시작한 원정대 중 0점 초과인 최고 점수의 색(동점이면 모두)
function bestColors(game, p) {
  const started = COLORS.filter((c) => game.expeditions[p][c].length > 0);
  const scored = started.map((c) => [c, scoreExpedition(game.expeditions[p][c])]).filter(([, s]) => s > 0);
  if (scored.length === 0) return [];
  const max = Math.max(...scored.map(([, s]) => s));
  return scored.filter(([, s]) => s === max).map(([c]) => c);
}

function fail(message) {
  return { ok: false, error: message };
}

// target: 'expedition' | 'discard'
function playCard(game, p, cardId, target) {
  if (game.over) return fail('게임이 이미 끝났습니다.');
  if (game.turn !== p) return fail('당신의 차례가 아닙니다.');
  if (game.phase !== 'play') return fail('카드를 뽑아야 합니다.');
  const idx = game.hands[p].findIndex((c) => c.id === cardId);
  if (idx < 0) return fail('손에 없는 카드입니다.');
  const card = game.hands[p][idx];

  if (target === 'expedition') {
    if (!canPlayOnExpedition(game.expeditions[p][card.color], card)) {
      return fail('그 항로에는 놓을 수 없는 카드입니다.');
    }
    game.hands[p].splice(idx, 1);
    game.expeditions[p][card.color].push(card);
    game.lastDiscard = null;
  } else if (target === 'discard') {
    game.hands[p].splice(idx, 1);
    game.discards[card.color].push(card);
    game.lastDiscard = card.color;
  } else {
    return fail('알 수 없는 대상입니다.');
  }
  game.phase = 'draw';
  return { ok: true };
}

// source: 'deck' | 색 이름(버린 더미)
function drawCard(game, p, source) {
  if (game.over) return fail('게임이 이미 끝났습니다.');
  if (game.turn !== p) return fail('당신의 차례가 아닙니다.');
  if (game.phase !== 'draw') return fail('먼저 카드를 내야 합니다.');

  let card;
  if (source === 'deck') {
    if (game.deck.length === 0) return fail('탐사 덱이 비었습니다.');
    card = game.deck.pop();
  } else if (COLORS.includes(source)) {
    if (source === game.lastDiscard) return fail('방금 내놓은 시장에서는 바로 가져올 수 없습니다.');
    if (game.discards[source].length === 0) return fail('비어 있는 시장입니다.');
    card = game.discards[source].pop();
  } else {
    return fail('알 수 없는 뽑기 대상입니다.');
  }
  game.hands[p].push(card);
  game.lastDiscard = null;

  if (game.deck.length === 0) {
    game.over = true; // 덱의 마지막 카드를 뽑으면 즉시 종료
  } else {
    game.turn = 1 - p;
    game.phase = 'play';
  }
  return { ok: true };
}

// p 입장에서 본 상태 (상대 손패·덱 내용은 숨김)
function viewFor(game, p) {
  const opp = 1 - p;
  const mine = scorePlayer(game, p);
  const theirs = scorePlayer(game, opp);
  const myTurn = game.turn === p && !game.over;
  const playableIds =
    myTurn && game.phase === 'play'
      ? game.hands[p].filter((c) => canPlayOnExpedition(game.expeditions[p][c.color], c)).map((c) => c.id)
      : [];
  return {
    colors: COLORS,
    hand: game.hands[p],
    oppHandCount: game.hands[opp].length,
    myExpeditions: game.expeditions[p],
    oppExpeditions: game.expeditions[opp],
    discards: game.discards,
    deckCount: game.deck.length,
    myTurn,
    phase: game.phase,
    lastDiscard: game.lastDiscard,
    over: game.over,
    playableIds,
    scores: {
      me: mine,
      opp: theirs,
      meByColor: scoresByColor(game, p),
      oppByColor: scoresByColor(game, opp),
      meBest: bestColors(game, p),
      oppBest: bestColors(game, opp),
    },
    winner: game.over ? (mine === theirs ? 'draw' : mine > theirs ? 'me' : 'opp') : null,
  };
}

module.exports = {
  COLORS,
  HAND_SIZE,
  buildDeck,
  shuffle,
  createGame,
  canPlayOnExpedition,
  scoreExpedition,
  scorePlayer,
  scoresByColor,
  bestColors,
  playCard,
  drawCard,
  viewFor,
};

};
defs["match"] = function (module, exports, require) {
'use strict';
// 3라운드 경기 진행 (순수 함수). 라운드 하나 = rules.js의 game 하나.
const rules = require('./rules');

const TOTAL_ROUNDS = 3;

function createMatch(startSeat = 0) {
  return { startSeat, round: 1, rounds: [] };
}

// 라운드마다 선공 교대
function firstPlayer(match) {
  return (match.startSeat + match.round - 1) % 2;
}

// 끝난 라운드를 기록. 같은 라운드를 두 번 기록하지 않는다.
function recordRound(match, game) {
  if (!game.over || match.rounds.length >= match.round) return false;
  match.rounds.push({
    scores: [rules.scorePlayer(game, 0), rules.scorePlayer(game, 1)],
    byColor: [rules.scoresByColor(game, 0), rules.scoresByColor(game, 1)],
    best: [rules.bestColors(game, 0), rules.bestColors(game, 1)],
  });
  return true;
}

function isOver(match) {
  return match.rounds.length >= TOTAL_ROUNDS;
}

function totals(match) {
  return match.rounds.reduce((t, r) => [t[0] + r.scores[0], t[1] + r.scores[1]], [0, 0]);
}

// 0 | 1 | null(무승부)
function winnerSeat(match) {
  const [a, b] = totals(match);
  return a === b ? null : a > b ? 0 : 1;
}

function nextRound(match) {
  if (match.rounds.length < match.round || isOver(match)) return false;
  match.round += 1;
  return true;
}

// p 입장으로 뒤집은 경기 요약
function viewMatch(match, p) {
  const o = 1 - p;
  const t = totals(match);
  const over = isOver(match);
  const w = over ? winnerSeat(match) : undefined;
  return {
    round: match.round,
    totalRounds: TOTAL_ROUNDS,
    rounds: match.rounds.map((r) => ({
      me: r.scores[p],
      opp: r.scores[o],
      meByColor: r.byColor[p],
      oppByColor: r.byColor[o],
      meBest: r.best[p],
      oppBest: r.best[o],
    })),
    totals: { me: t[p], opp: t[o] },
    over,
    winner: over ? (w === null ? 'draw' : w === p ? 'me' : 'opp') : null,
  };
}

// 기록 저장용 레코드 (좌석 기준)
function toRecord(match, names, room, endedAt = new Date()) {
  return {
    id: `${endedAt.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    endedAt: endedAt.toISOString(),
    room,
    players: names.slice(),
    rounds: match.rounds.map((r) => ({ scores: r.scores, byColor: r.byColor, best: r.best })),
    totals: totals(match),
    winner: winnerSeat(match),
  };
}

module.exports = {
  TOTAL_ROUNDS,
  createMatch,
  firstPlayer,
  recordRound,
  isOver,
  totals,
  winnerSeat,
  nextRound,
  viewMatch,
  toRecord,
};

};
defs["ai"] = function (module, exports, require) {
'use strict';
// 컴퓨터 상대 (순수 함수). 공개 정보(원정대·버린 더미·덱 장수·상대 손패 장수)와 자기 손패만 본다.
// 상대 손패나 덱 순서는 절대 읽지 않는다 — 공정성의 전제 (ai.test.js가 검사).
//
// 난이도
//   easy   : 기본 휴리스틱(basic*) + 절반은 무작위 수
//   normal : 전망 휴리스틱 — 색마다 "라운드 끝까지 남은 내 차례 수 안에서 손패·안 보인 카드로 만들 수 있는 최종 점수"를
//            추정(projectColor)하고, 각 수가 그 전망을 얼마나 바꾸는지로 고른다.
//            → 시간이 없는데 새 원정대를 열거나, 끝낼 수 없는 원정대용 카드를 쥐고 있는 실수를 줄인다.
//   hard   : 몬테카를로 — 안 보인 카드(덱+상대 손패)를 무작위로 여러 번 나눠 놓고(공개 정보와 모순 없게),
//            후보 수마다 라운드 끝까지 빠르게 두어 본 평균 점수 차로 고른다.
const rules = require('./rules');
const { COLORS, canPlayOnExpedition, scorePlayer } = rules;

const LEVELS = ['easy', 'normal', 'hard'];
const ALL_CARDS = rules.buildDeck(); // 카드 구성 (id·색·값). 실제 덱 순서와 무관.

const sum = (cards) => cards.reduce((s, c) => s + c.value, 0);

// 원정대의 마지막 숫자 (숫자 카드가 없으면 1 → 2부터 놓을 수 있음)
function lastNumber(exp) {
  for (let i = exp.length - 1; i >= 0; i--) if (exp[i].value > 0) return exp[i].value;
  return 1;
}

function legalMoves(game, p) {
  const moves = [];
  for (const card of game.hands[p]) {
    if (canPlayOnExpedition(game.expeditions[p][card.color], card)) moves.push({ cardId: card.id, target: 'expedition', card });
    moves.push({ cardId: card.id, target: 'discard', card });
  }
  return moves;
}

function legalDraws(game) {
  const out = ['deck'];
  for (const color of COLORS) if (game.discards[color].length && color !== game.lastDiscard) out.push(color);
  return out;
}

const pickRandom = (arr, rng) => arr[Math.floor(rng() * arr.length)];

// ============================================================================
// 기본 휴리스틱 (쉬움의 바탕, 어려움의 시뮬레이션용 — 빠르다)
// ============================================================================

function basicEvaluatePlay(game, p, card) {
  const hand = game.hands[p];
  const exp = game.expeditions[p][card.color];
  const deckLeft = game.deck.length;
  const last = lastNumber(exp);
  const sameColor = hand.filter((c) => c.color === card.color && c.id !== card.id);
  const nums = sameColor.filter((c) => c.value > 0);

  if (card.value === 0) {
    const s = sum(nums);
    if (deckLeft < 20 || nums.length < 2 || s < 17) return -20 + s / 10;
    return 4 + (s - 17) / 3;
  }
  const dead = nums.filter((c) => c.value > last && c.value < card.value).length;
  if (exp.length > 0) return 8 - (card.value - last - 1) * 1.3 - dead * 3;

  const later = sum(nums.filter((c) => c.value > card.value));
  const wagers = sameColor.filter((c) => c.value === 0).length;
  const projected = card.value + later + (deckLeft / 56) * 10;
  const need = 22 + (deckLeft < 12 ? 6 : 0) + wagers * 2;
  if (projected < need) return -8 - (need - projected) / 5;
  return 2 + (projected - need) / 4 - dead * 3 - card.value / 4;
}

function basicEvaluateDiscard(game, p, card) {
  const mine = game.expeditions[p][card.color];
  const theirs = game.expeditions[1 - p][card.color];
  const deckLeft = game.deck.length;
  let s = -1;
  if (mine.length > 0) {
    if (!canPlayOnExpedition(mine, card)) s += 4;
    else s -= 3 + Math.max(0, 3 - (card.value - lastNumber(mine) - 1));
  } else if (card.value === 0) {
    s += deckLeft > 25 ? -2 : 1;
  } else {
    s -= card.value / 6;
  }
  if (theirs.length > 0 && canPlayOnExpedition(theirs, card)) s -= 2 + card.value / 3;
  return s;
}

function basicMove(game, p, rng) {
  let best = null;
  let bestScore = -Infinity;
  for (const m of legalMoves(game, p)) {
    const score = (m.target === 'expedition' ? basicEvaluatePlay(game, p, m.card) : basicEvaluateDiscard(game, p, m.card)) + rng() * 0.01;
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return { cardId: best.cardId, target: best.target };
}

function basicDraw(game, p) {
  const deckLeft = game.deck.length;
  const behind = scorePlayer(game, p) < scorePlayer(game, 1 - p);
  let best = 'deck';
  let bestScore = 1.5;
  for (const color of COLORS) {
    const pile = game.discards[color];
    if (!pile.length || color === game.lastDiscard) continue;
    const top = pile[pile.length - 1];
    const mine = game.expeditions[p][color];
    const theirs = game.expeditions[1 - p][color];
    let s = -Infinity;
    if (mine.length > 0 && top.value > 0 && canPlayOnExpedition(mine, top)) {
      s = 5 - (top.value - lastNumber(mine) - 1) * 1.2;
    } else if (mine.length === 0 && top.value >= 7 && deckLeft > 10) {
      const handSum = sum(game.hands[p].filter((c) => c.color === color && c.value > 0));
      if (handSum + top.value >= 20) s = 2 + (handSum + top.value - 20) / 5;
    }
    if (s > -Infinity && theirs.length > 0 && canPlayOnExpedition(theirs, top)) s += 1;
    if (deckLeft <= 5 && behind) s = Math.max(s, 2);
    if (s > bestScore) {
      bestScore = s;
      best = color;
    }
  }
  return best;
}

// ============================================================================
// 전망 휴리스틱 (보통)
// ============================================================================

// 공개 정보로 본 '아직 안 보인 카드' = 덱 + 상대 손패 (+ 테스트용으로 빼 둔 카드). 실제 덱·상대 손패는 읽지 않는다.
function unseenCards(game, p) {
  const seen = new Set();
  for (const c of game.hands[p]) seen.add(c.id);
  for (const color of COLORS) {
    for (const c of game.expeditions[0][color]) seen.add(c.id);
    for (const c of game.expeditions[1][color]) seen.add(c.id);
    for (const c of game.discards[color]) seen.add(c.id);
  }
  return ALL_CARDS.filter((c) => !seen.has(c.id));
}

// 이번 차례를 포함해 라운드가 끝날 때까지 p가 카드를 낼 수 있는 횟수.
// 덱 D장, 내 '내기' 차례면 ceil(D/2). 이미 냈고 '뽑기' 차례면 앞으로 floor((D-1)/2).
function playsLeft(game, p) {
  const D = game.deck.length;
  if (game.turn === p && game.phase === 'play') return Math.ceil(D / 2);
  if (game.turn === p) return Math.floor((D - 1) / 2);
  return Math.floor(D / 2); // 상대 차례 중
}

// 조정값 (벤치마크로 정함. CLAUDE.md 참고)
const TUNE = {
  risk: 0.3, // 아직 오지 않은 카드에 기대는 만큼 깎는 비율
  optionScale: 2, // 시작 안 한 성계의 '나중에 열 수도 있음' 가치의 폭 (softplus 폭)
  openPenalty: 1.5, // 새 항로를 여는 수에 주는 벌점 (투자 계약이면 +0.5)
  oppUnstarted: 0.25, // 상대가 아직 안 연 성계의 카드를 버릴 때 위험 비율 (5 이상)
  oppStarted: 0.7, // 상대 항로에 바로 이어질 카드를 버릴 때 비율
  // 어려움
  hardCandidates: 4, // 휴리스틱 상위 몇 수만 시뮬레이션
  hardMinGain: 2, // 휴리스틱 1순위를 바꾸려면 평균 이만큼 더 나아야 하고
  hardZ: 2, // 표준오차의 이 배수보다도 커야 한다
};

// 경기 상황: lead = 이번 라운드 전까지 누적 점수 차(내 − 상대), roundsLeft = 이번 포함 남은 라운드
function matchInfo(opts) {
  const m = (opts && opts.match) || {};
  return { lead: Number(m.lead) || 0, roundsLeft: Number(m.roundsLeft) || 3 };
}

function makeContext(game, p, opts) {
  const unseen = unseenCards(game, p);
  const byColor = {};
  for (const color of COLORS) byColor[color] = [];
  for (const c of unseen) byColor[c.color].push(c.value);
  const plays = playsLeft(game, p);
  const draws = game.turn === p && game.phase === 'draw' ? plays : Math.max(0, plays - 1); // 다음 '내기' 전에 뽑을 수 있는 횟수
  const m = matchInfo(opts);
  const final = m.roundsLeft <= 1;
  // (마지막 라운드에 앞서면 덜 위험하게·뒤지면 과감하게 하는 조정은 벤치에서 차이가 없어 넣지 않았다.
  //  경기 상황은 덱 소진 속도 판단(lead)과 어려움의 효용 함수(utility)에서 쓴다.)
  return {
    plays,
    unseen,
    unseenByColor: byColor,
    // 안 보인 카드 한 장이 쓸 수 있는 때에 내 손에 들어올 대략의 확률
    q: unseen.length ? Math.min(1, draws / unseen.length) : 0,
    risk: TUNE.risk,
    // 덱 소진 속도 판단에 쓰는 '앞선 정도': 마지막 라운드면 누적 점수 차까지 더한다 (승패가 걸린 점수)
    lead: scorePlayer(game, p) - scorePlayer(game, 1 - p) + (final ? m.lead : 0),
    // 시작 안 한 성계의 선택 가치 폭: 남은 차례가 적을수록 줄어든다
    option: 1 + (TUNE.optionScale - 1) * Math.min(1, plays / 12),
    openPenalty: TUNE.openPenalty,
  };
}

// 시작 안 한 성계 = '안 열 수도 있다'. 전망 x가 음수여도 운이 좋으면 열 수 있으니 max(0, x)의 기대값처럼 부드럽게 친다.
// 예전처럼 0으로 자르면 혼자 있는 높은 카드의 가치가 0이 되어 일찍 버리는 문제가 있었다.
function softFloor(x, s) {
  if (x === -Infinity) return 0;
  if (x / s > 30) return x;
  return s * Math.log1p(Math.exp(x / s));
}

// 한 색의 최종 점수 전망: 원정대 exp에 손패 hand(같은 색)를 budget번 안에 놓고, 안 보인 카드 중 일부를 더 받는다고 볼 때.
// 시작 안 한 색은 '시작하지 않음(0점)'도 선택지라 0 이상 (softFloor).
function projectColor(ctx, color, exp, hand, budget) {
  const started = exp.length > 0;
  const expW = exp.filter((c) => c.value === 0).length;
  const hasNum = exp.some((c) => c.value > 0);
  const last = lastNumber(exp);
  const expSum = sum(exp);
  const handW = hasNum ? 0 : hand.filter((c) => c.value === 0).length;
  const nums = hand.filter((c) => c.value > last).map((c) => c.value).sort((a, b) => b - a); // 큰 것부터
  const above = ctx.unseenByColor[color].filter((v) => v > last);
  const aboveAvg = above.length ? above.reduce((s, v) => s + v, 0) / above.length : 0;

  const risk = ctx.risk == null ? TUNE.risk : ctx.risk;
  let best = -Infinity;
  for (let k = 0; k <= handW; k++) {
    const room = budget - k;
    if (room < 0) break;
    const chosen = nums.slice(0, room);
    if (!started && k === 0 && chosen.length === 0) continue;
    const w = expW + k;
    // 앞으로 받을 카드: 남은 차례와 확률로 제한. 손패보다 낮은 값은 순서가 꼬일 수 있어 절반만 친다.
    const fN = Math.min(Math.max(0, room - chosen.length), above.length * ctx.q * 0.7);
    const fSum = fN * aboveAvg;
    const total = expSum + chosen.reduce((s, v) => s + v, 0) + fSum;
    const count = exp.length + k + chosen.length + fN;
    let v = (total - 20) * (1 + w) + (count >= 8 ? 20 : 0);
    v -= fSum * (1 + w) * risk; // 아직 오지 않은 카드에 기대는 만큼 위험
    if (v > best) best = v;
  }
  if (!started) return softFloor(best, ctx.option || TUNE.optionScale);
  return best;
}

// 상대가 이 카드를 가져가 쓸 때 얻는 대략의 이익 (oppPlays = 상대에게 남은 대략의 차례)
function oppGain(game, p, card, oppPlays = 20) {
  const theirs = game.expeditions[1 - p][card.color];
  if (theirs.length > 0) {
    if (!canPlayOnExpedition(theirs, card)) return 0;
    const w = theirs.filter((c) => c.value === 0).length;
    return card.value * (1 + w) * TUNE.oppStarted;
  }
  // 상대가 아직 안 연 성계: 높은 카드는 그대로 새 항로의 밑천이 된다 (사람은 시장의 9·10을 잘 주워 간다)
  return card.value >= 5 ? card.value * TUNE.oppUnstarted * Math.min(1, oppPlays / 10) : 0;
}

const handOf = (game, p, color) => game.hands[p].filter((c) => c.color === color);

// '내기' 단계의 각 수 점수 (높을수록 좋음)
function scoreMoves(game, p, opts) {
  const ctx = makeContext(game, p, opts);
  const oppPlays = Math.floor(game.deck.length / 2);
  const budget = Math.max(0, ctx.plays - 1); // 이번 수 다음에 남는 차례
  const baseCache = {};
  const base = (color) => {
    if (!(color in baseCache)) baseCache[color] = projectColor(ctx, color, game.expeditions[p][color], handOf(game, p, color), budget);
    return baseCache[color];
  };
  return legalMoves(game, p).map((m) => {
    const color = m.card.color;
    const exp = game.expeditions[p][color];
    const rest = handOf(game, p, color).filter((c) => c.id !== m.cardId);
    let s;
    if (m.target === 'expedition') {
      s = projectColor(ctx, color, exp.concat([m.card]), rest, budget) - base(color);
      if (exp.length > 0) s += 0.5; // 진행 중 원정대는 미루지 않는다
      else s -= ctx.openPenalty + (m.card.value === 0 ? 0.5 : 0); // 여는 비용의 대부분은 softFloor(선택 가치)가 이미 반영
    } else {
      s = projectColor(ctx, color, exp, rest, budget) - base(color) - oppGain(game, p, m.card, oppPlays);
    }
    return { move: m, score: s };
  });
}

function heuristicMove(game, p, rng, opts) {
  let best = null;
  for (const x of scoreMoves(game, p, opts)) {
    const s = x.score + rng() * 0.01;
    if (!best || s > best.s) best = { m: x.move, s };
  }
  return { cardId: best.m.cardId, target: best.m.target };
}

// '뽑기' 단계의 각 선택 점수
function scoreDraws(game, p, opts) {
  const ctx = makeContext(game, p, opts);
  const oppPlays = Math.floor(game.deck.length / 2);
  const budget = ctx.plays;
  const D = game.deck.length;
  // 색·값이 같으면 이득도 같으니 캐시한다 (어려움의 시뮬레이션에서 가장 자주 불리는 곳)
  const baseCache = {};
  const gainCache = {};
  const gainOf = (card) => {
    const key = card.color + card.value;
    if (key in gainCache) return gainCache[key];
    const exp = game.expeditions[p][card.color];
    const hand = handOf(game, p, card.color);
    if (!(card.color in baseCache)) baseCache[card.color] = projectColor(ctx, card.color, exp, hand, budget);
    return (gainCache[key] = projectColor(ctx, card.color, exp, hand.concat([card]), budget) - baseCache[card.color]);
  };
  // 덱: 안 보인 카드 아무거나 한 장의 평균 이득
  const unseen = ctx.unseen;
  let deckGain = unseen.length ? unseen.reduce((s, c) => s + gainOf(c), 0) / unseen.length : 0;
  // 덱을 뽑으면 라운드가 빨리 끝난다: 앞서면 이득, 뒤지면 손해 (막판일수록 크게)
  if (D <= 14) {
    let tempo = Math.max(-4, Math.min(4, ctx.lead / 8)) * (1 - D / 15);
    // 뒤질 때 시장에서 뽑아 시간을 끄는 건 남은 차례에 낼 카드가 있을 때만 의미가 있다 (없으면 헛돌기만 한다)
    if (tempo < 0) {
      const useful = game.hands[p].filter((c) => {
        const exp = game.expeditions[p][c.color];
        return exp.length > 0 && c.value > 0 && canPlayOnExpedition(exp, c);
      }).length;
      tempo *= Math.min(1, useful / 2);
    }
    deckGain += tempo;
  }
  const out = [{ source: 'deck', score: deckGain + 0.3 }];
  for (const color of legalDraws(game)) {
    if (color === 'deck') continue;
    const pile = game.discards[color];
    const top = pile[pile.length - 1];
    out.push({ source: color, score: gainOf(top) + oppGain(game, p, top, oppPlays) * 0.7 });
  }
  return out;
}

function heuristicDraw(game, p, opts) {
  let best = null;
  for (const x of scoreDraws(game, p, opts)) if (!best || x.score > best.score) best = x;
  return best.source;
}

// 시뮬레이션용 빠른 뽑기: 덱의 평균 이득(안 보인 카드 전부 계산)을 고정값으로 어림하고 시장 맨 위 카드만 따진다.
// heuristicDraw보다 열 배쯤 빨라 같은 시간에 더 많은 판을 굴릴 수 있다.
function fastDraw(game, p, opts) {
  const piles = legalDraws(game).filter((s) => s !== 'deck');
  if (!piles.length) return 'deck';
  const ctx = makeContext(game, p, opts);
  const budget = ctx.plays;
  const D = game.deck.length;
  const oppPlays = Math.floor(D / 2);
  let deckScore = 1;
  if (D <= 14) deckScore += Math.max(-4, Math.min(4, ctx.lead / 8)) * (1 - D / 15);
  let best = 'deck';
  let bestScore = deckScore;
  for (const color of piles) {
    const pile = game.discards[color];
    const top = pile[pile.length - 1];
    const exp = game.expeditions[p][color];
    const hand = handOf(game, p, color);
    const gain = projectColor(ctx, color, exp, hand.concat([top]), budget) - projectColor(ctx, color, exp, hand, budget);
    const s = gain + oppGain(game, p, top, oppPlays) * 0.7;
    if (s > bestScore) {
      bestScore = s;
      best = color;
    }
  }
  return best;
}

// ============================================================================
// 몬테카를로 (어려움)
// ============================================================================

const copyBoard = (b) => {
  const o = {};
  for (const color of COLORS) o[color] = b[color].slice();
  return o;
};

// 공개 정보와 모순 없는 가상의 판: 안 보인 카드를 섞어 상대 손패(장수 유지)와 덱(장수 유지)에 나눈다
function determinize(game, p, unseen, rng) {
  const pool = rules.shuffle(unseen, rng);
  const oppN = game.hands[1 - p].length;
  const hands = [];
  hands[p] = game.hands[p].slice();
  hands[1 - p] = pool.slice(0, oppN);
  return {
    deck: pool.slice(oppN, oppN + game.deck.length),
    hands,
    expeditions: [copyBoard(game.expeditions[0]), copyBoard(game.expeditions[1])],
    discards: copyBoard(game.discards),
    turn: game.turn,
    phase: game.phase,
    lastDiscard: game.lastDiscard,
    over: false,
  };
}

const cloneGame = (g) => ({
  ...g,
  deck: g.deck.slice(),
  hands: [g.hands[0].slice(), g.hands[1].slice()],
  expeditions: [copyBoard(g.expeditions[0]), copyBoard(g.expeditions[1])],
  discards: copyBoard(g.discards),
});

// 상대 입장에서 본 경기 상황
const flipMatch = (opts) => {
  const m = matchInfo(opts);
  return { match: { lead: -m.lead, roundsLeft: m.roundsLeft } };
};

// 시뮬레이션 결과 점수 차 d를 '경기에 얼마나 좋은가'로 바꾼다.
// 마지막 라운드는 누적 점수로 이기느냐가 전부라 이미 크게 앞서면 더 벌어도, 크게 뒤지면 덜 져도 의미가 적다.
function utility(d, opts) {
  const m = matchInfo(opts);
  if (m.roundsLeft > 1) return d;
  return 40 * Math.tanh((m.lead + d) / 25);
}

// 라운드 끝까지 휴리스틱으로 두고 p 기준 효용을 돌려준다
function rollout(g, p, rng, opts) {
  const views = [];
  views[p] = opts;
  views[1 - p] = flipMatch(opts);
  let guard = 0;
  while (!g.over && guard++ < 400) {
    const q = g.turn;
    if (g.phase === 'play') {
      const mv = heuristicMove(g, q, rng, views[q]);
      rules.playCard(g, q, mv.cardId, mv.target);
    } else {
      rules.drawCard(g, q, fastDraw(g, q, views[q]));
    }
  }
  return utility(scorePlayer(g, p) - scorePlayer(g, 1 - p), opts);
}

// 시뮬레이션 양: samples를 주면 정확히 그만큼(테스트·벤치), 안 주면 생각 시간(ms) 안에서 최소~최대 판.
// 기기가 느리면(휴대폰) 저절로 판 수가 줄어든다.
const HARD_MIN_SAMPLES = 16;
const HARD_MAX_SAMPLES = 200;
const HARD_THINK_MS = { move: 800, draw: 300 };

// candidates[0] = 휴리스틱이 고른 수. 같은 가상의 판들에서 짝지어 비교(운의 차이 상쇄)하고,
// 다른 수가 '확실히'(평균 차 > 2×표준오차, 그리고 2점 이상) 나을 때만 바꾼다.
// 표본이 적을 때 잡음에 휘둘려 오히려 약해지는 것을 막는다.
function monteCarlo(game, p, candidates, rng, samples, opts, thinkMs) {
  if (candidates.length === 1) return candidates[0].key;
  const unseen = unseenCards(game, p);
  const diffs = candidates.map(() => []);
  const fixed = Number(samples) > 0;
  const maxN = fixed ? samples : HARD_MAX_SAMPLES;
  const deadline = fixed ? Infinity : Date.now() + thinkMs;
  for (let i = 0; i < maxN && (fixed || i < HARD_MIN_SAMPLES || Date.now() < deadline); i++) {
    const world = determinize(game, p, unseen, rng);
    const results = candidates.map((cand) => {
      const g = cloneGame(world);
      cand.apply(g);
      return rollout(g, p, rng, opts);
    });
    for (let j = 1; j < candidates.length; j++) diffs[j].push(results[j] - results[0]);
  }
  let best = 0;
  let bestMean = 0;
  for (let j = 1; j < candidates.length; j++) {
    const d = diffs[j];
    const mean = d.reduce((s, x) => s + x, 0) / d.length;
    const varc = d.reduce((s, x) => s + (x - mean) * (x - mean), 0) / Math.max(1, d.length - 1);
    const se = Math.sqrt(varc / d.length);
    if (mean > TUNE.hardMinGain && mean > TUNE.hardZ * se && mean > bestMean) {
      best = j;
      bestMean = mean;
    }
  }
  return candidates[best].key;
}

function hardMove(game, p, rng, samples, opts) {
  const ranked = scoreMoves(game, p, opts).sort((a, b) => b.score - a.score).slice(0, TUNE.hardCandidates);
  const candidates = ranked.map(({ move }) => ({
    key: move,
    apply: (g) => {
      rules.playCard(g, p, move.cardId, move.target);
      if (!g.over) rules.drawCard(g, p, heuristicDraw(g, p, opts));
    },
  }));
  const m = monteCarlo(game, p, candidates, rng, samples, opts, HARD_THINK_MS.move);
  return { cardId: m.cardId, target: m.target };
}

function hardDraw(game, p, rng, samples, opts) {
  const ranked = scoreDraws(game, p, opts).sort((a, b) => b.score - a.score).slice(0, 3);
  const candidates = ranked.map(({ source }) => ({ key: source, apply: (g) => rules.drawCard(g, p, source) }));
  return monteCarlo(game, p, candidates, rng, samples, opts, HARD_THINK_MS.draw);
}

// ============================================================================
// 공개 함수
// ============================================================================

// 낼 카드 선택 → { cardId, target }
// opts.samples: 어려움의 시뮬레이션 횟수 (테스트·벤치에서 고정. 없으면 생각 시간으로 정함)
// opts.match: { lead, roundsLeft } 경기 상황 (없으면 라운드 점수만 본다)
function chooseMove(game, p, { level = 'normal', rng = Math.random, samples, match } = {}) {
  const opts = { match };
  if (level === 'easy') {
    if (rng() < 0.5) {
      const m = pickRandom(legalMoves(game, p), rng);
      return { cardId: m.cardId, target: m.target };
    }
    return basicMove(game, p, rng);
  }
  if (level === 'basic') return basicMove(game, p, rng); // 내부·테스트용 (예전 보통)
  if (level === 'hard') return hardMove(game, p, rng, samples, opts);
  return heuristicMove(game, p, rng, opts);
}

// 뽑을 곳 선택 → 'deck' | 색
function chooseDraw(game, p, { level = 'normal', rng = Math.random, samples, match } = {}) {
  const opts = { match };
  if (level === 'easy') return rng() < 0.5 ? 'deck' : basicDraw(game, p);
  if (level === 'basic') return basicDraw(game, p);
  if (level === 'hard') return hardDraw(game, p, rng, samples, opts);
  return heuristicDraw(game, p, opts);
}

module.exports = { LEVELS, TUNE, chooseMove, chooseDraw, lastNumber, projectColor, unseenCards, playsLeft };

};
defs["stats"] = function (module, exports, require) {
'use strict';
// 대전 기록 통계 (순수 함수). 서버(history.js)와 브라우저 전용 혼자 하기 빌드가 함께 쓴다.

const MAX_RECORDS = 1000; // 기록이 무한히 커지지 않도록 오래된 것부터 버림

// 이름별 통계
function computeStats(records) {
  const by = new Map();
  const get = (name) => {
    if (!by.has(name)) {
      by.set(name, {
        name, games: 0, wins: 0, losses: 0, draws: 0, totalScore: 0,
        bestTotal: null, bestRound: null, bestExpedition: null, bestColorCounts: {},
      });
    }
    return by.get(name);
  };

  for (const rec of records) {
    rec.players.forEach((name, seat) => {
      const s = get(name);
      const total = rec.totals[seat];
      s.games += 1;
      if (rec.winner === null) s.draws += 1;
      else if (rec.winner === seat) s.wins += 1;
      else s.losses += 1;
      s.totalScore += total;
      if (s.bestTotal === null || total > s.bestTotal) s.bestTotal = total;
      for (const r of rec.rounds) {
        if (s.bestRound === null || r.scores[seat] > s.bestRound) s.bestRound = r.scores[seat];
        for (const [color, score] of Object.entries(r.byColor[seat])) {
          if (score !== 0 && (s.bestExpedition === null || score > s.bestExpedition.score)) {
            s.bestExpedition = { color, score };
          }
        }
        for (const c of r.best[seat]) s.bestColorCounts[c] = (s.bestColorCounts[c] || 0) + 1;
      }
    });
  }

  return [...by.values()]
    .map((s) => {
      const fav = Object.entries(s.bestColorCounts).sort((a, b) => b[1] - a[1])[0];
      return {
        name: s.name,
        games: s.games,
        wins: s.wins,
        losses: s.losses,
        draws: s.draws,
        winRate: s.games ? s.wins / s.games : 0,
        avgScore: s.games ? Math.round((s.totalScore / s.games) * 10) / 10 : 0,
        bestTotal: s.bestTotal,
        bestRound: s.bestRound,
        bestExpedition: s.bestExpedition,
        favoriteColor: fav ? fav[0] : null, // 라운드 최고 원정대로 가장 자주 뽑힌 색
      };
    })
    .sort((a, b) => b.wins - a.wins || b.winRate - a.winRate || b.games - a.games || a.name.localeCompare(b.name));
}

module.exports = { computeStats, MAX_RECORDS };

};
defs["solo"] = function (module, exports, require) {
'use strict';
// 혼자 하기(컴퓨터 상대) 공용 부품. 서버의 혼자 하기 방(index.js)과 브라우저 전용 빌드(offline/)가 함께 쓴다.
// I/O·타이머 없음. 세션은 JSON으로 그대로 저장/복원할 수 있는 순수 객체다.
const rules = require('./rules');
const matchLib = require('./match');
const ai = require('./ai');

// 봇 이름의 🤖는 사람 이름에 쓸 수 없게 막아 기록에서 구분된다
const BOT_NAMES = { easy: '🤖 컴퓨터(쉬움)', normal: '🤖 컴퓨터(보통)', hard: '🤖 컴퓨터(어려움)' };
const SOLO_CODE_RE = /^SOLO-[A-Z0-9]{6}$/; // 사람이 만드는 방 코드(영문/숫자만)와 겹치지 않는 형식
const HUMAN = 0;
const BOT = 1;

// 사람 이름 검사. 문제가 있으면 오류 메시지, 없으면 null
function nameError(name) {
  if (name.length < 1 || name.length > 12) return '이름은 1~12자입니다.';
  if (name.includes('🤖')) return '이름에 🤖는 쓸 수 없습니다. (컴퓨터 표시용)';
  return null;
}

function newSoloCode(taken = () => false) {
  let code;
  do code = 'SOLO-' + Math.random().toString(36).slice(2, 8).toUpperCase();
  while (taken(code) || !SOLO_CODE_RE.test(code));
  return code;
}

// AI에 넘길 경기 상황: 이번 라운드 전까지 누적 점수 차(p 기준)와 이번 포함 남은 라운드 수
function matchContext(match, p) {
  if (!match) return undefined;
  const t = matchLib.totals(match);
  return { lead: t[p] - t[1 - p], roundsLeft: matchLib.TOTAL_ROUNDS - match.round + 1 };
}

// 봇 차례에 한 동작(내기 또는 뽑기). AI가 잘못된 수를 내면 안전한 수로 대신한다.
function botStep(game, p, level, match) {
  const opts = { level, match: matchContext(match, p) };
  let result;
  if (game.phase === 'play') {
    const mv = ai.chooseMove(game, p, opts);
    result = rules.playCard(game, p, mv.cardId, mv.target);
    if (!result.ok) result = rules.playCard(game, p, game.hands[p][0].id, 'discard');
  } else {
    result = rules.drawCard(game, p, ai.chooseDraw(game, p, opts));
    if (!result.ok) result = rules.drawCard(game, p, 'deck');
  }
  return result;
}

// ---------- 브라우저 전용 세션 (서버의 방 하나에 해당) ----------
// 사람은 0번, 봇은 1번 좌석. 상태 메시지 모양은 서버의 sendState와 같다.

function createSession({ name, level, code = newSoloCode(), gameOptions = {} }) {
  const session = {
    code, level, gameOptions,
    names: [name, BOT_NAMES[level]],
    match: null, game: null, ready: [], nextStartSeat: 0,
  };
  startMatch(session);
  return session;
}

function startMatch(s) {
  s.match = matchLib.createMatch(s.nextStartSeat);
  s.nextStartSeat = 1 - s.nextStartSeat; // 다음 경기는 선공 교대
  s.game = rules.createGame({ ...s.gameOptions, firstPlayer: matchLib.firstPlayer(s.match) });
}

function stateFor(s) {
  return {
    type: 'state',
    room: s.code,
    seat: HUMAN,
    names: { me: s.names[HUMAN], opp: s.names[BOT] },
    solo: true,
    oppConnected: true,
    readyRequested: s.ready.includes(HUMAN),
    oppReady: s.ready.includes(BOT),
    game: rules.viewFor(s.game, HUMAN),
    match: matchLib.viewMatch(s.match, HUMAN),
  };
}

// 라운드가 끝났으면 기록. 경기가 끝났으면 저장할 기록 레코드를 돌려준다.
function settle(s) {
  if (!s.game.over) return null;
  let record = null;
  if (matchLib.recordRound(s.match, s.game) && matchLib.isOver(s.match)) {
    record = matchLib.toRecord(s.match, s.names, s.code);
    record.vsAI = s.level;
  }
  if (!s.ready.includes(BOT)) s.ready.push(BOT); // 봇은 언제나 다음 라운드 준비 완료
  return record;
}

// 사람의 play/draw. { ok, error } + 경기가 끝났으면 record
function humanAction(s, msg) {
  const result =
    msg.type === 'play'
      ? rules.playCard(s.game, HUMAN, String(msg.cardId), msg.target)
      : rules.drawCard(s.game, HUMAN, String(msg.source));
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, record: settle(s) };
}

// 라운드 종료 후 '다음'. 상태가 바뀌었으면 true
function humanNext(s) {
  if (!s.game.over) return false;
  if (!s.ready.includes(HUMAN)) s.ready.push(HUMAN);
  if (s.ready.length === 2) {
    s.ready = [];
    if (matchLib.isOver(s.match)) startMatch(s);
    else {
      matchLib.nextRound(s.match);
      s.game = rules.createGame({ ...s.gameOptions, firstPlayer: matchLib.firstPlayer(s.match) });
    }
  }
  return true;
}

function isBotTurn(s) {
  return !s.game.over && s.game.turn === BOT;
}

// 봇 한 동작. 경기가 끝났으면 { record }
function botTurn(s) {
  const result = botStep(s.game, BOT, s.level, s.match);
  if (!result.ok) return { ok: false, error: result.error, record: null };
  return { ok: true, record: settle(s) };
}

module.exports = {
  BOT_NAMES, SOLO_CODE_RE, HUMAN, BOT,
  nameError, newSoloCode, botStep, matchContext,
  createSession, stateFor, humanAction, humanNext, isBotTurn, botTurn,
};

};
defs["local-socket"] = function (module, exports, require) {
'use strict';
// 브라우저 전용(서버 없는) 혼자 하기. WebSocket과 같은 모양의 가짜 소켓이라 app.js는 거의 그대로 쓴다.
// 게임 판정은 서버와 같은 server/solo.js(→ rules/match/ai)가 한다. 진행 중인 게임·기록은 localStorage에 둔다.
const solo = require('./solo');
const { computeStats, MAX_RECORDS } = require('./stats');

const SESSION_KEY = 'lc-offline-session'; // 진행 중인 게임 (앱을 껐다 켜도 이어 하기)
const HISTORY_KEY = 'lc-offline-history'; // 끝난 경기 기록
const BOT_DELAY_MS = 700; // 컴퓨터가 한 동작마다 기다리는 시간 (서버와 같음)

function load(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v == null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function store(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // 저장 공간이 없거나 막혀 있어도 게임은 계속한다 (이어 하기·기록만 안 남음)
  }
}

function readRecords() {
  const r = load(HISTORY_KEY, []);
  return Array.isArray(r) ? r : [];
}

function addRecord(record) {
  const r = readRecords();
  r.push(record);
  store(HISTORY_KEY, r.slice(-MAX_RECORDS));
}

// 서버의 GET /api/history 와 같은 모양
function history(limit = 50) {
  const r = readRecords();
  return { stats: computeStats(r), matches: r.slice(-limit).reverse() };
}

class LocalSocket {
  // options.botDelayMs: 테스트에서 0으로 줄인다 (app.js는 인자 없이 만든다)
  constructor(options) {
    const o = options || {};
    this.botDelayMs = typeof o.botDelayMs === 'number' ? o.botDelayMs : BOT_DELAY_MS;
    this.readyState = 0; // WebSocket과 같은 값: 0 연결 중, 1 열림, 3 닫힘
    this.session = null;
    this.botTimer = null;
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    setTimeout(() => {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      if (this.onopen) this.onopen();
    }, 0);
  }

  send(raw) {
    if (this.readyState !== 1) return;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return;
    }
    setTimeout(() => this.handle(msg), 0); // 서버처럼 비동기로 응답
  }

  close() {
    this.readyState = 3;
    clearTimeout(this.botTimer);
    this.botTimer = null;
  }

  emit(msg) {
    if (this.readyState === 1 && this.onmessage) this.onmessage({ data: JSON.stringify(msg) });
  }

  error(message) {
    this.emit({ type: 'error', message });
  }

  handle(msg) {
    if (this.readyState !== 1 || !msg || typeof msg.type !== 'string') return;
    if (msg.type === 'join') return this.join(msg);
    const s = this.session;
    if (!s) return this.error('먼저 게임을 시작하세요.');
    if (msg.type === 'play' || msg.type === 'draw') {
      if (s.game.turn !== solo.HUMAN && !s.game.over) return this.error('상대 차례입니다.');
      const r = solo.humanAction(s, msg);
      if (!r.ok) return this.error(r.error);
      this.commit(r.record);
    } else if (msg.type === 'next') {
      if (solo.humanNext(s)) this.commit(null);
    } else if (msg.type === 'sync') {
      this.emit(solo.stateFor(s));
    }
  }

  join(msg) {
    const name = String(msg.name || '').trim();
    const bad = solo.nameError(name);
    if (bad) return this.error(bad);
    if (msg.solo) {
      const level = String(msg.level || 'normal');
      if (!solo.BOT_NAMES[level]) return this.error('알 수 없는 난이도입니다.');
      this.session = solo.createSession({ name, level });
      this.commit(null);
      return;
    }
    // 새로고침·앱 재실행: 저장해 둔 게임으로 이어 하기
    const code = String(msg.room || '').toUpperCase();
    const saved = load(SESSION_KEY, null);
    if (!saved || saved.code !== code || !saved.game || !saved.match) {
      return this.error('혼자 하기 게임이 종료되었습니다. 새로 시작해 주세요.');
    }
    this.session = saved;
    this.commit(null);
  }

  // 상태 저장 → 화면 갱신 → 봇 차례면 예약
  commit(record) {
    if (record) addRecord(record);
    store(SESSION_KEY, this.session);
    this.emit(solo.stateFor(this.session));
    this.scheduleBot();
  }

  scheduleBot() {
    if (this.botTimer || !this.session || !solo.isBotTurn(this.session)) return;
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      if (this.readyState !== 1) return;
      const r = solo.botTurn(this.session);
      if (!r.ok) console.error('봇 동작 실패: ' + r.error);
      this.commit(r.record);
    }, this.botDelayMs);
  }
}

module.exports = { LocalSocket, history };

};
  window.LCEngine = req("local-socket");
})();
