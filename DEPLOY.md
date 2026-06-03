# インターネット公開の手順

## 1. ローカルで確認

```powershell
cd "C:\Users\user\Documents\quiz HP"
npm install
npm start
```

ブラウザで `http://localhost:3000` を開き、トップから部屋作成・参加ができることを確認します。

使い方ガイドは **`/guide.html`** で閲覧できます。

## 2. Render で公開（おすすめ・無料枠あり）

1. [Render](https://render.com/) に GitHub 連携でログイン
2. **New → Web Service** でこのリポジトリを選択
3. 設定例:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance:** Free
4. **Environment**（任意）:
   - `NODE_ENV` = `production`
   - `TRUST_PROXY` = `1`
5. Deploy 後、表示された URL にアクセス

**以前 `SITE_PASSWORD` を設定していた場合**は、Render の Environment から **削除**してください。残っていると再デプロイ後も鍵がかかることがあります。

無料プランはしばらくアクセスがないとスリープします。初回表示が遅いことがあります。

### データの永続化（問題セット）

Render の無料ディスクは再起動で消えることがあります。問題セットを残したい場合は Render の **Disk** をマウントするか、有料 VPS を検討してください。

## 3. 更新を反映する

```powershell
git add .
git commit -m "変更内容の説明"
git push origin main
```

Render の **Auto-Deploy** が ON なら、push 後に自動で再ビルドされます。

## 4. その他のホスティング

| サービス | 手順の要点 |
|---------|------------|
| **Railway** | GitHub 連携 → `npm start` |
| **Fly.io** | `fly launch` → `npm start` |
| **VPS** | Node 18+、`npm install`、`pm2 start server.js`、nginx で HTTPS |

## 5. 運用の注意

- 部屋番号を知っている人だけがそのクイズに参加できます（部屋単位の区切り）
- 個人情報の収集は設計上不要ですが、ニックネームに本名を使わないよう周知するとより安全です
- 公開 URL は必要な人にだけ共有してください
