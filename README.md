# 条文くん (Joubun-kun)

AIを活用した日本法令検索・解説アプリケーション

**URL**: https://joubun-kun.pages.dev

## 特徴

- **セマンティック検索**: Cloudflare Vectorizeによるベクトル検索で、自然言語での法令検索が可能
- **AI解説**: Claude Sonnet 4による分かりやすい法令解説
- **参照条文表示**: 関連する参照先・参照元条文を自動取得
- **全法令対応**: 日本の現行法令約9,000件に対応
- **レスポンシブUI**: PC・スマホ両対応

## アーキテクチャ

```
┌─────────────────┐     ┌──────────────────────────────────────┐
│  フロントエンド  │     │         Cloudflare Workers           │
│  (React/Vite)   │────▶│  - /api/search (Vectorize検索)       │
│                 │     │  - /api/chat (Claude API)            │
│  Cloudflare     │◀────│  - /api/refs (参照条文取得)          │
│  Pages          │     │  - /api/articles (条文内容取得)      │
└─────────────────┘     └──────────────────────────────────────┘
                                        │
                        ┌───────────────┼───────────────┐
                        ▼               ▼               ▼
                ┌───────────┐   ┌───────────┐   ┌───────────┐
                │ Vectorize │   │    R2     │   │ Claude    │
                │ (ベクトル │   │ (法令JSON │   │   API     │
                │  検索)    │   │  ストレージ) │   │           │
                └───────────┘   └───────────┘   └───────────┘
```

## 技術スタック

### フロントエンド
- React 18
- Vite
- Tailwind CSS
- Cloudflare Pages

### バックエンド
- Cloudflare Workers
- Cloudflare Vectorize (ベクトル検索)
- Cloudflare R2 (オブジェクトストレージ)
- Claude API (Anthropic)

### データ
- 法令データ: e-Gov法令APIから取得・加工
- ベクトル埋め込み: text-embedding-3-small (OpenAI)
- 参照関係: lawtext-refsから生成

## ローカル開発

```bash
# 依存関係インストール
npm install

# 開発サーバー起動
npm run dev

# ビルド
npm run build
```

## デプロイ

### フロントエンド (Cloudflare Pages)
```bash
npm run build
npx wrangler pages deploy dist --project-name=joubun-kun
```

### バックエンド (Cloudflare Workers)
```bash
npx wrangler deploy
```

## データ構成

### R2バケット (joubun-kun-data)
```
├── law_chunk_map.json          # 法令ID → チャンク番号マップ
├── laws_chunk_XXX_light.json   # 法令データチャンク（約300個）
├── large_law_articles_v2/      # 大規模法令の条文単位ファイル
│   ├── 332AC0000000026/        # 租税特別措置法
│   ├── 129AC0000000089/        # 民法
│   └── ...
└── refs_chunks/                # 参照条文データ
    ├── refs_index.json         # 法令ID → チャンク番号
    └── refs_chunk_XXX.json     # 参照データチャンク
```

### Vectorize (law-embeddings)
- 約50万件の条文ベクトル
- メタデータ: law_id, law_title, article_title, caption

## 主要ファイル

| ファイル | 説明 |
|---------|------|
| `src/App.jsx` | フロントエンドメインコンポーネント |
| `cloudflare-worker.js` | Workers APIエンドポイント |
| `wrangler.jsonc` | Workers設定 |
| `src/lawIds.js` | 法令名→法令IDマッピング（8,878件） |

## コスト目安

| 項目 | 費用 |
|------|------|
| Cloudflare Pages | 無料 |
| Cloudflare Workers | 無料枠内 |
| Cloudflare R2 | 無料枠内（10GB） |
| Cloudflare Vectorize | 無料枠内 |
| Claude API | 約4-6円/検索 |

## 注意事項

- Claude APIキーは各ユーザーが自分で設定
- APIキーはlocalStorageに保存（ブラウザごと）
- 法令データは定期的に更新が必要

## ライセンス

MIT

## 作成者

司法書士法人そうぞう
