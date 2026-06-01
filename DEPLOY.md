# インターネット公開の手順

## 1. パスワード設定

プロジェクト直下に `.env` を置きます（Git には含めません）。

```env
SITE_PASSWORD=imaizumi
AUTH_SECRET=ここにランダムな長文字列
NODE_ENV=production
TRUST_PROXY=1
```

`AUTH_SECRET` は次のコマンドで生成できます。

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

未ログインの人は `/login.html` に誘導され、正しいパスワードで Cookie が付与されます。Socket.IO も同じ Cookie で保護されます。

## 2. ローカルで確認

```powershell
cd "C:\Users\user\Documents\quiz HP"
npm install
npm start
```

ブラウザで `http://localhost:3000` を開き、ログイン画面 → パスワード入力後にトップが表示されれば OK です。

## 3. Render で公開（おすすめ・無料枠あり）

1. [Render](https://render.com/) に GitHub 連携でログイン
2. **New → Web Service** でこのリポジトリを選択
3. 設定例:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance:** Free
4. **Environment** に追加:
   - `SITE_PASSWORD` = `imaizumi`（または変更後の値）
   - `AUTH_SECRET` = ランダム文字列
   - `NODE_ENV` = `production`
   - `TRUST_PROXY` = `1`
5. Deploy 後、表示された URL（例: `https://quiz-buzzer-xxxx.onrender.com`）にアクセス

無料プランはしばらくアクセスがないとスリープします。初回表示が遅いことがあります。

### データの永続化（問題セット）

Render の無料ディスクは再起動で消えることがあります。問題セットを残したい場合は Render の **Disk** をマウントするか、有料 VPS を検討してください。

## 4. その他のホスティング

| サービス | 手順の要点 |
|---------|------------|
| **Railway** | GitHub 連携 → `npm start` → 環境変数に `SITE_PASSWORD` 等 |
| **Fly.io** | `fly launch` → `fly secrets set SITE_PASSWORD=...` |
| **VPS** | Node 18+、`npm install`、`pm2 start server.js`、nginx で HTTPS リバースプロキシ |

いずれも **HTTPS** 推奨です（Cookie の `Secure` が有効になります）。

## 5. セキュリティ注意

- `.env` を GitHub に push しない
- 本番の `SITE_PASSWORD` は推測されにくいものに変更することを推奨
- このロックは「知人向けの簡易ゲート」です。高度な攻撃向けの認証ではありません
