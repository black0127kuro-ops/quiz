/**
 * 早押しクイズ サーバ (v1.1)
 *
 * 機能:
 *  - 部屋作成 / 参加 / ニックネーム
 *  - 出題文の 1 文字ずつ全クライアント同期配信
 *  - 早押し（上位5名・1/100秒精度・サーバ受信時刻ベース）
 *  - 10 秒カウント（0 で自動不正解 → 次順位者へ）
 *  - 「続きを流す」「最初から」「次の問題」での順位リセット
 *  - スコア表（参加者ごとの正解数を集計、全員の画面に表示）
 *  - 効果音差し替え（デデン / ピンポン / ブー / ブザー）… 主催者ブラウザ内のみ
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const ITEM_CATALOG = require('./public/items-catalog.js');
const ITEM_BY_ID = Object.fromEntries(ITEM_CATALOG.map(it => [it.id, it]));
const DEFAULT_ENABLED_ITEMS = ['delay5', 'steal_stealth', 'flip', 'flash', 'bonusQ'];

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');

const MAX_ROOMS = 500;
const MAX_PLAYERS_PER_ROOM = 80;

// ----------------------------------------------------------------------
// .env 読み込み（任意）
// ----------------------------------------------------------------------
function loadEnvFile() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnvFile();

// ----------------------------------------------------------------------
// Express + Socket.IO
// ----------------------------------------------------------------------
const app = express();
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 2e6
});

app.use(express.json({ limit: '1mb' }));

// セキュリティヘッダ・旧アップロードパスの無効化
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use('/uploads', (_req, res) => {
  res.status(410).json({ ok: false, error: 'uploads_disabled' });
});
app.use('/api/upload', (_req, res) => {
  res.status(410).json({ ok: false, error: 'uploads_disabled' });
});
app.use('/api/sets', (_req, res) => {
  res.status(410).json({ ok: false, error: 'sets_api_removed_use_browser_storage' });
});

function sendPublicHtml(res, filename) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.sendFile(path.join(PUBLIC_DIR, filename));
}

app.use(express.static(PUBLIC_DIR, {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
    }
  }
}));

app.get('/', (_req, res) => sendPublicHtml(res, 'index.html'));
app.get('/guide', (_req, res) => sendPublicHtml(res, 'guide.html'));
app.get('/terms', (_req, res) => sendPublicHtml(res, 'terms.html'));
app.get('/host', (_req, res) => sendPublicHtml(res, 'host.html'));
app.get('/player', (_req, res) => sendPublicHtml(res, 'player.html'));

// ----------------------------------------------------------------------
// レート制限（メモリ内・単一プロセス向け）
// ----------------------------------------------------------------------
const rateBuckets = new Map();
function clientIpFromSocket(socket) {
  const h = socket.handshake.headers || {};
  const xf = h['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
  return socket.handshake.address || 'unknown';
}
function checkRateLimit(key, max, windowMs) {
  const now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    rateBuckets.set(key, bucket);
  }
  bucket.count += 1;
  return bucket.count <= max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of rateBuckets.entries()) {
    if (now >= b.resetAt) rateBuckets.delete(k);
  }
}, 60_000);

function sanitizeNickname(raw) {
  return String(raw || '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[<>&]/g, '')
    .trim()
    .slice(0, 20) || '名無し';
}

function sanitizeQuestions(arr) {
  return (arr || []).slice(0, 200).map(q => ({
    id: typeof q.id === 'string' && q.id ? q.id.slice(0, 32) : crypto.randomBytes(6).toString('hex'),
    text: String(q.text || '').slice(0, 2000),
    answer: String(q.answer || '').slice(0, 500),
    explanation: String(q.explanation || '').slice(0, 2000),
    points: Number.isFinite(Number(q.points)) ? Math.max(-99, Math.min(999, Math.round(Number(q.points)))) : 1
  }));
}

// ----------------------------------------------------------------------
// 部屋管理
// ----------------------------------------------------------------------
const rooms = new Map();

function generateRoomCode() {
  for (let i = 0; i < 50; i++) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    if (!rooms.has(code)) return code;
  }
  return String(1000 + (Date.now() % 9000));
}

function makeRoom(hostSocketId) {
  const code = generateRoomCode();
  const room = {
    code,
    hostId: hostSocketId,
    players: new Map(), // socketId -> { nickname, score, joinedAt }

    // ホストが編集中の問題リスト
    questions: [],
    currentIndex: -1,

    // 出題進行
    question: '',
    revealIndex: 0,
    revealSpeed: 150,
    revealTimer: null,
    revealing: false,
    questionStartedAt: null,

    // 早押し
    buzzes: [],
    answeringId: null,
    answerDeadline: null,
    answerTimer: null,
    missed: new Set(),

    // 自動進行（出題完了 → 30秒 → 自動的に次の問題）
    autoAdvanceTimer: null,
    autoAdvanceWarnTimer: null,
    autoAdvanceDeadline: null,

    // 出題開始タイトル（「第N問」演出）の遅延タイマ
    pendingRevealTimer: null,

    // 問題番号カウンタ（リスト/フリー入力問わず出題ごとに +1）
    qNumber: 0,

    // 出題済みの問題 id / リスト index（ホストが「もう一度」リプレイするまで保持）
    askedQuestionIds: new Set(),
    askedQuestionIndices: new Set(),

    // 参加者にスコアを見せるか（主催者がトグル可能・デフォルトは表示）
    showScoreToPlayers: true,

    // お助けアイテム
    itemsEnabled: false,
    itemsConfigLocked: false,
    enabledItems: new Set(DEFAULT_ENABLED_ITEMS),
    itemQueue: [], // { userId, itemId } 次の問題で発動
    itemExclusiveHolds: new Map(), // exclusiveGroup -> { userId, nickname, itemName, itemId }
    questionItemEffects: new Map(), // socketId -> { delayMs, flip, flash, slow2x }
    playerBenefits: new Map(), // socketId -> { bonusQ, lucky3, ... }
    itemFeed: []
  };
  rooms.set(code, room);
  return room;
}

function ensureItemPool(room) {
  if (!room.enabledItems || room.enabledItems.size === 0) {
    room.enabledItems = new Set(DEFAULT_ENABLED_ITEMS);
  }
}

function parseItemsEnabled(v) {
  return v === true || v === 'true' || v === 1;
}

/** 出題開始時：チェック状態をそのまま反映（種類が空ならデフォルトプール） */
function applyHostItemsConfigForStart(room, { itemsEnabled, enabledIds } = {}) {
  if (itemsEnabled === true || itemsEnabled === 'true') {
    room.itemsEnabled = true;
  } else if (itemsEnabled !== undefined) {
    room.itemsEnabled = parseItemsEnabled(itemsEnabled);
  }
  if (Array.isArray(enabledIds)) {
    const ids = enabledIds.filter(id => ITEM_BY_ID[id]);
    if (ids.length) room.enabledItems = new Set(ids);
  }
  if (room.itemsEnabled) {
    ensureItemPool(room);
    if (!room.enabledItems || room.enabledItems.size === 0) {
      room.enabledItems = new Set(ITEM_CATALOG.map(it => it.id));
    }
  }
}

/** 第1問開始前のみ（設定画面からの変更） */
function applyHostItemsConfigIfUnlocked(room, { itemsEnabled, enabledIds } = {}) {
  if (room.itemsConfigLocked || (room.qNumber || 0) >= 1) return false;
  if (itemsEnabled !== undefined) room.itemsEnabled = parseItemsEnabled(itemsEnabled);
  if (Array.isArray(enabledIds)) {
    const ids = enabledIds.filter(id => ITEM_BY_ID[id]);
    if (ids.length) room.enabledItems = new Set(ids);
  }
  ensureItemPool(room);
  return true;
}

function lockItemsConfig(room) {
  if ((room.qNumber || 0) < 1) return;
  room.itemsConfigLocked = true;
}

function ensurePlayerItems(room, socketId) {
  const p = room.players.get(socketId);
  if (!p) return null;
  if (!p.heldItems) p.heldItems = {}; // itemId -> 所持数（ランダム配布）
  if (p.queuedItemId === undefined) p.queuedItemId = null;
  if (p.shieldStacks === undefined) p.shieldStacks = 0;
  return p;
}

function getSortedPlayers(room) {
  return Array.from(room.players.entries())
    .sort((a, b) => (b[1].score || 0) - (a[1].score || 0));
}

function getRankedPlayerIds(room) {
  return getSortedPlayers(room).map(([id]) => id);
}

function getPlayerRankIndex(room, socketId) {
  return getSortedPlayers(room).findIndex(([id]) => id === socketId);
}

const SWAP_LEADER_MAX_GAP = 5;

/** 使用時点で条件を満たすか（次の問題開始時にも再チェック） */
function validateItemUse(room, socketId, itemId) {
  const sorted = getSortedPlayers(room);
  const rank = getPlayerRankIndex(room, socketId);
  const p = room.players.get(socketId);
  if (!p) return { ok: false, error: 'not_player' };

  switch (itemId) {
    case 'swap_leader': {
      if (rank === 0) return { ok: false, error: 'already_first' };
      if (rank < 0) return { ok: false, error: 'not_player' };
      const leaderScore = sorted[0][1].score || 0;
      const gap = leaderScore - (p.score || 0);
      if (gap > SWAP_LEADER_MAX_GAP) return { ok: false, error: 'gap_too_large' };
      return { ok: true };
    }
    case 'snipe': {
      if (rank <= 0) return { ok: false, error: 'already_first' };
      const target = sorted[rank - 1][1];
      if ((target.score || 0) < 2) return { ok: false, error: 'target_too_poor' };
      return { ok: true };
    }
    case 'tax_leader': {
      if (sorted.length < 2) return { ok: false, error: 'need_more_players' };
      if ((sorted[0][1].score || 0) < 1) return { ok: false, error: 'leader_no_points' };
      return { ok: true };
    }
    case 'underdog2x': {
      if (rank < 0) return { ok: false, error: 'not_player' };
      if (rank < 3) return { ok: false, error: 'rank_too_high' };
      return { ok: true };
    }
    default:
      return { ok: true };
  }
}

function executeSwapLeader(room, userId) {
  const sorted = getSortedPlayers(room);
  const rank = sorted.findIndex(([id]) => id === userId);
  const user = room.players.get(userId);
  if (!user || rank <= 0) return;
  const [leaderId, leader] = sorted[0];
  const gap = (leader.score || 0) - (user.score || 0);
  if (gap > SWAP_LEADER_MAX_GAP) {
    pushItemFeedPrivate(room, userId, '得点差が広がったため「逆転のカード」は発動しませんでした');
    return;
  }
  const ls = leader.score || 0;
  const us = user.score || 0;
  leader.score = us;
  user.score = ls;
  pushItemFeed(room, `${user.nickname}さんが「逆転のカード」で1位の${leader.nickname}さんと点数を入れ替え！（${us}点⇔${ls}点）`);
  broadcastState(room);
}

function executeSnipe(room, userId) {
  const sorted = getSortedPlayers(room);
  const rank = sorted.findIndex(([id]) => id === userId);
  const thief = room.players.get(userId);
  if (!thief || rank <= 0) return;
  const [, target] = sorted[rank - 1];
  if (!target || (target.score || 0) < 2) {
    pushItemFeedPrivate(room, userId, '直上の参加者の点数が足りず「スナイプ2点」は発動しませんでした');
    return;
  }
  target.score = (target.score || 0) - 2;
  thief.score = (thief.score || 0) + 2;
  const targetNick = sorted[rank - 1][1].nickname || '?';
  pushItemFeed(room, `${thief.nickname}さんが${targetNick}さんから2点をスナイプ！`);
  broadcastState(room);
}

function executeTaxLeader(room, actorId) {
  const sorted = getSortedPlayers(room);
  if (sorted.length < 2) return;
  const [, leader] = sorted[0];
  const take = Math.min(2, leader.score || 0);
  if (take <= 0) return;
  leader.score = (leader.score || 0) - take;
  let distributed = 0;
  const names = [];
  if (sorted[1] && take > distributed) {
    sorted[1][1].score = (sorted[1][1].score || 0) + 1;
    names.push(sorted[1][1].nickname || '2位');
    distributed++;
  }
  if (sorted[2] && take > distributed) {
    sorted[2][1].score = (sorted[2][1].score || 0) + 1;
    names.push(sorted[2][1].nickname || '3位');
    distributed++;
  }
  const actor = room.players.get(actorId);
  const actorNick = actor ? actor.nickname : '?';
  pushItemFeed(
    room,
    `${actorNick}さんの「トップ課税」！1位${leader.nickname}さんから${take}点→${names.join('・')}へ`
  );
  broadcastState(room);
}

function playerHasHeldItems(p) {
  if (!p || !p.heldItems) return false;
  return Object.values(p.heldItems).some(n => (n || 0) > 0);
}

function pickGrantCandidates(room, mode) {
  let candidates = Array.from(room.players.keys());
  if (!candidates.length) return [];
  if (mode === 'exclude_top3' && candidates.length > 3) {
    const top3 = new Set(getRankedPlayerIds(room).slice(0, 3));
    const filtered = candidates.filter(id => !top3.has(id));
    if (filtered.length) candidates = filtered;
  }
  return candidates;
}

function pickRandomEnabledItemId(room) {
  ensureItemPool(room);
  const pool = Array.from(room.enabledItems).filter(id => ITEM_BY_ID[id]);
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** itemId が random / 空なら有効プールからランダム。指定なら検証して返す */
function resolveGrantItemId(room, itemId) {
  const id = String(itemId || '').trim();
  if (id === 'random' || id === '') return pickRandomEnabledItemId(room);
  if (!ITEM_BY_ID[id] || !room.enabledItems.has(id)) return null;
  return id;
}

/** 主催者が指定したアイテムを1人に配布 */
function grantItemToPlayer(room, socketId, itemId) {
  if (!room.itemsEnabled) return { ok: false, error: 'items_off' };
  ensureItemPool(room);
  if (!ITEM_BY_ID[itemId] || !room.enabledItems.has(itemId)) {
    return { ok: false, error: 'item_not_allowed' };
  }
  const p = ensurePlayerItems(room, socketId);
  const def = ITEM_BY_ID[itemId];
  if (!p || !def) return { ok: false, error: 'no_player' };
  p.heldItems[itemId] = (p.heldItems[itemId] || 0) + 1;
  pushItemFeed(room, `${p.nickname}さんに「${def.name}」を配布しました！`);
  emitItemInventory(room, socketId);
  io.to(socketId).emit('itemGranted', { itemId, itemName: def.name, nickname: p.nickname });
  syncAllItemInventories(room);
  return { ok: true, socketId, itemId, nickname: p.nickname };
}

function consumeHeldItem(p, itemId) {
  const n = (p.heldItems[itemId] || 0) - 1;
  if (n <= 0) delete p.heldItems[itemId];
  else p.heldItems[itemId] = n;
}

/** 他者への妨害系。シールドがあれば消費してブロック（次の問題でなくてもスタック保持） */
function applyHarmToVictim(room, victimId, attackerNick, effectLabel, mutator) {
  const victim = ensurePlayerItems(room, victimId);
  if (!victim) return;
  if ((victim.shieldStacks || 0) > 0) {
    victim.shieldStacks -= 1;
    pushItemFeed(room, `${victim.nickname}さんのシールドが「${effectLabel}」を防いました！（🛡残り${victim.shieldStacks}枚）`);
    emitItemInventory(room, victimId);
    return;
  }
  const cur = room.questionItemEffects.get(victimId) || {};
  mutator(cur);
  room.questionItemEffects.set(victimId, cur);
}

function applyHarmToOthers(room, attackerId, attackerNick, effectLabel, mutator) {
  for (const id of room.players.keys()) {
    if (id === attackerId) continue;
    applyHarmToVictim(room, id, attackerNick, effectLabel, mutator);
  }
}

function resetRoomItems(room) {
  room.itemsConfigLocked = false;
  room.itemQueue = [];
  room.itemExclusiveHolds = new Map();
  room.questionItemEffects = new Map();
  room.playerBenefits = new Map();
  room.itemFeed = [];
  for (const p of room.players.values()) {
    p.heldItems = {};
    p.queuedItemId = null;
    p.shieldStacks = 0;
  }
}

function pushItemFeed(room, text) {
  const msg = { id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, text, at: Date.now(), scope: 'public' };
  room.itemFeed.push(msg);
  if (room.itemFeed.length > 40) room.itemFeed.shift();
  io.to(room.code).emit('itemFeed', msg);
}

function pushItemFeedPrivate(room, socketId, text) {
  io.to(socketId).emit('itemFeed', { id: `${Date.now()}_p`, text, at: Date.now(), scope: 'private' });
}

function canUseItem(room, socketId, itemId) {
  if (!room.itemsEnabled) return { ok: false, error: 'items_off' };
  const def = ITEM_BY_ID[itemId];
  if (!def) return { ok: false, error: 'unknown_item' };
  const p = ensurePlayerItems(room, socketId);
  if (!p) return { ok: false, error: 'not_player' };
  if (room.revealing || room.answeringId) return { ok: false, error: 'busy' };
  if ((p.heldItems[itemId] || 0) < 1) return { ok: false, error: 'no_item' };
  return { ok: true, def, p };
}

function checkExclusiveHold(room, socketId, def) {
  const group = def.exclusiveGroup;
  if (!group) return { ok: true };
  if (!room.itemExclusiveHolds) room.itemExclusiveHolds = new Map();
  const hold = room.itemExclusiveHolds.get(group);
  if (hold && hold.userId !== socketId) {
    return { ok: false, hold };
  }
  return { ok: true };
}

function setExclusiveHold(room, socketId, def, p) {
  if (!def.exclusiveGroup) return;
  if (!room.itemExclusiveHolds) room.itemExclusiveHolds = new Map();
  room.itemExclusiveHolds.set(def.exclusiveGroup, {
    userId: socketId,
    nickname: p.nickname || '?',
    itemName: def.name,
    itemId: def.id
  });
}

function executeSteals(room) {
  for (const [userId, ben] of room.playerBenefits.entries()) {
    if (!ben.steal) continue;
    const thief = room.players.get(userId);
    if (!thief) continue;
    const ranked = Array.from(room.players.entries())
      .sort((a, b) => (b[1].score || 0) - (a[1].score || 0));
    if (!ranked.length) continue;
    const [leaderId, leader] = ranked[0];
    if (leaderId === userId) continue;
    if ((leader.score || 0) < 1) continue;
    leader.score = (leader.score || 0) - 1;
    thief.score = (thief.score || 0) + 1;
    if (ben.steal === 'loud') {
      pushItemFeed(room, `${thief.nickname}さんが1位から1点を奪いました！`);
    }
    delete ben.steal;
  }
}

function applyItemQueueForQuestion(room) {
  room.questionItemEffects = new Map();
  room.playerBenefits = new Map();
  const qNum = room.qNumber || 1;

  for (const { userId, itemId } of room.itemQueue) {
    const user = room.players.get(userId);
    if (!user) continue;
    const nick = user.nickname || '?';

    switch (itemId) {
      case 'delay5':
        applyHarmToOthers(room, userId, nick, '時の沙時計', cur => {
          cur.delayMs = Math.max(cur.delayMs || 0, 5000);
        });
        break;
      case 'steal_stealth':
        room.playerBenefits.set(userId, { ...(room.playerBenefits.get(userId) || {}), steal: 'stealth' });
        break;
      case 'steal_loud':
        room.playerBenefits.set(userId, { ...(room.playerBenefits.get(userId) || {}), steal: 'loud' });
        break;
      case 'flip':
        applyHarmToOthers(room, userId, nick, 'さかさまビジョン', cur => {
          cur.flip = true;
        });
        break;
      case 'flash':
        applyHarmToOthers(room, userId, nick, '一瞬だけ全文', cur => {
          cur.flash = true;
        });
        break;
      case 'bonusQ':
        room.playerBenefits.set(userId, { ...(room.playerBenefits.get(userId) || {}), bonusQ: qNum });
        break;
      case 'slow2x':
        applyHarmToOthers(room, userId, nick, 'のろまの呪い', cur => {
          cur.slow2x = true;
        });
        break;
      case 'lucky3':
        room.playerBenefits.set(userId, { ...(room.playerBenefits.get(userId) || {}), lucky3: true });
        break;
      case 'timestop':
        applyHarmToOthers(room, userId, nick, 'タイムストップ', cur => {
          cur.answerMs = 7000;
        });
        break;
      case 'mirror':
        applyHarmToOthers(room, userId, nick, 'ミラー文字', cur => {
          cur.mirror = true;
        });
        break;
      case 'jackpot':
        room.playerBenefits.set(userId, { ...(room.playerBenefits.get(userId) || {}), jackpot: true });
        break;
      case 'swap_leader':
        executeSwapLeader(room, userId);
        break;
      case 'snipe':
        executeSnipe(room, userId);
        break;
      case 'tax_leader':
        executeTaxLeader(room, userId);
        break;
      case 'underdog2x': {
        const rank = getPlayerRankIndex(room, userId);
        if (rank >= 3) {
          room.playerBenefits.set(userId, { ...(room.playerBenefits.get(userId) || {}), underdog2x: true });
        } else {
          pushItemFeedPrivate(room, userId, '4位以下ではなかったため「下克上ダブル」は発動しませんでした');
        }
        break;
      }
      default:
        break;
    }
    user.queuedItemId = null;
  }
  room.itemQueue = [];
  room.itemExclusiveHolds = new Map();
  executeSteals(room);
}

function emitItemInventory(room, socketId) {
  const p = ensurePlayerItems(room, socketId);
  if (!p) return;
  const hasHeld = playerHasHeldItems(p);
  io.to(socketId).emit('itemInventory', {
    enabled: room.itemsEnabled === true || hasHeld,
    configLocked: room.itemsConfigLocked === true,
    enabledIds: Array.from(room.enabledItems || DEFAULT_ENABLED_ITEMS),
    held: { ...(p.heldItems || {}) },
    queued: p.queuedItemId,
    shieldStacks: p.shieldStacks || 0
  });
}

function syncAllItemInventories(room) {
  for (const id of room.players.keys()) emitItemInventory(room, id);
  if (room.hostId) {
    io.to(room.hostId).emit('itemHostState', {
      enabled: room.itemsEnabled,
      configLocked: room.itemsConfigLocked,
      enabledIds: Array.from(room.enabledItems),
      feed: room.itemFeed.slice(-20)
    });
  }
}

function publicState(room) {
  return {
    code: room.code,
    hostConnected: !!room.hostId,
    players: Array.from(room.players.entries()).map(([id, p]) => ({
      id,
      nickname: p.nickname,
      score: p.score
    })),
    revealIndex: room.revealIndex,
    revealSpeed: room.revealSpeed,
    revealing: room.revealing,
    questionLength: room.question.length,
    questionVisible: room.question.slice(0, room.revealIndex),
    buzzes: room.buzzes.map(b => ({
      socketId: b.socketId,
      nickname: b.nickname,
      time: b.time
    })),
    missed: Array.from(room.missed),
    answeringId: room.answeringId,
    answerDeadline: room.answerDeadline,
    autoAdvanceDeadline: room.autoAdvanceDeadline,
    currentIndex: room.currentIndex,
    questionsCount: room.questions.length,
    qNumber: room.qNumber || 0,
    askedIds: Array.from(room.askedQuestionIds || []),
    askedIndices: Array.from(room.askedQuestionIndices || []),
    showScoreToPlayers: room.showScoreToPlayers === true,
    itemsEnabled: room.itemsEnabled === true,
    itemsConfigLocked: room.itemsConfigLocked === true
  };
}

// ホストには問題リスト（answer含む）も渡す
function hostExtraState(room) {
  // 問題リスト本体は host:setQuestions の ack で同期（毎回の上書きで配点等が消えるのを防ぐ）
  return { currentIndex: room.currentIndex };
}

function broadcastState(room) {
  io.to(room.code).emit('state', publicState(room));
  if (room.hostId) {
    io.to(room.hostId).emit('host:state', hostExtraState(room));
    io.to(room.hostId).emit('itemHostState', {
      enabled: room.itemsEnabled === true,
      configLocked: room.itemsConfigLocked === true,
      enabledIds: Array.from(room.enabledItems || DEFAULT_ENABLED_ITEMS),
      feed: (room.itemFeed || []).slice(-20)
    });
  }
}

// ----------------------------------------------------------------------
// 出題リビール / 早押し / 10 秒カウント
// ----------------------------------------------------------------------
function clearRevealTimer(room) {
  if (room.revealTimer) {
    clearInterval(room.revealTimer);
    room.revealTimer = null;
  }
  if (room.pendingRevealTimer) {
    clearTimeout(room.pendingRevealTimer);
    room.pendingRevealTimer = null;
  }
  room.revealing = false;
}

function startReveal(room) {
  clearRevealTimer(room);
  if (room.revealIndex >= room.question.length) {
    room.revealing = false;
    broadcastState(room);
    return;
  }
  room.revealing = true;
  if (room.questionStartedAt === null) {
    room.questionStartedAt = Date.now();
  }
  const tick = () => {
    if (!rooms.has(room.code)) return;
    if (room.revealIndex < room.question.length) {
      room.revealIndex += 1;
      io.to(room.code).emit('reveal', {
        index: room.revealIndex,
        char: room.question[room.revealIndex - 1]
      });
    }
    if (room.revealIndex >= room.question.length) {
      clearRevealTimer(room);
      io.to(room.code).emit('revealEnd');
      // 早押しなしで出題完了 → 解説は出さず自動進行のみ（解説は正解/不正解後）
      if (room.buzzes.length === 0 && !room.answeringId) {
        scheduleAutoAdvance(room);
      }
    }
  };
  room.revealTimer = setInterval(tick, Math.max(20, room.revealSpeed));
  broadcastState(room);
}

function resetBuzzesAndAnswer(room) {
  room.buzzes = [];
  room.missed = new Set();
  clearAnswerTimer(room);
  room.answeringId = null;
  room.answerDeadline = null;
}

// ----------------------------------------------------------------------
// 自動進行（出題完了 → 30秒 → 自動的に次の問題）
// ----------------------------------------------------------------------
const AUTO_ADVANCE_MS = 30000;
const AUTO_ADVANCE_WARN_MS = 10000; // 10秒前にホストへカウントダウン開始通知

function clearAutoAdvance(room) {
  if (room.autoAdvanceTimer) { clearTimeout(room.autoAdvanceTimer); room.autoAdvanceTimer = null; }
  if (room.autoAdvanceWarnTimer) { clearTimeout(room.autoAdvanceWarnTimer); room.autoAdvanceWarnTimer = null; }
  room.autoAdvanceDeadline = null;
  io.to(room.code).emit('autoAdvanceStop');
}

function stopAllQuestionTimers(room) {
  clearAnswerTimer(room);
  room.answeringId = null;
  room.answerDeadline = null;
  clearAutoAdvance(room);
  io.to(room.code).emit('answerStop');
  io.to(room.code).emit('timersStop');
  if (room.hostId) io.to(room.hostId).emit('countdownStop');
}

function scheduleAutoAdvance(room) {
  // 次の問題が無ければスケジュールしない
  const next = room.currentIndex + 1;
  if (room.currentIndex < 0 || next >= room.questions.length) return;

  clearAutoAdvance(room);
  const now = Date.now();
  room.autoAdvanceDeadline = now + AUTO_ADVANCE_MS;
  io.to(room.code).emit('autoAdvanceStart', { deadline: room.autoAdvanceDeadline });

  room.autoAdvanceWarnTimer = setTimeout(() => {
    if (!rooms.has(room.code)) return;
    if (room.autoAdvanceDeadline === null) return;
    if (room.hostId) io.to(room.hostId).emit('countdownStart');
  }, AUTO_ADVANCE_MS - AUTO_ADVANCE_WARN_MS);

  room.autoAdvanceTimer = setTimeout(() => {
    if (!rooms.has(room.code)) return;
    if (room.autoAdvanceDeadline === null) return;
    if (room.hostId) io.to(room.hostId).emit('countdownEnd');
    autoAdvanceToNext(room);
  }, AUTO_ADVANCE_MS);
}

function autoAdvanceToNext(room) {
  // 状態クリア
  if (room.autoAdvanceTimer) { clearTimeout(room.autoAdvanceTimer); room.autoAdvanceTimer = null; }
  if (room.autoAdvanceWarnTimer) { clearTimeout(room.autoAdvanceWarnTimer); room.autoAdvanceWarnTimer = null; }
  room.autoAdvanceDeadline = null;
  io.to(room.code).emit('autoAdvanceStop');

  const next = room.currentIndex + 1;
  if (next < 0 || next >= room.questions.length) {
    broadcastState(room);
    return;
  }
  const q = room.questions[next];
  room.currentIndex = next;
  room.question = q.text || '';
  room.revealIndex = 0;
  resetBuzzesAndAnswer(room);
  startQuestionWithTitle(room);
}

// ----------------------------------------------------------------------
// 出題開始（「第N問」のタイトル演出を挟んでから 1 文字ずつのリビールに入る）
// ----------------------------------------------------------------------
const TITLE_INTRO_MS = 1800;
function startQuestionWithTitle(room) {
  ensureRoomTracking(room);
  // 既存タイマをクリア
  clearRevealTimer(room);
  // questionStartedAt はリビール開始時に確定（タイトル中のバズ受付を防ぐため null のまま）
  room.questionStartedAt = null;
  room.qNumber = (room.qNumber || 0) + 1;
  lockItemsConfig(room);
  if (room.itemsEnabled) syncAllItemInventories(room);
  // 出題済みフラグ
  if (room.currentIndex >= 0 && room.questions[room.currentIndex]) {
    room.askedQuestionIndices.add(room.currentIndex);
    const qid = room.questions[room.currentIndex].id;
    if (qid) room.askedQuestionIds.add(qid);
  }
  applyItemQueueForQuestion(room);
  io.to(room.code).emit('hideExplanation');
  const qStartBase = {
    length: room.question.length,
    speed: room.revealSpeed,
    qIndex: room.currentIndex,
    qNumber: room.qNumber
  };
  for (const [sid] of room.players) {
    const v = room.questionItemEffects.get(sid) || {};
    io.to(sid).emit('questionStart', {
      ...qStartBase,
      itemEffects: {
        delayMs: v.delayMs || 0,
        flip: !!v.flip,
        mirror: !!v.mirror,
        flash: !!v.flash,
        slow2x: !!v.slow2x,
        answerMs: v.answerMs || 10000,
        fullText: v.flash ? room.question : ''
      }
    });
  }
  if (room.hostId) io.to(room.hostId).emit('questionStart', qStartBase);
  if (room.hostId) io.to(room.hostId).emit('dedenSound');
  // 出題リセット直後の状態を即時ブロードキャスト（古い buzzes/missed を残さない）
  broadcastState(room);
  room.pendingRevealTimer = setTimeout(() => {
    if (!rooms.has(room.code)) return;
    if (!room.question) return;
    room.pendingRevealTimer = null;
    room.questionStartedAt = Date.now();
    startReveal(room);
  }, TITLE_INTRO_MS);
}

function clearAnswerTimer(room) {
  if (room.answerTimer) {
    clearTimeout(room.answerTimer);
    room.answerTimer = null;
  }
}

function stopAnswerCountdown(room) {
  clearAnswerTimer(room);
  room.answeringId = null;
  room.answerDeadline = null;
  io.to(room.code).emit('answerStop');
}

function startAnswerCountdown(room, socketId) {
  clearAnswerTimer(room);
  room.answeringId = socketId;
  const v = room.questionItemEffects.get(socketId) || {};
  const answerMs = v.answerMs || 10000;
  room.answerDeadline = Date.now() + answerMs;
  io.to(room.code).emit('answerStart', {
    socketId,
    deadline: room.answerDeadline,
    answerMs
  });
  broadcastState(room);
  room.answerTimer = setTimeout(() => {
    handleIncorrect(room, true);
  }, answerMs);
}

function pickNextAnswerer(room) {
  for (const b of room.buzzes) {
    if (!room.missed.has(b.socketId)) return b.socketId;
  }
  return null;
}

function handleIncorrect(room, auto = false) {
  if (!room.answeringId) return;
  const losingId = room.answeringId;
  room.missed.add(losingId);
  clearAnswerTimer(room);
  room.answeringId = null;
  room.answerDeadline = null;
  io.to(room.code).emit('answerStop');
  io.to(room.code).emit('judgement', { type: 'wrong', socketId: losingId, auto });
  const next = pickNextAnswerer(room);
  if (next) {
    startAnswerCountdown(room, next);
  } else {
    // 候補者がいなくなった → 自動進行カウント開始 + 解説送信
    broadcastState(room);
    sendExplanation(room);
    scheduleAutoAdvance(room);
  }
}

function handleCorrect(room) {
  const winnerId = room.answeringId;
  stopAllQuestionTimers(room);
  if (!winnerId) {
    broadcastState(room);
    return;
  }
  // 得点加算（問題ごとの配点を使用、デフォルトは 1pt）
  const q = room.currentIndex >= 0 ? room.questions[room.currentIndex] : null;
  const pts = (q && Number.isFinite(Number(q.points))) ? Number(q.points) : 1;
  const p = room.players.get(winnerId);
  let bonus = 0;
  const ben = room.playerBenefits.get(winnerId);
  if (ben && p) {
    if (ben.bonusQ) {
      bonus += ben.bonusQ;
      pushItemFeed(room, `${p.nickname}さんの問題番号ボーナス +${ben.bonusQ}点！`);
      delete ben.bonusQ;
    }
    if (ben.lucky3) {
      bonus += 3;
      pushItemFeed(room, `${p.nickname}さんのラッキー+3点！`);
      delete ben.lucky3;
    }
  }
  let total = pts + bonus;
  if (ben && ben.underdog2x && p) {
    const doubled = total * 2;
    pushItemFeed(room, `${p.nickname}さんの下克上ダブル！ ${total}点→${doubled}点`);
    total = doubled;
    delete ben.underdog2x;
  }
  if (ben && ben.jackpot && p) {
    const doubled = total * 2;
    pushItemFeed(room, `${p.nickname}さんのジャックポット！ ${total}点→${doubled}点`);
    total = doubled;
    delete ben.jackpot;
  }
  if (p) p.score = (p.score || 0) + total;
  io.to(room.code).emit('judgement', { type: 'correct', socketId: winnerId, points: total, basePoints: pts, bonus });
  clearRevealTimer(room);
  broadcastState(room);
  sendExplanation(room);
}

function sendExplanation(room) {
  if (room.currentIndex < 0) return;
  const q = room.questions[room.currentIndex];
  if (!q) return;
  const payload = {
    answer: q.answer || '',
    explanation: q.explanation || ''
  };
  if (!payload.answer && !payload.explanation) return;
  io.to(room.code).emit('showExplanation', payload);
}

// ----------------------------------------------------------------------
// Socket.IO ハンドラ
// ----------------------------------------------------------------------
function ensureRoomTracking(room) {
  if (!room.askedQuestionIds) room.askedQuestionIds = new Set();
  if (!room.askedQuestionIndices) room.askedQuestionIndices = new Set();
}

/** ホスト操作: 部屋コード + 現在の socket が部屋主であることを確認 */
function resolveHostRoom(socket, code) {
  const c = String(code || socket.data.roomCode || '').trim();
  if (!c) return null;
  const room = rooms.get(c);
  if (!room || room.hostId !== socket.id) return null;
  ensureRoomTracking(room);
  return room;
}

io.on('connection', (socket) => {
  // --- 部屋作成 / 再アタッチ ---
  socket.on('createRoom', (_payload, ack) => {
    const ip = clientIpFromSocket(socket);
    if (!checkRateLimit(`create:${ip}`, 20, 60 * 60 * 1000)) {
      return ack && ack({ ok: false, error: 'rate_limited' });
    }
    if (rooms.size >= MAX_ROOMS) {
      return ack && ack({ ok: false, error: 'server_busy' });
    }
    const room = makeRoom(socket.id);
    socket.join(room.code);
    socket.data.role = 'host';
    socket.data.roomCode = room.code;
    if (typeof ack === 'function') {
      ack({
        ok: true,
        code: room.code,
        questions: room.questions,
        currentIndex: room.currentIndex
      });
    }
    broadcastState(room);
  });

  socket.on('reattachHost', ({ code }, ack) => {
    const room = rooms.get(String(code || '').trim());
    if (!room) return ack && ack({ ok: false, error: 'room_not_found' });
    room.hostId = socket.id;
    socket.join(room.code);
    socket.data.role = 'host';
    socket.data.roomCode = room.code;
    ensureRoomTracking(room);
    if (typeof ack === 'function') {
      ack({
        ok: true,
        code: room.code,
        questions: room.questions,
        currentIndex: room.currentIndex
      });
    }
    broadcastState(room);
  });

  socket.on('joinRoom', ({ code, nickname }, ack) => {
    const ip = clientIpFromSocket(socket);
    if (!checkRateLimit(`join:${ip}`, 60, 60 * 1000)) {
      return ack && ack({ ok: false, error: 'rate_limited' });
    }
    const room = rooms.get(String(code));
    if (!room) return ack && ack({ ok: false, error: 'room_not_found' });
    if (room.players.size >= MAX_PLAYERS_PER_ROOM) {
      return ack && ack({ ok: false, error: 'room_full' });
    }
    const nick = sanitizeNickname(nickname);
    // 同名のプレイヤーが既に居れば、その情報（スコア等）を引き継いで socketId を更新
    let preservedScore = 0;
    let preservedHeld = {};
    let preservedQueued = null;
    let preservedShield = 0;
    for (const [oldId, p] of Array.from(room.players.entries())) {
      if (p.nickname === nick && oldId !== socket.id) {
        preservedScore = p.score || 0;
        preservedHeld = { ...(p.heldItems || {}) };
        preservedQueued = p.queuedItemId ?? null;
        preservedShield = p.shieldStacks || 0;
        room.players.delete(oldId);
        // 旧 socketId に紐付くバズ/ミスは整理
        room.buzzes = room.buzzes.filter(b => b.socketId !== oldId);
        room.missed.delete(oldId);
        if (room.answeringId === oldId) {
          room.answeringId = null;
          room.answerDeadline = null;
        }
      }
    }
    room.players.set(socket.id, {
      nickname: nick,
      score: preservedScore,
      joinedAt: Date.now(),
      heldItems: preservedHeld,
      queuedItemId: preservedQueued,
      shieldStacks: preservedShield
    });
    ensurePlayerItems(room, socket.id);
    socket.join(room.code);
    socket.data.role = 'player';
    socket.data.roomCode = room.code;
    socket.data.nickname = nick;
    ack && ack({ ok: true, code: room.code, nickname: nick });
    broadcastState(room);
    emitItemInventory(room, socket.id);
    if (room.itemFeed.length) {
      socket.emit('itemFeedHistory', room.itemFeed.slice(-20));
    }
  });

  // --- 早押し ---
  socket.on('buzz', () => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room) return;
    if (socket.data.role !== 'player') return;
    if (room.buzzes.find(b => b.socketId === socket.id)) return;
    if (room.missed.has(socket.id)) return;
    if (!room.question) return; // 問題未出題
    if (!room.questionStartedAt) return; // タイトル演出中（リビール開始前）はバズ受付なし

    // 自動進行カウント中であればキャンセル
    clearAutoAdvance(room);

    const now = Date.now();
    const time = room.questionStartedAt ? (now - room.questionStartedAt) / 1000 : 0;
    const player = room.players.get(socket.id);
    const nickname = player ? player.nickname : '?';
    if (room.buzzes.length < 5) {
      room.buzzes.push({
        socketId: socket.id,
        nickname,
        time: Math.max(0, time),
        ts: now
      });
      room.buzzes.sort((a, b) => a.ts - b.ts);
    }
    if (room.buzzes.length === 1) {
      clearRevealTimer(room);
      io.to(room.code).emit('revealPause', { index: room.revealIndex });
      if (room.hostId) io.to(room.hostId).emit('buzzSound');
      startAnswerCountdown(room, socket.id);
    } else {
      if (room.hostId) io.to(room.hostId).emit('buzzSound');
      broadcastState(room);
    }
  });

  // --- 問題リスト操作（ホスト） ---
  socket.on('host:setQuestions', ({ code, questions }, ack) => {
    const room = resolveHostRoom(socket, code);
    if (!room) return ack && ack({ ok: false, error: 'not_host' });
    room.questions = sanitizeQuestions(questions || []);
    if (room.currentIndex >= room.questions.length) {
      room.currentIndex = -1;
    }
    if (typeof ack === 'function') ack({ ok: true, questions: room.questions });
    broadcastState(room);
  });

  socket.on('host:loadSet', ({ code, setId }, ack) => {
    const room = resolveHostRoom(socket, code);
    if (!room) return ack && ack({ ok: false, error: 'not_host' });
    const data = loadSets();
    const s = data.sets.find(x => x.id === setId);
    if (!s) return ack && ack({ ok: false, error: 'not_found' });
    room.questions = sanitizeQuestions(s.questions);
    room.currentIndex = -1;
    room.qNumber = 0;
    room.askedQuestionIds = new Set();
    room.askedQuestionIndices = new Set();
    clearAutoAdvance(room);
    if (typeof ack === 'function') ack({ ok: true, questions: room.questions });
    broadcastState(room);
  });

  // --- スコア操作（ホスト） ---
  socket.on('host:resetScores', ({ code } = {}) => {
    const room = resolveHostRoom(socket, code);
    if (!room) return;
    for (const p of room.players.values()) p.score = 0;
    room.qNumber = 0;
    room.itemsConfigLocked = false;
    broadcastState(room);
    if (room.hostId) {
      io.to(room.hostId).emit('itemHostState', {
        enabled: room.itemsEnabled === true,
        configLocked: false,
        enabledIds: Array.from(room.enabledItems || DEFAULT_ENABLED_ITEMS),
        feed: (room.itemFeed || []).slice(-20)
      });
    }
  });
  socket.on('host:adjustScore', ({ code, socketId, delta }) => {
    const room = resolveHostRoom(socket, code);
    if (!room) return;
    const p = room.players.get(socketId);
    if (!p) return;
    p.score = Math.max(-99, Math.min(999, (p.score || 0) + Number(delta || 0)));
    broadcastState(room);
  });

  // --- 出題開始 / 続き / 次の問題 ---
  socket.on('host:startQuestionAt', ({ code, index, itemsEnabled, enabledIds }, ack) => {
    const room = resolveHostRoom(socket, code);
    if (!room) {
      if (typeof ack === 'function') ack({ ok: false, error: 'not_host' });
      return;
    }
    applyHostItemsConfigForStart(room, { itemsEnabled, enabledIds });
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= room.questions.length) {
      return ack && ack({ ok: false, error: 'out_of_range' });
    }
    const q = room.questions[i];
    room.currentIndex = i;
    room.question = q.text || '';
    room.revealIndex = 0;
    resetBuzzesAndAnswer(room);
    clearAutoAdvance(room);
    startQuestionWithTitle(room);
    ack && ack({ ok: true });
  });

  // 自由入力で出題（保存しない単発）
  socket.on('host:setQuestionText', ({ code, text }, ack) => {
    const room = resolveHostRoom(socket, code);
    if (!room) return ack && ack({ ok: false, error: 'not_host' });
    room.question = String(text || '').slice(0, 2000);
    room.revealIndex = 0;
    room.questionStartedAt = null;
    room.currentIndex = -1;
    resetBuzzesAndAnswer(room);
    clearRevealTimer(room);
    clearAutoAdvance(room);
    ack && ack({ ok: true });
    broadcastState(room);
  });

  socket.on('host:startQuestion', ({ code, itemsEnabled, enabledIds } = {}) => {
    const room = resolveHostRoom(socket, code);
    if (!room) return;
    applyHostItemsConfigForStart(room, { itemsEnabled, enabledIds });
    if (!room.question) return;
    resetBuzzesAndAnswer(room);
    clearAutoAdvance(room);
    room.revealIndex = 0;
    startQuestionWithTitle(room);
  });

  socket.on('host:resumeQuestion', ({ code } = {}) => {
    const room = resolveHostRoom(socket, code);
    if (!room) return;
    resetBuzzesAndAnswer(room);
    clearAutoAdvance(room);
    if (room.revealIndex >= room.question.length) {
      io.to(room.code).emit('revealEnd');
      broadcastState(room);
      return;
    }
    io.to(room.code).emit('questionResume');
    startReveal(room);
  });

  socket.on('host:nextQuestion', ({ code } = {}) => {
    const room = resolveHostRoom(socket, code);
    if (!room) return;
    clearRevealTimer(room);
    resetBuzzesAndAnswer(room);
    clearAutoAdvance(room);
    // 自動で次の問題に進める（リストがあれば）
    const next = room.currentIndex >= 0 ? room.currentIndex + 1 : -1;
    if (next >= 0 && next < room.questions.length) {
      const q = room.questions[next];
      room.currentIndex = next;
      room.question = q.text || '';
      room.revealIndex = 0;
      room.questionStartedAt = null;
      io.to(room.code).emit('questionPrepared', {
        length: room.question.length,
        index: next
      });
    } else {
      room.currentIndex = -1;
      room.question = '';
      room.revealIndex = 0;
      room.questionStartedAt = null;
      io.to(room.code).emit('nextQuestion');
    }
    broadcastState(room);
  });

  socket.on('host:setSpeed', ({ code, ms }) => {
    const room = resolveHostRoom(socket, code);
    if (!room) return;
    room.revealSpeed = Math.max(20, Math.min(2000, Number(ms) || 150));
    if (room.revealing) {
      // 進行中なら新しい速度で再起動
      startReveal(room);
    }
    broadcastState(room);
  });

  socket.on('host:correct', ({ code } = {}) => {
    const room = resolveHostRoom(socket, code);
    if (!room) return;
    handleCorrect(room);
  });

  socket.on('host:grantItem', ({ code, mode, itemId, targetSocketId } = {}, ack) => {
    const room = resolveHostRoom(socket, code);
    if (!room) return ack && ack({ ok: false, error: 'not_host' });
    if (!room.itemsEnabled) return ack && ack({ ok: false, error: 'items_off' });
    ensureItemPool(room);

    const modeNorm = String(mode || 'random');
    const wantRandomItem = String(itemId || '').trim() === 'random' || String(itemId || '').trim() === '';
    if (modeNorm === 'target' && wantRandomItem) {
      return ack && ack({ ok: false, error: 'bad_item' });
    }

    const resolvedItemId = modeNorm === 'target'
      ? (ITEM_BY_ID[itemId] && room.enabledItems.has(itemId) ? itemId : null)
      : resolveGrantItemId(room, itemId);
    if (!resolvedItemId) {
      return ack && ack({ ok: false, error: wantRandomItem ? 'no_item_pool' : 'bad_item' });
    }

    if (modeNorm === 'target') {
      const tid = String(targetSocketId || '');
      if (!room.players.has(tid)) return ack && ack({ ok: false, error: 'no_player' });
      const result = grantItemToPlayer(room, tid, resolvedItemId);
      return ack && ack(result);
    }

    const candidates = pickGrantCandidates(room, modeNorm === 'exclude_top3' ? 'exclude_top3' : 'random');
    if (!candidates.length) return ack && ack({ ok: false, error: 'no_players' });
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    const result = grantItemToPlayer(room, pick, resolvedItemId);
    return ack && ack(result);
  });
  socket.on('host:wrong', ({ code } = {}) => {
    const room = resolveHostRoom(socket, code);
    if (!room) return;
    handleIncorrect(room, false);
  });

  // 結果発表
  socket.on('host:showResults', ({ code } = {}) => {
    const room = resolveHostRoom(socket, code);
    if (!room) return;
    const players = Array.from(room.players.entries())
      .map(([id, p]) => ({ id, nickname: p.nickname, score: p.score || 0 }))
      .sort((a, b) => b.score - a.score);
    io.to(room.code).emit('showResults', { players });
  });
  socket.on('host:hideResults', ({ code } = {}) => {
    const room = resolveHostRoom(socket, code);
    if (!room) return;
    io.to(room.code).emit('hideResults');
  });

  // もう一度クイズ（部屋を解散せずスコア・出題済をリセット）
  socket.on('host:replayQuiz', ({ code } = {}, ack) => {
    const room = resolveHostRoom(socket, code);
    if (!room) return ack && ack({ ok: false, error: 'not_host' });
    clearRevealTimer(room);
    clearAnswerTimer(room);
    clearAutoAdvance(room);
    for (const p of room.players.values()) p.score = 0;
    room.askedQuestionIds = new Set();
    room.askedQuestionIndices = new Set();
    room.qNumber = 0;
    room.currentIndex = -1;
    room.question = '';
    room.revealIndex = 0;
    room.questionStartedAt = null;
    room.buzzes = [];
    room.missed = new Set();
    room.answeringId = null;
    room.answerDeadline = null;
    resetRoomItems(room);
    io.to(room.code).emit('hideResults');
    io.to(room.code).emit('hideExplanation');
    io.to(room.code).emit('nextQuestion');
    io.to(room.code).emit('quizReplayed');
    if (typeof ack === 'function') ack({ ok: true });
    broadcastState(room);
    syncAllItemInventories(room);
  });

  // お助けアイテム設定（主催者・第1問開始後は変更不可）
  socket.on('host:setItemsConfig', ({ code, enabled, enabledIds }, ack) => {
    const room = resolveHostRoom(socket, code);
    if (!room) return ack && ack({ ok: false, error: 'not_host' });
    if (room.itemsConfigLocked || (room.qNumber || 0) >= 1) {
      room.itemsConfigLocked = true;
      syncAllItemInventories(room);
      if (typeof ack === 'function') ack({ ok: false, error: 'locked' });
      return;
    }
    if (enabled === true || enabled === 'true') room.itemsEnabled = true;
    else if (enabled !== undefined) room.itemsEnabled = parseItemsEnabled(enabled);
    if (Array.isArray(enabledIds)) {
      const ids = enabledIds.filter(id => ITEM_BY_ID[id]);
      if (ids.length) room.enabledItems = new Set(ids);
    }
    if (room.itemsEnabled) {
      ensureItemPool(room);
      if (!room.enabledItems || room.enabledItems.size === 0) {
        room.enabledItems = new Set(ITEM_CATALOG.map(it => it.id));
      }
    }
    if (typeof ack === 'function') ack({ ok: true });
    broadcastState(room);
    syncAllItemInventories(room);
  });

  socket.on('useItem', ({ itemId }) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room || socket.data.role !== 'player') return;
    const check = canUseItem(room, socket.id, itemId);
    if (!check.ok) {
      socket.emit('itemUseResult', { ok: false, error: check.error });
      return;
    }
    const { p, def } = check;
    const ex = checkExclusiveHold(room, socket.id, def);
    if (!ex.ok) {
      pushItemFeedPrivate(room, socket.id, `「${ex.hold.itemName}」を${ex.hold.nickname}さんが先に使用したので使えません`);
      socket.emit('itemUseResult', { ok: false, error: 'blocked_exclusive' });
      return;
    }

    const useCheck = validateItemUse(room, socket.id, itemId);
    if (!useCheck.ok) {
      socket.emit('itemUseResult', { ok: false, error: useCheck.error });
      return;
    }

    consumeHeldItem(p, itemId);

    if (itemId === 'shield') {
      p.shieldStacks = (p.shieldStacks || 0) + 1;
      socket.emit('itemUseResult', {
        ok: true,
        itemId,
        message: `シールドを1枚スタック（合計${p.shieldStacks}枚）妨害が当たるまで保持`
      });
      emitItemInventory(room, socket.id);
      pushItemFeed(room, `${p.nickname}さんがシールドを張った（🛡${p.shieldStacks}枚・妨害を受けるまで有効）`);
      return;
    }

    setExclusiveHold(room, socket.id, def, p);
    p.queuedItemId = itemId;
    room.itemQueue = room.itemQueue.filter(q => q.userId !== socket.id);
    room.itemQueue.push({ userId: socket.id, itemId });
    socket.emit('itemUseResult', { ok: true, itemId, message: `「${def.name}」をセット！次の問題で発動します` });
    emitItemInventory(room, socket.id);
    if (itemId !== 'steal_stealth') {
      let msg = `${p.nickname}さんが「${def.name}」を使いました（次の問題で発動）`;
      if (itemId === 'steal_loud') {
        msg = `${p.nickname}さんが「堂々1点奪取」を使いました！次の問題で1位から1点もらいます`;
      } else if (itemId === 'swap_leader') {
        msg = `${p.nickname}さんが「逆転のカード」をセット！次問開始時に1位と入れ替え（差5点以内）`;
      } else if (itemId === 'snipe') {
        msg = `${p.nickname}さんが「スナイプ2点」をセット！次問開始時に直上の順位から2点`;
      } else if (itemId === 'tax_leader') {
        msg = `${p.nickname}さんが「トップ課税」をセット！次問開始時に1位から2・3位へ配分`;
      } else if (itemId === 'underdog2x') {
        msg = `${p.nickname}さんが「下克上ダブル」をセット！次問正解時に獲得2倍（4位以下）`;
      }
      pushItemFeed(room, msg);
    }
  });

  // 参加者へのスコア表示 ON/OFF
  socket.on('host:setShowScore', ({ code, enabled }) => {
    const room = resolveHostRoom(socket, code);
    if (!room) return;
    room.showScoreToPlayers = enabled === true;
    broadcastState(room);
  });

  // 解説バナー閉じる
  socket.on('host:hideExplanation', ({ code } = {}) => {
    const room = resolveHostRoom(socket, code);
    if (!room) return;
    io.to(room.code).emit('hideExplanation');
  });

  // リアクション (👏🎉😆😱🤔💡 等)
  socket.on('reaction', ({ emoji }) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room) return;
    const allow = ['👏', '🎉', '😆', '😱', '🤔', '💡', '🔥', '💯'];
    if (!allow.includes(emoji)) return;
    const player = room.players.get(socket.id);
    const nickname = player ? player.nickname : (socket.id === room.hostId ? '主催者' : '?');
    io.to(code).emit('reaction', { emoji, nickname });
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    if (socket.data.role === 'host' && room.hostId === socket.id) {
      clearRevealTimer(room);
      clearAnswerTimer(room);
      clearAutoAdvance(room);
      io.to(room.code).emit('roomClosed');
      rooms.delete(code);
      return;
    }
    if (socket.data.role === 'player') {
      room.players.delete(socket.id);
      const wasAnswering = room.answeringId === socket.id;
      room.buzzes = room.buzzes.filter(b => b.socketId !== socket.id);
      room.missed.delete(socket.id);
      if (wasAnswering) {
        clearAnswerTimer(room);
        room.answeringId = null;
        room.answerDeadline = null;
        const next = pickNextAnswerer(room);
        if (next) startAnswerCountdown(room, next);
      }
      broadcastState(room);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[quiz-buzzer] http://localhost:${PORT} で起動しました`);
});
