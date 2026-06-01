# 早押しクイズ Web アプリ

口頭回答型・部屋制の早押しクイズ Web アプリです。
**4桁の部屋番号** で主催者と参加者が同じセッションに集まり、主催者が出題・正誤判定、参加者が早押しボタンで挑むスタイルです。

このリポジトリ単体で **問題セットの保存 / スコア表 / 効果音差し替え / 画像クイズ** をすべて備え、Node.js が動く環境にそのままインターネット公開できます。

---

## 機能一覧

### 基本機能
- 部屋（4桁番号・ランダム発行）／ニックネーム参加
- 出題文を **1 文字ずつ全員に同期表示**（速度調整可）
- 早押し（**1/100 秒精度・上位5名表示**）
- 1 番手に **10 秒カウント** で回答権 → 0 で自動不正解 → 次順位へ
- 「続きを流す」「最初から」「次の問題」で順位リセット
- 主催者の操作音: **デデン / ピンポン / ブー / ブザー**

### 拡張機能（v1.1）
- **問題セットの保存・読込・削除**（サーバ側 JSON で永続化）
- **エクスポート / インポート**（画像も含めた単一 JSON でやり取り可能）
- **スコア表**：参加者ごとの正解数を全員の画面に常時表示。主催者は手動加減点・全リセットも可。
- **画像付きクイズ**：問題ごとに画像を添付（アップロード or URL 指定）。出題と同時に表示。
- **効果音の差し替え**：4 種それぞれを
  - **無音 (デフォルト)**
  - **内蔵合成音**（外部依存なしの自作合成、著作権問題なし）
  - **マイ音源（このブラウザのみ）** — お手元の mp3/wav/ogg を読み込み、`IndexedDB` に保存
  
  から選べます。**マイ音源は主催者のブラウザだけに保存され、サーバや他参加者には一切送信されません**。効果音ラボなど「再配布禁止」の素材も、このモードでなら規約に違反せず利用できます。
  
  なお参加者の画面では音は鳴らず、視覚的なフラッシュ（緑/赤）のみが表示されます。対面プレイなら主催者PCのスピーカーから全員に音が届きます。

---

## ローカル起動

Node.js 18 以降。

```powershell
cd "C:\Users\user\Documents\quiz HP"
npm install
npm start
```

ブラウザで `http://localhost:3000` を開き、「部屋をつくる」または「参加する」を選択。

同一 LAN の別端末から参加するときは、PC の IP（例 `192.168.x.x`）を控えてその端末のブラウザで `http://192.168.x.x:3000` を開きます（必要ならファイアウォールでポート 3000 を許可）。

---

## インターネット公開（おすすめ: Render）

無料・GUI のみで、WebSocket 対応の Node.js を公開できます。

### 手順（Render）
1. **GitHub** にこのプロジェクトを push します。
   ```powershell
   cd "C:\Users\user\Documents\quiz HP"
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<あなたのID>/quiz-buzzer.git
   git push -u origin main
   ```
2. https://render.com にサインアップ → 「**New +**」→「**Web Service**」を選択。
3. GitHub 連携でこのリポジトリを選び、`render.yaml` が自動検出されるのでそのまま **Create Web Service** を押下。
   - 自動検出されない場合は手動で:
     - Environment: **Node**
     - Build Command: `npm install`
     - Start Command: `npm start`
4. 数分後に `https://quiz-buzzer-xxxx.onrender.com` のような URL が払い出されます。これがそのままサイト URL。
5. 主催者はその URL で「部屋をつくる」、参加者は同 URL を開いて 4 桁番号で参加。

> Render 無料プランの注意: 約 15 分アクセスが無いとスリープし、起動に十数秒かかります。**ファイルシステムは再起動で消える**ため、保存した問題セット・アップロード画像/音源は永続化されません。継続運用したい場合は次の Fly.io（永続ボリューム）か有料プランを使ってください。

### 代替 1: Fly.io（永続ボリューム対応・無料枠あり）

```powershell
# Fly CLI を入れて
iwr https://fly.io/install.ps1 -useb | iex
fly auth signup     # または fly auth login

cd "C:\Users\user\Documents\quiz HP"
fly launch --no-deploy --copy-config   # 同梱の fly.toml を利用
fly volumes create quiz_data --size 1 --region nrt
fly volumes create quiz_uploads --size 3 --region nrt
fly deploy
```

`https://<アプリ名>.fly.dev` で公開されます。`fly.toml` で `/app/data` と `/app/public/uploads` をボリュームにマウント済みなので、問題セット・画像・音源は永続化されます。

### 代替 2: Railway（GUI で簡単）

1. https://railway.com → New Project → Deploy from GitHub。
2. このリポジトリを選択（`railway.json` が自動検出されます）。
3. 立ち上がったサービスで「Settings」→「Networking」→「Generate Domain」。
4. その URL が公開 URL。

### 代替 3: Glitch / Replit などの簡易ホスティング

- そのまま `npm install && npm start` で動きます。
- WebSocket（Socket.IO）対応のホスティングを選んでください（Vercel など Serverless Functions のみは不可）。

---

## 使い方

### 主催者
1. トップページで「**部屋をつくる**」 → 4桁の部屋番号が表示されます。
2. 参加者にその番号と公開 URL を共有。
3. 「**＋ 新規追加**」で問題を追加。文・正解（メモ）・画像（任意）を入力。
4. 行ごとの **出題** ボタンで読み上げ開始（または「この問題で出題」）。
5. 押された瞬間に出題ストップ＆10秒カウント開始 → 口頭回答を聞いて **正解 / 不正解** を判定。
6. 「**続きを流す**」「**次の問題へ**」で順位リセット & 進行。
7. 「**問題セット管理**」で **保存 / 読込 / 名前変更 / 削除 / エクスポート / インポート**。
8. 「**効果音設定**」で 4 種の音をプリセット・URL・アップロードのいずれかで差し替え。

### 参加者
1. トップページで部屋番号 + ニックネームを入力 → 「参加する」。
2. 大きな赤い **押** ボタンをクリック / タップ（**スペースキー** でも可）。
3. 上位 5 位までの名前・タイム・スコアが画面に表示されます。
4. 自分が回答権を持つと黄色バナーになるので **口頭で回答**してください。

---

## 著作権フリー素材ソース

このリポジトリ自体には外部音源は同梱していません。効果音は **「主催者のブラウザだけに読み込む」** 設計のため、効果音ラボなど直リンク・再配布が禁じられている素材も、各自で手元にダウンロードしたものを「マイ音源」モードで読み込めば規約に反せず利用できます。

### 音源（おすすめ）
- **効果音ラボ** - https://soundeffect-lab.info/sound/anime/  (商用可・クレジット不要・直リンク禁止)
  - 「クイズ出題1 デデン」「クイズ正解1 ピンポンピンポンピンポン」「クイズ不正解1 ブブー」「クイズ早押しボタン1」など
- **OtoLogic** - https://otologic.jp/free/se/quiz01.html  (CC BY 4.0・要表記)
- **DOVA-SYNDROME** - https://dova-s.jp/se/  (商用可・クレジット任意)
- **Mixkit** - https://mixkit.co/free-sound-effects/  (商用可・クレジット不要・直リンクOK／必要なら手元にDLしてマイ音源にロード)
- **Pixabay Sound Effects** - https://pixabay.com/sound-effects/  (Pixabay Content License)

> ⚠️ どのサイトの素材も、サーバへのアップロード・公開リポジトリへの同梱は **再配布** にあたる可能性があるため、避けてください。本アプリのマイ音源モードはローカル保存のみなので問題ありません。

### 画像
- **Pixabay** - https://pixabay.com/  (Pixabay Content License・商用利用可)
- **Unsplash** - https://unsplash.com/  (Unsplash License・商用利用可)
- **Pexels** - https://www.pexels.com/  (Pexels License・商用利用可)
- **いらすとや** - https://www.irasutoya.com/  (利用規約参照)
- **写真AC / イラストAC** - https://www.photo-ac.com/  (要登録・無料枠あり)

---

## ディレクトリ構成

```
quiz HP/
├── package.json
├── server.js                 # Express + Socket.IO サーバ
├── README.md
├── Dockerfile / .dockerignore
├── render.yaml               # Render Blueprint
├── fly.toml                  # Fly.io 設定（永続ボリューム付き）
├── railway.json              # Railway 設定
├── data/
│   └── question-sets.json    # 問題セットの永続化（自動生成）
└── public/
    ├── index.html            # ホーム（部屋作成 / 参加）
    ├── host.html / host.js   # 主催者画面
    ├── player.html / player.js # 参加者画面
    ├── style.css
    ├── sound.js              # 効果音再生（合成 + URL）
    ├── presets.js            # 効果音プリセット定義（Mixkit 直リンク）
    └── uploads/              # アップロードされた画像 / 音源
```

---

## ライセンス

本アプリのコードは MIT。内蔵合成音（`public/sound.js`）は本リポジトリのオリジナル実装で著作権制約はありません。「マイ音源」機能で読み込む音源はそれぞれの素材ライセンスに従います（本アプリはサーバへ送信せずブラウザ内に閉じる設計）。
