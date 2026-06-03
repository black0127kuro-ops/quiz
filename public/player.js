/* eslint-disable no-undef */
(function () {
  const socket = io({ transports: ['polling', 'websocket'], reconnection: true });
  const params = new URLSearchParams(location.search);
  const code = params.get('code') || sessionStorage.getItem('playerRoom') || '';
  const nick = params.get('nick') || sessionStorage.getItem('playerNick') || '';

  if (!code || !nick) { location.href = '/'; return; }

  document.getElementById('room-code').textContent = code;
  document.getElementById('me-nick').textContent = nick;

  socket.emit('joinRoom', { code, nickname: nick }, (res) => {
    if (!res || !res.ok) {
      const msg = res && res.error === 'room_full'
        ? 'この部屋は定員に達しています。'
        : res && res.error === 'rate_limited'
          ? '参加の試行回数が多すぎます。しばらく待ってからお試しください。'
          : '部屋への参加に失敗しました。';
      alert(msg);
      location.href = '/';
    }
  });
  // 再接続（ネット瞬断・タブ復帰時）で部屋に入り直す
  socket.on('connect', () => {
    mySocketId = socket.id;
    socket.emit('joinRoom', { code, nickname: nick }, (res) => {
      if (res && !res.ok && res.error === 'room_not_found') {
        alert('部屋が見つかりません。トップに戻ります。');
        location.href = '/';
      }
    });
  });

  document.getElementById('btn-home').addEventListener('click', () => {
    if (!confirm('ホーム画面に戻ります。部屋から退出しますがよろしいですか？')) return;
    sessionStorage.removeItem('playerNick');
    sessionStorage.removeItem('playerRoom');
    location.href = '/';
  });

  // 押ボタンの左右配置トグル（localStorage に永続化）
  const buzzRow = document.getElementById('buzz-row');
  const SIDE_KEY = 'quiz-buzzer-buzz-side';
  if (localStorage.getItem(SIDE_KEY) === 'right') {
    buzzRow.classList.add('right');
  }
  document.getElementById('btn-toggle-side').addEventListener('click', () => {
    buzzRow.classList.toggle('right');
    localStorage.setItem(SIDE_KEY, buzzRow.classList.contains('right') ? 'right' : 'left');
  });

  // 押ボタンデザイン切替（localStorage に永続化）
  const BUZZ_SKINS = [
    { id: 'default', label: '標準', short: '押' },
    { id: 'sos', label: 'SOS', src: '/buzzer-skins/sos.png' },
    { id: 'kasai-button', label: '火災ボタン', src: '/buzzer-skins/kasai-button.png' },
    { id: 'kasai-panel', label: '火災報知', src: '/buzzer-skins/kasai-panel.png' },
    { id: 'skull', label: 'ドクロ', src: '/buzzer-skins/skull.png' }
  ];
  const SKIN_KEY = 'quiz-buzzer-skin';
  const skinBar = document.getElementById('buzz-skin-bar');
  const buzzBtnEarly = document.getElementById('buzz');

  function applyBuzzSkin(skinId) {
    const skin = BUZZ_SKINS.find(s => s.id === skinId) || BUZZ_SKINS[0];
    buzzBtnEarly.className = 'buzz buzz--' + skin.id;
    if (skin.id === 'default') {
      buzzBtnEarly.textContent = '押';
      buzzBtnEarly.setAttribute('aria-label', '早押し');
    } else {
      buzzBtnEarly.textContent = '';
      buzzBtnEarly.setAttribute('aria-label', '早押し（' + skin.label + '）');
    }
    localStorage.setItem(SKIN_KEY, skin.id);
    skinBar.querySelectorAll('.skin-pick').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-skin') === skin.id);
    });
  }

  const skinLabel = document.createElement('span');
  skinLabel.className = 'buzz-skin-label';
  skinLabel.textContent = 'デザイン:';
  skinBar.appendChild(skinLabel);
  BUZZ_SKINS.forEach(skin => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'skin-pick skin-pick--' + skin.id;
    btn.setAttribute('data-skin', skin.id);
    btn.title = skin.label;
    btn.setAttribute('aria-label', skin.label);
    if (skin.id === 'default') {
      btn.textContent = skin.short;
    }
    btn.addEventListener('click', () => applyBuzzSkin(skin.id));
    skinBar.appendChild(btn);
  });
  const savedSkin = localStorage.getItem(SKIN_KEY);
  applyBuzzSkin(BUZZ_SKINS.some(s => s.id === savedSkin) ? savedSkin : 'default');

  // -------------------- お助けアイテム --------------------
  const itemsPanel = document.getElementById('items-panel');
  const itemFeedPanel = document.getElementById('item-feed-panel');
  const itemsGrid = document.getElementById('items-grid');
  const itemQueueHint = document.getElementById('item-queue-hint');
  const itemFeedList = document.getElementById('item-feed-list');
  const textWrap = document.querySelector('.text-wrap');
  let itemInventory = { enabled: false, enabledIds: [], held: {}, queued: null, shieldStacks: 0 };
  let myItemEffects = { delayMs: 0, flip: false, mirror: false, flash: false, slow2x: false, fullText: '', answerMs: 10000 };
  let revealGateOpenAt = 0;
  let flashTimer = null;

  function appendItemFeed(text, scope) {
    if (!itemFeedList) return;
    const el = document.createElement('div');
    el.className = 'item-feed-msg ' + (scope === 'private' ? 'item-feed-private' : 'item-feed-public');
    el.textContent = text;
    itemFeedList.appendChild(el);
    while (itemFeedList.children.length > 25) itemFeedList.removeChild(itemFeedList.firstChild);
    itemFeedList.scrollTop = itemFeedList.scrollHeight;
  }
  function applyItemVisuals() {
    if (textWrap) {
      textWrap.classList.toggle('item-flip', !!myItemEffects.flip);
      textWrap.classList.toggle('item-mirror', !!myItemEffects.mirror);
    }
    const st = document.getElementById('stage');
    if (st) st.classList.toggle('item-slow', !!myItemEffects.slow2x);
  }
  function getRevealIntervalMs() {
    const base = (lastState && lastState.revealSpeed) || 150;
    return myItemEffects.slow2x ? Math.max(20, base * 2) : Math.max(20, base);
  }
  function canAppendReveal() {
    return !titleActive && !revealReplayTimer && Date.now() >= revealGateOpenAt;
  }
  function onTitleRevealReady() {
    const runGatedReveal = () => {
      revealGateOpenAt = Date.now();
      applyItemVisuals();
      startRevealReplayIfNeeded();
      caretEl.style.display = 'inline-block';
      if (lastState) updateBuzzButton(lastState);
    };
    const afterDelay = () => {
      const d = myItemEffects.delayMs || 0;
      if (d > 0) setTimeout(runGatedReveal, d);
      else runGatedReveal();
    };
    if (myItemEffects.flash && myItemEffects.fullText) {
      if (flashTimer) clearTimeout(flashTimer);
      typedEl.textContent = myItemEffects.fullText;
      flashTimer = setTimeout(() => {
        typedEl.textContent = '';
        clearRevealQueue();
        afterDelay();
      }, 1000);
    } else {
      afterDelay();
    }
  }
  function itemsFeatureOn() {
    const held = itemInventory.held || {};
    const hasHeld = Object.values(held).some(n => (n || 0) > 0);
    return !!(itemInventory.enabled || (lastState && lastState.itemsEnabled) || hasHeld);
  }
  function updateItemsPanelsVisibility() {
    const on = itemsFeatureOn();
    if (itemsPanel) itemsPanel.style.display = on ? '' : 'none';
    if (itemFeedPanel) itemFeedPanel.style.display = '';
  }
  function renderItemsGrid() {
    if (!itemsGrid || !window.ITEM_CATALOG) return;
    itemsGrid.innerHTML = '';
    updateItemsPanelsVisibility();
    const enabled = itemsFeatureOn();
    const ids = itemInventory.enabledIds || [];
    if (!enabled) return;
    const held = itemInventory.held || {};
    const heldIds = Object.keys(held).filter(id => (held[id] || 0) > 0);
    if (!heldIds.length) {
      const empty = document.createElement('p');
      empty.className = 'items-empty-hint';
      empty.textContent = '所持アイテムなし（主催者が問題の合間に配布します）';
      itemsGrid.appendChild(empty);
    } else {
    heldIds.forEach(itemId => {
      const def = (window.ITEM_CATALOG && window.ITEM_CATALOG.find(x => x.id === itemId)) || null;
      const label = def ? def.name : itemId;
      const emoji = def ? def.emoji : '🎁';
      const desc = def && def.desc ? def.desc : '';
      const count = held[itemId] || 0;
      const btn = document.createElement('button');
      btn.type = 'button';
      const shieldStacks = itemInventory.shieldStacks || 0;
      btn.className = 'item-btn'
        + (itemInventory.queued === itemId ? ' queued' : '')
        + (itemId === 'shield' && shieldStacks > 0 ? ' shield-active' : '');
      btn.disabled = count < 1 || !!(lastState && (lastState.revealing || lastState.answeringId));
      const usesLabel = itemId === 'shield' && shieldStacks > 0
        ? `所持${count} / 🛡${shieldStacks}枚`
        : `×${count}`;
      btn.innerHTML =
        `<span class="item-btn-head">`
        + `<span class="emoji">${emoji}</span>`
        + `<span class="name">${escapeHtml(label)}</span>`
        + `<span class="uses">${usesLabel}</span>`
        + `</span>`
        + (desc ? `<span class="item-desc">${escapeHtml(desc)}</span>` : '');
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        socket.emit('useItem', { itemId });
      });
      itemsGrid.appendChild(btn);
    });
    }
    const hints = [];
    if (itemInventory.queued) {
      const q = window.ITEM_CATALOG.find(x => x.id === itemInventory.queued);
      if (q) hints.push(`✓ 「${q.name}」をセット済み（次の問題）`);
    }
    if ((itemInventory.shieldStacks || 0) > 0) {
      hints.push(`🛡 シールド ${itemInventory.shieldStacks}枚（妨害が当たるまで保持）`);
    }
    if (itemQueueHint) itemQueueHint.textContent = hints.join(' / ');
  }

  // -------------------- DOM --------------------
  const stage = document.getElementById('stage');
  const typedEl = document.getElementById('typed');
  const caretEl = document.getElementById('caret');
  const phaseLabel = document.getElementById('phase-label');
  const qIndexEl = document.getElementById('q-index');
  const buzzBtn = document.getElementById('buzz');
  const rankingList = document.getElementById('ranking-list');
  const scoreList = document.getElementById('score-list');
  const scoreboardEl = document.getElementById('scoreboard');
  const meScoreWrap = document.querySelector('.me-score-wrap');
  const answerBanner = document.getElementById('answer-banner');
  const whoEl = document.getElementById('who');
  const countEl = document.getElementById('count');
  const autoBanner = document.getElementById('auto-banner');
  const autoCountEl = document.getElementById('auto-count');
  const flash = document.getElementById('flash');
  const meScore = document.getElementById('me-score');

  let mySocketId = null;
  let lastState = null;
  let answerInterval = null;
  let autoInterval = null;
  // タイトル演出中はサーバから届いた reveal をキューに積み、タイトル終了後に
  // リビール速度で 1 文字ずつ流す（タブ切替や時刻ずれの防衛策）
  let titleActive = false;
  const pendingReveals = [];
  let revealReplayTimer = null;
  function clearRevealQueue() {
    pendingReveals.length = 0;
    if (revealReplayTimer) {
      clearInterval(revealReplayTimer);
      revealReplayTimer = null;
    }
  }
  function startRevealReplayIfNeeded() {
    if (revealReplayTimer) return;
    if (pendingReveals.length === 0) return;
    if (!canAppendReveal()) return;
    const speed = getRevealIntervalMs();
    typedEl.textContent += pendingReveals.shift();
    if (pendingReveals.length === 0) return;
    revealReplayTimer = setInterval(() => {
      if (pendingReveals.length === 0) {
        clearInterval(revealReplayTimer);
        revealReplayTimer = null;
        return;
      }
      typedEl.textContent += pendingReveals.shift();
    }, speed);
  }

  socket.on('connect', () => { mySocketId = socket.id; });
  // 注: 上の connect ハンドラで joinRoom を再送している（接続時/再接続時両対応）。
  // ここでは mySocketId 更新のみ（重複登録）を維持しても動作問題ないが、
  // 確実に id を最新に保つために残している。

  buzzBtn.addEventListener('pointerdown', (e) => {
    if (buzzBtn.disabled) return;
    e.preventDefault();
    socket.emit('buzz');
    buzzBtn.classList.add('pressed');
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev =>
    buzzBtn.addEventListener(ev, () => buzzBtn.classList.remove('pressed'))
  );
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !e.repeat) {
      if (buzzBtn.disabled) return;
      e.preventDefault();
      socket.emit('buzz');
      buzzBtn.classList.add('pressed');
    }
  });
  document.addEventListener('keyup', (e) => { if (e.code === 'Space') buzzBtn.classList.remove('pressed'); });

  // リアクション送信
  document.getElementById('reaction-bar').addEventListener('click', (e) => {
    const t = e.target.closest('.reaction-btn');
    if (!t) return;
    const emoji = t.getAttribute('data-emoji');
    if (emoji) socket.emit('reaction', { emoji });
  });

  // -------------------- Socket events --------------------
  socket.on('state', (state) => {
    lastState = state;
    if (state.itemsEnabled) itemInventory.enabled = true;

    if (!titleActive && !revealReplayTimer) {
      typedEl.textContent = state.questionVisible || '';
    }

    if (state.revealing) {
      caretEl.style.display = 'inline-block'; stage.classList.remove('paused');
      phaseLabel.textContent = '出題中';
    } else if (state.questionVisible && state.questionLength > state.revealIndex) {
      caretEl.style.display = 'inline-block'; stage.classList.add('paused');
      phaseLabel.textContent = '早押し受付中';
    } else if (state.questionLength > 0 && state.revealIndex >= state.questionLength) {
      caretEl.style.display = 'none'; stage.classList.remove('paused');
      phaseLabel.textContent = '早押し受付中';
    } else {
      caretEl.style.display = 'none'; stage.classList.remove('paused');
      phaseLabel.textContent = '待機中';
    }

    renderRanking(state);
    renderScoreboard(state);
    updateAnswerBanner(state);
    updateAutoBanner(state);
    updateBuzzButton(state);

    qIndexEl.textContent = state.qNumber > 0 ? `第${toFullWidth(state.qNumber)}問` : '';

    if (state.revealing) hideExplanationBanner();

    // 主催者がスコア表示を OFF にしている場合は隠す
    const showScore = state.showScoreToPlayers === true;
    if (scoreboardEl) scoreboardEl.style.display = showScore ? '' : 'none';
    if (meScoreWrap)  meScoreWrap.style.display  = showScore ? '' : 'none';

    const me = state.players.find(p => p.id === mySocketId);
    if (me) meScore.textContent = me.score || 0;

    updateItemsPanelsVisibility();
    renderItemsGrid();
  });

  socket.on('itemInventory', (inv) => {
    if (!inv) return;
    itemInventory = {
      enabled: inv.enabled === true,
      enabledIds: Array.isArray(inv.enabledIds) ? inv.enabledIds : (itemInventory.enabledIds || []),
      held: { ...(inv.held || {}) },
      queued: inv.queued != null ? inv.queued : null,
      shieldStacks: inv.shieldStacks != null ? inv.shieldStacks : 0
    };
    updateItemsPanelsVisibility();
    renderItemsGrid();
  });
  socket.on('itemGranted', (data) => {
    if (!data) return;
    itemInventory.enabled = true;
    if (data.itemId) {
      itemInventory.held = itemInventory.held || {};
      itemInventory.held[data.itemId] = (itemInventory.held[data.itemId] || 0) + 1;
    }
    updateItemsPanelsVisibility();
    renderItemsGrid();
  });
  socket.on('itemUseResult', (res) => {
    if (res && res.ok) {
      if (res.itemId && itemInventory.held) {
        const n = (itemInventory.held[res.itemId] || 0) - 1;
        if (n <= 0) delete itemInventory.held[res.itemId];
        else itemInventory.held[res.itemId] = n;
      }
      if (res.message && itemQueueHint) itemQueueHint.textContent = res.message;
      renderItemsGrid();
    } else {
      if (res.error === 'blocked_exclusive') return;
      const err = {
        items_off: 'アイテムはOFFです',
        busy: '出題・回答中は使えません',
        no_item: 'このアイテムを所持していません',
        item_disabled: '使えません',
        already_first: '1位のため使えません',
        gap_too_large: '1位との差が5点を超えているため使えません',
        target_too_poor: '直上の参加者の点数が2点未満のため使えません',
        need_more_players: '参加者が2人以上必要です',
        leader_no_points: '1位の点数が0のため使えません',
        rank_too_high: '4位以下のときだけ使えます'
      };
      alert(err[res.error] || 'アイテムを使えませんでした');
    }
  });
  socket.on('itemFeed', (msg) => {
    if (!msg || !msg.text) return;
    if (itemFeedPanel) itemFeedPanel.style.display = '';
    appendItemFeed(msg.text, msg.scope || 'public');
  });
  socket.on('itemFeedHistory', (list) => {
    if (!itemFeedList || !Array.isArray(list)) return;
    if (itemFeedPanel) itemFeedPanel.style.display = '';
    itemFeedList.innerHTML = '';
    list.forEach(m => appendItemFeed(m.text, m.scope || 'public'));
  });

  socket.on('reveal', ({ char }) => {
    hideExplanationBanner();
    if (!canAppendReveal()) {
      pendingReveals.push(char);
      return;
    }
    if (revealReplayTimer) {
      pendingReveals.push(char);
    } else {
      typedEl.textContent += char;
    }
  });
  socket.on('revealEnd', () => {
    caretEl.style.display = 'none'; stage.classList.remove('paused');
    phaseLabel.textContent = '早押し受付中';
  });
  socket.on('revealPause', () => {
    stage.classList.add('paused');
    phaseLabel.textContent = '早押し受付中';
  });
  socket.on('questionStart', ({ qIndex, qNumber, itemEffects }) => {
    hideExplanationBanner();
    if (flashTimer) clearTimeout(flashTimer);
    myItemEffects = itemEffects || { delayMs: 0, flip: false, mirror: false, flash: false, slow2x: false, fullText: '', answerMs: 10000 };
    revealGateOpenAt = Infinity;
    applyItemVisuals();
    typedEl.textContent = '';
    caretEl.style.display = 'none';
    stage.classList.remove('paused');
    phaseLabel.textContent = '出題中';
    showTitleOverlay(qNumber, onTitleRevealReady);
    if (typeof qNumber === 'number' && qNumber > 0) {
      qIndexEl.textContent = `第${toFullWidth(qNumber)}問`;
    } else {
      qIndexEl.textContent = '';
    }
  });
  socket.on('questionResume', () => {
    caretEl.style.display = 'inline-block'; stage.classList.remove('paused');
    phaseLabel.textContent = '出題中';
  });
  socket.on('questionPrepared', () => {
    typedEl.textContent = '';
    caretEl.style.display = 'none';
    clearRevealQueue();
    phaseLabel.textContent = '次の問題';
  });
  socket.on('nextQuestion', () => {
    myItemEffects = { delayMs: 0, flip: false, flash: false, slow2x: false, fullText: '' };
    applyItemVisuals();
    typedEl.textContent = '';
    caretEl.style.display = 'none';
    clearRevealQueue();
    phaseLabel.textContent = '待機中';
    renderItemsGrid();
  });

  socket.on('dedenSound', () => { /* 参加者は無音 */ });
  socket.on('buzzSound', () => { /* 参加者は無音 */ });
  socket.on('answerStart', ({ socketId, deadline }) => showAnswerBanner(socketId, deadline));
  socket.on('answerStop', () => hideAnswerBanner());
  socket.on('timersStop', () => {
    hideAnswerBanner();
    hideAutoBanner();
  });
  socket.on('judgement', ({ type }) => {
    hideAnswerBanner();
    hideAutoBanner();
    if (type === 'correct') { flashColor('correct'); }
    else { flashColor('wrong'); }
  });
  socket.on('roomClosed', () => {
    alert('主催者が退室したため部屋が閉じられました。');
    location.href = '/';
  });

  socket.on('autoAdvanceStart', ({ deadline }) => showAutoBanner(deadline));
  socket.on('autoAdvanceStop', () => hideAutoBanner());

  function hideExplanationBanner() {
    document.getElementById('explanation-banner').classList.remove('show');
  }
  // 解説バナー（正解/不正解の判定後のみ）
  socket.on('showExplanation', ({ answer, explanation }) => {
    if (lastState && lastState.revealing) return;
    if (titleActive) return;
    const ans = (answer || '').trim();
    const exp = (explanation || '').trim();
    if (!ans && !exp) return;
    document.getElementById('exp-answer').textContent = ans ? `正解: ${ans}` : '';
    document.getElementById('exp-text').textContent = exp;
    document.getElementById('explanation-banner').classList.add('show');
  });
  socket.on('hideExplanation', hideExplanationBanner);

  // 結果発表
  const resultsBackdrop = document.getElementById('results-backdrop');
  const podiumEl = document.getElementById('podium');
  const confettiEl = document.getElementById('confetti');
  const resultsSuspense = document.getElementById('results-suspense');
  const resultsTitle = document.getElementById('results-title');
  let resultsAnimToken = 0;
  socket.on('showResults', ({ players }) => {
    animateResults(players);
  });
  socket.on('hideResults', () => {
    resultsAnimToken++;
    resultsBackdrop.classList.remove('open');
    confettiEl.innerHTML = '';
  });
  socket.on('quizReplayed', () => {
    resultsAnimToken++;
    resultsBackdrop.classList.remove('open');
    confettiEl.innerHTML = '';
    typedEl.textContent = '';
    caretEl.style.display = 'none';
    phaseLabel.textContent = '待機中';
    qIndexEl.textContent = '';
    document.getElementById('explanation-banner').classList.remove('show');
    hideAutoBanner();
    if (lastState) {
      lastState.askedIds = [];
      lastState.askedIndices = [];
      lastState.qNumber = 0;
      lastState.players.forEach(p => { p.score = 0; });
      meScore.textContent = '0';
      renderScoreboard(lastState);
    }
  });

  // リアクション受信
  socket.on('reaction', ({ emoji, nickname }) => {
    spawnReaction(emoji, nickname);
  });

  // -------------------- helpers --------------------
  const titleOverlay = document.getElementById('title-overlay');
  let titleTimer1 = null, titleTimer2 = null;
  function showTitleOverlay(qNumber, onDone) {
    if (!titleOverlay) return;
    if (titleTimer1) clearTimeout(titleTimer1);
    if (titleTimer2) clearTimeout(titleTimer2);
    const n = (typeof qNumber === 'number' && qNumber > 0) ? qNumber : 1;
    titleOverlay.textContent = `第${toFullWidth(n)}問`;
    titleOverlay.classList.remove('fading', 'show');
    void titleOverlay.offsetWidth;
    titleOverlay.classList.add('show');
    titleActive = true;
    clearRevealQueue();
    titleTimer1 = setTimeout(() => titleOverlay.classList.add('fading'), 1450);
    titleTimer2 = setTimeout(() => {
      titleOverlay.classList.remove('show', 'fading');
      titleActive = false;
      if (typeof onDone === 'function') onDone();
      else {
        startRevealReplayIfNeeded();
        caretEl.style.display = 'inline-block';
        if (lastState) updateBuzzButton(lastState);
      }
    }, 1800);
  }

  function renderRanking(state) {
    rankingList.innerHTML = '';
    state.buzzes.forEach((b, i) => {
      const li = document.createElement('li');
      if (state.answeringId === b.socketId) li.classList.add('answering');
      if (state.missed && state.missed.includes(b.socketId)) li.classList.add('missed');
      li.innerHTML = `
        <span class="pos">${i + 1}</span>
        <span class="nick">${escapeHtml(b.nickname)}${b.socketId === mySocketId ? '（あなた）' : ''}</span>
        <span class="time">${b.time.toFixed(2)} 秒</span>`;
      rankingList.appendChild(li);
    });
    if (!state.buzzes.length) {
      rankingList.innerHTML = '<li style="grid-template-columns:1fr;color:var(--muted);">— まだ早押しはありません —</li>';
    }
  }
  function renderScoreboard(state) {
    scoreList.innerHTML = '';
    if (!state.players.length) {
      scoreList.innerHTML = '<li style="grid-template-columns:1fr;color:var(--muted);">— 参加者なし —</li>';
      return;
    }
    const sorted = [...state.players].sort((a, b) => (b.score || 0) - (a.score || 0));
    sorted.forEach((p, i) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="pos">${i + 1}</span>
        <span class="nick">${escapeHtml(p.nickname)}${p.id === mySocketId ? '（あなた）' : ''}</span>
        <span class="score">${p.score || 0}</span>`;
      scoreList.appendChild(li);
    });
  }
  function updateBuzzButton(state) {
    const alreadyBuzzed = state.buzzes.some(b => b.socketId === mySocketId);
    // タイトル演出中はサーバが弾くので、視覚的にも押下不可にしておく
    buzzBtn.disabled = alreadyBuzzed || titleActive;
  }
  function showAnswerBanner(socketId, deadline) {
    answerBanner.style.display = 'flex';
    answerBanner.classList.toggle('you', socketId === mySocketId);
    if (lastState) {
      const p = lastState.players.find(p => p.id === socketId);
      const b = lastState.buzzes.find(b => b.socketId === socketId);
      const name = (p && p.nickname) || (b && b.nickname) || '?';
      whoEl.textContent = socketId === mySocketId ? `あなた（${name}）` : name;
    }
    if (answerInterval) clearInterval(answerInterval);
    const update = () => {
      const remain = Math.max(0, (deadline - Date.now()) / 1000);
      countEl.textContent = remain.toFixed(1);
      if (remain <= 0) clearInterval(answerInterval);
    };
    update();
    answerInterval = setInterval(update, 100);
  }
  function hideAnswerBanner() {
    answerBanner.style.display = 'none';
    if (answerInterval) clearInterval(answerInterval);
    answerInterval = null;
  }
  function updateAnswerBanner(state) {
    if (state.answeringId && state.answerDeadline) showAnswerBanner(state.answeringId, state.answerDeadline);
    else hideAnswerBanner();
  }

  function showAutoBanner(deadline) {
    autoBanner.style.display = 'flex';
    if (autoInterval) clearInterval(autoInterval);
    const update = () => {
      const remain = Math.max(0, (deadline - Date.now()) / 1000);
      autoCountEl.textContent = remain.toFixed(1);
      if (remain <= 0) clearInterval(autoInterval);
    };
    update();
    autoInterval = setInterval(update, 100);
  }
  function hideAutoBanner() {
    autoBanner.style.display = 'none';
    if (autoInterval) clearInterval(autoInterval);
    autoInterval = null;
  }
  function updateAutoBanner(state) {
    if (state.autoAdvanceDeadline && state.autoAdvanceDeadline > Date.now() && !state.answeringId) {
      showAutoBanner(state.autoAdvanceDeadline);
    } else {
      hideAutoBanner();
    }
  }
  function flashColor(kind) {
    flash.classList.remove('correct', 'wrong');
    flash.classList.add(kind);
    setTimeout(() => flash.classList.remove(kind), 700);
  }

  // ===== 表彰台 / 紙吹雪 =====
  function renderPodium(players) {
    podiumEl.innerHTML = '';
    if (!players || players.length === 0) {
      podiumEl.innerHTML = '<p class="muted-note">— 参加者がいません —</p>';
      return;
    }
    const medals = ['🥇', '🥈', '🥉'];
    const klass = ['gold', 'silver', 'bronze'];
    players.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'podium-row show ' + (klass[i] || '');
      const medal = medals[i] || `${i + 1}`;
      const meMark = p.id === mySocketId ? '（あなた）' : '';
      row.innerHTML = `
        <span class="medal">${medal}</span>
        <span class="nick">${escapeHtml(p.nickname)}${meMark}</span>
        <span class="pts">${p.score}<span style="font-size:14px;color:var(--muted);font-weight:600;"> pt</span></span>`;
      podiumEl.appendChild(row);
    });
  }
  // 結果発表アニメ（参加者画面・音は無し）
  async function animateResults(players) {
    const myToken = ++resultsAnimToken;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const cancelled = () => myToken !== resultsAnimToken;
    podiumEl.innerHTML = '';
    resultsSuspense.classList.add('animating');
    resultsTitle.classList.remove('shake');
    resultsSuspense.innerHTML = '<span class="suspense-dots"><span></span><span></span><span></span></span>';
    confettiEl.innerHTML = '';
    resultsBackdrop.classList.add('open');

    await sleep(3000);
    if (cancelled()) return;

    resultsSuspense.classList.remove('animating');
    resultsSuspense.innerHTML = '<span class="reveal-text">発表！</span>';
    resultsTitle.classList.add('shake');

    await sleep(800);
    if (cancelled()) return;

    if (!players || players.length === 0) {
      podiumEl.innerHTML = '<p class="muted-note">— 参加者がいません —</p>';
    } else {
      const medals = ['🥇', '🥈', '🥉'];
      const klass = ['gold', 'silver', 'bronze'];
      const rows = players.map((p, i) => {
        const row = document.createElement('div');
        row.className = 'podium-row ' + (klass[i] || '');
        const medal = medals[i] || `${i + 1}`;
        const meMark = p.id === mySocketId ? '（あなた）' : '';
        row.innerHTML = `
          <span class="medal">${medal}</span>
          <span class="nick">${escapeHtml(p.nickname)}${meMark}</span>
          <span class="pts">${p.score}<span style="font-size:14px;color:var(--muted);font-weight:600;"> pt</span></span>`;
        podiumEl.appendChild(row);
        return row;
      });
      for (let i = rows.length - 1; i >= 0; i--) {
        if (cancelled()) return;
        rows[i].classList.add('show');
        await sleep(800);
      }
    }
    if (cancelled()) return;

    fireConfetti();
    setTimeout(() => {
      if (cancelled()) return;
      resultsSuspense.innerHTML = '';
    }, 2000);
  }
  function fireConfetti() {
    confettiEl.innerHTML = '';
    const colors = ['#ff8a1f', '#ffd23f', '#1bb05a', '#e4474a', '#3b82f6', '#a855f7'];
    const count = 90;
    for (let i = 0; i < count; i++) {
      const s = document.createElement('span');
      s.style.left = (Math.random() * 100) + 'vw';
      s.style.background = colors[i % colors.length];
      s.style.animationDuration = (2.5 + Math.random() * 2) + 's';
      s.style.animationDelay = (Math.random() * 0.6) + 's';
      s.style.transform = `rotate(${Math.random() * 360}deg)`;
      s.style.width = (6 + Math.random() * 8) + 'px';
      s.style.height = (10 + Math.random() * 10) + 'px';
      confettiEl.appendChild(s);
    }
    setTimeout(() => { confettiEl.innerHTML = ''; }, 6000);
  }

  // ===== リアクション =====
  const reactionLayer = document.getElementById('reaction-layer');
  function spawnReaction(emoji, nickname) {
    if (!emoji) return;
    const s = document.createElement('div');
    s.className = 'reaction-fly';
    s.textContent = emoji;
    const startX = 20 + Math.random() * (window.innerWidth - 40);
    const startY = window.innerHeight - 80;
    const dx = (Math.random() - 0.5) * 200;
    s.style.left = startX + 'px';
    s.style.top = startY + 'px';
    s.style.setProperty('--dx', dx + 'px');
    if (nickname) s.title = nickname;
    reactionLayer.appendChild(s);
    setTimeout(() => { try { reactionLayer.removeChild(s); } catch (_) {} }, 2700);
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  }
  function toFullWidth(n) {
    return String(n).replace(/[0-9]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x30 + 0xFF10));
  }
})();
