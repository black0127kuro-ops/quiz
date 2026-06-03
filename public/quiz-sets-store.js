/* eslint-disable no-undef */
/**
 * 問題セットの保存（このブラウザの localStorage のみ。サーバーには送らない）
 */
(function (global) {
  const STORAGE_KEY = 'quizHpSets_v1';
  const MAX_SETS = 50;
  const MAX_QUESTIONS_PER_SET = 200;

  function loadAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const data = raw ? JSON.parse(raw) : null;
      if (data && Array.isArray(data.sets)) return data;
    } catch (_) { /* ignore */ }
    return { sets: [] };
  }

  function saveAll(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function normalizeQuestion(q) {
    const ptsRaw = Number(q && q.points);
    return {
      id: (q && typeof q.id === 'string' && q.id) ? q.id : ('q' + Math.random().toString(36).slice(2, 10)),
      text: String((q && q.text) || '').slice(0, 2000),
      answer: String((q && q.answer) || '').slice(0, 500),
      explanation: String((q && q.explanation) || '').slice(0, 2000),
      points: Number.isFinite(ptsRaw) ? Math.max(-99, Math.min(999, Math.round(ptsRaw))) : 1
    };
  }

  function normalizeQuestions(arr) {
    return (arr || []).slice(0, MAX_QUESTIONS_PER_SET).map(normalizeQuestion);
  }

  function newId() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  function list() {
    const data = loadAll();
    return data.sets.map(s => ({
      id: s.id,
      name: s.name,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      count: (s.questions || []).length
    }));
  }

  function get(id) {
    const data = loadAll();
    const s = data.sets.find(x => x.id === id);
    if (!s) return null;
    return {
      ...s,
      questions: normalizeQuestions(s.questions)
    };
  }

  function save(name, questions) {
    const data = loadAll();
    const now = Date.now();
    const set = {
      id: newId(),
      name: String(name || '無題').slice(0, 80),
      createdAt: now,
      updatedAt: now,
      questions: normalizeQuestions(questions)
    };
    data.sets.unshift(set);
    if (data.sets.length > MAX_SETS) data.sets.length = MAX_SETS;
    saveAll(data);
    return set;
  }

  function update(id, patch) {
    const data = loadAll();
    const idx = data.sets.findIndex(x => x.id === id);
    if (idx < 0) return null;
    const cur = data.sets[idx];
    if (typeof patch.name === 'string') cur.name = patch.name.slice(0, 80);
    if (Array.isArray(patch.questions)) cur.questions = normalizeQuestions(patch.questions);
    cur.updatedAt = Date.now();
    data.sets[idx] = cur;
    saveAll(data);
    return cur;
  }

  function remove(id) {
    const data = loadAll();
    const before = data.sets.length;
    data.sets = data.sets.filter(s => s.id !== id);
    saveAll(data);
    return before - data.sets.length;
  }

  function exportJson(id) {
    const s = get(id);
    if (!s) return null;
    return {
      name: s.name,
      questions: s.questions.map(q => ({
        text: q.text,
        answer: q.answer,
        explanation: q.explanation,
        points: q.points
      }))
    };
  }

  function importSet(name, questions) {
    return save(name, questions);
  }

  global.QuizSetsStore = {
    list,
    get,
    save,
    update,
    remove,
    exportJson,
    importSet,
    normalizeQuestions
  };
})(typeof window !== 'undefined' ? window : global);
