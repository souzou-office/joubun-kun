# 📦 JSONファイル配置手順

## 現状

```
K:\laws_chunk_embeddings/
├── laws_chunk_000_embedded.json
├── laws_chunk_001_embedded.json
└── ... (50個のファイル)

↓ これを条文くんで使えるようにする
```

## 🎯 目標

```
K:\joubun-kun-web/
└── public/
    └── data/
        ├── laws_index.json           ← 新規作成（軽量・法令リスト）
        ├── laws_chunk_000_embedded.json  ← コピー
        ├── laws_chunk_001_embedded.json  ← コピー
        └── ... (50個)
```

## 📝 手順

### Step 1: インデックス作成

```bash
cd K:\joubun-kun-web

# インデックス作成スクリプト実行
npm run create-index
```

**出力:**
```
📋 法令インデックス作成スクリプト

📦 50個のファイルを処理します

処理中 (1/50): laws_chunk_000_embedded.json
処理中 (2/50): laws_chunk_001_embedded.json
...

✅ インデックス作成完了: 1234法令
💾 保存: public/data/laws_index.json

🎉 完了！
```

→ `public/data/laws_index.json` が作成されます（約1MB）

### Step 2: JSONファイルをコピー

#### 方法A: 直接コピー（推奨・本番用）

```bash
# PowerShell で実行
xcopy K:\laws_chunk_embeddings\*.json K:\joubun-kun-web\public\data\ /Y
```

#### 方法B: シンボリックリンク（開発用）

```bash
# 管理者権限のPowerShellで実行
mklink /D "K:\joubun-kun-web\public\data\chunks" "K:\laws_chunk_embeddings"
```

**注意:** シンボリックリンクはGitにコミットできません。開発時のみ使用。

### Step 3: ONNXモデルをコピー

```bash
# PowerShell で実行
xcopy K:\ONNX\* K:\joubun-kun-web\public\models\ /Y
```

### Step 4: 動作確認

```bash
npm run dev
```

→ http://localhost:5173 でアクセス

**確認ポイント:**
- ✅ 「データ準備中」が消える
- ✅ ヘッダーに「1234法令検索」と表示される
- ✅ 検索が動作する

## 🔍 ファイル構成（完成後）

```
K:\joubun-kun-web/
└── public/
    ├── data/
    │   ├── laws_index.json (1MB)              ← 法令リスト
    │   ├── laws_chunk_000_embedded.json (10-50MB) ← 実データ
    │   ├── laws_chunk_001_embedded.json
    │   └── ... (50個)
    └── models/
        ├── model_quantized.onnx (536MB)
        ├── tokenizer.json (16MB)
        ├── ort-wasm.wasm (9MB)
        └── ... (その他)
```

## 📊 動作の仕組み

```javascript
// 1. 起動時: インデックスだけ読み込み（軽量）
const indexResponse = await fetch('data/laws_index.json');
// → どの法令がどのchunkファイルにあるか分かる

// 2. 検索時: 必要なchunkファイルだけ読み込み
const chunkData = await fetch('data/laws_chunk_000_embedded.json');
// → 全部ダウンロードしない！必要な分だけ

// 3. ブラウザキャッシュ
// → 2回目以降は超高速
```

## ⚠️ トラブルシューティング

### Q: `npm run create-index` でエラー

```
❌ エラー: K:/laws_chunk_embeddings が見つかりません
```

**解決策:**
- `K:\laws_chunk_embeddings` フォルダが存在するか確認
- JSONファイルが完成しているか確認

### Q: 「データ準備中」が消えない

**確認:**
1. `public/data/laws_index.json` が存在するか
2. ブラウザのDevToolsでエラーを確認

```javascript
// DevTools Console で確認
fetch('data/laws_index.json').then(r => r.json()).then(console.log)
```

### Q: ファイルサイズが大きすぎる

**対策:**
- Git LFS使用（必須）
- または、GitHub Releasesで配布

## 🌐 GitHub にアップロードする場合

### Git LFS必須

```bash
# Git LFS インストール
# https://git-lfs.com/

# Git LFS 有効化
git lfs install

# 大容量ファイルを追跡
git lfs track "public/data/*.json"
git lfs track "public/models/*.onnx"

# .gitattributes に記録される
git add .gitattributes

# コミット
git add public/
git commit -m "Add law data and models"
git push
```

## 💰 Git LFS 料金

| 項目 | 無料枠 | 使用量 | 費用 |
|---|---|---|---|
| ストレージ | 1GB | 1.7GB | $5/月 |
| 転送量 | 1GB/月 | 50GB/月 | - |

## 🎉 完了後

```
1. npm run dev で起動
   ↓
2. 設定画面でAPIキー入力
   ↓
3. 検索してみる
   ↓
4. 動作確認OK!
   ↓
5. GitHub Pages にデプロイ
```

## 📝 チェックリスト

- [ ] `npm run create-index` 実行
- [ ] `public/data/laws_index.json` 作成確認
- [ ] JSONファイルを `public/data/` にコピー
- [ ] ONNXモデルを `public/models/` にコピー
- [ ] `npm run dev` で動作確認
- [ ] 「データ準備中」が消えることを確認
- [ ] 検索が動作することを確認
- [ ] Git LFS 設定（GitHub用）
- [ ] GitHub にプッシュ
- [ ] GitHub Pages で動作確認
