import React, { useState, useEffect } from 'react';
import { pipeline } from '@xenova/transformers';

// グローバル変数
let embeddingPipeline = null;
const lawDataCache = new Map();

// ===== 法令名・条文番号マッチング用ヘルパー =====

// 数字を漢数字に変換
const toKanjiNumber = (num) => {
  const kanjiDigits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const kanjiUnits = ['', '十', '百', '千'];
  
  if (num === 0) return '〇';
  if (num < 0 || num > 9999) return String(num);
  
  let result = '';
  let n = num;
  let unitIndex = 0;
  
  while (n > 0) {
    const digit = n % 10;
    if (digit > 0) {
      if (unitIndex === 0) {
        result = kanjiDigits[digit] + result;
      } else if (digit === 1) {
        result = kanjiUnits[unitIndex] + result;
      } else {
        result = kanjiDigits[digit] + kanjiUnits[unitIndex] + result;
      }
    }
    n = Math.floor(n / 10);
    unitIndex++;
  }
  return result;
};

// 主要法令名リスト
const MAJOR_LAW_NAMES = [
  '民法', '会社法', '商法', '刑法', '憲法', '民事訴訟法', '刑事訴訟法',
  '行政事件訴訟法', '行政手続法', '国家賠償法', '労働基準法', '労働契約法',
  '借地借家法', '不動産登記法', '商業登記法', '戸籍法', '供託法',
  '民事執行法', '民事保全法', '破産法', '会社更生法', '民事再生法',
  '金融商品取引法', '独占禁止法', '消費者契約法', '特定商取引法',
  '著作権法', '特許法', '商標法', '信託法', '宅地建物取引業法',
  '建築基準法', '都市計画法', '農地法', '所得税法', '法人税法',
  '相続税法', '地方税法', '国税通則法', '国税徴収法'
];

// クエリから法令名と条文番号を抽出
const extractLawAndArticle = (query) => {
  let lawName = null;
  let articleNumberKanji = null;
  
  for (const name of MAJOR_LAW_NAMES) {
    if (query.includes(name)) {
      lawName = name;
      break;
    }
  }
  
  const articleMatch = query.match(/第?(\d+)条/);
  if (articleMatch) {
    articleNumberKanji = toKanjiNumber(parseInt(articleMatch[1], 10));
  }
  
  if (!articleNumberKanji) {
    const kanjiMatch = query.match(/第([一二三四五六七八九十百千]+)条/);
    if (kanjiMatch) {
      articleNumberKanji = kanjiMatch[1];
    }
  }
  
  return { lawName, articleNumberKanji };
};

// 条文タイトルから条文番号（漢数字）を抽出
const extractArticleNumberFromTitle = (title) => {
  if (!title) return null;
  const match = title.match(/第([一二三四五六七八九十百千]+)条/);
  return match ? match[1] : null;
};

// ===== IndexedDB設定 =====
const DB_NAME = 'LawDataDB';
const DB_VERSION = 1;
const STORE_NAME = 'lawChunks';

// IndexedDBを開く
const openDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'chunk_id' });
      }
    };
  });
};

// IndexedDBからデータ取得
const getFromIndexedDB = async (chunkId) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(chunkId);
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

// IndexedDBにデータ保存
const saveToIndexedDB = async (chunkId, data) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put({ chunk_id: chunkId, data: data });
    
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

// APIキー管理
const API_KEY_STORAGE = 'joubun_claude_api_key';

const saveApiKey = (key) => {
  localStorage.setItem(API_KEY_STORAGE, key);
};

const getApiKey = () => {
  return localStorage.getItem(API_KEY_STORAGE) || '';
};

const deleteApiKey = () => {
  localStorage.removeItem(API_KEY_STORAGE);
};

// AI解説テキストを見やすくフォーマット
const formatExplanation = (text) => {
  let cleanText = text
    .replace(/^#{4,6}\s+/gm, '    ')
    .replace(/^###\s+/gm, '   ')
    .replace(/^##\s+/gm, '  ')
    .replace(/^#\s+/gm, ' ')
    .trim();
  
  const paragraphs = cleanText.split('\n').filter(p => p.trim());
  
  return paragraphs.map((paragraph, index) => {
    let content = paragraph;
    
    // 太字を強調
    content = content.replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-gray-900">$1</strong>');
    content = content.replace(/\*(.*?)\*/g, '<em class="italic">$1</em>');
    
    // 条文番号を目立たせる
    content = content.replace(
      /(【[^】]+第[0-9]+条[^】]*】)/g, 
      '<span class="inline-block font-bold text-blue-700 bg-blue-100 px-3 py-1 rounded-lg border-2 border-blue-300 mx-1 shadow-sm">$1</span>'
    );
    
    // 重要キーワードを強調
    content = content.replace(
      /(?:^|\s)(手付|解除|履行の着手|契約|債務|債権|損害賠償|設立|株式|株主|登記|要件|効果|原則|例外|注意点|できる|できない|できません|してはならない|しなければならない|必要|可能|不可|禁止|違反)(?=\s|$|、|。|は|が|を|に|です)/g, 
      ' <span class="font-semibold text-gray-900 bg-yellow-100 px-1.5 py-0.5 rounded">$1</span>'
    );
    
    // 番号付きリスト
    const isNumberedList = /^(\d+)[\.\)]\s(.+)/.exec(paragraph);
    const isBulletList = /^[・•]\s/.test(paragraph);
    
    if (isNumberedList) {
      const number = isNumberedList[1];
      const text = isNumberedList[2];
      return (
        <div key={index} className="flex items-start gap-3 mb-3 ml-2">
          <span className="flex-shrink-0 w-7 h-7 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold">{number}</span>
          <p className="text-gray-800 leading-relaxed flex-1 pt-0.5 text-[15px]" dangerouslySetInnerHTML={{ __html: text }} />
        </div>
      );
    }
    
    if (isBulletList) {
      return (
        <div key={index} className="flex items-start gap-3 mb-2 ml-4">
          <span className="text-blue-600 font-bold">•</span>
          <p className="text-gray-800 leading-relaxed flex-1 text-[15px]" dangerouslySetInnerHTML={{ __html: content.replace(/^[・•]\s/, '') }} />
        </div>
      );
    }
    
    // 見出し
    const isHeading = paragraph.length < 40 && (
      paragraph.endsWith('：') || 
      paragraph.endsWith(':') || 
      paragraph.match(/^【.+】$/)
    );
    
    if (isHeading) {
      return (
        <h4 key={index} className="font-bold text-gray-900 mt-4 mb-2 text-base border-l-4 border-blue-600 pl-3 bg-blue-50 py-1.5" dangerouslySetInnerHTML={{ __html: content }} />
      );
    }
    
    // セクション区切り
    const isSectionStart = /^(まず|次に|また|さらに|最後に|ただし|なお|具体的には)、?/.test(paragraph);
    
    if (isSectionStart) {
      return (
        <p key={index} className="text-gray-800 leading-relaxed mb-3 mt-3 pl-3 border-l-2 border-blue-400 bg-blue-50 py-2 pr-2 text-[15px]" dangerouslySetInnerHTML={{ __html: content }} />
      );
    }
    
    // 重要な結論・制約
    const isImportantConclusion = 
      /^(したがって|よって|つまり|結論として|以上より|重要|注意)、?/.test(paragraph) ||
      /(できません|禁止|してはならない|必ず|不可|違反)/.test(paragraph) ||
      paragraph.includes('履行の着手');
    
    if (isImportantConclusion) {
      return (
        <div key={index} className="bg-yellow-50 border-2 border-yellow-400 rounded-lg p-4 my-4">
          <div className="flex items-start gap-3">
            <span className="text-2xl">⚠️</span>
            <p className="text-gray-900 leading-relaxed font-semibold text-base flex-1" dangerouslySetInnerHTML={{ __html: content }} />
          </div>
        </div>
      );
    }
    
    // 通常の段落
    return (
      <p key={index} className="text-gray-800 leading-relaxed mb-3 text-[15px]" dangerouslySetInnerHTML={{ __html: content }} />
    );
  });
};

export default function App() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [modelLoading, setModelLoading] = useState(true);
  const [modelStatus, setModelStatus] = useState('初期化中...');
  const [error, setError] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [processingStep, setProcessingStep] = useState('');
  const [progress, setProgress] = useState(0);
  const [expandedArticles, setExpandedArticles] = useState(new Set());
  const [lawsIndex, setLawsIndex] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);

  const BM25_K1 = 1.2;
  const BM25_B = 0.75;
  const TITLE_BONUS = 15;
  const CAPTION_BONUS = 8;
  const LAW_NAME_BONUS = 5;

  const toggleArticleExpansion = (lawId, articleNumber) => {
    const key = `${lawId}-${articleNumber}`;
    const newExpanded = new Set(expandedArticles);
    if (newExpanded.has(key)) {
      newExpanded.delete(key);
    } else {
      newExpanded.add(key);
    }
    setExpandedArticles(newExpanded);
  };

  // ===== 初期化 =====
  useEffect(() => {
    checkApiKey();
    initialize();
  }, []);

  const checkApiKey = () => {
    const key = getApiKey();
    setHasApiKey(key.length > 0);
  };

  const initialize = async () => {
    try {
      // 1. Embeddingモデル初期化（メモリ確保のため最初に）
      setModelStatus('🧬 Embeddingモデルを読み込み中... (初回のみ3-5分)');
      
      embeddingPipeline = await pipeline(
        'feature-extraction',
        'Xenova/multilingual-e5-base',
        { quantized: true }  // BASE版：軽量・ブラウザベース
      );
      
      console.log('✅ Embeddingモデル初期化完了');

      // 2. 法令インデックス読み込み
      setModelStatus('📚 法令インデックスを読み込み中...');
      
      try {
        const indexResponse = await fetch('data/laws_index.json');
        const index = await indexResponse.json();
        setLawsIndex(index);
        console.log(`✅ ${index.total_laws}法令のインデックス読み込み完了`);
      } catch (err) {
        console.log('⚠️ インデックスファイルが見つかりません（JSONファイル準備中）');
      }
      
      setModelLoading(false);
      setModelStatus('✅ 準備完了！');
      
    } catch (err) {
      console.error('初期化エラー:', err);
      setError(`初期化に失敗: ${err.message}`);
      setModelLoading(false);
    }
  };

  // ===== Claude API呼び出し（安全版）=====
  const callClaude = async (messages, maxTokens = 2000) => {
    const apiKey = getApiKey();
    
    if (!apiKey) {
      throw new Error('APIキーが設定されていません');
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: maxTokens,
        messages: messages
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Claude API error: ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    return data.content[0].text;
  };

  // ===== chunkファイル読み込み（IndexedDB対応）=====
  const loadLawChunk = async (filename) => {
    // メモリキャッシュチェック
    if (lawDataCache.has(filename)) {
      console.log(`✅ メモリキャッシュヒット: ${filename}`);
      return lawDataCache.get(filename);
    }
    
    // IndexedDBチェック（エラー時はスキップ）
    try {
      const cachedData = await getFromIndexedDB(filename);
      if (cachedData) {
        console.log(`💾 IndexedDBヒット: ${filename}`);
        // メモリキャッシュにも入れる
        lawDataCache.set(filename, cachedData.data);
        return cachedData.data;
      }
    } catch (e) {
      console.log(`⚠️ IndexedDB読み込みスキップ: ${filename}`);
    }
    
    console.log(`📥 ダウンロード中: ${filename}`);
    
    const response = await fetch(`data/${filename}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    
    // IndexedDBに保存（容量不足でも続行）
    try {
      await saveToIndexedDB(filename, data);
      console.log(`💾 IndexedDBに保存: ${filename}`);
    } catch (e) {
      console.log(`⚠️ IndexedDB保存スキップ（容量不足？）: ${filename}`);
    }
    
    // メモリキャッシュには必ず保存
    lawDataCache.set(filename, data);
    
    return data;
  };

  // ===== Embedding生成 =====
  const getQueryEmbedding = async (text) => {
    if (!embeddingPipeline) {
      throw new Error('Embeddingモデルが初期化されていません');
    }
    
    // multilingual-e5モデルはquery用にprefixが必要
    const prefixedText = `query: ${text}`;
    
    const output = await embeddingPipeline(prefixedText, {
      pooling: 'mean',
      normalize: true
    });
    
    return Array.from(output.data);
  };

  // ===== コサイン類似度 =====
  const cosineSimilarity = (vecA, vecB) => {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    let dotProduct = 0, normA = 0, normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  };

  // ===== BM25計算 =====
  const calculateBM25 = (keyword, doc, docLength, avgDocLength, totalDocs, docsWithKeyword) => {
    const tf = (doc.match(new RegExp(keyword, 'g')) || []).length;
    const idf = Math.log((totalDocs - docsWithKeyword + 0.5) / (docsWithKeyword + 0.5) + 1);
    return idf * ((tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * (docLength / avgDocLength))));
  };

  // ===== 検索処理 =====
  const handleSearch = async () => {
    if (!query.trim() || !lawsIndex || modelLoading) return;
    
    if (!hasApiKey) {
      setError('APIキーが設定されていません。設定画面から入力してください。');
      setShowSettings(true);
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      console.log('=== 🔍 検索開始 ===');
      console.log('📝 検索キーワード:', query);
      
      // クエリから法令名・条文番号を抽出
      const { lawName, articleNumberKanji } = extractLawAndArticle(query);
      console.log('🔎 抽出結果:', { lawName, articleNumberKanji });
      
      // 【第1段階】Embedding生成
      setProcessingStep('🧬 質問文をEmbedding化中...');
      setProgress(10);
      
      const queryEmbedding = await getQueryEmbedding(query);
      console.log('✅ Embedding生成完了');
      console.log('🧬 Embedding vector length:', queryEmbedding.length);

      // 【第2段階】全chunk処理してからTop候補を選出
      setProcessingStep('📦 法令データを読み込み中...');
      setProgress(30);
      
      let allCandidates = [];
      let totalArticleCount = 0;
      
      // ボーナススコア設定
      const EXACT_MATCH_BONUS = 0.50;      // 法令名+条文番号完全一致
      const LAW_NAME_MATCH_BONUS = 0.15;   // 法令名のみ一致
      
      // 全77chunkを検索対象にする
      const dataChunks = lawsIndex.chunks.filter(c => c.filename.startsWith('laws_chunk_'));
      const totalChunks = dataChunks.length;
      
      // 全chunk検索
      for (let i = 0; i < dataChunks.length; i++) {
        const chunk = dataChunks[i];
        const progress = 30 + Math.round((i / totalChunks) * 40);
        setProgress(progress);
        setProcessingStep(`📦 ${i + 1}/${totalChunks} 読み込み中...`);
        
        const chunkData = await loadLawChunk(chunk.filename);
        
        // このchunkの条文を処理
        for (const [lawId, lawData] of Object.entries(chunkData.laws)) {
          if (!lawData.articles) continue;
          
          for (const article of lawData.articles) {
            if (!article.embedding || !Array.isArray(article.embedding)) {
              continue;
            }
            
            totalArticleCount++;
            const similarity = cosineSimilarity(queryEmbedding, article.embedding);
            
            // ボーナススコア計算
            let bonus = 0;
            let matchType = '';
            
            const lawNameMatched = lawName && lawData.law_title && lawData.law_title === lawName;
            const articleTitleKanji = extractArticleNumberFromTitle(article.title);
            const articleNumberMatched = articleNumberKanji && articleTitleKanji && articleTitleKanji === articleNumberKanji;
            
            if (lawNameMatched && articleNumberMatched) {
              bonus = EXACT_MATCH_BONUS;
              matchType = '🎯完全一致';
            } else if (lawNameMatched) {
              bonus = LAW_NAME_MATCH_BONUS;
              matchType = '📘法令名一致';
            }
            
            const score = Math.min(similarity + bonus, 1.0);
            
            // 全候補を保存
            allCandidates.push({
              law: lawData,
              article: article,
              similarity: Math.round(similarity * 1000) / 1000,
              score: Math.round(score * 1000) / 1000,
              matchType: matchType
            });
          }
        }
      }
      
      // 全chunk処理後、スコアでソートしてTop20を選出
      console.log('📊 ソート中...');
      allCandidates.sort((a, b) => b.score - a.score);
      const top20 = allCandidates.slice(0, 20);
      
      console.log('✅ Top200選出完了');
      console.log('📊 全条文数:', totalArticleCount);
      console.log('💾 検索済みchunk数:', totalChunks);
      console.log('🏆 Top20のスコア:');
      top20.forEach((item, i) => {
        const bonusInfo = item.matchType ? ` ${item.matchType}` : '';
        console.log(`  ${i + 1}. [${item.score}] ${item.law.law_title} ${item.article.title}${bonusInfo}`);
      });

      // 【第3段階】ClaudeにTop200を渡して最適な条文を選択・解説させる
      setProcessingStep('🤖 AIが条文を分析・解説中...');
      setProgress(70);
      
      console.log('======================');
      console.log('【第3段階】Claude統合分析開始');
      console.log('======================');
      
      // Top20の条文データを整形（スコア付き）
      let articleContext = '\n\n【候補条文データ（スコア順Top20）】\n';
      top20.forEach((item, index) => {
        const matchInfo = item.matchType ? ` ${item.matchType}` : '';
        articleContext += `\n${index + 1}. 【スコア: ${item.score}${matchInfo}】 ${item.law.law_title} ${item.article.title}`;
        if (item.article.caption) {
          articleContext += ` ${item.article.caption}`;
        }
        articleContext += `\n`;
        item.article.paragraphs.forEach(p => {
          p.sentences.forEach(s => {
            articleContext += `${p.num !== "1" ? p.num + " " : ""}${s.text}\n`;
          });
        });
        articleContext += '\n';
      });

      const combinedPrompt = `あなたは法令検索のアシスタントです。

【ユーザーの質問】
${query}

${articleContext}

【重要な選択基準】
- 候補条文は「スコア」の高い順に並んでいます
- 「🎯完全一致」マークがある条文は、ユーザーが指定した法令名・条文番号と完全に一致しています。**最優先で選んでください**
- 「📘法令名一致」マークがある条文は、ユーザーが指定した法令の条文です。優先的に選んでください
- スコア0.85以上の条文は関連性が高いため、優先して選んでください
- 上位10番以内の条文を優先してください
- 条文タイトルだけでなく、条文の内容全体を見て判断してください

【指示】
1. 上記の候補条文の中から、質問に最も関連する条文を1〜5個選んでください
2. 選んだ条文を引用しながら、質問にわかりやすく回答してください
3. 条文を引用する際は「【法令名 第X条】」の形式で明記してください
4. 実務的なアドバイスも含めてください
5. 特定の条文番号が質問で指定されている場合は、その条文を優先してください

【回答形式】
必ず以下のJSON形式で回答してください：

{
  "selected_indices": [1, 2, 3],
  "explanation": "ここに解説文を記載"
}

- selected_indices: 使用した条文の番号（候補リストの1〜200から選択）
- explanation: 質問への回答文（条文を引用した解説）

CRITICAL: 必ず有効なJSON形式で回答してください。マークダウンのコードブロック記号は含めないでください。
`;

      console.log('📤 Claudeにリクエスト送信...');
      setProgress(85);
      
      let claudeResponse;
      try {
        claudeResponse = await callClaude([
          { role: "user", content: combinedPrompt }
        ], 3000);
        console.log('📥 Claude応答完了');
        console.log('📝 Claude生応答:', claudeResponse.substring(0, 500));
      } catch (apiError) {
        console.error('❌ Claude API呼び出しエラー:', apiError);
        throw apiError;
      }

      // JSONをパース
      let responseData;
      let answer;
      let finalArticles;
      
      try {
        const cleanJson = claudeResponse
          .replace(/```json\n?/g, '')
          .replace(/```\n?/g, '')
          .trim();
        console.log('🔍 パース対象JSON:', cleanJson.substring(0, 300));
        responseData = JSON.parse(cleanJson);
        console.log('📊 selected_indices:', responseData.selected_indices);
        
        answer = responseData.explanation;
        
        // 選択された条文だけを抽出（Top200から選択）
        finalArticles = responseData.selected_indices
          .filter(idx => idx >= 1 && idx <= top20.length)
          .map(idx => top20[idx - 1]);
        
        console.log(`✅ ${finalArticles.length}個の条文を選択`);
        finalArticles.forEach((item, i) => {
          console.log(`  ${i + 1}. ${item.law.law_title} ${item.article.title}`);
        });
        
      } catch (parseError) {
        console.error('⚠️ JSON解析エラー、フォールバック処理');
        // パースエラー時は応答全体を解説文として使い、Top3を表示
        answer = claudeResponse;
        finalArticles = top20.slice(0, 3);
      }

      setConversations(prev => [...prev, {
        id: Date.now(),
        question: query,
        answer: answer,
        relevantArticles: finalArticles.map(item => ({
          article: item.article,
          lawData: item.law,
          similarity: item.similarity
        })),
        timestamp: new Date()
      }]);
      
      setQuery('');
      setProcessingStep('');
      setProgress(0);
      
    } catch (err) {
      console.error('検索エラー:', err);
      setError(`検索に失敗しました: ${err.message}`);
    } finally {
      setLoading(false);
      setProcessingStep('');
      setProgress(0);
    }
  };
  // ===== 初期化画面 =====
  if (modelLoading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="max-w-2xl w-full bg-white rounded-lg shadow-lg p-8">
          <div className="text-6xl mb-6 text-center">⚖️</div>
          <h1 className="text-3xl font-bold text-gray-900 mb-4 text-center">条文くん</h1>
          
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
            <div className="flex items-center justify-center mb-4">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
            <p className="text-blue-800 text-center text-sm">{modelStatus}</p>
            <p className="text-blue-600 text-center text-xs mt-2">
              初回のみモデルをダウンロードします。2回目以降はキャッシュから即座に起動します。
            </p>
          </div>
          
          {error && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-800 text-sm">{error}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ===== メインUI =====
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white shadow-sm">
          {/* ヘッダー */}
          <div className="border-b border-gray-200 px-6 py-4">
            <div className="flex justify-between items-center">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">条文くん</h1>
                <p className="text-sm text-gray-600 mt-1">
                  {lawsIndex ? `${lawsIndex.total_laws}法令・検索可能` : 'データ準備中'}
                </p>
              </div>
              
              <div className="flex gap-3">
                <button
                  onClick={() => setShowSettings(true)}
                  className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm transition-colors"
                >
                  ⚙️ 設定
                </button>
              </div>
            </div>
          </div>

          {/* メインエリア */}
          <div className="flex flex-col h-[calc(100vh-120px)]">
            {/* 会話エリア */}
            <div className="flex-1 overflow-y-auto p-6">
              {conversations.length === 0 && (
                <div className="text-center py-20">
                  <div className="text-4xl mb-4">⚖️</div>
                  <h2 className="text-xl font-semibold text-gray-700 mb-2">条文くん</h2>
                  <p className="text-gray-500 mb-6">法的な質問を入力してください</p>
                  <div className="text-sm text-gray-400 space-y-1">
                    <div>💡 例：「手付金を放棄して契約解除したい」</div>
                    <div>💡 例：「民法２３４条について教えて」</div>
                    <div>💡 例：「会社設立の必要書類は？」</div>
                  </div>
                </div>
              )}

              <div className="space-y-8">
                {conversations.map((conv) => (
                  <div key={conv.id} className="space-y-4">
                    {/* ユーザーの質問 */}
                    <div className="flex justify-end">
                      <div className="max-w-2xl">
                        <div className="flex items-start gap-3 justify-end">
                          <div className="bg-gradient-to-br from-blue-600 to-blue-700 text-white rounded-2xl px-5 py-3 shadow-md">
                            <p className="leading-relaxed">{conv.question}</p>
                            <p className="text-xs text-blue-100 mt-2 text-right">
                              {conv.timestamp.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                          <div className="flex-shrink-0 w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center text-gray-600 text-sm font-bold">
                            👤
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* AIの回答 */}
                    <div className="flex justify-start">
                      <div className="max-w-3xl">
                        <div className="flex items-start gap-3">
                          <div className="flex-shrink-0 w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white text-sm font-bold shadow-md">
                            AI
                          </div>
                          <div className="flex-grow bg-white rounded-2xl shadow-sm border border-gray-200 px-5 py-4">
                            <div className="prose prose-sm max-w-none">
                              {formatExplanation(conv.answer)}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 関連条文セクション */}
                    {conv.relevantArticles && conv.relevantArticles.length > 0 && (
                      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-5 border border-blue-200 shadow-sm">
                        <div className="flex items-center gap-2 mb-4">
                          <span className="text-lg">📋</span>
                          <span className="text-blue-700 font-bold text-base">参照条文</span>
                          <span className="text-xs text-blue-600 bg-blue-100 px-2 py-1 rounded-full">{conv.relevantArticles.length}件</span>
                        </div>
                        <div className="space-y-3">
                          {conv.relevantArticles.map((item, index) => (
                            <div key={`${item.lawData.law_id}-${item.article.number}-${index}`} 
                                 className="bg-white rounded-lg border-2 border-blue-100 hover:border-blue-300 transition-colors p-4">
                              <div className="flex items-start justify-between">
                                <div className="flex-grow">
                                  <div className="flex items-center gap-2 mb-2">
                                    <span className="text-xs bg-gradient-to-r from-blue-600 to-blue-700 text-white px-3 py-1 rounded-full font-semibold">
                                      {item.lawData.law_title}
                                    </span>
                                    <span className="font-bold text-gray-900 text-base">
                                      {item.article.title}
                                    </span>
                                  </div>
                                  {item.article.caption && (
                                    <p className="font-medium mb-3 bg-gray-50 px-3 py-1 rounded border-l-4 border-blue-400 text-gray-700">
                                      {item.article.caption}
                                    </p>
                                  )}
                                  
                                  {!expandedArticles.has(`${item.lawData.law_id}-${item.article.number}`) ? (
                                    <div className="leading-relaxed bg-gray-50 p-3 rounded text-gray-700 text-sm">
                                      {item.article.paragraphs.slice(0, 1).map((paragraph, pIndex) => (
                                        <div key={pIndex}>
                                          {paragraph.sentences.slice(0, 1).map((sentence, sIndex) => (
                                            <span key={sIndex}>{sentence.text}</span>
                                          ))}
                                          {paragraph.sentences.length > 1 && <span className="text-gray-400 ml-1">...</span>}
                                        </div>
                                      ))}
                                      {item.article.paragraphs.length > 1 && (
                                        <div className="text-gray-500 text-xs mt-2 italic">
                                          ＋他{item.article.paragraphs.length - 1}項
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <div className="leading-relaxed space-y-4 bg-gray-50 p-4 rounded border border-gray-200 text-gray-800 text-sm">
                                      {item.article.paragraphs.map((paragraph, pIndex) => {
                                        const hasItems = paragraph.items && paragraph.items.length > 0;
                                        let mainTextEndIndex = paragraph.sentences.length;
                                        if (hasItems) {
                                          for (let i = 0; i < paragraph.sentences.length; i++) {
                                            if (paragraph.sentences[i].text.includes('次に掲げる') ||
                                                paragraph.sentences[i].text.includes('次の各号') ||
                                                paragraph.sentences[i].text.includes('左の各号')) {
                                              mainTextEndIndex = Math.min(i + 2, paragraph.sentences.length);
                                              break;
                                            }
                                          }
                                        }
                                        
                                        return (
                                          <div key={pIndex}>
                                            {paragraph.num !== "1" && (
                                              <div className="font-bold text-blue-600 mb-2">{paragraph.num}</div>
                                            )}
                                            
                                            {hasItems ? (
                                              <div className="space-y-2 mb-3">
                                                {paragraph.sentences.slice(0, mainTextEndIndex).map((sentence, sIndex) => (
                                                  <div key={sIndex}>{sentence.text}</div>
                                                ))}
                                              </div>
                                            ) : (
                                              <div className="space-y-2 mb-3">
                                                {paragraph.sentences.map((sentence, sIndex) => (
                                                  <div key={sIndex}>{sentence.text}</div>
                                                ))}
                                              </div>
                                            )}
                                            
                                            {hasItems && (
                                              <div className="space-y-3 mt-4">
                                                {paragraph.items.map((subItem, itemIndex) => (
                                                  <div key={itemIndex} className="flex gap-3 ml-4 border-l-2 border-blue-300 pl-3 py-1">
                                                    <span className="font-bold text-blue-700 bg-blue-100 px-2 py-0.5 rounded min-w-[50px] text-center flex-shrink-0 h-fit">
                                                      {subItem.item_title}
                                                    </span>
                                                    <div className="flex-1">
                                                      {subItem.sentences.map((sentence, sIndex) => (
                                                        <span key={sIndex}>{sentence.text}</span>
                                                      ))}
                                                    </div>
                                                  </div>
                                                ))}
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                                
                                <button
                                  onClick={() => toggleArticleExpansion(item.lawData.law_id, item.article.number)}
                                  className="ml-4 px-3 py-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg text-sm font-medium transition-colors flex-shrink-0 border border-blue-200"
                                >
                                  {expandedArticles.has(`${item.lawData.law_id}-${item.article.number}`) ? '▲ 閉じる' : '▼ 全文'}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* 処理状況表示 */}
            {loading && processingStep && (
              <div className="border-t border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50 px-6 py-4">
                <div className="max-w-2xl mx-auto">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-700"></div>
                    <span className="text-sm font-medium text-blue-900">{processingStep}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
                    <div 
                      className="bg-gradient-to-r from-blue-500 to-blue-600 h-2.5 rounded-full transition-all duration-500 ease-out"
                      style={{ width: `${progress}%` }}
                    ></div>
                  </div>
                  <div className="text-xs text-blue-700 mt-1 text-right">{progress}%</div>
                </div>
              </div>
            )}

            {/* 入力エリア */}
            <div className="border-t border-gray-200 bg-white p-4">
              <div className="flex gap-3">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && !loading && handleSearch()}
                  placeholder="法的な質問を入力してください（例：手付金について、民法234条、会社設立に必要な書類）"
                  className="flex-1 px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  disabled={loading}
                />
                <button
                  onClick={handleSearch}
                  disabled={loading || !query.trim()}
                  className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {loading && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>}
                  {loading ? '検索中' : '送信'}
                </button>
              </div>
              {error && (
                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-red-700 text-sm">{error}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 設定モーダル */}
      {showSettings && <SettingsModal onClose={() => {
        setShowSettings(false);
        checkApiKey();
      }} />}
    </div>
  );
}

// ===== 設定モーダルコンポーネント =====
function SettingsModal({ onClose }) {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    const key = getApiKey();
    if (key) {
      setApiKey(key);
    }
  }, []);

  const handleSave = () => {
    if (!apiKey.trim()) {
      setMessage({ type: 'error', text: 'APIキーを入力してください' });
      return;
    }

    if (!apiKey.startsWith('sk-ant-')) {
      setMessage({ type: 'error', text: '無効なAPIキー形式です' });
      return;
    }

    saveApiKey(apiKey);
    setMessage({ type: 'success', text: 'APIキーを保存しました' });
    setTimeout(() => {
      onClose();
    }, 1500);
  };

  const handleDelete = () => {
    if (!confirm('APIキーを削除しますか？')) return;
    
    deleteApiKey();
    setApiKey('');
    setMessage({ type: 'success', text: 'APIキーを削除しました' });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-900">⚙️ 設定</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">✕</button>
        </div>

        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Claude APIキー</label>
            <div className="space-y-2">
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-ant-api03-..."
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <button
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-2.5 text-gray-500 hover:text-gray-700"
                >
                  {showKey ? '🙈' : '👁️'}
                </button>
              </div>
              <p className="text-xs text-gray-500">
                APIキーはlocalStorageに保存されます（ブラウザから確認可能）
              </p>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="font-semibold text-blue-900 mb-2">📘 APIキーの取得方法</h3>
            <ol className="text-sm text-blue-800 space-y-1 list-decimal list-inside">
              <li>
                <a href="https://console.anthropic.com/" target="_blank" rel="noopener noreferrer"
                   className="underline hover:text-blue-600">Anthropic Console</a> にアクセス
              </li>
              <li>「API Keys」→「Create Key」</li>
              <li>生成されたキーをコピーして上記に貼り付け</li>
            </ol>
          </div>

          {message && (
            <div className={`p-4 rounded-lg ${
              message.type === 'success' 
                ? 'bg-green-50 border border-green-200 text-green-800'
                : 'bg-red-50 border border-red-200 text-red-800'
            }`}>
              {message.text}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={handleSave}
              className="flex-1 py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              💾 保存
            </button>
            <button
              onClick={handleDelete}
              disabled={!apiKey}
              className="px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50"
            >
              🗑️ 削除
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
