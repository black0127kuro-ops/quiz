# Chromebook を主催者にする（LAN版）

Chromebook 単体では Node.js は入っていません。**Linux 開発環境（Crostini）** を使います。  
参加者は **ブラウザだけ**（Chromebook・スマホ・PC どれでも可）。

---

## 事前確認

- Chromebook に **Linux 開発環境** が使えること  
  （設定に「Linux」が出ない → 学校管理で無効の可能性。IT に確認）
- 主催者 Chromebook と参加者が **同じ Wi‑Fi / LAN**

---

## 1. Linux を有効にする（初回）

1. **設定** → **詳細設定** → **開発者向け**
2. **Linux 開発環境** → **オン**
3. ユーザー名を決めてインストール（数分）
4. 同じ画面で **「ローカルネットワーク上の他のコンピュータから、Linux で動作しているアプリへの接続を許可する」** を **オン**  
   （英語UI: *Allow Linux applications to be accessible from other computers on your local network*）

※ これをオンにしないと、他端末から Chromebook のクイズに繋がりません。

---

## 2. Node.js を入れる（Linux ターミナル・初回）

Linux ターミナルを開き:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
```

`v20` などと出れば OK。

---

## 3. クイズ本体を Linux に置く

### 方法A: GitHub から（おすすめ）

```bash
cd ~
git clone https://github.com/black0127kuro-ops/quiz.git
cd quiz
```

### 方法B: USB / Google ドライブ

1. ファイルアプリでプロジェクトを **Linux files** にコピー  
2. ターミナルでそのフォルダへ `cd`

---

## 4. 起動

```bash
cd ~/quiz
chmod +x start-lan.sh
./start-lan.sh
```

または:

```bash
npm install
npm start
```

表示例:

```
  このPC:     http://localhost:3000
  同じWi‑Fi/LANの端末からは次のURLで開けます:
    http://172.25.xx.xx:3000
```

---

## 5. 主催者（この Chromebook）

1. **Chrome** で **`http://localhost:3000`** を開く  
2. 利用規約に同意 → **部屋をつくる**  
3. 部屋番号をメモ  

---

## 6. 参加者

主催者から次を伝える:

| 内容 | 例 |
|------|-----|
| URL | `http://172.25.xx.xx:3000`（ターミナルに出た IPv4） |
| 部屋番号 | `3847` |

※ **Chromebook の IP** を使う（Linux ターミナルの `hostname -I` の先頭でも確認可）

---

## 7. 終了

Linux ターミナルを閉じる（または Ctrl+C）。

---

## うまくいかないとき

| 症状 | 対処 |
|------|------|
| 設定に Linux がない | 学校管理 → 個人PC主催 or USB版を検討 |
| 参加者だけ繋がらない | 上記 **ローカルネットワークからの接続を許可** がオンか確認 |
| localhost も開けない | ターミナルで `npm start` が動いているか確認 |
| IP が分からない | ターミナル: `hostname -I` または Chrome で `chrome://system` |

---

## USB 版・Windows 版との違い

| | Chromebook 主催 | Windows USB 版 |
|--|-----------------|----------------|
| 準備 | Linux + Node（Linux内） | USB の bat だけ |
| 校務PC | 不要（Chromebook が主催） | bat 実行 |
| 参加者 | ブラウザのみ | 同左 |

---

## 学校の Chromebook で Linux が使えない場合

- **Windows + USB 版**（`build-usb.bat` → `quiz-lan.bat`）  
- または **自分のノートPC を主催**、Chromebook は参加者（ブラウザだけ）
