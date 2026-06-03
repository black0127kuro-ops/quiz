/* eslint-disable no-undef */
(function () {
  const socket = io({ transports: ['polling', 'websocket'], reconnection: true });
  const params = new URLSearchParams(location.search);
  let roomCode = params.get('code') || sessionStorage.getItem('hostRoomCode') || '';
  document.getElementById('room-code').textContent = roomCode || '----';

  // ----- 入室処理（リロード時は再アタッチ・無ければ新規作成） -----
  let hostReady = false;
  function hostPayload(extra) {
    return { ...(extra || {}), code: roomCode };
  }
  function hostEmit(event, data, ack) {
    if (!roomCode) return;
    const payload = hostPayload(data);
    if (typeof ack === 'function') socket.emit(event, payload, ack);
    else socket.emit(event, payload);
  }
  function isQuestionEditorFocused() {
    const el = document.activeElement;
    if (!el) return false;
    return el === editText || el === editAnswer || el === editExplanation
      || el === editPoints || el === editImageUrl;
  }

  /** サーバーからの一覧同期（入力中の上書きはしない） */
  function applyQuestionsFromServer(list, opts = {}) {
    const incoming = (list || []).map(q => ({ ...q }));
    if (!opts.force && incoming.length === 0 && questions.length > 0) return;
    questions = incoming;
    renderQList();
    if (!isQuestionEditorFocused() && selectedIdx >= 0 && selectedIdx < questions.length) {
      loadEditor();
    }
  }
  function onHostRoomReady(res) {
    if (!res || !res.ok) return;
    hostReady = true;
    if (res.code) updateCode(res.code);
    if (Array.isArray(res.questions)) applyQuestionsFromServer(res.questions);
    if (typeof res.currentIndex === 'number') hostCurrentIndex = res.currentIndex;
  }
  function ensureRoom() {
    hostReady = false;
    if (roomCode) {
      socket.emit('reattachHost', { code: roomCode }, (res) => {
        if (!res || !res.ok) {
          socket.emit('createRoom', {}, (r2) => { onHostRoomReady(r2); });
        } else {
          onHostRoomReady(res);
        }
      });
    } else {
      socket.emit('createRoom', {}, (r2) => { onHostRoomReady(r2); });
    }
  }
  function updateCode(code) {
    roomCode = code;
    sessionStorage.setItem('hostRoomCode', code);
    history.replaceState(null, '', `/host?code=${code}`);
    document.getElementById('room-code').textContent = code;
  }
  socket.on('connect', () => ensureRoom());

  // ----- DOM 取得 -----
  const stage = document.getElementById('stage');
  const typedEl = document.getElementById('typed');
  const caretEl = document.getElementById('caret');
  const phaseLabel = document.getElementById('phase-label');
  const qIndexEl = document.getElementById('q-index');
  const stageImage = document.getElementById('stage-image');
  const rankingList = document.getElementById('ranking-list');
  const scoreList = document.getElementById('score-list');
  const playersList = document.getElementById('players-list');
  const playerCount = document.getElementById('player-count');
  const speedSlider = document.getElementById('speed');
  const speedVal = document.getElementById('speed-val');
  const flash = document.getElementById('flash');

  const qListEl = document.getElementById('q-list');
  const qEditWrap = document.getElementById('q-edit');
  const qEditEmpty = document.getElementById('q-edit-empty');
  const editText = document.getElementById('edit-text');
  const editAnswer = document.getElementById('edit-answer');
  const editPoints = document.getElementById('edit-points');
  const editExplanation = document.getElementById('edit-explanation');
  const editImageUrl = document.getElementById('edit-image-url');
  const editImagePreview = document.getElementById('edit-image-preview');
  const imageFileInput = document.getElementById('image-file');

  const answerBanner = document.getElementById('answer-banner-host');
  const whoEl = document.getElementById('who-host');
  const countEl = document.getElementById('count-host');
  const autoBanner = document.getElementById('auto-banner-host');
  const autoCountEl = document.getElementById('auto-count-host');

  // ----- 状態 -----
  let lastState = null;
  let answerInterval = null;
  let autoInterval = null;
  // タイトル演出中はサーバから届いた reveal をキューに積み、タイトル終了後に
  // リビール速度で 1 文字ずつ流す。ネットワーク遅延・タブ切替時の setTimeout
  // スロットリング等で「タイトル中に文字が出る」「複数文字が一気に出る」事故を防ぐ。
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
    const speed = (lastState && lastState.revealSpeed) || 150;
    // 即座に 1 文字反映してから interval を起動（先頭の体感遅延を消す）
    typedEl.textContent += pendingReveals.shift();
    if (pendingReveals.length === 0) return;
    revealReplayTimer = setInterval(() => {
      if (pendingReveals.length === 0) {
        clearInterval(revealReplayTimer);
        revealReplayTimer = null;
        return;
      }
      typedEl.textContent += pendingReveals.shift();
    }, Math.max(20, speed));
  }
  let questions = [];
  let selectedIdx = -1;
  let hostCurrentIndex = -1;

  function unlockSound() { window.QuizSound && QuizSound.unlock(); }
  document.body.addEventListener('click', unlockSound, { once: true });

  // ===== 問題リスト編集 =====
  function renderQList() {
    qListEl.innerHTML = '';
    if (!questions.length) {
      const p = document.createElement('p');
      p.className = 'muted-note';
      p.textContent = '— 問題がありません。「＋ 新規追加」または「セット管理」から読み込んでください。 —';
      qListEl.appendChild(p);
    }
    const askedIdSet = (lastState && Array.isArray(lastState.askedIds)) ? new Set(lastState.askedIds) : new Set();
    const askedIdxSet = (lastState && Array.isArray(lastState.askedIndices)) ? new Set(lastState.askedIndices) : new Set();
    questions.forEach((q, i) => {
      const row = document.createElement('div');
      const asked = askedIdxSet.has(i) || !!(q.id && askedIdSet.has(q.id));
      row.className = 'q-item' + (i === hostCurrentIndex ? ' current' : '') + (asked ? ' asked' : '');
      row.dataset.qIdx = String(i);
      const ptsVal = (Number.isFinite(Number(q.points)) ? Number(q.points) : 1);
      row.innerHTML = `
        <div class="num">${i + 1}${asked ? ' <span class="asked-badge" title="出題済み">✓</span>' : ''}</div>
        <div>${q.image ? `<img class="thumb" src="${escapeAttr(q.image)}" alt="">` : `<div class="thumb"></div>`}</div>
        <div class="body">
          <div class="text">${escapeHtml(q.text || '(未入力)')}</div>
          <div class="answer">正解: ${escapeHtml(q.answer || '(未設定)')}</div>
          <div class="meta-row">
            <label class="pts-inline" title="配点（リストから変更可）">
              配点 <input type="number" class="pts-input" data-i="${i}" min="-99" max="999" value="${ptsVal}">
            </label>
            ${asked ? '<span class="asked-label">出題済み</span>' : ''}
          </div>
        </div>
        <div class="ctrls">
          <button class="btn small ghost" data-act="up" data-i="${i}" title="上へ">↑</button>
          <button class="btn small ghost" data-act="down" data-i="${i}" title="下へ">↓</button>
          <button class="btn small secondary" data-act="edit" data-i="${i}">編集</button>
          <button class="btn small good" data-act="play" data-i="${i}">出題</button>
          <button class="btn small danger" data-act="del" data-i="${i}">削除</button>
        </div>`;
      qListEl.appendChild(row);
    });
  }
  function updateListRowPreview(i) {
    const row = qListEl.querySelector(`.q-item[data-q-idx="${i}"]`);
    if (!row || !questions[i]) return;
    const textEl = row.querySelector('.body .text');
    if (textEl) textEl.textContent = questions[i].text || '(未入力)';
  }
  function renderQListHighlight() {
    qListEl.querySelectorAll('.q-item[data-q-idx]').forEach(row => {
      const i = Number(row.dataset.qIdx);
      row.classList.toggle('current', i === hostCurrentIndex);
    });
  }
  qListEl.addEventListener('change', (e) => {
    const inp = e.target.closest('.pts-input');
    if (!inp) return;
    const i = Number(inp.getAttribute('data-i'));
    if (!Number.isFinite(i) || !questions[i]) return;
    const raw = Number(inp.value);
    const v = Number.isFinite(raw)
      ? Math.max(-99, Math.min(999, Math.round(raw)))
      : 1;
    questions[i].points = v;
    inp.value = v;
    if (selectedIdx === i && editPoints) editPoints.value = v;
    pushQuestions();
  });
  qListEl.addEventListener('click', (e) => {
    if (e.target.closest('.pts-input')) return;
    const t = e.target.closest('button[data-act]');
    if (!t) return;
    const i = Number(t.getAttribute('data-i'));
    const act = t.getAttribute('data-act');
    if (act === 'edit') {
      readEditorFieldsIntoModel();
      pushQuestions();
      selectedIdx = i;
      loadEditor();
    } else if (act === 'del') {
      questions.splice(i, 1);
      if (selectedIdx === i) { selectedIdx = -1; loadEditor(); }
      else if (selectedIdx > i) selectedIdx--;
      pushQuestions();
      renderQList();
    } else if (act === 'up' && i > 0) {
      [questions[i - 1], questions[i]] = [questions[i], questions[i - 1]];
      if (selectedIdx === i) selectedIdx = i - 1;
      else if (selectedIdx === i - 1) selectedIdx = i;
      pushQuestions(); renderQList();
    } else if (act === 'down' && i < questions.length - 1) {
      [questions[i + 1], questions[i]] = [questions[i], questions[i + 1]];
      if (selectedIdx === i) selectedIdx = i + 1;
      else if (selectedIdx === i + 1) selectedIdx = i;
      pushQuestions(); renderQList();
    } else if (act === 'play') {
      unlockSound();
      readEditorFieldsIntoModel();
      pushQuestions(() => hostStartQuestionAt(i));
    }
  });

  function loadEditor() {
    if (selectedIdx < 0 || !questions[selectedIdx]) {
      qEditWrap.style.display = 'none';
      qEditEmpty.style.display = '';
      return;
    }
    const q = questions[selectedIdx];
    qEditWrap.style.display = '';
    qEditEmpty.style.display = 'none';
    editText.value = q.text || '';
    editAnswer.value = q.answer || '';
    editPoints.value = (Number.isFinite(Number(q.points)) ? Number(q.points) : 1);
    editExplanation.value = q.explanation || '';
    editImageUrl.value = q.image || '';
    if (q.image) {
      editImagePreview.src = q.image;
      editImagePreview.classList.add('show');
    } else {
      editImagePreview.classList.remove('show');
      editImagePreview.removeAttribute('src');
    }
  }

  function readEditorFieldsIntoModel() {
    if (selectedIdx < 0) return;
    const q = questions[selectedIdx];
    if (!q) return;
    q.text = editText.value;
    q.answer = editAnswer.value;
    const ptsRaw = Number(editPoints.value);
    q.points = Number.isFinite(ptsRaw) ? Math.max(-99, Math.min(999, Math.round(ptsRaw))) : 1;
    q.explanation = editExplanation.value;
    q.image = editImageUrl.value;
  }
  function syncEditorToModel() {
    readEditorFieldsIntoModel();
    renderQList();
    pushQuestions();
  }
  function syncEditorToModelNoPush() {
    readEditorFieldsIntoModel();
    if (selectedIdx >= 0) updateListRowPreview(selectedIdx);
  }
  editText.addEventListener('input', () => {
    if (selectedIdx < 0) return;
    questions[selectedIdx].text = editText.value;
    updateListRowPreview(selectedIdx);
  });
  editText.addEventListener('blur', () => {
    readEditorFieldsIntoModel();
    pushQuestions();
  });
  editText.addEventListener('change', () => {
    readEditorFieldsIntoModel();
    pushQuestions();
    renderQList();
  });
  editAnswer.addEventListener('input', syncEditorToModelNoPush);
  editAnswer.addEventListener('change', syncEditorToModel);
  editPoints.addEventListener('input', syncEditorToModel);
  editPoints.addEventListener('change', syncEditorToModel);
  editExplanation.addEventListener('input', syncEditorToModelNoPush);
  editExplanation.addEventListener('change', syncEditorToModel);
  editImageUrl.addEventListener('input', () => {
    if (editImageUrl.value) {
      editImagePreview.src = editImageUrl.value;
      editImagePreview.classList.add('show');
    } else {
      editImagePreview.classList.remove('show');
    }
    syncEditorToModel();
  });

  document.getElementById('btn-upload-image').addEventListener('click', () => imageFileInput.click());
  document.getElementById('btn-clear-image').addEventListener('click', () => {
    editImageUrl.value = '';
    editImagePreview.classList.remove('show');
    syncEditorToModel();
  });
  imageFileInput.addEventListener('change', async () => {
    const f = imageFileInput.files && imageFileInput.files[0];
    if (!f) return;
    const fd = new FormData();
    fd.append('file', f);
    const r = await fetch('/api/upload/image', { method: 'POST', body: fd });
    const j = await r.json();
    if (j.ok) {
      editImageUrl.value = j.url;
      editImagePreview.src = j.url;
      editImagePreview.classList.add('show');
      syncEditorToModel();
    } else {
      alert('画像アップロード失敗: ' + (j.error || ''));
    }
    imageFileInput.value = '';
  });

  document.getElementById('btn-add-question').addEventListener('click', () => {
    questions.push({
      id: 'q' + Math.random().toString(36).slice(2, 10),
      text: '',
      image: '',
      answer: '',
      explanation: '',
      points: 1
    });
    selectedIdx = questions.length - 1;
    pushQuestions();
    renderQList();
    loadEditor();
    editText.focus();
  });
  document.getElementById('btn-shuffle-questions').addEventListener('click', () => {
    if (questions.length < 2) return;
    if (!confirm('問題リストの順序をランダムに並び替えます。よろしいですか？')) return;
    // Fisher-Yates シャッフル
    for (let i = questions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [questions[i], questions[j]] = [questions[j], questions[i]];
    }
    selectedIdx = -1;
    pushQuestions();
    renderQList();
    loadEditor();
  });
  document.getElementById('btn-clear-questions').addEventListener('click', () => {
    if (!questions.length) return;
    if (!confirm('すべての問題を消去します。よろしいですか？')) return;
    questions = [];
    selectedIdx = -1;
    pushQuestions();
    renderQList();
    loadEditor();
  });
  document.getElementById('btn-save-set').addEventListener('click', async () => {
    const name = prompt('セット名を入力してください:', `クイズ ${new Date().toLocaleString('ja-JP')}`);
    if (!name) return;
    const r = await fetch('/api/sets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, questions })
    });
    const j = await r.json();
    if (j.ok) alert('セットを保存しました。');
    else alert('保存失敗');
  });

  function pushQuestions(callback) {
    if (!roomCode) {
      if (typeof callback === 'function') callback(false);
      return;
    }
    readEditorFieldsIntoModel();
    hostEmit('host:setQuestions', { questions }, (res) => {
      if (res && !res.ok) {
        alert('問題リストをサーバーに保存できませんでした。部屋番号を確認するか、ページを再読み込みしてください。');
        if (typeof callback === 'function') callback(false);
        return;
      }
      if (typeof callback === 'function') callback(true);
    });
  }

  // ===== セット管理モーダル =====
  function openModal(id) { document.getElementById(id).classList.add('open'); }
  function closeModal(id) { document.getElementById(id).classList.remove('open'); }
  document.querySelectorAll('[data-close-modal]').forEach(b => {
    b.addEventListener('click', () => closeModal(b.getAttribute('data-close-modal')));
  });
  document.getElementById('btn-open-sets').addEventListener('click', async () => {
    openModal('modal-sets');
    await refreshSets();
  });
  // tabs
  document.querySelectorAll('#modal-sets .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#modal-sets .tab').forEach(t => t.classList.toggle('active', t === tab));
      const target = tab.getAttribute('data-tab');
      document.querySelectorAll('#modal-sets .tab-pane').forEach(p => {
        p.style.display = p.getAttribute('data-pane') === target ? '' : 'none';
      });
    });
  });
  document.getElementById('btn-refresh-sets').addEventListener('click', refreshSets);
  async function refreshSets() {
    const r = await fetch('/api/sets');
    const j = await r.json();
    const list = document.getElementById('set-list');
    list.innerHTML = '';
    if (!j.ok || !j.sets.length) {
      list.innerHTML = '<p class="muted-note">— 保存済みセットはありません —</p>';
      return;
    }
    j.sets.forEach(s => {
      const it = document.createElement('div');
      it.className = 'item';
      it.innerHTML = `
        <div>
          <div class="name">${escapeHtml(s.name)}</div>
          <div class="meta">${s.count} 問 ・ 更新 ${new Date(s.updatedAt).toLocaleString('ja-JP')}</div>
        </div>
        <button class="btn small" data-act="load" data-id="${s.id}">読込</button>
        <button class="btn small secondary" data-act="export" data-id="${s.id}">エクスポート</button>
        <button class="btn small ghost" data-act="rename" data-id="${s.id}">名前変更</button>
        <button class="btn small danger" data-act="del" data-id="${s.id}">削除</button>`;
      list.appendChild(it);
    });
    list.onclick = async (e) => {
      const t = e.target.closest('button[data-act]');
      if (!t) return;
      const id = t.getAttribute('data-id');
      const act = t.getAttribute('data-act');
      if (act === 'load') {
        const rr = await fetch(`/api/sets/${id}`);
        const jj = await rr.json();
        if (jj.ok) {
          questions = (jj.set.questions || []).map(q => ({ ...q }));
          selectedIdx = -1;
          pushQuestions();
          renderQList();
          loadEditor();
          closeModal('modal-sets');
        }
      } else if (act === 'export') {
        window.open(`/api/sets/${id}/export`, '_blank');
      } else if (act === 'rename') {
        const name = prompt('新しい名前:');
        if (!name) return;
        await fetch(`/api/sets/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name })
        });
        await refreshSets();
      } else if (act === 'del') {
        if (!confirm('このセットを削除しますか？')) return;
        await fetch(`/api/sets/${id}`, { method: 'DELETE' });
        await refreshSets();
      }
    };
  }

  // import
  document.getElementById('btn-do-import').addEventListener('click', async () => {
    const f = document.getElementById('import-file').files[0];
    const notice = document.getElementById('import-notice');
    if (!f) { notice.textContent = 'JSONファイルを選択してください。'; return; }
    notice.textContent = '読込中...';
    const txt = await f.text();
    let obj;
    try { obj = JSON.parse(txt); } catch { notice.textContent = 'JSONとして読めませんでした。'; return; }
    const name = document.getElementById('import-name').value || (obj.name || f.name.replace(/\.json$/i, ''));
    const r = await fetch('/api/sets/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, questions: obj.questions || [] })
    });
    const j = await r.json();
    if (j.ok) {
      notice.textContent = 'インポートしました。';
      document.getElementById('import-file').value = '';
      document.getElementById('import-name').value = '';
      await refreshSets();
    } else {
      notice.textContent = '失敗: ' + (j.error || '');
    }
  });

  // ===== 効果音設定モーダル =====
  document.getElementById('btn-open-sounds').addEventListener('click', () => {
    openModal('modal-sounds');
    renderSoundConfig();
  });
  function renderSoundConfig() {
    const wrap = document.getElementById('sounds-config');
    wrap.innerHTML = '';
    const KEYS = window.SOUND_KEYS_ORDERED || ['deden', 'correct', 'wrong', 'buzz', 'countdown', 'countdownEnd'];
    KEYS.forEach(key => {
      const mode = QuizSound.getMode(key);
      const localName = QuizSound.getLocalName(key);
      const card = document.createElement('div');
      card.className = 'panel';
      card.innerHTML = `
        <h3>${SOUND_LABELS[key]}</h3>
        <div class="sound-row">
          <label>モード</label>
          <select data-role="mode" data-key="${key}">
            <option value="off"   ${mode === 'off'   ? 'selected' : ''}>無音 (オフ)</option>
            <option value="synth" ${mode === 'synth' ? 'selected' : ''}>内蔵合成音</option>
            <option value="local" ${mode === 'local' ? 'selected' : ''}>マイ音源 (このブラウザのみ)</option>
          </select>
          <button class="btn small ghost" type="button" data-role="preview" data-key="${key}">▶ 試聴</button>
        </div>
        <div class="sound-row" data-role="local-row" style="${mode === 'local' ? '' : 'display:none;'}">
          <label>音源ファイル</label>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span data-role="file-name" style="font-size:12px;color:var(--muted);">${escapeHtml(localName) || '未選択'}</span>
            <input type="file" accept="audio/*" data-role="file" data-key="${key}" style="display:none;">
            <button class="btn small secondary" type="button" data-role="select" data-key="${key}">ファイル選択</button>
            <button class="btn small ghost" type="button" data-role="clear" data-key="${key}">クリア</button>
          </div>
        </div>`;
      wrap.appendChild(card);
    });

    wrap.onchange = async (e) => {
      const sel = e.target.closest('select[data-role="mode"]');
      if (sel) {
        const key = sel.getAttribute('data-key');
        const mode = sel.value;
        await QuizSound.setMode(key, mode);
        // local-row の表示切替
        const card = sel.closest('.panel');
        const localRow = card.querySelector('[data-role="local-row"]');
        localRow.style.display = mode === 'local' ? '' : 'none';
        // ファイル名再表示（cache から）
        const nameEl = card.querySelector('[data-role="file-name"]');
        if (nameEl) nameEl.textContent = QuizSound.getLocalName(key) || '未選択';
        return;
      }
      const fi = e.target.closest('input[data-role="file"]');
      if (fi) {
        const key = fi.getAttribute('data-key');
        const file = fi.files && fi.files[0];
        if (!file) return;
        await QuizSound.setLocalFile(key, file);
        // 反映
        const card = fi.closest('.panel');
        const sel2 = card.querySelector('select[data-role="mode"]');
        sel2.value = 'local';
        card.querySelector('[data-role="local-row"]').style.display = '';
        card.querySelector('[data-role="file-name"]').textContent = QuizSound.getLocalName(key) || file.name;
        fi.value = '';
      }
    };

    wrap.onclick = (e) => {
      const t = e.target.closest('button[data-role]');
      if (!t) return;
      const key = t.getAttribute('data-key');
      const role = t.getAttribute('data-role');
      if (role === 'preview') {
        unlockSound();
        QuizSound.play(key);
      } else if (role === 'select') {
        const card = t.closest('.panel');
        card.querySelector('input[data-role="file"]').click();
      } else if (role === 'clear') {
        QuizSound.clearLocalFile(key).then(() => {
          const card = t.closest('.panel');
          const sel = card.querySelector('select[data-role="mode"]');
          if (sel.value === 'local') sel.value = 'off';
          card.querySelector('[data-role="local-row"]').style.display = 'none';
          card.querySelector('[data-role="file-name"]').textContent = '未選択';
        });
      }
    };
  }

  // ===== 出題コントロール =====
  // スライダーは「左=遅い／右=速い」だが、内部値 ms は逆方向 (小さいほど速い)。
  // そのため slider.value と ms を反転して扱う。
  const SPEED_MIN = 40, SPEED_MAX = 600;
  const sliderToMs = (v) => SPEED_MIN + SPEED_MAX - Number(v);
  const msToSlider = (ms) => SPEED_MIN + SPEED_MAX - Number(ms);

  speedSlider.addEventListener('input', () => {
    speedVal.textContent = `${sliderToMs(speedSlider.value)}ms/字`;
  });
  speedSlider.addEventListener('change', () => {
    hostEmit('host:setSpeed', { ms: sliderToMs(speedSlider.value) });
  });

  document.getElementById('btn-start').addEventListener('click', () => {
    unlockSound();
    readEditorFieldsIntoModel();
    if (selectedIdx >= 0) {
      pushQuestions(() => hostStartQuestionAt(selectedIdx));
    } else {
      // フリー入力（リスト未使用）想定: テキストフィールドの内容で
      const txt = editText.value;
      if (!txt) { alert('問題を選択するか、編集欄に入力してください。'); return; }
      hostEmit('host:setQuestionText', { text: txt, image: editImageUrl.value }, () => {
        hostStartQuestionFree();
      });
    }
  });
  document.getElementById('btn-resume').addEventListener('click', () => {
    unlockSound();
    hostEmit('host:resumeQuestion');
  });
  document.getElementById('btn-next').addEventListener('click', () => {
    unlockSound();
    hostEmit('host:nextQuestion');
  });
  document.getElementById('btn-correct').addEventListener('click', () => {
    unlockSound();
    hostEmit('host:correct');
  });
  document.getElementById('btn-wrong').addEventListener('click', () => {
    unlockSound();
    hostEmit('host:wrong');
  });
  document.getElementById('btn-reset-scores').addEventListener('click', () => {
    if (!confirm('スコアを 0 にし、問題数（第○問）もリセットします。\nお助けアイテムの種類を再度変更できるようになります。よろしいですか？')) return;
    hostEmit('host:resetScores');
  });

  document.getElementById('btn-home').addEventListener('click', () => {
    if (!confirm('ホーム画面に戻ります。この部屋は閉じられ、参加者全員が退出します。よろしいですか？')) return;
    sessionStorage.removeItem('hostRoomCode');
    location.href = '/';
  });

  // ===== お助けアイテム（主催者設定） =====
  const itemsEnabledEl = document.getElementById('items-enabled');
  const itemsLockNote = document.getElementById('items-lock-note');
  const hostItemsConfig = document.getElementById('host-items-config');
  const hostItemFeed = document.getElementById('host-item-feed');
  let hostItemsState = { enabled: false, configLocked: false, enabledIds: [] };

  function appendHostItemFeed(text, scope) {
    if (!hostItemFeed) return;
    const el = document.createElement('div');
    el.className = 'item-feed-msg ' + (scope === 'private' ? 'item-feed-private' : 'item-feed-public');
    el.textContent = text;
    hostItemFeed.appendChild(el);
    while (hostItemFeed.children.length > 25) hostItemFeed.removeChild(hostItemFeed.firstChild);
    hostItemFeed.scrollTop = hostItemFeed.scrollHeight;
  }
  function readLocalItemsConfigFromDom() {
    const master = !!(itemsEnabledEl && itemsEnabledEl.checked);
    const ids = [];
    if (hostItemsConfig) {
      hostItemsConfig.querySelectorAll('input[type=checkbox]').forEach(cb => {
        if (cb.checked) ids.push(cb.value);
      });
    }
    return { master, ids };
  }
  function renderHostItemsConfig() {
    if (!hostItemsConfig || !window.ITEM_CATALOG || !itemsEnabledEl) return;
    const locked = hostItemsState.configLocked;
    const local = readLocalItemsConfigFromDom();
    const enabled = locked ? hostItemsState.enabled : local.master;
    const enabledIds = (!locked && local.ids.length)
      ? local.ids
      : (hostItemsState.enabledIds || []);
    hostItemsState.enabled = enabled;
    if (!locked && local.ids.length) hostItemsState.enabledIds = local.ids.slice();

    itemsEnabledEl.checked = enabled;
    itemsEnabledEl.disabled = locked;
    itemsEnabledEl.parentElement.classList.toggle('locked', locked);

    const checkAllBtn = document.getElementById('items-check-all');
    const checkNoneBtn = document.getElementById('items-check-none');
    const bulkDisabled = locked || !enabled;
    if (checkAllBtn) checkAllBtn.disabled = bulkDisabled;
    if (checkNoneBtn) checkNoneBtn.disabled = bulkDisabled;

    itemsLockNote.textContent = locked
      ? '🔒 第1問開始後は種類の変更不可。配布は下の「アイテム配布」から問題の合間に行えます。'
      : '使う種類を選び、問題の合間に下の「アイテム配布」で配ってください。';
    hostItemsConfig.innerHTML = '';
    window.ITEM_CATALOG.forEach(def => {
      const lab = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = def.id;
      cb.checked = enabled && enabledIds.includes(def.id);
      cb.disabled = locked || !enabled;
      lab.className = locked || !enabled ? 'locked' : '';
      lab.appendChild(cb);
      const nameSpan = document.createElement('span');
      nameSpan.className = 'item-config-name';
      nameSpan.textContent = `${def.emoji} ${def.name}`;
      lab.appendChild(nameSpan);
      if (def.desc) {
        const descSpan = document.createElement('span');
        descSpan.className = 'item-config-desc';
        descSpan.textContent = def.desc;
        lab.appendChild(descSpan);
      }
      hostItemsConfig.appendChild(lab);
    });
    renderHostGrantPanel();
  }
  function getHostItemsConfigPayload() {
    const enabledIds = [];
    if (hostItemsConfig) {
      hostItemsConfig.querySelectorAll('input[type=checkbox]').forEach(cb => {
        if (cb.checked) enabledIds.push(cb.value);
      });
    }
    return {
      itemsEnabled: !!(itemsEnabledEl && itemsEnabledEl.checked),
      enabledIds
    };
  }
  function syncHostItemsFromState(state) {
    if (!state) return;
    if (state.itemsEnabled === true) hostItemsState.enabled = true;
    if (state.itemsConfigLocked === false) {
      hostItemsState.configLocked = false;
      renderHostItemsConfig();
    } else if (state.itemsConfigLocked === true && !hostItemsState.configLocked) {
      hostItemsState.configLocked = true;
      if (state.itemsEnabled === false) hostItemsState.enabled = false;
      renderHostItemsConfig();
    }
  }
  function pushHostItemsConfig(cb) {
    if (!roomCode) {
      if (typeof cb === 'function') cb({ ok: false, error: 'no_room' });
      return;
    }
    if (hostItemsState.configLocked) {
      renderHostItemsConfig();
      if (typeof cb === 'function') cb({ ok: false, error: 'locked' });
      return;
    }
    const payload = getHostItemsConfigPayload();
    hostEmit('host:setItemsConfig', {
      enabled: payload.itemsEnabled,
      enabledIds: payload.enabledIds
    }, (res) => {
      if (res && !res.ok && res.error === 'locked') {
        hostItemsState.configLocked = true;
        renderHostItemsConfig();
      }
      if (typeof cb === 'function') cb(res);
    });
  }
  function hostStartQuestionAt(index) {
    if (!roomCode) {
      alert('部屋がまだありません。ページを再読み込みするか、しばらく待ってから出題してください。');
      return;
    }
    hostItemsState.enabled = !!(itemsEnabledEl && itemsEnabledEl.checked);
    const cfg = getHostItemsConfigPayload();
    hostEmit('host:setSpeed', { ms: sliderToMs(speedSlider.value) });
    hostEmit('host:startQuestionAt', {
      index,
      itemsEnabled: cfg.itemsEnabled,
      enabledIds: cfg.enabledIds
    }, (res) => {
      if (res && !res.ok) {
        alert('出題できませんでした。問題リストを確認してください。');
      }
    });
  }
  function hostStartQuestionFree() {
    if (!roomCode) {
      alert('部屋がまだありません。ページを再読み込みするか、しばらく待ってから出題してください。');
      return;
    }
    hostItemsState.enabled = !!(itemsEnabledEl && itemsEnabledEl.checked);
    const cfg = getHostItemsConfigPayload();
    hostEmit('host:setSpeed', { ms: sliderToMs(speedSlider.value) });
    hostEmit('host:startQuestion', {
      itemsEnabled: cfg.itemsEnabled,
      enabledIds: cfg.enabledIds
    });
  }
  if (itemsEnabledEl) {
    itemsEnabledEl.addEventListener('change', () => {
      hostItemsState.enabled = itemsEnabledEl.checked;
      if (hostItemsState.enabled && window.ITEM_CATALOG) {
        hostItemsState.enabledIds = window.ITEM_CATALOG.map(d => d.id);
      }
      renderHostItemsConfig();
      pushHostItemsConfig();
    });
  }
  if (hostItemsConfig) {
    hostItemsConfig.addEventListener('change', () => pushHostItemsConfig());
  }
  const itemsCheckAllBtn = document.getElementById('items-check-all');
  const itemsCheckNoneBtn = document.getElementById('items-check-none');
  function setAllItemTypes(checked) {
    if (hostItemsState.configLocked || !itemsEnabledEl || !itemsEnabledEl.checked) return;
    if (!hostItemsConfig) return;
    hostItemsConfig.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.checked = checked;
    });
    hostItemsState.enabledIds = checked
      ? window.ITEM_CATALOG.map(d => d.id)
      : [];
    renderHostItemsConfig();
    pushHostItemsConfig();
  }
  if (itemsCheckAllBtn) {
    itemsCheckAllBtn.addEventListener('click', () => setAllItemTypes(true));
  }
  if (itemsCheckNoneBtn) {
    itemsCheckNoneBtn.addEventListener('click', () => setAllItemTypes(false));
  }
  socket.on('itemHostState', (st) => {
    if (!st) return;
    const locked = st.configLocked === true;
    const local = readLocalItemsConfigFromDom();
    hostItemsState.configLocked = locked;
    if (st.enabled === true) hostItemsState.enabled = true;
    else if (locked) hostItemsState.enabled = false;
    else if (!local.master) hostItemsState.enabled = false;

    if (Array.isArray(st.enabledIds) && st.enabledIds.length) {
      hostItemsState.enabledIds = st.enabledIds;
    } else if (!locked && local.ids.length) {
      hostItemsState.enabledIds = local.ids.slice();
    } else {
      hostItemsState.enabledIds = Array.isArray(st.enabledIds) ? st.enabledIds : [];
    }
    renderHostItemsConfig();
    if (hostItemFeed && Array.isArray(st.feed)) {
      hostItemFeed.innerHTML = '';
      st.feed.forEach(m => appendHostItemFeed(m.text, m.scope || 'public'));
    }
  });
  socket.on('itemFeed', (msg) => {
    if (msg && msg.text) appendHostItemFeed(msg.text, msg.scope || 'public');
  });

  const hostItemGrantPanel = document.getElementById('host-item-grant-panel');
  const grantItemSelect = document.getElementById('grant-item-select');
  const grantPlayerSelect = document.getElementById('grant-player-select');
  const grantItemDesc = document.getElementById('grant-item-desc');

  function updateGrantItemDesc() {
    if (!grantItemDesc || !grantItemSelect) return;
    if (grantItemSelect.value === 'random') {
      grantItemDesc.textContent = '有効なアイテム種類の中からランダムに1つ選んで配布します。';
      return;
    }
    if (!window.ITEM_CATALOG) return;
    const def = window.ITEM_CATALOG.find(d => d.id === grantItemSelect.value);
    grantItemDesc.textContent = def && def.desc ? def.desc : '';
  }

  function renderHostGrantPanel() {
    if (!hostItemGrantPanel || !grantItemSelect) return;
    const on = hostItemsState.enabled;
    hostItemGrantPanel.style.display = on ? '' : 'none';
    const poolIds = hostItemsState.enabledIds.length
      ? hostItemsState.enabledIds
      : (window.ITEM_CATALOG ? window.ITEM_CATALOG.map(d => d.id) : []);
    grantItemSelect.innerHTML = '';
    const randomOpt = document.createElement('option');
    randomOpt.value = 'random';
    randomOpt.textContent = '🎲 ランダム（有効な種類から）';
    grantItemSelect.appendChild(randomOpt);
    poolIds.forEach(id => {
      const def = window.ITEM_CATALOG && window.ITEM_CATALOG.find(d => d.id === id);
      if (!def) return;
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = `${def.emoji} ${def.name}`;
      grantItemSelect.appendChild(opt);
    });
    const prevItem = grantItemSelect.value;
    if (prevItem && [...grantItemSelect.options].some(o => o.value === prevItem)) {
      grantItemSelect.value = prevItem;
    } else {
      grantItemSelect.value = 'random';
    }
    updateGrantItemDesc();
    if (grantPlayerSelect) {
      const cur = grantPlayerSelect.value;
      grantPlayerSelect.innerHTML = '<option value="">— 参加者を選択 —</option>';
      const players = (lastState && lastState.players) ? lastState.players : [];
      players.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.nickname}（${p.score || 0}点）`;
        grantPlayerSelect.appendChild(opt);
      });
      if (cur && [...grantPlayerSelect.options].some(o => o.value === cur)) {
        grantPlayerSelect.value = cur;
      }
    }
    const busy = !!(lastState && (lastState.revealing || lastState.answeringId));
    ['btn-grant-random', 'btn-grant-exclude', 'btn-grant-target'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = !on || busy || !poolIds.length || !(lastState && lastState.players.length);
    });
    if (grantItemSelect) grantItemSelect.disabled = !on || busy;
    if (grantPlayerSelect) grantPlayerSelect.disabled = !on || busy;
  }

  function doGrantItem(mode) {
    if (!roomCode || !grantItemSelect) return;
    const itemVal = grantItemSelect.value;
    if (mode === 'target') {
      if (!itemVal || itemVal === 'random') {
        alert('指定配布ではアイテムを1つ選んでください（「ランダム」以外）。');
        return;
      }
      if (!grantPlayerSelect || !grantPlayerSelect.value) {
        alert('配布先の参加者を選んでください。');
        return;
      }
    }
    const payload = {
      mode,
      itemId: (itemVal === 'random' || !itemVal) ? 'random' : itemVal
    };
    if (mode === 'target') {
      payload.targetSocketId = grantPlayerSelect.value;
    }
    hostEmit('host:grantItem', payload, (res) => {
      if (!res || !res.ok) {
        const err = {
          items_off: 'お助けアイテムがOFFです',
          no_players: '参加者がいません',
          no_player: '参加者が見つかりません',
          no_item_pool: '配布できるアイテムがありません（種類をONにしてください）',
          item_not_allowed: 'このアイテムは使えません',
          bad_item: 'アイテムを選んでください'
        };
        alert(err[res.error] || '配布できませんでした');
      }
    });
  }
  const btnGrantRandom = document.getElementById('btn-grant-random');
  const btnGrantExclude = document.getElementById('btn-grant-exclude');
  const btnGrantTarget = document.getElementById('btn-grant-target');
  if (grantItemSelect) grantItemSelect.addEventListener('change', updateGrantItemDesc);
  if (btnGrantRandom) btnGrantRandom.addEventListener('click', () => doGrantItem('random'));
  if (btnGrantExclude) btnGrantExclude.addEventListener('click', () => doGrantItem('exclude_top3'));
  if (btnGrantTarget) btnGrantTarget.addEventListener('click', () => doGrantItem('target'));

  // ===== 結果発表 =====
  const resultsBackdrop = document.getElementById('results-backdrop');
  const podiumEl = document.getElementById('podium');
  const confettiEl = document.getElementById('confetti');
  const resultsSuspense = document.getElementById('results-suspense');
  const resultsActions = document.getElementById('results-actions');
  const resultsTitle = document.getElementById('results-title');
  let resultsAnimToken = 0; // アニメ進行中の識別。closeで打ち切り
  document.getElementById('btn-show-results').addEventListener('click', () => {
    unlockSound();
    hostEmit('host:showResults');
  });
  document.getElementById('btn-results-close').addEventListener('click', () => {
    hostEmit('host:hideResults');
  });
  document.getElementById('btn-replay-quiz').addEventListener('click', () => {
    if (!confirm('スコアと出題済みフラグをリセットして、もう一度クイズを始めますか？\n（参加者と問題リストはそのまま保持されます）')) return;
    if (!roomCode) {
      alert('部屋に接続されていません。ページを再読み込みしてください。');
      return;
    }
    hostEmit('host:replayQuiz', {}, (res) => {
      if (!res || !res.ok) {
        alert('リセットに失敗しました。主催者として部屋に接続できていない可能性があります。ページを再読み込みしてください。');
      }
    });
  });

  // ===== 参加者へのスコア表示 ON/OFF =====
  const btnToggleShowScore = document.getElementById('btn-toggle-show-score');
  btnToggleShowScore.addEventListener('click', () => {
    const cur = lastState ? lastState.showScoreToPlayers === true : true;
    const next = !cur;
    if (lastState) lastState.showScoreToPlayers = next;
    updateShowScoreButton({ showScoreToPlayers: next });
    hostEmit('host:setShowScore', { enabled: next });
  });
  function updateShowScoreButton(state) {
    const enabled = state.showScoreToPlayers === true;
    btnToggleShowScore.textContent = enabled ? '👁 スコア表示: ON' : '🙈 スコア表示: OFF';
    btnToggleShowScore.classList.toggle('active-toggle', enabled);
  }

  // ===== 解説バナー =====
  document.getElementById('exp-close').addEventListener('click', () => {
    hostEmit('host:hideExplanation');
  });

  // ===== ショートカット =====
  document.getElementById('btn-shortcuts').addEventListener('click', () => openModal('modal-shortcuts'));
  function isInputFocused() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
  }
  document.addEventListener('keydown', (e) => {
    if (isInputFocused()) return;
    // モーダル開いてる時は無効
    if (document.querySelector('.modal-backdrop.open') || resultsBackdrop.classList.contains('open')) return;
    const key = e.key;
    if (key === '?' || key === '/') { e.preventDefault(); openModal('modal-shortcuts'); return; }
    if (key === 'o' || key === 'O' || key === '1') { e.preventDefault(); unlockSound(); hostEmit('host:correct'); return; }
    if (key === 'x' || key === 'X' || key === '2') { e.preventDefault(); unlockSound(); hostEmit('host:wrong'); return; }
    if (key === 'n' || key === 'N') { e.preventDefault(); unlockSound(); hostEmit('host:nextQuestion'); return; }
    if (key === 'r' || key === 'R') {
      // 現在の問題を最初から流す
      e.preventDefault(); unlockSound();
      if (lastState && lastState.currentIndex >= 0) {
        readEditorFieldsIntoModel();
        pushQuestions(() => hostStartQuestionAt(lastState.currentIndex));
      }
      return;
    }
    if (key === 's' || key === 'S') {
      e.preventDefault();
      document.getElementById('btn-shuffle-questions').click();
      return;
    }
    if (key === ' ' || key === 'Spacebar') {
      e.preventDefault(); unlockSound();
      // 状況に応じてスマートに切替
      if (!lastState) return;
      if (lastState.revealing) {
        // 進行中 → 何もしない（必要なら Pause だが現在仕様外）
        return;
      }
      // 自動進行待ちなら次へ
      if (lastState.autoAdvanceDeadline) {
        hostEmit('host:nextQuestion');
        return;
      }
      // 出題完了済みなら次へ
      if (lastState.questionLength > 0 && lastState.revealIndex >= lastState.questionLength) {
        hostEmit('host:nextQuestion');
        return;
      }
      // 早押しで停止中 → 続きを流す
      if (lastState.questionLength > 0 && lastState.revealIndex < lastState.questionLength) {
        hostEmit('host:resumeQuestion');
        return;
      }
      // それ以外（待機中）→ 選択中の問題を出題
      if (selectedIdx >= 0) {
        readEditorFieldsIntoModel();
        pushQuestions(() => hostStartQuestionAt(selectedIdx));
      }
    }
  });

  // ===== ソケットイベント =====
  socket.on('state', (state) => {
    lastState = state;
    syncHostItemsFromState(state);
    renderHostGrantPanel();
    document.getElementById('room-code').textContent = state.code;

    playerCount.textContent = state.players.length;
    playersList.innerHTML = '';
    state.players.forEach(p => {
      const el = document.createElement('span');
      el.className = 'chip';
      el.textContent = p.nickname;
      playersList.appendChild(el);
    });

    // 出題テキスト（タイトル演出中・キュー再生中は state で上書きしない）
    if (!titleActive && !revealReplayTimer) {
      typedEl.textContent = state.questionVisible || '';
    }
    if (state.image) {
      stage.classList.add('has-image');
      stageImage.src = state.image;
    } else {
      stage.classList.remove('has-image');
      stageImage.removeAttribute('src');
    }
    if (state.revealing) {
      caretEl.style.display = 'inline-block'; stage.classList.remove('paused');
      phaseLabel.textContent = '出題中';
    } else if (state.questionVisible && state.questionLength > state.revealIndex) {
      caretEl.style.display = 'inline-block'; stage.classList.add('paused');
      phaseLabel.textContent = '一時停止';
    } else if (state.questionLength > 0 && state.revealIndex >= state.questionLength) {
      caretEl.style.display = 'none'; stage.classList.remove('paused');
      phaseLabel.textContent = '出題完了';
    } else {
      caretEl.style.display = 'none'; stage.classList.remove('paused');
      phaseLabel.textContent = '待機中';
    }
    qIndexEl.textContent = state.qNumber > 0 ? `第${toFullWidth(state.qNumber)}問` : '';

    // スコア表示トグルの見た目を同期
    updateShowScoreButton(state);

    if (state.revealing) hideExplanationBanner();

    renderRanking(state);
    renderScoreboard(state);
    if (isQuestionEditorFocused()) renderQListHighlight();
    else renderQList();
    if (sliderToMs(speedSlider.value) !== state.revealSpeed) {
      speedSlider.value = msToSlider(state.revealSpeed);
      speedVal.textContent = `${state.revealSpeed}ms/字`;
    }
    updateAnswerBanner(state);
    updateAutoBanner(state);
  });

  socket.on('host:state', (h) => {
    if (typeof h.currentIndex === 'number') hostCurrentIndex = h.currentIndex;
    if (isQuestionEditorFocused()) renderQListHighlight();
    else renderQList();
  });

  socket.on('reveal', ({ char }) => {
    hideExplanationBanner();
    if (titleActive || revealReplayTimer) {
      pendingReveals.push(char);
    } else {
      typedEl.textContent += char;
    }
  });
  socket.on('revealEnd', () => {
    caretEl.style.display = 'none';
    stage.classList.remove('paused');
    phaseLabel.textContent = '出題完了';
  });
  socket.on('revealPause', () => {
    stage.classList.add('paused');
    phaseLabel.textContent = '早押し受付';
  });
  socket.on('questionStart', ({ image, qIndex, qNumber }) => {
    if (typeof qNumber === 'number' && qNumber >= 1) {
      hostItemsState.configLocked = true;
      renderHostItemsConfig();
    }
    hideExplanationBanner();
    typedEl.textContent = '';
    caretEl.style.display = 'none';
    stage.classList.remove('paused');
    phaseLabel.textContent = '出題中';
    if (image) { stage.classList.add('has-image'); stageImage.src = image; }
    else { stage.classList.remove('has-image'); stageImage.removeAttribute('src'); }
    // 出題済み表示（state 到着前でもリストに反映）
    if (typeof qIndex === 'number' && qIndex >= 0) {
      hostCurrentIndex = qIndex;
      if (!lastState) lastState = { askedIds: [], askedIndices: [] };
      if (!Array.isArray(lastState.askedIndices)) lastState.askedIndices = [];
      if (!lastState.askedIndices.includes(qIndex)) lastState.askedIndices.push(qIndex);
      const q = questions[qIndex];
      if (q && q.id) {
        if (!Array.isArray(lastState.askedIds)) lastState.askedIds = [];
        if (!lastState.askedIds.includes(q.id)) lastState.askedIds.push(q.id);
      }
      if (isQuestionEditorFocused()) renderQListHighlight();
      else renderQList();
    }
    // 「第N問」の大きなタイトル演出。タイトル終了までは reveal をバッファに溜める。
    showTitleOverlay(qNumber);
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
  socket.on('questionPrepared', ({ image }) => {
    typedEl.textContent = '';
    caretEl.style.display = 'none';
    clearRevealQueue();
    if (image) { stage.classList.add('has-image'); stageImage.src = image; }
    else { stage.classList.remove('has-image'); stageImage.removeAttribute('src'); }
    phaseLabel.textContent = '次の問題';
  });
  socket.on('nextQuestion', () => {
    typedEl.textContent = '';
    caretEl.style.display = 'none';
    stage.classList.remove('has-image');
    stageImage.removeAttribute('src');
    clearRevealQueue();
    phaseLabel.textContent = '待機中';
  });

  socket.on('dedenSound', () => QuizSound.play('deden'));
  socket.on('buzzSound', () => QuizSound.play('buzz'));
  socket.on('answerStart', ({ socketId, deadline }) => showAnswerBanner(socketId, deadline));
  socket.on('answerStop', () => {
    hideAnswerBanner();
    QuizSound.stopCountdown();
  });
  socket.on('timersStop', () => {
    hideAnswerBanner();
    hideAutoBanner();
    QuizSound.stopCountdown();
  });
  socket.on('countdownStop', () => QuizSound.stopCountdown());
  socket.on('judgement', ({ type }) => {
    hideAnswerBanner();
    hideAutoBanner();
    QuizSound.stopCountdown();
    if (type === 'correct') { QuizSound.play('correct'); flashColor('correct'); }
    else { QuizSound.play('wrong'); flashColor('wrong'); }
  });
  socket.on('roomClosed', () => {
    alert('部屋が閉じられました。');
    location.href = '/';
  });

  // 自動進行
  socket.on('autoAdvanceStart', ({ deadline }) => showAutoBanner(deadline));
  socket.on('autoAdvanceStop', () => {
    hideAutoBanner();
    QuizSound.stopCountdown();
  });
  socket.on('countdownStart', () => { unlockSound(); QuizSound.startCountdown(); });
  socket.on('countdownEnd', () => QuizSound.playCountdownEnd());

  function hideExplanationBanner() {
    document.getElementById('explanation-banner').classList.remove('show');
  }
  // 解説（正解/不正解の判定後のみサーバーから送られる）
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
  socket.on('showResults', ({ players }) => {
    animateResults(players);
  });
  socket.on('hideResults', () => {
    resultsAnimToken++;
    QuizSound.stopResultsBuildup();
    resultsBackdrop.classList.remove('open');
    confettiEl.innerHTML = '';
  });
  // もう一度クイズが押されたとき
  socket.on('quizReplayed', () => {
    resultsAnimToken++;
    QuizSound.stopResultsBuildup();
    resultsBackdrop.classList.remove('open');
    confettiEl.innerHTML = '';
    resultsActions.style.display = 'none';
    resultsSuspense.classList.remove('animating');
    resultsSuspense.innerHTML = '';
    typedEl.textContent = '';
    caretEl.style.display = 'none';
    stage.classList.remove('has-image');
    stageImage.removeAttribute('src');
    phaseLabel.textContent = '待機中';
    qIndexEl.textContent = '';
    document.getElementById('explanation-banner').classList.remove('show');
    hideAutoBanner();
    if (lastState) {
      lastState.askedIds = [];
      lastState.askedIndices = [];
      lastState.qNumber = 0;
      lastState.currentIndex = -1;
      lastState.players.forEach(p => { p.score = 0; });
    }
    hostCurrentIndex = -1;
    if (lastState) {
      renderScoreboard(lastState);
    }
    renderQList();
  });

  // リアクション（参加者のボタン押下を全員に飛ばす）
  socket.on('reaction', ({ emoji, nickname }) => {
    spawnReaction(emoji, nickname);
  });

  // ===== 描画ヘルパ =====
  const titleOverlay = document.getElementById('title-overlay');
  let titleTimer1 = null, titleTimer2 = null;
  function showTitleOverlay(qNumber) {
    if (!titleOverlay) return;
    if (titleTimer1) clearTimeout(titleTimer1);
    if (titleTimer2) clearTimeout(titleTimer2);
    const n = (typeof qNumber === 'number' && qNumber > 0) ? qNumber : 1;
    titleOverlay.textContent = `第${toFullWidth(n)}問`;
    titleOverlay.classList.remove('fading', 'show');
    // reflow させて再アニメーション
    void titleOverlay.offsetWidth;
    titleOverlay.classList.add('show');
    // タイトル中は reveal を一切表示しない（キューに溜める）
    titleActive = true;
    clearRevealQueue();
    titleTimer1 = setTimeout(() => titleOverlay.classList.add('fading'), 1450);
    titleTimer2 = setTimeout(() => {
      titleOverlay.classList.remove('show', 'fading');
      titleActive = false;
      // 溜まっていた文字をリビール速度で順に流す
      startRevealReplayIfNeeded();
      caretEl.style.display = 'inline-block';
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
        <span class="nick">${escapeHtml(b.nickname)}</span>
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
        <span class="nick">${escapeHtml(p.nickname)}</span>
        <span class="score">
          <span style="margin-right:6px;">${p.score || 0}</span>
          <span class="ctrls">
            <button class="btn small ghost" data-act="dec" data-id="${p.id}">-1</button>
            <button class="btn small ghost" data-act="inc" data-id="${p.id}">+1</button>
          </span>
        </span>`;
      scoreList.appendChild(li);
    });
  }
  scoreList.addEventListener('click', (e) => {
    const t = e.target.closest('button[data-act]');
    if (!t) return;
    const id = t.getAttribute('data-id');
    const delta = t.getAttribute('data-act') === 'inc' ? 1 : -1;
    hostEmit('host:adjustScore', { socketId: id, delta });
  });

  function showAnswerBanner(socketId, deadline) {
    answerBanner.style.display = 'flex';
    if (lastState) {
      const p = lastState.players.find(p => p.id === socketId);
      const b = lastState.buzzes.find(b => b.socketId === socketId);
      whoEl.textContent = (p && p.nickname) || (b && b.nickname) || '?';
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
    QuizSound.stopCountdown();
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
      row.innerHTML = `
        <span class="medal">${medal}</span>
        <span class="nick">${escapeHtml(p.nickname)}</span>
        <span class="pts">${p.score}<span style="font-size:14px;color:var(--muted);font-weight:600;"> pt</span></span>`;
      podiumEl.appendChild(row);
    });
  }

  // 結果発表のフェーズ演出
  // 0-3.0s: タイトル + ドラムロール（溜め）
  // 3.0s : ファンファーレ + ドット消去
  // 3.0s〜: 下位から順に表彰台がスライドイン
  // 全表示後: 拍手・歓声 + 紙吹雪 + ボタン表示
  async function animateResults(players) {
    const myToken = ++resultsAnimToken;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const cancelled = () => myToken !== resultsAnimToken;

    // 初期化
    podiumEl.innerHTML = '';
    resultsActions.style.display = 'none';
    resultsSuspense.classList.add('animating');
    resultsTitle.classList.remove('shake');
    confettiEl.innerHTML = '';
    resultsBackdrop.classList.add('open');

    unlockSound();
    QuizSound.startResultsBuildup();

    // タイトルポップ後、サスペンス
    await sleep(3000);
    if (cancelled()) return;

    // 発表ジャジャーン
    QuizSound.stopResultsBuildup();
    QuizSound.playResultsReveal();
    resultsSuspense.classList.remove('animating');
    resultsSuspense.innerHTML = '<span class="reveal-text">発表！</span>';
    resultsTitle.classList.add('shake');

    await sleep(800);
    if (cancelled()) return;

    // 下位から順にスライドイン
    if (!players || players.length === 0) {
      podiumEl.innerHTML = '<p class="muted-note">— 参加者がいません —</p>';
    } else {
      const medals = ['🥇', '🥈', '🥉'];
      const klass = ['gold', 'silver', 'bronze'];
      // まず空の枠をすべて作成（位置確保）して、下位から show を付ける
      const rows = players.map((p, i) => {
        const row = document.createElement('div');
        row.className = 'podium-row ' + (klass[i] || '');
        const medal = medals[i] || `${i + 1}`;
        row.innerHTML = `
          <span class="medal">${medal}</span>
          <span class="nick">${escapeHtml(p.nickname)}</span>
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

    // お祝い：拍手・紙吹雪
    QuizSound.playResultsApplause();
    fireConfetti();
    await sleep(500);
    if (cancelled()) return;
    resultsActions.style.display = '';
    // サスペンス領域を控えめに
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
  function escapeAttr(s) { return escapeHtml(s); }
  function toFullWidth(n) {
    return String(n).replace(/[0-9]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x30 + 0xFF10));
  }
})();
