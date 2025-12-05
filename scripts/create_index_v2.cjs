const fs = require('fs');
const path = require('path');

const outputDir = 'K:/joubun-kun-web/output_v2';
const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.json') && f.startsWith('laws_chunk_')).sort();

const chunks = [];
let totalLaws = 0;

// 巨大ファイル用：メタデータだけ抽出
async function extractMetadata(filePath) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    let buffer = '';
    let laws = [];
    let inLaws = false;
    let depth = 0;
    let currentLawId = null;
    let currentLawData = '';

    stream.on('data', (chunk) => {
      buffer += chunk;

      // "laws": { の後から法令データを探す
      if (!inLaws) {
        const lawsStart = buffer.indexOf('"laws":{');
        if (lawsStart !== -1) {
          inLaws = true;
          buffer = buffer.substring(lawsStart + 8);
        } else {
          // バッファが大きくなりすぎないように切り詰め
          if (buffer.length > 10000) {
            buffer = buffer.substring(buffer.length - 1000);
          }
          return;
        }
      }

      // 法令IDと基本情報を抽出
      const lawIdRegex = /"([^"]+)":\s*\{\s*"law_id":\s*"([^"]+)",\s*"law_num":\s*"([^"]*)",\s*"law_title":\s*"([^"]*)"/g;
      let match;
      while ((match = lawIdRegex.exec(buffer)) !== null) {
        const lawId = match[1];
        const lawTitle = match[4];
        const lawNum = match[3];

        // 重複チェック
        if (!laws.find(l => l.law_id === lawId)) {
          laws.push({
            law_id: lawId,
            law_title: lawTitle,
            law_num: lawNum,
            article_count: 0  // 後で更新したい場合は別途処理
          });
        }
      }

      // バッファが大きくなりすぎないように切り詰め（最後の部分は残す）
      if (buffer.length > 100000) {
        buffer = buffer.substring(buffer.length - 10000);
      }
    });

    stream.on('end', () => {
      resolve(laws);
    });

    stream.on('error', reject);
  });
}

(async () => {
  for (const file of files) {
    const match = file.match(/laws_chunk_(\d+)_v2\.json/);
    if (!match) continue;

    const chunkId = parseInt(match[1]);
    const filePath = path.join(outputDir, file);
    const fileSize = fs.statSync(filePath).size;

    console.log(`Processing ${file} (${(fileSize / 1024 / 1024).toFixed(1)} MB)...`);

    let laws = [];

    if (fileSize > 500 * 1024 * 1024) {
      // 500MB以上はストリーミング
      console.log(`  -> Using streaming for large file`);
      laws = await extractMetadata(filePath);
    } else {
      // 通常の読み込み
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        for (const [lawId, lawData] of Object.entries(data.laws || {})) {
          laws.push({
            law_id: lawId,
            law_title: lawData.law_title,
            law_num: lawData.law_num,
            article_count: lawData.articles ? lawData.articles.length : 0
          });
        }
      } catch (e) {
        console.log(`  -> Error reading, using streaming: ${e.message}`);
        laws = await extractMetadata(filePath);
      }
    }

    totalLaws += laws.length;
    console.log(`  -> ${laws.length} laws`);

    chunks.push({
      chunk_id: chunkId,
      filename: file,
      laws: laws
    });
  }

  const index = {
    version: '2.0',
    created_at: new Date().toISOString(),
    total_laws: totalLaws,
    chunks: chunks
  };

  fs.writeFileSync('K:/joubun-kun-web/output_v2/laws_index_v2.json', JSON.stringify(index, null, 2));
  console.log('\nCreated index with', chunks.length, 'chunks and', totalLaws, 'laws');
})();
