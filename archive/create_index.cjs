// JSONファイルからインデックスを作成するスクリプト
// 使用方法: node scripts/create_index.js

const fs = require('fs');
const path = require('path');

console.log('📋 法令インデックス作成スクリプト');
console.log('');

// 設定
const INPUT_DIR = 'K:/joubun-kun-web/public/data';  // 実際のデータフォルダ
const OUTPUT_FILE = 'K:/joubun-kun-web/public/data/laws_index.json';

// インデックスデータ
const index = {
  version: '1.0',
  created_at: new Date().toISOString(),
  total_laws: 0,
  chunks: []
};

try {
  // K:\laws_chunk_embeddings フォルダの存在確認
  if (!fs.existsSync(INPUT_DIR)) {
    console.error(`❌ エラー: ${INPUT_DIR} が見つかりません`);
    console.log('');
    console.log('💡 JSONファイルの準備ができたら、このスクリプトを実行してください');
    process.exit(1);
  }

  // ファイル一覧取得
  const files = fs.readdirSync(INPUT_DIR)
    .filter(f => f.endsWith('.json'))
    .sort();

  if (files.length === 0) {
    console.log('⚠️  JSONファイルが見つかりません');
    console.log('');
    console.log('💡 laws_chunk_XXX.json ファイルが完成したら、再度実行してください');
    process.exit(0);
  }

  console.log(`📦 ${files.length}個のファイルを処理します`);
  console.log('');

  // 各ファイルを処理
  for (let i = 0; i < files.length; i++) {
    const filename = files[i];
    const filepath = path.join(INPUT_DIR, filename);
    
    console.log(`処理中 (${i + 1}/${files.length}): ${filename}`);
    
    try {
      const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
      
      const chunkInfo = {
        chunk_id: i,
        filename: filename,
        laws: []
      };
      
      // 各法令の基本情報のみ抽出
      if (data.laws && typeof data.laws === 'object') {
        for (const [lawId, lawData] of Object.entries(data.laws)) {
          chunkInfo.laws.push({
            law_id: lawId,
            law_title: lawData.law_title || '',
            law_num: lawData.law_num || '',
            article_count: lawData.articles?.length || 0
          });
          index.total_laws++;
        }
      }
      
      index.chunks.push(chunkInfo);
      
    } catch (error) {
      console.error(`  ❌ エラー: ${error.message}`);
    }
  }

  console.log('');
  console.log(`✅ インデックス作成完了: ${index.total_laws}法令`);
  
  // 出力ディレクトリ作成
  const outputDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // インデックスファイル保存
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(index, null, 2));
  console.log(`💾 保存: ${OUTPUT_FILE}`);
  
  console.log('');
  console.log('🎉 完了！');
  console.log('');
  console.log('次のステップ:');
  console.log('1. JSONファイルを public/data/ にコピー');
  console.log('2. ONNXモデルを public/models/ にコピー');
  console.log('3. npm run dev で動作確認');
  
} catch (error) {
  console.error('❌ エラー:', error.message);
  process.exit(1);
}
