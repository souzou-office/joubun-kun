// 項単位Embedding生成スクリプト
// 使用方法: node scripts/generate_paragraph_embeddings.cjs
//
// R2から既存JSONを読み込み、項単位でCloudflare Workers AI (bge-m3) で
// Embeddingを生成し、新しいJSONファイルを出力する

const fs = require('fs');
const path = require('path');

// 設定
const WORKER_URL = 'https://delicate-bread-29f1.ikeda-250.workers.dev/';
const R2_BASE_URL = 'https://pub-31e9c70796b94125976e0d215b8de3b1.r2.dev';
const OUTPUT_DIR = 'K:/joubun-kun-web/output_v2';
const BATCH_SIZE = 10;  // 1回のAPIリクエストで処理するテキスト数（最大10件）
const RETRY_DELAYS = [500, 1000, 2000, 3000, 5000]; // 指数バックオフ（ミリ秒）
const MAX_TEXT_LENGTH = 6000; // 6000文字を超えるテキストは切り詰め（API制限: 60000トークン/リクエスト）

// 進捗ファイル（中断時の再開用）
const PROGRESS_FILE = 'K:/joubun-kun-web/scripts/embedding_progress.json';

// 待機関数
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Embedding API呼び出し（指数バックオフ付きリトライ）
async function getEmbeddings(texts) {
  // null/空文字をフィルタ
  const validTexts = texts.filter(t => t && typeof t === 'string' && t.trim().length > 0);
  if (validTexts.length === 0) {
    return [];
  }

  for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
    try {
      const response = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: validTexts })
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const result = await response.json();
      return result.data;  // [[1024次元], [1024次元], ...]
    } catch (error) {
      if (attempt < RETRY_DELAYS.length - 1) {
        const delay = RETRY_DELAYS[attempt];
        console.log(`    ⚠️ リトライ ${attempt + 1}/${RETRY_DELAYS.length}: ${error.message} (${delay}ms待機)`);
        await sleep(delay);
      } else {
        throw error;
      }
    }
  }
}

// 項のテキストを生成（MAX_TEXT_LENGTHで切り詰め）
function getParagraphText(paragraph, articleTitle, lawTitle) {
  const sentences = paragraph.sentences.map(s => s.text).join('');
  const fullText = `${lawTitle} ${articleTitle} ${sentences}`;
  if (fullText.length > MAX_TEXT_LENGTH) {
    console.log(`    ⚠️ テキスト切り詰め: ${fullText.length}文字 → ${MAX_TEXT_LENGTH}文字`);
    return fullText.slice(0, MAX_TEXT_LENGTH);
  }
  return fullText;
}

// メイン処理
async function main() {
  console.log('📋 項単位Embedding生成スクリプト');
  console.log('================================');
  console.log(`Worker URL: ${WORKER_URL}`);
  console.log(`出力先: ${OUTPUT_DIR}`);
  console.log(`バッチサイズ: ${BATCH_SIZE}`);
  console.log('');

  // 出力ディレクトリ作成
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // 進捗読み込み（中断からの再開用）
  let startChunk = 0;

  if (fs.existsSync(PROGRESS_FILE)) {
    const progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    startChunk = progress.lastCompletedChunk !== undefined ? progress.lastCompletedChunk + 1 : 0;
    console.log(`📌 チャンク ${startChunk} から再開`);
  }

  const totalChunks = 77;
  let totalParagraphs = 0;
  let totalApiCalls = 0;

  for (let chunkIndex = startChunk; chunkIndex < totalChunks; chunkIndex++) {
    const chunkName = `laws_chunk_${String(chunkIndex).padStart(3, '0')}_embedded.json`;
    const outputName = `laws_chunk_${String(chunkIndex).padStart(3, '0')}_v2.json`;

    console.log(`\n📦 処理中: ${chunkName} (${chunkIndex + 1}/${totalChunks})`);

    // R2からダウンロード
    const url = `${R2_BASE_URL}/${chunkName}`;
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`  ❌ ダウンロード失敗: ${response.status}`);
      continue;
    }

    const chunkData = await response.json();

    // 項のテキストとメタ情報を収集
    const paragraphInfos = [];

    for (const [lawId, lawData] of Object.entries(chunkData.laws)) {
      if (!lawData.articles) continue;

      for (let articleIdx = 0; articleIdx < lawData.articles.length; articleIdx++) {
        const article = lawData.articles[articleIdx];
        if (!article.paragraphs) continue;

        for (let paraIdx = 0; paraIdx < article.paragraphs.length; paraIdx++) {
          const para = article.paragraphs[paraIdx];
          const text = getParagraphText(para, article.title, lawData.law_title);

          if (text && text.trim().length > 0) {
            paragraphInfos.push({
              lawId,
              articleIdx,
              paraIdx,
              text
            });
          }
        }
      }
    }

    console.log(`  📝 項数: ${paragraphInfos.length}`);

    if (paragraphInfos.length === 0) {
      for (const lawData of Object.values(chunkData.laws)) {
        if (lawData.articles) {
          for (const article of lawData.articles) {
            delete article.embedding;
          }
        }
      }
      fs.writeFileSync(
        path.join(OUTPUT_DIR, outputName),
        JSON.stringify(chunkData, null, 2)
      );
      console.log(`  💾 保存完了（項なし）`);
      continue;
    }

    // バッチ処理でEmbedding生成
    const embeddings = [];

    for (let i = 0; i < paragraphInfos.length; i += BATCH_SIZE) {
      const batchNum = Math.floor(i / BATCH_SIZE);
      const batch = paragraphInfos.slice(i, i + BATCH_SIZE);
      const texts = batch.map(p => p.text);

      console.log(`  🔄 Embedding生成: ${i + 1}-${Math.min(i + BATCH_SIZE, paragraphInfos.length)}/${paragraphInfos.length}`);

      try {
        const batchEmbeddings = await getEmbeddings(texts);
        embeddings.push(...batchEmbeddings);
        totalApiCalls++;
        await sleep(1000);
      } catch (error) {
        console.error(`  ❌ APIエラー: ${error.message}`);
        console.log(`\n⚠️ チャンク ${chunkIndex} のバッチ ${batchNum} でエラー。再実行でチャンクの最初からやり直します。`);
        process.exit(1);
      }
    }

    // Embeddingをデータに埋め込む
    for (let i = 0; i < paragraphInfos.length; i++) {
      const info = paragraphInfos[i];
      const article = chunkData.laws[info.lawId].articles[info.articleIdx];
      const para = article.paragraphs[info.paraIdx];

      para.embedding = embeddings[i];
      delete article.embedding;
    }

    totalParagraphs += paragraphInfos.length;

    // 巨大ファイル対応：法令ごとにストリーミング書き込み
    const outputPath = path.join(OUTPUT_DIR, outputName);
    const writeStream = fs.createWriteStream(outputPath);

    // ヘルパー: 安全な書き込み（backpressure対応）
    const safeWrite = (data) => {
      return new Promise((resolve) => {
        if (!writeStream.write(data)) {
          writeStream.once('drain', resolve);
        } else {
          resolve();
        }
      });
    };

    await safeWrite('{"metadata":');
    await safeWrite(JSON.stringify(chunkData.metadata || {}));
    await safeWrite(',"laws":{');

    const lawIds = Object.keys(chunkData.laws);
    for (let li = 0; li < lawIds.length; li++) {
      const lawId = lawIds[li];
      const lawData = chunkData.laws[lawId];

      if (li > 0) await safeWrite(',');
      await safeWrite(JSON.stringify(lawId) + ':{');

      // 法令データの各フィールドを個別に書き込む
      await safeWrite('"law_title":' + JSON.stringify(lawData.law_title || ''));
      await safeWrite(',"law_id":' + JSON.stringify(lawData.law_id || ''));
      if (lawData.law_num) await safeWrite(',"law_num":' + JSON.stringify(lawData.law_num));

      // articles配列を個別に書き込む
      if (lawData.articles && lawData.articles.length > 0) {
        await safeWrite(',"articles":[');
        for (let ai = 0; ai < lawData.articles.length; ai++) {
          if (ai > 0) await safeWrite(',');
          await safeWrite(JSON.stringify(lawData.articles[ai]));
        }
        await safeWrite(']');
      }

      await safeWrite('}');

      // メモリ解放のため、書き込み済みの法令データを削除
      delete chunkData.laws[lawId];
    }

    await safeWrite('}}');
    writeStream.end();

    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    console.log(`  💾 保存完了`);

    fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ lastCompletedChunk: chunkIndex }));
  }

  console.log('\n================================');
  console.log('🎉 完了！');
  console.log(`  総項数: ${totalParagraphs}`);
  console.log(`  APIコール数: ${totalApiCalls}`);
  console.log(`  出力先: ${OUTPUT_DIR}`);

  if (fs.existsSync(PROGRESS_FILE)) {
    fs.unlinkSync(PROGRESS_FILE);
  }
}

main().catch(err => {
  console.error('❌ エラー:', err);
  process.exit(1);
});
