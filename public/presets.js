/**
 * 効果音 ラベル定義（B 方式: 主催者ブラウザのみ・参加者は無音）
 *  サーバ共有プリセットは廃止（再配布リスクを避けるため）。
 */
window.SOUND_LABELS = {
  deden:            'デデン (出題開始)',
  correct:          'ピンポンピンポーン (正解)',
  wrong:            'ブー (不正解)',
  buzz:             'ブザー (早押しボタン)',
  countdown:        'カウントダウン (残り10秒・ループ再生)',
  countdownEnd:     '時間切れ (0カウント時の終了音)',
  resultsBuildup:   '結果発表 溜め (ドラムロール・ループ)',
  resultsReveal:    '結果発表 ジャジャーン (発表時のファンファーレ)',
  resultsApplause:  'お祝い 拍手・歓声 (結果発表後)'
};

window.SOUND_KEYS_ORDERED = [
  'deden', 'correct', 'wrong', 'buzz',
  'countdown', 'countdownEnd',
  'resultsBuildup', 'resultsReveal', 'resultsApplause'
];
