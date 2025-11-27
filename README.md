# 条文くん - GitHub Pages版

AIを使った法令検索アプリ（完全ブラウザ内動作）

## 🎯 特徴

- ✅ 完全ブラウザ内動作（サーバー不要）
- ✅ Embedding + BM25 ハイブリッド検索
- ✅ Claude APIで自然言語解説
- ✅ APIキーは各ユーザーがlocalStorageで管理
- ✅ XSS対策完備（textContentのみ使用）

## 🔐 セキュリティ

### APIキー管理
- localStorageに保存（ブラウザから確認可能）
- 各ユーザーが個別に設定
- コードに埋め込まれていない

### XSS対策
- ユーザー入力は`innerHTML`使用禁止
- 全て`textContent`で安全に表示
- サニタイゼーション不要（HTMLとして解釈しない）

## 📦 セットアップ

### 1. リポジトリクローン

```bash
git clone https://github.com/YOUR_USERNAME/joubun-kun.git
cd joubun-kun
```

### 2. 依存関係インストール

```bash
npm install
```

### 3. JSONファイル準備（後で実施）

```bash
# K:\laws_chunk_embeddings のファイルを public/data/ にコピー
# または Git LFS でコミット
```

### 4. ONNXモデル準備（後で実施）

```bash
# K:\ONNX のファイルを public/models/ にコピー
```

## 🚀 開発

```bash
npm run dev
```

http://localhost:5173 でアクセス

## 📦 ビルド

```bash
npm run build
```

`dist/` フォルダにビルド成果物が生成されます。

## 🌐 GitHub Pagesデプロイ

### 方法1: GitHub Actions（自動）

1. GitHubリポジトリ作成
2. Settings → Pages → Source: GitHub Actions
3. コミット & プッシュ

```bash
git add .
git commit -m "Initial commit"
git push origin main
```

→ 自動でビルド & デプロイ！

### 方法2: 手動デプロイ

```bash
npm run build
# dist/ フォルダを GitHub Pages にアップロード
```

## 📁 プロジェクト構成

```
joubun-kun-web/
├── .github/
│   └── workflows/
│       └── deploy.yml       # GitHub Actions設定
├── src/
│   ├── main.jsx             # エントリーポイント
│   └── App.jsx              # メインアプリ
├── public/
│   ├── data/                # JSONファイル（後で追加）
│   └── models/              # ONNXモデル（後で追加）
├── package.json
├── vite.config.js
└── README.md
```

## 🔧 使い方

### 初回アクセス

1. アプリにアクセス
2. 設定ボタンクリック
3. Claude APIキーを入力
4. 保存

### APIキー取得

1. https://console.anthropic.com/ にアクセス
2. 「API Keys」→「Create Key」
3. 生成されたキーをコピー

### 検索

1. 質問を入力
2. 送信ボタンクリック
3. AI解説 + 関連条文が表示

## 📝 TODO（JSONファイル準備後）

- [ ] JSONファイルを `public/data/` に配置
- [ ] ONNXモデルを `public/models/` に配置
- [ ] Git LFS でコミット
- [ ] GitHub Pagesにデプロイ
- [ ] テスト

## 💰 コスト

| 項目 | 費用 |
|---|---|
| GitHub Pages | 0円（100GB/月） |
| Git LFS | $5/月（データ1.7GB） |
| Claude API | 従量課金（~60円/月） |

## ⚠️ 注意事項

### APIキーについて

- localStorageに保存されます
- ブラウザのDevToolsから確認可能です
- 信頼できるユーザーのみに共有してください

### セキュリティ

- XSS攻撃対策済み（textContentのみ使用）
- ユーザー入力はHTMLとして解釈されません
- APIキーは各ユーザーが自己管理

## 📄 ライセンス

MIT

## 👤 作成者

司法書士法人そうぞう
