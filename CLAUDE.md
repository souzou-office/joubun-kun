# 条文くん (Joubun-kun) 開発メモ

## 2025-12-22 セッション

### 解決した問題

#### 1. 租税特別措置法 第三条・第四条の `paragraphs: 0` 問題

**症状**: 租税特別措置法の条文を検索しても `paragraphs: 0` が返される

**原因**:
1. R2の `laws_chunk_075_light.json` が0バイト（空ファイル）
2. サブチャンク形式（`laws_chunk_075_1_light.json` 等）は存在するが、70MB以上でCloudflare Workerのメモリ制限を超過
3. `law_chunk_map.json` で租税特別措置法は単に `75` とマッピングされていた

**解決策**:
1. 租税特別措置法用の条文単位ファイルを新形式（v2）で生成
   - 同名の条文（本則と附則）をすべて含む `articles` 配列形式
   - 保存先: `large_law_articles_v2/{law_id}/{article_title}.json`

2. ワーカーを更新
   - `cloudflare-worker.js` に租税特別措置法専用の処理を追加
   - `large_law_articles_v2/` からcaption含めて正しい条文を取得

### ファイル構成

```
output_v2/
├── large_law_articles_v2/
│   └── 332AC0000000026/    # 租税特別措置法
│       ├── 第一条.json      # articles配列に同名条文をすべて含む
│       ├── 第三条.json
│       ├── 第四条.json      # 50件の「第四条」を含む
│       └── ...              # 計590ファイル
├── laws_chunk_075_1_light.json  # 70MB - Worker読み込み不可
└── ...
```

### 条文ファイルの新形式（v2）

```json
{
  "law_id": "332AC0000000026",
  "law_title": "租税特別措置法",
  "law_num": "...",
  "articles": [
    {
      "title": "第四条",
      "caption": "（障害者等の少額公債の利子の非課税）",
      "paragraphs": [...]
    },
    {
      "title": "第四条",
      "caption": "（利子所得及び配当所得に関する経過規定）",
      "paragraphs": [...]
    }
    // ... 同名条文を最大50件含む
  ]
}
```

### ワーカーの更新内容

`cloudflare-worker.js` の変更点:

1. 租税特別措置法の判定条件を拡張
   ```javascript
   const needsSozei = articlesByLaw.has(SOZEI_ID) ||
     uniqueLawIds.includes(SOZEI_ID) ||
     multipleLawInfos.some(info => info.lawName === '租税特別措置法');
   ```

2. v2形式の条文ファイルから読み込み
   ```javascript
   const r2Key = `large_law_articles_v2/${SOZEI_ID}/${articleTitle}.json`;
   // articles配列をすべて追加
   lawDataCache[SOZEI_ID].articles.push(...data.articles);
   ```

3. 条文検索時にcaptionで正確にマッチ
   - Vectorizeのmetadataからcaptionを取得
   - 同名条文から正しいcaptionの条文を返す

### Vectorize更新

chunk_75のベクトル（66,629件）をVectorizeに再アップロード:
```bash
npx wrangler vectorize insert law-embeddings --file="output_v2/vectors_fixed/chunk_75_vectors_unique2.ndjson"
```

### スクリプト

- `scripts/generate_sozei_articles_full.cjs` - 租税特別措置法の条文ファイル生成
- `scripts/upload_sozei_articles.cjs` - R2へのアップロード
- `scripts/check_075_ranges.cjs` - サブチャンクの条文範囲確認

### 今後の課題

1. **租税特別措置法施行令・施行規則**
   - 同じくchunk 75に含まれる
   - 同様の対応が必要な可能性

2. **他の大規模法令**
   - 同名条文問題がある法令は条文単位ファイルv2形式に移行が必要

### COMMON_LAW_IDS

主要法令名→法令IDマッピング（ベクトル検索で見つからない場合のフォールバック用）に租税特別措置法を追加済み:
```javascript
'租税特別措置法': '332AC0000000026',
```

---

## 2025-12-23 セッション

### 解決した問題

#### 1. chunk 075 大規模法令の `paragraphs: 0` 問題

**症状**: 租税特別措置法施行令・施行規則などchunk 075に含まれる大規模法令で `paragraphs: 0` が返される

**原因**:
1. chunk 075が70MB超でWorkerで読み込み不可
2. 条文単位ファイル（v2形式）が未生成・未アップロード

**解決策**:

1. **chunk 075の再分割**
   - 65個のサブチャンクに分割
   - 49個の小規模チャンク（10MB未満）をR2にアップロード
   - 14個の大規模法令は条文単位ファイル（v2形式）に移行

2. **14個の大規模法令の条文単位ファイル生成・アップロード**
   - `scripts/generate_large_law_articles.py` で生成
   - `scripts/upload_large_articles.py` でR2にアップロード
   - 計6,000以上の条文ファイルをアップロード

3. **law_chunk_map.json更新**
   - 大規模法令に `LARGE_075` マーカーを設定
   - 小規模チャンクは `75_XX` 形式で記録

#### 2. Vectorizeデータ不整合によるlaw_id誤り問題

**症状**: 租税特別措置法施行規則の一部条文で `paragraphs: 0` が継続

**原因**:
- Vectorize内の一部ベクトルで `law_id` と `law_title` が不整合
- 例: `law_id: 503AC0000000081`（医療的ケア児支援法）に `law_title: 租税特別措置法施行規則` が設定されていた
- 誤った `law_id` でR2からファイル取得を試みるため失敗

**解決策**:
1. `COMMON_LAW_IDS` に租税特別措置法ファミリーを追加
   ```javascript
   '租税特別措置法': '332AC0000000026',
   '租税特別措置法施行令': '332CO0000000043',
   '租税特別措置法施行規則': '332M50000040015',
   ```

2. ワーカーでlaw_id修正ロジックを追加
   ```javascript
   // law_titleからCOMMON_LAW_IDSでlaw_idを修正（Vectorizeのデータ不整合対策）
   const metadata = { ...metadataCache.get(key) }; // 浅いコピー
   if (metadata.law_title && COMMON_LAW_IDS[metadata.law_title]) {
     metadata.law_id = COMMON_LAW_IDS[metadata.law_title];
   }
   ```

### 動作確認

```
租税特別措置法施行規則 第十一条の四 | paragraphs: 3 ✅
租税特別措置法施行規則 第五条の四の五 | paragraphs: 8 ✅
```

### 追加したスクリプト

- `scripts/generate_large_law_articles.py` - 大規模法令の条文単位ファイル生成
- `scripts/upload_large_articles.py` - R2への並列アップロード

### ワーカー更新内容

`cloudflare-worker.js`:
1. `LARGE_075` マーカー対応（条文単位ファイルからの取得）
2. `COMMON_LAW_IDS` による law_id 修正ロジック追加
3. ダミー追加時も `COMMON_LAW_IDS` を優先使用

---

## 2025-12-24 セッション

### 実装した機能

#### 1. 参照条文機能（refs/reverse_refs）

**目的**: 説明の精度向上のため、選定条文の参照先・参照元の条文情報をClaudeに渡す

**データソース**: `K:\lawtext-refs\output` の refs.json / reverse_refs.json
- refs: ある条文が参照している条文（例: 458条 → 453条を参照）
- reverse_refs: ある条文を参照している条文（例: 453条 ← 458条から参照される）

**実装内容**:

1. **refs データの分割・アップロード**
   - 26MB の refs.json を法令ID単位に分割（5,679ファイル）
   - R2 に `refs/{law_id}.json` 形式でアップロード
   - スクリプト: `scripts/split_refs.cjs`, `scripts/upload_refs_parallel.cjs`

2. **Worker に `/api/refs` エンドポイント追加**
   ```javascript
   // POST /api/refs
   // body: { articles: [{ law_id, article_title }, ...] }
   // response: { results: [{ law_id, article_title, refs: [...], reverse_refs: [...] }, ...] }
   ```

3. **Worker に `/api/articles` エンドポイント追加**
   - 条文ID（`lawId_ArtXXX` 形式）から条文内容を取得
   - 民法・会社法など大規模法令に対応

4. **フロントエンド（App.jsx）を2段階Claude呼び出しに変更**
   - 1回目: 条文選定（max_tokens: 200）
   - refs/reverse_refs 取得
   - 参照先条文の内容取得
   - 2回目: 説明文生成（max_tokens: 2000、参照条文情報込み）

5. **UI表示の区別**
   - 青色: 検索でヒットした条文
   - オレンジ「参照」: refs/reverse_refs で取得した条文

#### 2. 言及条文抽出機能

**目的**: 説明文の中で言及された条文を自動取得して表示

**実装内容**:

1. **説明文から条文番号を正規表現で抽出**
   ```javascript
   // パターン例: 【会社法 第295条】、民法709条 など
   const mentionPatterns = [
     /【([^】]+?)\s*第([一二三四五六七八九十百千〇]+)条(?:の([一二三四五六七八九十]+))?】/g,
     /(?:^|[（(「『\s])([^\s（(「『【】）)」』]+?(?:法|令|規則|規程))\s*第([一二三四五六七八九十百千〇]+)条/gm
   ];
   ```

2. **抽出した条文をVectorize検索で取得**
   - 条文タイトル完全一致 + paragraphs存在チェック
   - 存在しない条文（ハルシネーション）は表示されない

3. **UI表示**
   - 緑色「言及」: 説明文で言及された条文

### 処理フロー（最終版）

```
1. クエリ分類・マルチクエリ生成
2. Vectorize検索（Top20取得）
3. 【Claude 1回目】条文選定（5件程度）
4. refs/reverse_refs 取得（R2）
5. 参照先条文の内容取得（R2）
6. 【Claude 2回目】説明文生成（選定条文 + 参照条文情報込み）
7. 説明文から言及条文を抽出（正規表現）
8. 言及条文をVectorize検索で取得
9. 結果表示（青/オレンジ/緑で区別）
```

### ファイル構成（追加分）

```
refs_split/
├── 129AC0000000089.json  # 民法
├── 417AC0000000086.json  # 会社法
└── ... (5,679ファイル)

R2:
├── refs/
│   ├── 129AC0000000089.json
│   ├── 417AC0000000086.json
│   └── ... (5,679ファイル)
```

### 制限事項・注意点

1. **reverse_refs の範囲参照問題**
   - 「453条から前条まで」のような範囲参照は、最初の条文（453条）にのみ reverse_refs が設定される
   - 454〜457条には 458条 の reverse_refs が入らない
   - これは lawtext-refs のデータ生成時点の仕様

2. **言及条文のハルシネーション対策**
   - Vectorize検索で存在確認するため、存在しない条文は表示されない
   - ただし説明文自体にはハルシネーションが残る可能性あり

### 追加したスクリプト

- `scripts/split_refs.cjs` - refs.json を法令ID単位に分割
- `scripts/upload_refs_parallel.cjs` - refs ファイルを R2 に並列アップロード
- `scripts/upload_all_refs.cjs` - refs ファイルを R2 にアップロード（逐次版）

---

## 2025-12-26 セッション

### 実装した機能

#### 1. refs_chunks形式への移行

**問題**: refs を法令ID単位で分割すると5,679個のファイルになり管理が煩雑

**解決策**: サイズベースのチャンク分割（約1MB単位）に変更

**実装内容**:

1. **refs データの再分割**
   - 5,679個の個別ファイル → 25個の1MBチャンク + 1個のインデックスファイル
   - スクリプト: `scripts/split_refs_by_size.cjs`

2. **R2 へのアップロード**
   ```
   refs_chunks/
   ├── refs_chunk_000.json  # ~1MB
   ├── refs_chunk_001.json
   ├── ...
   ├── refs_chunk_024.json  # 計25チャンク
   └── refs_index.json      # 法令ID → チャンク番号のマップ
   ```
   - スクリプト: `scripts/upload_refs_chunks.cjs`

3. **Worker の `/api/refs` エンドポイント更新**
   ```javascript
   // 1. インデックスファイルを取得
   const indexObj = await env.R2.get('refs_chunks/refs_index.json');
   refsIndex = JSON.parse(await indexObj.text());

   // 2. 必要なチャンク番号を特定
   const neededChunks = new Set();
   for (const lawId of lawIds) {
     const chunkNum = refsIndex[lawId];
     if (chunkNum !== undefined) neededChunks.add(chunkNum);
   }

   // 3. 必要なチャンクのみ並列取得
   await Promise.all([...neededChunks].map(async (chunkNum) => {
     const r2Key = `refs_chunks/refs_chunk_${String(chunkNum).padStart(3, '0')}.json`;
     const chunkObj = await env.R2.get(r2Key);
     if (chunkObj) chunkDataMap[chunkNum] = JSON.parse(await chunkObj.text());
   }));
   ```

#### 2. 全法令IDマッピング（8,878件）

**問題**: `COMMON_LAW_IDS` に主要法令のみ登録していたため、マイナー法令でID解決できない

**解決策**: 全法令のマッピングファイルを生成

**実装内容**:

1. **`src/lawIds.js` を新規作成**
   - output_v2/laws_chunk_*_light.json から全法令を抽出
   - 8,878件の法令名 → 法令ID マッピング
   - ファイルサイズ: 約1MB（gzip後282KB）

2. **App.jsx での使用**
   ```javascript
   import { ALL_LAW_IDS } from './lawIds.js';
   const COMMON_LAW_IDS = ALL_LAW_IDS;
   ```

#### 3. 言及条文のみ表示するUI改善

**変更前**: 検索ヒット条文 + refs条文 + 言及条文をすべて表示
**変更後**: Claude説明文で言及された条文のみ表示

**実装内容**:

1. **正規表現パターンの拡張**
   ```javascript
   const mentionPatterns = [
     // 【法令名 第X条】形式（アラビア数字・複数の「の」対応）
     /【([^】]+?(?:法|令|規則|規程))\s*第([一二三四五六七八九十百千〇0-9]+)条((?:の[一二三四五六七八九十0-9]+)*)(?:第[0-9一二三四五六七八九十]+項)?】/g,
     // 法令名 第X条 形式（スペースなし対応）
     /(?:^|[（(「『\s])([^\s（(「『【】）)」』]+?(?:法|令|規則|規程))\s*第([一二三四五六七八九十百千〇0-9]+)条((?:の[一二三四五六七八九十0-9]+)*)/gm
   ];
   ```

2. **アラビア数字 → 漢数字変換**
   ```javascript
   function arabicToKanji(str) {
     const map = { '0': '〇', '1': '一', '2': '二', ... };
     return str.replace(/[0-9]/g, d => map[d] || d);
   }
   ```

3. **条文リンククリック時のlaw_id解決**
   ```javascript
   lawId: COMMON_LAW_IDS[lawName] || null  // 法令名からIDを解決
   ```

### ファイル構成（追加・変更分）

```
src/
├── App.jsx          # UI改善・全法令ID対応
└── lawIds.js        # 新規: 8,878件の法令マッピング

refs_chunks/         # 新規ディレクトリ
├── refs_chunk_000.json ~ refs_chunk_024.json  # 25チャンク
└── refs_index.json  # インデックス

R2:
├── refs_chunks/
│   ├── refs_chunk_000.json ~ refs_chunk_024.json
│   └── refs_index.json
```

### 処理フロー（最終版）

```
1. クエリ分類・マルチクエリ生成
2. Vectorize検索（Top20取得）
3. 【Claude 1回目】条文選定（5件程度）
4. refs/reverse_refs 取得（R2 refs_chunks形式）
5. 参照先条文の内容取得（R2）
6. 【Claude 2回目】説明文生成（選定条文 + 参照条文情報込み）
7. 説明文から言及条文を抽出（正規表現 - アラビア数字対応）
8. 言及条文をVectorize検索で取得
9. 言及条文のみサイドバーに表示
```

### 追加したスクリプト

- `scripts/split_refs_by_size.cjs` - refs を1MBチャンクに分割
- `scripts/upload_refs_chunks.cjs` - refs_chunks を R2 にアップロード

### デプロイ情報

- **フロントエンド**: https://joubun-kun.pages.dev
- **Worker API**: https://morning-surf-f117.ikeda-250.workers.dev

### Git コミット

```
0bb26e0 refs機能追加・全法令IDマッピング・UI改善
```

---

## 2025-12-26 セッション（続き）

### sub_items（イ、ロ、ハ等）対応

#### 問題
条文の「号」の下にある「イ、ロ、ハ」などのサブ項目が表示されていなかった

#### 原因
XMLからJSONへの変換時に `<Subitem1>`, `<Subitem2>` などの要素が `sub_items` として抽出されていなかった

#### 解決策

1. **全チャンクのアップグレード処理**
   - R2から309個のlightファイルをバックアップ（`r2_backup_20251226/`）
   - XMLから `Subitem1`, `Subitem2`, `Subitem3` を再抽出
   - `scripts/upgrade_all_chunks.py` で並列処理（8ワーカー）
   - 結果: 270成功、37スキップ、1エラー（空ファイル）

2. **R2へのアップロード**
   - `scripts/upload_upgraded_to_r2.cjs` で306ファイルをアップロード
   - 1ファイル失敗（chunk_000は元から空）

3. **フロントエンド対応**（前回セッションで実装済み）
   - `sub_items` の再帰的表示
   - 色分け: 青（号）、緑（イロハ）、オレンジ（(1)(2)）

#### 動作確認

```
不動産登記規則 第百十八条
├── Item 1: 一
│   └── sub_items: 4個
│       ├── イ
│       ├── ロ
│       ├── ハ
│       └── ニ
```

### Observability（ログ機能）有効化

#### 実装内容

1. **wrangler.jsonc 作成**
   ```json
   {
     "name": "morning-surf-f117",
     "main": "cloudflare-worker.js",
     "compatibility_date": "2024-01-01",
     "observability": {
       "enabled": true,
       "logs": {
         "enabled": true,
         "persist": true,
         "invocation_logs": true
       }
     },
     "vectorize": [...],
     "r2_buckets": [...],
     "ai": { "binding": "AI" }
   }
   ```

2. **トークン使用量ログ追加**
   ```javascript
   // cloudflare-worker.js
   if (data.usage) {
     console.log(`[Claude /classify] input: ${data.usage.input_tokens}, output: ${data.usage.output_tokens}`);
   }
   if (data.usage) {
     console.log(`[Claude /api/chat] input: ${data.usage.input_tokens}, output: ${data.usage.output_tokens}`);
   }
   ```

### コスト分析

#### 1回の検索あたりのトークン使用量（実測値）

| 呼び出し | 入力 | 出力 | 用途 |
|---------|------|------|------|
| /api/classify | 350-770 | 60-70 | クエリ分類 |
| /api/chat (1回目) | 4,000-7,000 | 17-23 | 条文選定 |
| /api/chat (2回目) | 1,700-2,900 | 400-640 | 説明文生成 |
| **合計** | **約7,000-10,000** | **約500-700** | |

#### コスト計算（Claude Sonnet 4）

- 入力: $3 / 100万トークン
- 出力: $15 / 100万トークン
- **1回の検索: 約4-6円**
- 月1,000回: 約5,000円

#### 入力トークンの変動要因

1. **質問の長さ** → classify入力に影響
2. **ヒット条文の長さ** → 条文選定入力に影響
3. **選定条文・参照条文の量** → 説明文生成入力に影響
4. **会話履歴の累積** → 説明文生成入力に影響（質問＋回答のみ、条文全文は含まない）

### 追加したファイル

- `wrangler.jsonc` - Workerの設定ファイル（observability含む）
- `scripts/upgrade_all_chunks.py` - 全チャンクのsub_items再抽出
- `scripts/upload_upgraded_to_r2.cjs` - アップグレード済みファイルのR2アップロード
- `r2_backup_20251226/` - R2データのバックアップ（309ファイル）
- `r2_upgraded/` - アップグレード済みファイル（307ファイル）

---

## 2025-12-30 セッション

### 解決した問題

#### 1. R2データの法令ID不整合問題

**症状**: 電子署名及び認証業務に関する法律などが参照条文に表示されない

**原因**:
- 2025-12-26のsub_items対応で `r2_backup_20251226` を基にアップグレードした
- しかし `r2_backup_20251226` 自体に法令IDの不整合があった
- 例: chunk_065で電子署名法（412AC0000000102）が欠落
- `output_v2` には正しいデータがあったが、R2には反映されていなかった

**解決策**:

1. **output_v2の全チャンクをR2に再アップロード**
   - `scripts/upload_all_output_v2.cjs` で280個のチャンクをアップロード
   - 275個成功、5個失敗（巨大ファイル: 069, 072, 073, 074, 075）
   - 失敗した069, 072, 073, 074は `r2_backup_20251226` からアップロード（適切なサイズ）
   - chunk_075はサブチャンク（075_1〜075_65）が既にアップロード済み

2. **アップロード結果**
   ```
   output_v2から: 275個（電子署名法含むchunk_065など）
   r2_backupから: 4個（069, 072, 073, 074）
   chunk_075: サブチャンク65個が既存
   ```

#### 2.「法律」で終わる法令名が認識されない問題

**症状**: 「電子署名及び認証業務に関する法律」が説明文でクリック可能にならない、参照条文に表示されない

**原因**:
- 正規表現が `(法|令|規則|規程)` のみにマッチ
- 「法律」で終わる法令名（電子署名及び認証業務に関する法律など）がマッチしない

**解決策**:

`src/App.jsx` の正規表現を修正:

1. **formatExplanation内のパターン**
   ```javascript
   // Before
   /【([^】]+?)(法|令|規則|規程)\s*(第...)】/g

   // After
   /【([^】]+?)(法律|法|令|規則|規程)\s*(第...)】/g
   ```

2. **mentionPatterns**
   ```javascript
   // Before
   /【([^】]+?(?:法|令|規則|規程))\s*第...】/g

   // After
   /【([^】]+?(?:法律|法|令|規則|規程))\s*第...】/g
   ```

3. **referenceMap / lastSeen / invalidLawNames**
   - `法律` 用のエントリを追加
   - `同法律`, `本法律`, `前法律` を無効な法令名として追加

### 追加したスクリプト

- `scripts/upload_all_output_v2.cjs` - output_v2の全チャンクをR2にアップロード

### 教訓

- **正規のデータソースを一元管理する**: `output_v2` が正しいデータ
- **バックアップからのアップグレードは危険**: `r2_backup` のデータに問題があると、それが引き継がれる
- **アップロード時はoutput_v2を基準にする**