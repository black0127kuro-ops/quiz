/**
 * お助けアイテム定義（サーバー・主催者・参加者で共有）
 * once: true = 1試合に1回まで
 */
const ITEM_CATALOG = [
  {
    id: 'delay5',
    name: '時の沙時計',
    emoji: '⏳',
    desc: '他の参加者の問題文の表示開始を5秒遅らせる（次の問題）',
    once: false,
    maxUses: 2
  },
  {
    id: 'steal_stealth',
    name: 'こっそり1点奪取',
    emoji: '🥷',
    desc: '次の問題開始時、1位から1点を奪う（通知なし・使い切り）',
    once: true,
    exclusiveGroup: 'steal'
  },
  {
    id: 'steal_loud',
    name: '堂々1点奪取',
    emoji: '👑',
    desc: '次の問題開始時、1位から1点を奪う（通知欄に表示・使い切り）',
    once: true,
    exclusiveGroup: 'steal'
  },
  {
    id: 'flip',
    name: 'さかさまビジョン',
    emoji: '🙃',
    desc: '他の参加者の出題文字を上下逆さまにする（次の問題）',
    once: false,
    maxUses: 2
  },
  {
    id: 'flash',
    name: '一瞬だけ全文',
    emoji: '⚡',
    desc: '他の参加者に問題文を一瞬全文表示→1秒後に消す（次の問題）',
    once: false,
    maxUses: 2
  },
  {
    id: 'bonusQ',
    name: '問題番号ボーナス',
    emoji: '🎯',
    desc: '次の問題で正解したら、問題番号と同じ点数が追加でもらえる',
    once: true
  },
  {
    id: 'slow2x',
    name: 'のろまの呪い',
    emoji: '🐢',
    desc: '他の参加者の文字表示速度が半分になる（次の問題）',
    once: false,
    maxUses: 2
  },
  {
    id: 'lucky3',
    name: 'ラッキー+3',
    emoji: '🍀',
    desc: '次の問題で正解したら追加+3点',
    once: true
  },
  {
    id: 'shield',
    name: 'シールド',
    emoji: '🛡️',
    desc: '妨害が当たるまでスタック。当たったとき1回防ぐ（次の問題でなくても可）',
    instant: true,
    once: false,
    maxUses: 3
  },
  {
    id: 'timestop',
    name: 'タイムストップ',
    emoji: '⏱️',
    desc: '他の参加者の回答時間を10秒→7秒に短縮（次の問題）',
    once: false,
    maxUses: 2
  },
  {
    id: 'mirror',
    name: 'ミラー文字',
    emoji: '↔️',
    desc: '他の参加者の出題文字を左右反転（次の問題）',
    once: false,
    maxUses: 2
  },
  {
    id: 'jackpot',
    name: 'ジャックポット',
    emoji: '💎',
    desc: '次の問題で正解したら獲得点数が2倍',
    once: true
  },
  {
    id: 'swap_leader',
    name: '逆転のカード',
    emoji: '🔄',
    desc: '次の問題開始時、1位と自分の点数を入れ替え（条件：自分が1位でない・1位との差が5点以内）',
    once: true,
    exclusiveGroup: 'score_swap'
  },
  {
    id: 'underdog2x',
    name: '下克上ダブル',
    emoji: '📈',
    desc: '次の問題で正解したとき、使った時点で4位以下なら獲得点が2倍',
    once: true
  },
  {
    id: 'tax_leader',
    name: 'トップ課税',
    emoji: '💸',
    desc: '次の問題開始時、1位から最大2点を剥がし2位・3位に1点ずつ配分（1位が1点以上必要）',
    once: true
  },
  {
    id: 'snipe',
    name: 'スナイプ2点',
    emoji: '🎯',
    desc: '次の問題開始時、自分の1つ上の順位から2点奪う（条件：1位でない・相手が2点以上）',
    once: true,
    exclusiveGroup: 'steal'
  }
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ITEM_CATALOG;
}
if (typeof window !== 'undefined') {
  window.ITEM_CATALOG = ITEM_CATALOG;
}
