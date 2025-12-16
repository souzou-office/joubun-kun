import React, { useState, useEffect, useRef } from 'react';
import logoA from '/logo_A.png';
import logoB from '/logo_B.png';

// Cloudflare Worker URL
const WORKER_URL = 'https://morning-surf-f117.ikeda-250.workers.dev';
// メモリキャッシュ廃止（OOM対策）

// ===== クエリ分類 & マルチクエリ生成 =====
// 挨拶/条文直接指定/法的質問を分類し、必要に応じて3種類のクエリを生成
const classifyAndGenerateQueries = async (originalQuery, conversationHistory = []) => {
  try {
    const response = await fetch(`${WORKER_URL}/api/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: originalQuery,
        conversationHistory: conversationHistory.slice(-2).map(conv => ({
          question: conv.question,
          answer: conv.answer.length > 200 ? conv.answer.substring(0, 200) + '...' : conv.answer
        }))
      })
    });

    if (!response.ok) {
      console.error('⚠️ クエリ分類APIエラー');
      return { type: 'legal', queries: [originalQuery] };
    }

    const parsed = await response.json();
    console.log(`📋 分類結果: ${parsed.type}`);
    if (parsed.type === 'legal') {
      console.log('🔄 生成クエリ:');
      console.log('  - original:', parsed.queries[0]);
      console.log('  - legal:', parsed.queries[1]);
      console.log('  - broad:', parsed.queries[2]);
    }
    return parsed;
  } catch (err) {
    console.error('⚠️ クエリ分類エラー:', err);
    return { type: 'legal', queries: [originalQuery] };
  }
};

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

// 主要法令名リスト → 廃止して正規表現で抽出

// クエリから法令名と条文番号を抽出（複数条文対応・枝番対応）
const extractLawAndArticle = (query) => {
  let lawName = null;
  let articleTitlesKanji = [];  // 「第三条の二」形式の配列

  // 全角数字を半角に変換
  const normalizedQuery = query.replace(/[０-９]/g, (s) =>
    String.fromCharCode(s.charCodeAt(0) - 0xFEE0)
  );

  // 法令名を正規表現で抽出（「〇〇法」「〇〇令」「〇〇規則」等）
  const lawMatch = normalizedQuery.match(/([\u4e00-\u9fff]+(?:法|令|規則|条例|規程|憲章))/);
  if (lawMatch) {
    lawName = lawMatch[1];
  }

  // 条文番号を抽出（アラビア数字・枝番対応）
  // 「3条の2」「42条の2」のようなパターンに対応
  const articleMatches = normalizedQuery.matchAll(/第?(\d+)条(?:の(\d+))?/g);
  for (const match of articleMatches) {
    let title = '第' + toKanjiNumber(parseInt(match[1], 10)) + '条';
    if (match[2]) {
      title += 'の' + toKanjiNumber(parseInt(match[2], 10));
    }
    if (!articleTitlesKanji.includes(title)) {
      articleTitlesKanji.push(title);
    }
  }

  // 漢数字での条文番号も対応（枝番対応）
  const kanjiMatches = normalizedQuery.matchAll(/第([一二三四五六七八九十百千]+)条(?:の([一二三四五六七八九十]+))?/g);
  for (const match of kanjiMatches) {
    let title = '第' + match[1] + '条';
    if (match[2]) {
      title += 'の' + match[2];
    }
    if (!articleTitlesKanji.includes(title)) {
      articleTitlesKanji.push(title);
    }
  }

  return { lawName, articleTitlesKanji };
};

// 条文タイトルから条文番号（漢数字）を抽出
const extractArticleNumberFromTitle = (title) => {
  if (!title) return null;
  const match = title.match(/第([一二三四五六七八九十百千]+)条/);
  return match ? match[1] : null;
};

// プロモード設定
const PRO_MODE_STORAGE = 'joubun_pro_mode';

const saveProMode = (enabled) => {
  localStorage.setItem(PRO_MODE_STORAGE, enabled ? 'true' : 'false');
};

const getProMode = () => {
  return localStorage.getItem(PRO_MODE_STORAGE) === 'true';
};

// トークン制限
const TOKEN_LIMIT = 200000;

// トークン数推定（日本語は1文字≒2-3トークン、英語は1単語≒1トークン）
const estimateTokens = (text) => {
  if (!text) return 0;
  const japaneseChars = (text.match(/[\u3000-\u9fff\uff00-\uffef]/g) || []).length;
  const otherChars = text.length - japaneseChars;
  return Math.ceil(japaneseChars * 2 + otherChars * 0.25);
};

// 会話履歴のトークン数を計算
const calculateConversationTokens = (conversations) => {
  let total = 0;
  for (const conv of conversations) {
    total += estimateTokens(conv.question);
    total += estimateTokens(conv.answer);
  }
  return total;
};

// AI解説テキストを見やすくフォーマット
const formatExplanation = (text, onArticleClick) => {
  let cleanText = text
    .replace(/^#{4,6}\s+/gm, '    ')
    .replace(/^###\s+/gm, '   ')
    .replace(/^##\s+/gm, '  ')
    .replace(/^#\s+/gm, ' ')
    .trim();

  const paragraphs = cleanText.split('\n').filter(p => p.trim());

  return paragraphs.map((paragraph, index) => {
    let content = paragraph;

    // 太字を強調（より目立つスタイル）
    content = content.replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-gray-900 bg-gray-100 px-1 rounded">$1</strong>');
    content = content.replace(/\*(.*?)\*/g, '<em class="italic text-gray-700">$1</em>');

    // 条文番号をクリッカブルなボタンに（data属性で条文情報を持たせる）
    // 【民法 第557条】や【民法第557条】両方対応
    content = content.replace(
      /【([^】第]+?)\s*(第[一二三四五六七八九十百千0-9]+条[^】]*)】/g,
      '<button class="article-link inline-block font-bold text-blue-700 bg-blue-100 px-3 py-1 rounded-lg border-2 border-blue-300 mx-1 shadow-sm hover:bg-blue-200 hover:border-blue-400 cursor-pointer transition-colors" data-law="$1" data-article="$2">【$1$2】</button>'
    );

    // 重要キーワードを強調（より多くのキーワード対応）
    content = content.replace(
      /(?:^|\s)(手付|解除|履行の着手|契約|債務|債権|損害賠償|設立|株式|株主|登記|届出|届け出|申請|要件|効果|原則|例外|注意点|できる|できない|できません|してはならない|しなければならない|必要|可能|不可|禁止|違反|義務|権利|責任|期限|期間)(?=\s|$|、|。|は|が|を|に|です)/g,
      ' <span class="font-bold text-gray-900 bg-yellow-100 px-1 py-0.5 rounded border-b-2 border-yellow-400">$1</span>'
    );
    
    // 番号付きリスト
    const isNumberedList = /^(\d+)[\.\)]\s(.+)/.exec(paragraph);
    const isBulletList = /^[・•]\s/.test(paragraph);
    
    if (isNumberedList) {
      const number = isNumberedList[1];
      const text = isNumberedList[2];
      return (
        <div key={index} className="flex items-start gap-3 mb-4 ml-2">
          <span className="flex-shrink-0 w-7 h-7 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold">{number}</span>
          <p className="text-gray-800 leading-7 flex-1 pt-0.5 text-base" dangerouslySetInnerHTML={{ __html: text }} />
        </div>
      );
    }
    
    if (isBulletList) {
      return (
        <div key={index} className="flex items-start gap-3 mb-3 ml-4">
          <span className="text-blue-600 font-bold">•</span>
          <p className="text-gray-800 leading-7 flex-1 text-base" dangerouslySetInnerHTML={{ __html: content.replace(/^[・•]\s/, '') }} />
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
        <p key={index} className="text-gray-800 leading-7 mb-4 mt-4 pl-3 border-l-2 border-blue-400 bg-blue-50 py-2 pr-2 text-base" dangerouslySetInnerHTML={{ __html: content }} />
      );
    }
    
    // 重要な結論・制約
    const isImportantConclusion =
      /^(したがって|よって|つまり|結論として|以上より|重要|注意)、?/.test(paragraph) ||
      /(できません|禁止|してはならない|必ず|不可|違反)/.test(paragraph) ||
      paragraph.includes('履行の着手');

    if (isImportantConclusion) {
      // 黄色カード内では条文リンクを黄色系に変更
      const yellowContent = content
        .replace(/text-blue-700/g, 'text-amber-800')
        .replace(/bg-blue-100/g, 'bg-amber-100')
        .replace(/border-blue-300/g, 'border-amber-400')
        .replace(/hover:bg-blue-200/g, 'hover:bg-amber-200')
        .replace(/hover:border-blue-400/g, 'hover:border-amber-500');
      return (
        <div key={index} className="bg-yellow-50 border-2 border-yellow-400 rounded-lg p-5 my-5">
          <div className="flex items-start gap-3">
            <span className="text-2xl">⚠️</span>
            <p className="text-gray-900 leading-7 font-semibold text-base flex-1" dangerouslySetInnerHTML={{ __html: yellowContent }} />
          </div>
        </div>
      );
    }
    
    // 通常の段落
    return (
      <p key={index} className="text-gray-800 leading-7 mb-4 text-base" dangerouslySetInnerHTML={{ __html: content }} />
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
  const [showSettings, setShowSettings] = useState(false);
  const [tokenCount, setTokenCount] = useState(0);
  const [isTokenLimitReached, setIsTokenLimitReached] = useState(false);
  const [proMode, setProMode] = useState(false);

  // 最新の会話へのスクロール用ref
  const latestConversationRef = useRef(null);

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
    checkProMode();
    initialize();
  }, []);

  // ===== 新しい会話が追加されたらスクロール =====
  useEffect(() => {
    if (latestConversationRef.current && conversations.length > 0) {
      latestConversationRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [conversations]);

  // ===== 条文リンクのクリックイベント（ネイティブイベントリスナー）=====
  useEffect(() => {
    const handleArticleLinkClick = (e) => {
      const target = e.target.closest('.article-link');
      if (!target) return;

      e.preventDefault();
      e.stopPropagation();

      const lawName = target.dataset.law;
      const articleNum = target.dataset.article;
      console.log('🔗 条文クリック:', lawName, articleNum);

      // 該当する会話のIDを取得（親要素から探す）
      const conversationDiv = target.closest('[data-explanation-conv-id]');
      const convId = conversationDiv?.dataset.explanationConvId;
      console.log('会話ID:', convId);

      // 右側の条文エリアで該当条文を探す
      const selector = convId
        ? `[data-conv-id="${convId}"] .article-card`
        : '.article-card';
      const articleElements = document.querySelectorAll(selector);
      console.log('条文カード数:', articleElements.length);

      // articleNumから条文番号を抽出（「第209条の2」→「209」「の2」または「十九」「の二」）
      // 枝番号（の二、の三など）も含めて抽出
      const articleMatchResult = articleNum.match(/第([一二三四五六七八九十百千0-9]+)条(の[一二三四五六七八九十0-9]+)?/);
      const articleNumber = articleMatchResult ? articleMatchResult[1] : articleNum;
      const articleSuffix = articleMatchResult ? (articleMatchResult[2] || '') : '';

      // アラビア数字→漢数字変換（カード内は漢数字で表記されている）
      let articleNumberKanji = articleNumber;
      if (/^[0-9]+$/.test(articleNumber)) {
        articleNumberKanji = toKanjiNumber(parseInt(articleNumber, 10));
      }

      // 枝番号もアラビア数字→漢数字変換
      let articleSuffixKanji = articleSuffix;
      const suffixMatch = articleSuffix.match(/の([0-9]+)/);
      if (suffixMatch) {
        articleSuffixKanji = 'の' + toKanjiNumber(parseInt(suffixMatch[1], 10));
      }

      const fullArticlePattern = `第${articleNumberKanji}条${articleSuffixKanji}`;
      console.log('抽出した条文番号:', articleNumber + articleSuffix, '→ 検索パターン:', fullArticlePattern);

      let found = false;
      for (const el of articleElements) {
        const text = el.textContent;

        // 法令名チェック
        const lawMatched = text.includes(lawName);
        // 条文番号チェック（漢数字で検索、枝番号含む）
        const articleMatched = text.includes(fullArticlePattern);

        if (lawMatched && articleMatched) {
          console.log('✅ マッチ！スクロールします');
          found = true;

          // 親のスクロールコンテナを取得
          const scrollContainer = el.closest('.overflow-y-auto');
          if (scrollContainer) {
            // コンテナ内でのスクロール位置を計算（上部に少し余白を持たせる）
            const containerRect = scrollContainer.getBoundingClientRect();
            const elementRect = el.getBoundingClientRect();
            const offsetTop = elementRect.top - containerRect.top + scrollContainer.scrollTop;
            const topPadding = 10; // 上部に10pxの余白

            scrollContainer.scrollTo({
              top: offsetTop - topPadding,
              behavior: 'smooth'
            });
          } else {
            // フォールバック
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }

          el.classList.add('ring-4', 'ring-yellow-400');
          setTimeout(() => el.classList.remove('ring-4', 'ring-yellow-400'), 2000);
          break; // 最初のマッチで終了
        }
      }

      if (!found) {
        console.log('❌ マッチする条文が見つかりませんでした');
        console.log('検索条件: 法令名=' + lawName + ', 条文番号=' + fullArticlePattern);
      }
    };

    // ドキュメント全体にイベントリスナーを追加
    document.addEventListener('click', handleArticleLinkClick);

    return () => {
      document.removeEventListener('click', handleArticleLinkClick);
    };
  }, []);

  // ===== トークン数を監視 =====
  useEffect(() => {
    const tokens = calculateConversationTokens(conversations);
    setTokenCount(tokens);
    if (tokens >= TOKEN_LIMIT) {
      setIsTokenLimitReached(true);
    }
  }, [conversations]);

  const checkProMode = () => {
    setProMode(getProMode());
  };

  const initialize = async () => {
    // Worker側で検索するので、ブラウザ側での初期化は不要
    setModelLoading(false);
    setModelStatus('✅ 準備完了！');
  };

  // ===== Claude API呼び出し（Worker経由）=====
  const callClaude = async (messages, system = '', maxTokens = 2000) => {
    const response = await fetch(`${WORKER_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, system })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Claude API error: ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error);
    }
    if (!data.content || !data.content[0]) {
      console.error('❌ 予期しないAPIレスポンス:', data);
      throw new Error('APIからの応答が不正です');
    }
    return data.content[0].text;
  };

  // ===== 検索処理 =====
  const handleSearch = async (searchQuery = null) => {
    const actualQuery = (typeof searchQuery === 'string') ? searchQuery : query;

    if (!actualQuery.trim() || modelLoading) return;

    setLoading(true);
    setError(null);

    try {
      console.log('=== 🔍 検索開始 ===');
      console.log('📝 元クエリ:', actualQuery);

      // 【第1段階】クエリ分類 & マルチクエリ生成
      setProcessingStep('🧬 質問文を分析中...');
      setProgress(10);

      const queryResult = await classifyAndGenerateQueries(actualQuery, conversations);
      console.log('📋 クエリ分類結果:', queryResult.type);

      // 挨拶の場合は検索スキップ
      if (queryResult.type === 'greeting') {
        console.log('👋 挨拶検出 - 検索スキップ');
        const greetingResponse = queryResult.greeting_response || 'こんにちは！法令に関する質問があればお気軽にどうぞ。';
        setConversations(prev => [...prev, {
          id: Date.now(),
          question: actualQuery,
          answer: greetingResponse,
          relevantArticles: [],
          timestamp: new Date()
        }]);
        setQuery('');
        setLoading(false);
        return;
      }

      // 【第2段階】Worker側でマルチクエリ検索実行（RRFランキング）
      setProcessingStep('📦 法令データを検索中...');
      setProgress(30);

      // directの場合、クエリを漢数字形式に正規化（ベクトル検索の精度向上）
      let searchQueries = queryResult.queries;
      if (queryResult.type === 'direct') {
        const extracted = extractLawAndArticle(actualQuery);
        if (extracted.lawName && extracted.articleTitlesKanji.length > 0) {
          // 「民法3条の2」→「民法 第三条の二」に変換
          const normalizedQuery = `${extracted.lawName} ${extracted.articleTitlesKanji[0]}`;
          searchQueries = [normalizedQuery];
          console.log('📝 正規化クエリ:', normalizedQuery);
        }
      }

      const searchResponse = await fetch(`${WORKER_URL}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queries: searchQueries,  // マルチクエリ配列を送信
          originalQuery: actualQuery,    // 元のクエリも送信（条番号抽出用）
          topN: 20
        })
      });

      if (!searchResponse.ok) {
        throw new Error('検索に失敗しました');
      }

      const searchData = await searchResponse.json();
      const top20 = searchData.results;
      console.log('✅ 検索完了:', top20.length, '件 (RRFランキング)');

      setProgress(70);

      console.log('🏆 Top20のスコア:');
      top20.forEach((item, i) => {
        console.log(`  ${i + 1}. [${item.score.toFixed(4)}] ${item.law.law_title} ${item.article.title} | paragraphs: ${item.article.paragraphs?.length || 0}`);
      });
      // デバッグ: 1件目の詳細
      if (top20.length > 0) {
        console.log('📝 1件目の条文詳細:', JSON.stringify(top20[0].article).substring(0, 300));
      }

      // 【第3段階】ClaudeにTop200を渡して最適な条文を選択・解説させる
      setProcessingStep('🤖 AIが条文を分析・解説中...');
      setProgress(70);
      
      console.log('======================');
      console.log('【第3段階】Claude統合分析開始');
      console.log('======================');
      
      // Top20の条文データを整形（スコア付き）
      let articleContext = '\n\n【候補条文データ（スコア順Top20）】\n';
      top20.forEach((item, index) => {
        articleContext += `\n${index + 1}. 【スコア: ${item.score}】 ${item.law.law_title} ${item.article.title}`;
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

      // 簡潔モードと通常モードでプロンプトを分岐
      const instructionText = proMode
        ? `【指示（簡潔回答）】
- 関連条文を列挙し、各条文の関連性を簡潔に記載
- 条文内容の説明は不要
- 「【法令名 第X条】：関連性」の形式で`
        : `【指示】
- まず結論を述べる
- 関連条文を「【法令名 第X条】」形式で引用しつつ、平易な言葉で説明
- 法律用語は必要に応じて補足
- 注意点や例外があれば明記`;

      const combinedPrompt = `あなたは法令検索のアシスタントです。

【ユーザーの質問】
${actualQuery}

${articleContext}

【重要な選択基準】
- 候補条文は「スコア」の高い順に並んでいます
- スコアが高い条文は関連性が高いため、優先して選んでください
- 上位10番以内の条文を優先してください
- 条文タイトルだけでなく、条文の内容全体を見て判断してください

【絶対厳守】
- 回答には**上記の候補条文リスト（1〜20）に含まれる条文のみ**を使用してください
- 候補リストにない条文は、たとえ関連がありそうでも**絶対に言及しないでください**
- あなたの知識にある条文でも、候補リストにないものは使用禁止です

${instructionText}

【回答形式】
必ず以下のJSON形式で回答してください：

{
  "selected_indices": [1, 2, 3],
  "explanation": "ここに解説文を記載"
}

- selected_indices: 使用した条文の番号（候補リストの1〜20から選択、見つからない場合は空配列[]）
- explanation: 質問への回答文。見つからない場合は「お探しの内容に直接該当する条文は見つかりませんでした。」と記載

CRITICAL: 必ず有効なJSON形式で回答してください。マークダウンのコードブロック記号は含めないでください。
`;

      console.log('📤 Claudeにリクエスト送信...');
      setProgress(85);
      
      // 過去の会話履歴を構築
      const messages = [];
      conversations.forEach(conv => {
        messages.push({ role: "user", content: conv.question });
        messages.push({ role: "assistant", content: conv.answer });
      });
      // 今回の質問を追加
      messages.push({ role: "user", content: combinedPrompt });
      
      console.log(`📚 会話履歴: ${conversations.length}件の過去の会話を含む`);
      
      let claudeResponse;
      try {
        claudeResponse = await callClaude(messages, 3000);
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
          console.log(`  ${i + 1}. ${item.law.law_title} ${item.article.title} | paragraphs: ${item.article.paragraphs?.length || 0}`);
          if (item.article.paragraphs?.length > 0) {
            console.log(`      内容: ${item.article.paragraphs[0].sentences?.[0]?.text?.substring(0, 30)}...`);
          }
        });
        
      } catch (parseError) {
        console.error('⚠️ JSON解析エラー、フォールバック処理');
        answer = claudeResponse;
        finalArticles = top20.slice(0, 3);
      }

      setConversations(prev => [...prev, {
        id: Date.now(),
        question: actualQuery,
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
          <img src={logoB} alt="条文くん" className="h-24 mx-auto mb-6" />
          <p className="text-gray-600 text-center mb-4">8,236法令・検索可能</p>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
            <div className="flex items-center justify-center mb-4">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
            <p className="text-blue-800 text-center text-sm">{modelStatus}</p>
            <p className="text-blue-600 text-center text-xs mt-2">
              法令データを読み込んでいます...
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
      <div className="w-full px-4 lg:px-8">
        <div className="bg-white shadow-sm">
          {/* ヘッダー */}
          <div className="border-b border-gray-200 px-4 py-1">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <img src={logoA} alt="条文くん" className="h-14" />
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
                  <img src={logoB} alt="条文くん" className="h-32 mx-auto mb-4" />
                  <p className="text-gray-500 mb-6">法的な質問を入力してください</p>
                  <div className="text-sm text-gray-400 space-y-1">
                    <div>💡 例：「手付金を放棄して契約解除できる？」</div>
                    <div>💡 例：「株式会社の設立に必要な書類は？」</div>
                    <div>💡 例：「民法の境界線についての規定を教えて」</div>
                  </div>

                  {/* 簡潔回答モード切替 */}
                  <div className="mt-8 flex items-center justify-center gap-3">
                    <span className={`text-sm ${proMode ? 'text-gray-400' : 'text-gray-700 font-medium'}`}>
                      通常回答
                    </span>
                    <button
                      onClick={() => {
                        const newMode = !proMode;
                        setProMode(newMode);
                        saveProMode(newMode);
                      }}
                      disabled={loading}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                      } ${proMode ? 'bg-blue-600' : 'bg-gray-300'}`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          proMode ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                    <span className={`text-sm ${proMode ? 'text-blue-700 font-medium' : 'text-gray-400'}`}>
                      簡潔回答
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-2">
                    簡潔回答：条文の詳細解説を省略し、関連性のみ表示
                  </p>
                </div>
              )}

              <div className="space-y-8">
                {conversations.map((conv, index) => (
                  <div 
                    key={conv.id} 
                    className="space-y-4"
                    ref={index === conversations.length - 1 ? latestConversationRef : null}
                  >
                    {/* ユーザーの質問 */}
                    <div className="flex justify-end">
                      <div className="max-w-2xl">
                        <div className="flex items-start gap-3 justify-end">
                          <div className="bg-gradient-to-br from-blue-600 to-blue-700 text-white rounded-2xl px-5 py-3 shadow-md">
                            <p className="leading-relaxed">{conv.question}</p>
                            <p className="text-xs text-blue-100 mt-2 text-right">
                              {conv.timestamp?.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) || ''}
                            </p>
                          </div>
                          <div className="flex-shrink-0 w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center text-gray-600 text-sm font-bold">
                            👤
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* AIの回答と条文を左右分割（PCのみ） */}
                    <div className="flex flex-col lg:flex-row gap-4">
                      {/* 左側: AI解説 */}
                      <div className="lg:w-1/2">
                        <div className="flex items-start gap-3">
                          <div className="flex-shrink-0 w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white text-sm font-bold shadow-md">
                            AI
                          </div>
                          <div
                            className="flex-grow bg-white rounded-2xl shadow-sm border border-gray-200 px-6 py-5"
                            data-explanation-conv-id={conv.id}
                          >
                            <div className="prose prose-base max-w-none">
                              {formatExplanation(conv.answer)}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 右側: 関連条文（sticky + 独立スクロール） */}
                      <div className="lg:w-1/2 lg:self-start lg:sticky lg:top-4" data-conv-id={conv.id}>
                        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-200 shadow-sm">
                          <div className="flex items-center gap-2 mb-4">
                            <span className="text-lg">📋</span>
                            <span className="text-blue-700 font-bold text-base">参照条文</span>
                            {conv.relevantArticles && conv.relevantArticles.length > 0 && (
                              <span className="text-xs text-blue-600 bg-blue-100 px-2 py-1 rounded-full">{conv.relevantArticles.length}件</span>
                            )}
                          </div>
                          {(!conv.relevantArticles || conv.relevantArticles.length === 0) ? (
                            <div className="text-gray-500 text-sm py-4 text-center">該当なし</div>
                          ) : (
                            <div className="space-y-3 max-h-[calc(100vh-180px)] overflow-y-auto">
                              {conv.relevantArticles.map((item, index) => (
                                <div key={`${item.lawData.law_id}-${item.article.number}-${index}`}
                                     className="article-card bg-white rounded-lg border-2 border-blue-100 hover:border-blue-300 transition-all p-4">
                                  <div className="flex items-start justify-between">
                                    <div className="flex-grow">
                                      <div className="flex flex-wrap items-center gap-2 mb-2">
                                        <span className="text-xs bg-gradient-to-r from-blue-600 to-blue-700 text-white px-3 py-1 rounded-full font-semibold">
                                          {item.lawData.law_title}
                                        </span>
                                        <span className="font-bold text-gray-900 text-sm">
                                          {item.article.title}
                                        </span>
                                      </div>
                                      {item.article.caption && (
                                        <p className="font-medium mb-2 bg-gray-50 px-2 py-1 rounded border-l-4 border-blue-400 text-gray-700 text-sm">
                                          {item.article.caption}
                                        </p>
                                      )}

                                      {!expandedArticles.has(`${item.lawData.law_id}-${item.article.title}`) ? (
                                        <div className="leading-6 bg-gray-50 p-3 rounded text-gray-700 text-sm">
                                          {(item.article.paragraphs || []).length === 0 ? (
                                            <div className="text-gray-400 italic">条文内容を取得中...</div>
                                          ) : (
                                            <>
                                              {item.article.paragraphs.slice(0, 1).map((paragraph, pIndex) => (
                                                <div key={pIndex}>
                                                  {(paragraph.sentences || []).slice(0, 1).map((sentence, sIndex) => (
                                                    <span key={sIndex}>{sentence.text}</span>
                                                  ))}
                                                  {(paragraph.sentences || []).length > 1 && <span className="text-gray-400 ml-1">...</span>}
                                                </div>
                                              ))}
                                              {item.article.paragraphs.length > 1 && (
                                                <div className="text-gray-500 text-xs mt-2 italic">
                                                  ＋他{item.article.paragraphs.length - 1}項
                                                </div>
                                              )}
                                            </>
                                          )}
                                        </div>
                                      ) : (
                                        <div className="leading-6 space-y-3 bg-gray-50 p-4 rounded border border-gray-200 text-gray-800 text-sm">
                                          {(item.article.paragraphs || []).map((paragraph, pIndex) => {
                                            const hasItems = paragraph.items && paragraph.items.length > 0;

                                            // itemsがある場合、sentencesからitemsと重複する内容を除外
                                            let displaySentences = paragraph.sentences;
                                            if (hasItems) {
                                              // itemsの最初のテキストを取得
                                              const itemTexts = new Set(
                                                paragraph.items.flatMap(it => it.sentences.map(s => s.text))
                                              );
                                              // sentencesからitemsと重複しないものだけを抽出
                                              displaySentences = paragraph.sentences.filter(s => !itemTexts.has(s.text));
                                            }

                                            return (
                                              <div key={pIndex}>
                                                {paragraph.num !== "1" && (
                                                  <div className="font-bold text-blue-600 mb-1">{paragraph.num}</div>
                                                )}

                                                {displaySentences.length > 0 && (
                                                  <div className="space-y-1 mb-2">
                                                    {displaySentences.map((sentence, sIndex) => (
                                                      <div key={sIndex}>{sentence.text}</div>
                                                    ))}
                                                  </div>
                                                )}

                                                {hasItems && (
                                                  <div className="space-y-2 mt-3">
                                                    {paragraph.items.map((subItem, itemIndex) => (
                                                      <div key={itemIndex} className="flex gap-2 ml-3 border-l-2 border-blue-300 pl-2 py-0.5">
                                                        <span className="font-bold text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded min-w-[40px] text-center flex-shrink-0 h-fit text-xs">
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
                                      onClick={() => toggleArticleExpansion(item.lawData.law_id, item.article.title)}
                                      className="ml-2 px-2 py-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded text-xs font-medium transition-colors flex-shrink-0 border border-blue-200"
                                    >
                                      {expandedArticles.has(`${item.lawData.law_id}-${item.article.title}`) ? '▲' : '▼'}
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
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
              {isTokenLimitReached ? (
                <div className="bg-amber-50 border border-amber-300 rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">⚠️</span>
                      <div>
                        <p className="font-semibold text-amber-800">会話の上限に達しました</p>
                        <p className="text-sm text-amber-700">新しい会話を始めてください（約{Math.round(tokenCount / 1000)}Kトークン使用）</p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setConversations([]);
                        setTokenCount(0);
                        setIsTokenLimitReached(false);
                      }}
                      className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 font-medium"
                    >
                      🔄 新しい会話を開始
                    </button>
                  </div>
                </div>
              ) : (
                <>
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
                  {conversations.length > 0 && (
                    <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
                      <span>使用トークン: 約{Math.round(tokenCount / 1000)}K / 200K</span>
                      <button
                        onClick={() => {
                          if (confirm('会話履歴をクリアしますか？')) {
                            setConversations([]);
                            setTokenCount(0);
                          }
                        }}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        会話をクリア
                      </button>
                    </div>
                  )}
                </>
              )}
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
      {showSettings && <SettingsModal
        onClose={() => {
          setShowSettings(false);
          checkProMode();
        }}
        proMode={proMode}
        setProMode={setProMode}
      />}
    </div>
  );
}

// ===== 設定モーダルコンポーネント =====
function SettingsModal({ onClose, proMode, setProMode }) {
  const [localProMode, setLocalProMode] = useState(proMode);
  const [message, setMessage] = useState(null);

  const handleSave = () => {
    saveProMode(localProMode);
    setProMode(localProMode);
    setMessage({ type: 'success', text: '設定を保存しました' });
    setTimeout(() => {
      onClose();
    }, 1000);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-900">⚙️ 設定</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">✕</button>
        </div>

        <div className="space-y-6">
          {/* 簡潔回答モード設定 */}
          <div>
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-sm font-medium text-gray-700">簡潔回答モード</label>
                <p className="text-xs text-gray-500 mt-1">
                  条文の詳細解説を省略し、関連性のみ表示
                </p>
              </div>
              <button
                onClick={() => setLocalProMode(!localProMode)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  localProMode ? 'bg-blue-600' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    localProMode ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
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

          <button
            onClick={handleSave}
            className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            💾 保存
          </button>
        </div>
      </div>
    </div>
  );
}
