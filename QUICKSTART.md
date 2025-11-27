# 🚀 クイックスタートガイド

## 📋 完成したプロジェクト

✅ GitHub Pages対応
✅ 完全ブラウザ内動作
✅ APIキーlocalStorage管理
✅ XSS対策完備（textContentのみ）
✅ 自動デプロイ設定済み

## 🔧 今すぐできること

### 1. 依存関係インストール

```bash
cd K:\joubun-kun-web
npm install
```

### 2. 開発モードで起動

```bash
npm run dev
```

→ http://localhost:5173 でアクセス

### 3. 動作確認

- ✅ 設定画面でAPIキー入力
- ✅ localStorage に保存される
- ✅ デモモード動作確認

## 📦 JSONファイル準備後の手順

### Step 1: JSONファイル配置

```bash
# 方法A: シンボリックリンク（開発用）
mklink /D "K:\joubun-kun-web\public\data" "K:\laws_chunk_embeddings"

# 方法B: 直接コピー（本番用）
xcopy K:\laws_chunk_embeddings\*.json K:\joubun-kun-web\public\data\ /Y
```

### Step 2: ONNXモデル配置

```bash
xcopy K:\ONNX\* K:\joubun-kun-web\public\models\ /Y
```

### Step 3: Git LFS設定

```bash
# Git LFS インストール（初回のみ）
# https://git-lfs.com/

# Git LFS 有効化
git lfs install

# 大容量ファイルを追跡
git lfs track "public/data/*.json"
git lfs track "public/models/*.onnx"
git lfs track "public/models/*.wasm"
```

## 🌐 GitHub Pages デプロイ

### Step 1: GitHubリポジトリ作成

1. https://github.com/new にアクセス
2. リポジトリ名: `joubun-kun`（任意）
3. Public または Private 選択
4. Create repository

### Step 2: ローカルとリンク

```bash
cd K:\joubun-kun-web

# Git初期化
git init
git add .
git commit -m "Initial commit: 条文くん GitHub Pages版"

# リモートリポジトリ追加
git remote add origin https://github.com/YOUR_USERNAME/joubun-kun.git

# プッシュ
git push -u origin main
```

### Step 3: GitHub Pages 有効化

1. GitHubリポジトリページを開く
2. **Settings** タブ
3. 左メニュー **Pages**
4. **Source**: GitHub Actions
5. 自動デプロイ開始！

### 公開URL

```
https://YOUR_USERNAME.github.io/joubun-kun/
```

## ⚙️ vite.config.js の設定

`base` をリポジトリ名に合わせて変更:

```javascript
export default defineConfig({
  plugins: [react()],
  base: '/joubun-kun/',  // ← リポジトリ名に変更
});
```

## 🔐 セキュリティ仕様

### APIキー管理

```javascript
// localStorage に保存（ブラウザから確認可能）
localStorage.setItem('joubun_claude_api_key', 'sk-ant-...');

// 取得
const apiKey = localStorage.getItem('joubun_claude_api_key');
```

**注意点:**
- DevToolsから確認可能
- 信頼できるユーザーのみに共有
- コードには埋め込まない

### XSS対策

```javascript
// ❌ 危険（innerHTML使用禁止）
element.innerHTML = userInput;

// ✅ 安全（textContentのみ）
element.textContent = userInput;

// または
<p>{userInput}</p>  // Reactが自動エスケープ
```

## 📊 ファイルサイズ見積もり

| ファイル | サイズ | Git LFS |
|---|---|---|
| JSONファイル | 1.17GB | 必要 |
| ONNXモデル | 563MB | 必要 |
| アプリコード | 10MB | 不要 |
| **合計** | **1.74GB** | **$5/月** |

## 🐛 トラブルシューティング

### Q: Git LFS でプッシュエラー

```bash
# Git LFS の状態確認
git lfs status

# LFS ファイルを確認
git lfs ls-files

# 再プッシュ
git push origin main --force
```

### Q: GitHub Actions ビルドエラー

```bash
# ローカルでビルド確認
npm run build

# エラーがあれば修正
# 再コミット & プッシュ
```

### Q: APIキーが保存されない

```
1. ブラウザのlocalStorageを確認
   - DevTools → Application → Local Storage
2. プライベートモードでは保存されない
3. ブラウザのストレージ容量確認
```

## 💡 開発Tips

### ホットリロード

`src/App.jsx` を編集すると自動で反映されます。

### DevToolsでAPIキー確認

```javascript
// Console で実行
localStorage.getItem('joubun_claude_api_key')
```

### localStorageクリア

```javascript
// Console で実行
localStorage.removeItem('joubun_claude_api_key')
```

## 🎉 完成後の使い方

```
1. https://YOUR_USERNAME.github.io/joubun-kun/ にアクセス
   ↓
2. 設定ボタンクリック
   ↓
3. APIキー入力 & 保存
   ↓
4. 質問を入力: "手付金を放棄して契約解除したい"
   ↓
5. AI解説 + 関連条文が表示！
```

## 📝 次のステップ

1. ✅ `npm install` でセットアップ完了
2. ✅ `npm run dev` で動作確認
3. ⏳ JSONファイル完成を待つ
4. ⏳ JSONファイル & ONNX配置
5. ⏳ Git LFS設定
6. ⏳ GitHub にプッシュ
7. ⏳ GitHub Pages で公開
8. 🎉 完成！

## 🔗 関連リンク

- Git LFS: https://git-lfs.com/
- Anthropic Console: https://console.anthropic.com/
- GitHub Pages: https://pages.github.com/
- Vite: https://vitejs.dev/
