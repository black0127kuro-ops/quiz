/**
 * 効果音モジュール v4 (B 方式: 主催者ブラウザのみ・参加者は無音)
 *
 * - 各効果音 (deden / correct / wrong / buzz) ごとに以下のモードを選択可:
 *     - 'off'   : 無音 (デフォルト)
 *     - 'synth' : 内蔵 Web Audio 合成音 (本アプリ自作・著作権フリー)
 *     - 'local' : 主催者がローカルから読み込んだ音源ファイル
 *                 → IndexedDB にこのブラウザ内だけで保存される。
 *                   サーバには送信されない。
 *
 * 設計上の注意:
 *   - 効果音ラボ等の「再配布禁止」素材は 'local' モードでのみ利用すること。
 *   - 参加者画面ではこのモジュールの play() は呼ばないこと（無音）。
 */
(function (global) {
  // ============== Web Audio (合成音用) =================================
  let ctx = null;
  function ensureCtx() {
    if (!ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function bell({ freq, start = 0, gain = 0.35, duration = 0.9 }) {
    const ac = ensureCtx(); if (!ac) return;
    const t0 = ac.currentTime + start;
    const partials = [
      { mul: 1.0, gain: 1.0,  decayAt: duration * 1.0 },
      { mul: 2.0, gain: 0.55, decayAt: duration * 0.7 },
      { mul: 3.0, gain: 0.25, decayAt: duration * 0.5 },
      { mul: 4.2, gain: 0.12, decayAt: duration * 0.35 }
    ];
    partials.forEach(p => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(freq * p.mul, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain * p.gain), t0 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + p.decayAt);
      o.connect(g).connect(ac.destination);
      o.start(t0);
      o.stop(t0 + p.decayAt + 0.05);
    });
    const a = ac.createOscillator();
    const ag = ac.createGain();
    a.type = 'triangle';
    a.frequency.setValueAtTime(freq * 4, t0);
    ag.gain.setValueAtTime(0.0001, t0);
    ag.gain.exponentialRampToValueAtTime(0.18 * gain, t0 + 0.003);
    ag.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
    a.connect(ag).connect(ac.destination);
    a.start(t0); a.stop(t0 + 0.08);
  }

  function hitBrass({ start, duration, basePitch, accent }) {
    const ac = ensureCtx(); if (!ac) return;
    const t0 = ac.currentTime + start;
    [1, 2, 3, 4].forEach((mul, i) => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = i === 0 ? 'sawtooth' : (i === 1 ? 'sawtooth' : 'square');
      o.frequency.setValueAtTime(basePitch * mul, t0);
      o.frequency.exponentialRampToValueAtTime(basePitch * mul * 0.92, t0 + duration * 0.9);
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.setValueAtTime(2200, t0);
      lp.frequency.exponentialRampToValueAtTime(800, t0 + duration);
      lp.Q.value = 4;
      const baseGain = [0.32, 0.18, 0.10, 0.05][i] * accent;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(baseGain, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      o.connect(lp).connect(g).connect(ac.destination);
      o.start(t0); o.stop(t0 + duration + 0.05);
    });
    {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(basePitch * 0.5, t0);
      o.frequency.exponentialRampToValueAtTime(basePitch * 0.35, t0 + duration * 0.9);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.45 * accent, t0 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      o.connect(g).connect(ac.destination);
      o.start(t0); o.stop(t0 + duration + 0.05);
    }
    {
      const length = Math.floor(ac.sampleRate * 0.08);
      const buf = ac.createBuffer(1, length, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
      const src = ac.createBufferSource(); src.buffer = buf;
      const filter = ac.createBiquadFilter(); filter.type = 'highpass'; filter.frequency.value = 4000;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.18 * accent, t0 + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.08);
      src.connect(filter).connect(g).connect(ac.destination);
      src.start(t0); src.stop(t0 + 0.10);
    }
  }

  const SYNTH = {
    deden() {
      ensureCtx();
      hitBrass({ start: 0.00, duration: 0.20, basePitch: 110, accent: 0.7 });
      hitBrass({ start: 0.22, duration: 0.55, basePitch: 130.81, accent: 1.0 });
    },
    correct() {
      ensureCtx();
      bell({ freq: 739.99, start: 0.00, gain: 0.45, duration: 0.32 });
      bell({ freq: 587.33, start: 0.22, gain: 0.45, duration: 0.42 });
      bell({ freq: 739.99, start: 0.55, gain: 0.45, duration: 0.32 });
      bell({ freq: 587.33, start: 0.78, gain: 0.55, duration: 1.20 });
    },
    wrong() {
      const ac = ensureCtx(); if (!ac) return;
      const t0 = ac.currentTime;
      const pulses = [
        { start: 0.00, duration: 0.10, gain: 0.30 },
        { start: 0.13, duration: 0.10, gain: 0.30 },
        { start: 0.27, duration: 0.55, gain: 0.34 }
      ];
      pulses.forEach(p => {
        const start = t0 + p.start;
        [-7, +7].forEach((cents, i) => {
          const o = ac.createOscillator();
          const g = ac.createGain();
          o.type = 'sawtooth';
          o.frequency.setValueAtTime(110, start);
          o.detune.setValueAtTime(cents, start);
          const lp = ac.createBiquadFilter();
          lp.type = 'lowpass'; lp.frequency.value = 1100; lp.Q.value = 2;
          g.gain.setValueAtTime(0.0001, start);
          g.gain.exponentialRampToValueAtTime(p.gain * (i === 0 ? 1 : 0.7), start + 0.006);
          g.gain.setValueAtTime(p.gain * (i === 0 ? 1 : 0.7), start + p.duration - 0.06);
          g.gain.exponentialRampToValueAtTime(0.0001, start + p.duration);
          o.connect(lp).connect(g).connect(ac.destination);
          o.start(start); o.stop(start + p.duration + 0.03);
        });
        const sub = ac.createOscillator();
        const sg = ac.createGain();
        sub.type = 'sine';
        sub.frequency.setValueAtTime(55, start);
        sg.gain.setValueAtTime(0.0001, start);
        sg.gain.exponentialRampToValueAtTime(p.gain * 0.6, start + 0.006);
        sg.gain.exponentialRampToValueAtTime(0.0001, start + p.duration);
        sub.connect(sg).connect(ac.destination);
        sub.start(start); sub.stop(start + p.duration + 0.03);
      });
    },
    buzz() {
      const ac = ensureCtx(); if (!ac) return;
      const t0 = ac.currentTime;
      bell({ freq: 1318.51, start: 0.00, gain: 0.55, duration: 0.18 });
      const length = Math.floor(ac.sampleRate * 0.012);
      const buf = ac.createBuffer(1, length, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
      const src = ac.createBufferSource(); src.buffer = buf;
      const filter = ac.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = 3000; filter.Q.value = 0.8;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.30, t0 + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.012);
      src.connect(filter).connect(g).connect(ac.destination);
      src.start(t0); src.stop(t0 + 0.02);
    },
    /** 1 tick: 短い高音ビープ（時計刻み風） */
    countdown() {
      const ac = ensureCtx(); if (!ac) return;
      const t0 = ac.currentTime;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'square';
      o.frequency.setValueAtTime(880, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.10);
      o.connect(g).connect(ac.destination);
      o.start(t0); o.stop(t0 + 0.12);
    },
    /** カウントダウン終了アラーム（長めのピー） */
    countdownEnd() {
      const ac = ensureCtx(); if (!ac) return;
      const t0 = ac.currentTime;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(1760, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.28, t0 + 0.02);
      g.gain.setValueAtTime(0.28, t0 + 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.95);
      o.connect(g).connect(ac.destination);
      o.start(t0); o.stop(t0 + 1.0);
      // 倍音
      const o2 = ac.createOscillator();
      const g2 = ac.createGain();
      o2.type = 'sine';
      o2.frequency.setValueAtTime(880, t0);
      g2.gain.setValueAtTime(0.0001, t0);
      g2.gain.exponentialRampToValueAtTime(0.10, t0 + 0.02);
      g2.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.95);
      o2.connect(g2).connect(ac.destination);
      o2.start(t0); o2.stop(t0 + 1.0);
    },
    /** 結果発表「溜め」: スネアドラムロール風（短いノイズ連打） */
    resultsBuildup() {
      // 単発呼び出し: 1 ティックの「ダ！」
      const ac = ensureCtx(); if (!ac) return;
      const t0 = ac.currentTime;
      const length = Math.floor(ac.sampleRate * 0.04);
      const buf = ac.createBuffer(1, length, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
      const src = ac.createBufferSource(); src.buffer = buf;
      const filter = ac.createBiquadFilter(); filter.type = 'bandpass';
      filter.frequency.value = 1500; filter.Q.value = 1.4;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.30, t0 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.04);
      src.connect(filter).connect(g).connect(ac.destination);
      src.start(t0); src.stop(t0 + 0.05);
    },
    /** 結果発表「発表」: ファンファーレ（ブラス上行） */
    resultsReveal() {
      const ac = ensureCtx(); if (!ac) return;
      const t0 = ac.currentTime;
      // C-E-G-C 上行 + 高音シンバル風ノイズ
      const notes = [
        { f: 261.63, s: 0.00, d: 0.18 },  // C4
        { f: 329.63, s: 0.15, d: 0.18 },  // E4
        { f: 392.00, s: 0.30, d: 0.18 },  // G4
        { f: 523.25, s: 0.45, d: 1.00 }   // C5（伸ばし）
      ];
      notes.forEach(n => {
        const start = t0 + n.s;
        // 鋸歯×2（ブラスらしい厚み）
        [1, 2].forEach((mul, i) => {
          const o = ac.createOscillator();
          const g = ac.createGain();
          o.type = i === 0 ? 'sawtooth' : 'square';
          o.frequency.setValueAtTime(n.f * mul, start);
          const lp = ac.createBiquadFilter();
          lp.type = 'lowpass'; lp.frequency.value = 3200; lp.Q.value = 2;
          const baseGain = i === 0 ? 0.30 : 0.10;
          g.gain.setValueAtTime(0.0001, start);
          g.gain.exponentialRampToValueAtTime(baseGain, start + 0.01);
          g.gain.setValueAtTime(baseGain, start + Math.max(0.01, n.d - 0.08));
          g.gain.exponentialRampToValueAtTime(0.0001, start + n.d);
          o.connect(lp).connect(g).connect(ac.destination);
          o.start(start); o.stop(start + n.d + 0.05);
        });
      });
      // 最後にシンバル
      const cymStart = t0 + 0.45;
      const cymLen = 0.6;
      const length = Math.floor(ac.sampleRate * cymLen);
      const buf = ac.createBuffer(1, length, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
      const src = ac.createBufferSource(); src.buffer = buf;
      const f = ac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 5000;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, cymStart);
      g.gain.exponentialRampToValueAtTime(0.18, cymStart + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, cymStart + cymLen);
      src.connect(f).connect(g).connect(ac.destination);
      src.start(cymStart); src.stop(cymStart + cymLen);
    },
    /** 結果発表「お祝い」: 拍手・歓声風（フィルタードノイズに揺らぎ） */
    resultsApplause() {
      const ac = ensureCtx(); if (!ac) return;
      const t0 = ac.currentTime;
      const dur = 2.5;
      // ベース: 大きなノイズ層（観客のざわめき）
      const length = Math.floor(ac.sampleRate * dur);
      const buf = ac.createBuffer(1, length, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < length; i++) {
        // ピンクノイズ近似 + 小さな振幅変動
        const env = 0.5 + 0.5 * Math.sin(i * 0.0007);
        data[i] = (Math.random() * 2 - 1) * 0.7 * env;
      }
      const src = ac.createBufferSource(); src.buffer = buf;
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass';
      bp.frequency.value = 2200; bp.Q.value = 0.6;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.08);
      g.gain.setValueAtTime(0.22, t0 + dur - 0.5);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(bp).connect(g).connect(ac.destination);
      src.start(t0); src.stop(t0 + dur + 0.05);

      // 重ね: 個別のクラップを乱発（鋭い短いノイズバースト）
      const claps = 22;
      for (let i = 0; i < claps; i++) {
        const cs = t0 + Math.random() * (dur - 0.1);
        const cl = 0.04;
        const cbuf = ac.createBuffer(1, Math.floor(ac.sampleRate * cl), ac.sampleRate);
        const cd = cbuf.getChannelData(0);
        for (let j = 0; j < cd.length; j++) cd[j] = (Math.random() * 2 - 1) * (1 - j / cd.length);
        const cs2 = ac.createBufferSource(); cs2.buffer = cbuf;
        const cf = ac.createBiquadFilter(); cf.type = 'highpass'; cf.frequency.value = 2500;
        const cg = ac.createGain();
        const peakGain = 0.06 + Math.random() * 0.10;
        cg.gain.setValueAtTime(0.0001, cs);
        cg.gain.exponentialRampToValueAtTime(peakGain, cs + 0.003);
        cg.gain.exponentialRampToValueAtTime(0.0001, cs + cl);
        cs2.connect(cf).connect(cg).connect(ac.destination);
        cs2.start(cs); cs2.stop(cs + cl + 0.02);
      }
    }
  };

  // ============== IndexedDB（マイ音源ファイル保存） =====================
  const KEYS = ['deden', 'correct', 'wrong', 'buzz', 'countdown', 'countdownEnd', 'resultsBuildup', 'resultsReveal', 'resultsApplause'];
  // 主効果音はデフォルトオフ、カウントダウン2種と結果系3種は合成音をデフォルトに
  const DEFAULT_OFF = ['deden', 'correct', 'wrong', 'buzz'];
  const DEFAULT_SYNTH = ['countdown', 'countdownEnd', 'resultsBuildup', 'resultsReveal', 'resultsApplause'];
  const DB_NAME = 'quiz-buzzer-sounds';
  const STORE = 'files';
  const META_LS_KEY = 'quiz-buzzer-sound-modes';
  const META_NAME_KEY = 'quiz-buzzer-sound-names';

  function openDB() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('IndexedDB unsupported'));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function saveFile(key, file) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(file, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function loadFile(key) {
    try {
      const db = await openDB();
      return await new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch (_) { return null; }
  }
  async function deleteFileFromDB(key) {
    try {
      const db = await openDB();
      return await new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch (_) {}
  }

  // localStorage に mode と表示用ファイル名を保持
  function loadModes() {
    try { return JSON.parse(localStorage.getItem(META_LS_KEY)) || {}; }
    catch { return {}; }
  }
  function saveModes(m) { localStorage.setItem(META_LS_KEY, JSON.stringify(m)); }
  function loadNames() {
    try { return JSON.parse(localStorage.getItem(META_NAME_KEY)) || {}; }
    catch { return {}; }
  }
  function saveNames(n) { localStorage.setItem(META_NAME_KEY, JSON.stringify(n)); }

  const modes = loadModes();
  const names = loadNames();
  DEFAULT_OFF.forEach(k => { if (!modes[k]) modes[k] = 'off'; });
  DEFAULT_SYNTH.forEach(k => { if (!modes[k]) modes[k] = 'synth'; });
  saveModes(modes);

  // 再生用 cached HTMLAudioElement
  const localCache = new Map(); // key -> { url, audio, name }

  async function loadLocalToCache(key) {
    const file = await loadFile(key);
    if (!file) {
      localCache.delete(key);
      return null;
    }
    if (localCache.has(key)) {
      try { URL.revokeObjectURL(localCache.get(key).url); } catch (_) {}
    }
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    audio.preload = 'auto';
    const entry = { url, audio, name: names[key] || file.name || '音源' };
    localCache.set(key, entry);
    return entry;
  }

  async function init() {
    for (const k of KEYS) {
      if (modes[k] === 'local') {
        await loadLocalToCache(k);
      }
    }
  }
  init().catch(() => {});

  // ============== 公開 API =============================================
  function play(key) {
    const mode = modes[key] || 'off';
    if (mode === 'off') return;
    if (mode === 'synth') {
      const fn = SYNTH[key]; if (fn) fn();
      return;
    }
    if (mode === 'local') {
      const entry = localCache.get(key);
      if (!entry) return;
      try {
        entry.audio.loop = false; // 単発再生に戻す（カウントダウンループ後の状態を上書き）
        entry.audio.pause();
        entry.audio.currentTime = 0;
        const p = entry.audio.play();
        if (p && p.catch) p.catch(() => {});
      } catch (_) {}
    }
  }

  async function setMode(key, mode) {
    if (!KEYS.includes(key)) return;
    modes[key] = mode;
    saveModes(modes);
    if (mode === 'local' && !localCache.has(key)) {
      await loadLocalToCache(key);
    }
  }
  function getMode(key) { return modes[key] || 'off'; }

  async function setLocalFile(key, file) {
    if (!KEYS.includes(key) || !file) return;
    await saveFile(key, file);
    names[key] = file.name || '音源';
    saveNames(names);
    await loadLocalToCache(key);
    modes[key] = 'local';
    saveModes(modes);
  }

  async function clearLocalFile(key) {
    if (!KEYS.includes(key)) return;
    await deleteFileFromDB(key);
    if (localCache.has(key)) {
      try { URL.revokeObjectURL(localCache.get(key).url); } catch (_) {}
      localCache.delete(key);
    }
    delete names[key];
    saveNames(names);
    if (modes[key] === 'local') {
      modes[key] = 'off';
      saveModes(modes);
    }
  }

  function getLocalName(key) {
    if (localCache.has(key)) return localCache.get(key).name;
    return names[key] || '';
  }

  // 任意ファイルを試聴（保存はしない）
  function previewFile(file) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const a = new Audio(url);
    a.play().catch(() => {});
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) {} }, 10000);
  }
  function previewSynth(key) {
    const fn = SYNTH[key]; if (fn) fn();
  }

  function unlock() { ensureCtx(); }

  // ============== カウントダウン用ループ =================================
  // モードに従って合成音 / マイ音源 / 無音を切り替える。
  // - synth : 1秒ごとに SYNTH.countdown() を呼ぶ
  // - local : audio.loop=true で連続再生
  // - off   : 何もしない
  let countdownInterval = null;
  let countdownLoopAudio = null;
  function startCountdown() {
    stopCountdown();
    const mode = modes['countdown'] || 'off';
    if (mode === 'off') return;
    if (mode === 'synth') {
      SYNTH.countdown();
      countdownInterval = setInterval(() => SYNTH.countdown(), 1000);
      return;
    }
    if (mode === 'local') {
      const entry = localCache.get('countdown');
      if (!entry) return;
      try {
        const a = entry.audio;
        a.loop = true;
        a.currentTime = 0;
        countdownLoopAudio = a;
        const p = a.play();
        if (p && p.catch) p.catch(() => {});
      } catch (_) {}
    }
  }
  function stopCountdown() {
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    if (countdownLoopAudio) {
      try {
        countdownLoopAudio.pause();
        countdownLoopAudio.currentTime = 0;
        countdownLoopAudio.loop = false;
      } catch (_) {}
      countdownLoopAudio = null;
    }
  }
  function playCountdownEnd() {
    stopCountdown();
    play('countdownEnd');
  }

  // ============== 結果発表「溜め」ループ ============================
  // synth: 短いドラムロールティックを 60ms 間隔で連打
  // local: audio.loop=true で連続再生
  let buildupInterval = null;
  let buildupLoopAudio = null;
  function startResultsBuildup() {
    stopResultsBuildup();
    const mode = modes['resultsBuildup'] || 'off';
    if (mode === 'off') return;
    if (mode === 'synth') {
      SYNTH.resultsBuildup();
      buildupInterval = setInterval(() => SYNTH.resultsBuildup(), 60);
      return;
    }
    if (mode === 'local') {
      const entry = localCache.get('resultsBuildup');
      if (!entry) return;
      try {
        const a = entry.audio;
        a.loop = true;
        a.currentTime = 0;
        buildupLoopAudio = a;
        const p = a.play();
        if (p && p.catch) p.catch(() => {});
      } catch (_) {}
    }
  }
  function stopResultsBuildup() {
    if (buildupInterval) {
      clearInterval(buildupInterval);
      buildupInterval = null;
    }
    if (buildupLoopAudio) {
      try {
        buildupLoopAudio.pause();
        buildupLoopAudio.currentTime = 0;
        buildupLoopAudio.loop = false;
      } catch (_) {}
      buildupLoopAudio = null;
    }
  }
  function playResultsReveal() { play('resultsReveal'); }
  function playResultsApplause() { play('resultsApplause'); }

  global.QuizSound = {
    KEYS,
    play, unlock,
    setMode, getMode,
    setLocalFile, clearLocalFile, getLocalName,
    previewFile, previewSynth,
    startCountdown, stopCountdown, playCountdownEnd,
    startResultsBuildup, stopResultsBuildup, playResultsReveal, playResultsApplause,
    // 後方互換
    dedenSound: () => play('deden'),
    correctSound: () => play('correct'),
    wrongSound: () => play('wrong'),
    buzzSound: () => play('buzz')
  };
})(window);
