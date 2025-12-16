// Cloudflare Workers - 法令検索API（Vectorize版 + R2バインディング）
// https://morning-surf-f117.ikeda-250.workers.dev/

const EXACT_MATCH_BONUS = 2.0;
const LAW_NAME_MATCH_BONUS = 0.15;

// 主要法令名→法令IDマッピング（ベクトル検索で見つからない場合のフォールバック用）
const COMMON_LAW_IDS = {
  '民法': '129AC0000000089',
  '刑法': '140AC0000000045',
  '憲法': '321CONSTITUTION',
  '日本国憲法': '321CONSTITUTION',
  '商法': '132AC0000000048',
  '民事訴訟法': '408AC0000000109',
  '刑事訴訟法': '323AC0000000131',
  '会社法': '417AC0000000086',
  '行政事件訴訟法': '337AC0000000139',
  '行政手続法': '405AC0000000088',
  '国家賠償法': '322AC0000000125',
  '著作権法': '345AC0000000048',
  '特許法': '334AC0000000121',
  '労働基準法': '322AC0000000049',
  '労働契約法': '419AC0000000128',
  '借地借家法': '403AC0000000090',
  '不動産登記法': '416AC0000000123',
  '破産法': '416AC0000000075',
  '民事再生法': '411AC0000000225',
  '金融商品取引法': '323AC0000000025',
  '独占禁止法': '322AC0000000054',
  '私的独占の禁止及び公正取引の確保に関する法律': '322AC0000000054',
  '消費者契約法': '412AC0000000061',
  '個人情報保護法': '415AC0000000057',
  '個人情報の保護に関する法律': '415AC0000000057',
};

// 単一の法令+条文を抽出（後方互換用）
function extractLawInfo(query) {
  const result = { lawName: null, articleNum: null };
  const lawPatterns = [/^(.+?法)/, /(.+?法)(?:第|の)/];
  for (const pattern of lawPatterns) {
    const match = query.match(pattern);
    if (match) { result.lawName = match[1]; break; }
  }
  const articleMatch = query.match(/(\d+)条/) || query.match(/第(.+?)条/);
  if (articleMatch) {
    const numStr = articleMatch[1];
    result.articleNum = /^\d+$/.test(numStr) ? parseInt(numStr, 10) : kanjiToNumber(numStr);
  }
  return result;
}

// 全角数字を半角に変換
function normalizeNumbers(str) {
  return str.replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
}

// 複数の法令+条文を抽出（「著作権法121条と民法323条」「民法42条の2」のようなクエリ対応）
function extractMultipleLawInfos(query) {
  const results = [];
  // 全角数字を半角に正規化
  const normalizedQuery = normalizeNumbers(query);
  // 「〇〇法XXX条」または「〇〇法XXX条のY」のパターンを全て抽出
  // 枝番（の二、の2）にも対応
  const pattern = /([\u4e00-\u9fff]+(?:法|令|規則|条例))[\s]*(?:第)?(\d+|[一二三四五六七八九十百千]+)条(?:の(\d+|[一二三四五六七八九十]+))?/g;
  let match;
  while ((match = pattern.exec(normalizedQuery)) !== null) {
    const lawName = match[1];
    const numStr = match[2];
    const articleNum = /^\d+$/.test(numStr) ? parseInt(numStr, 10) : kanjiToNumber(numStr);
    const subNum = match[3] ? (/^\d+$/.test(match[3]) ? parseInt(match[3], 10) : kanjiToNumber(match[3])) : null;
    results.push({ lawName, articleNum, subNum });
  }
  return results;
}

function kanjiToNumber(str) {
  const kanjiNums = { '〇': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  let result = 0, temp = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === '千') { temp = (temp || 1) * 1000; result += temp; temp = 0; }
    else if (char === '百') { temp = (temp || 1) * 100; result += temp; temp = 0; }
    else if (char === '十') { temp = (temp || 1) * 10; result += temp; temp = 0; }
    else if (kanjiNums[char] !== undefined) { temp = temp * 10 + kanjiNums[char]; }
  }
  return result + temp;
}

function numberToKanji(num) {
  if (num === 0) return '〇';
  const kanjiDigits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const units = ['', '十', '百', '千'];
  let result = '', n = num, position = 0;
  while (n > 0) {
    const digit = n % 10;
    if (digit !== 0) {
      if (position === 0) result = kanjiDigits[digit];
      else if (digit === 1) result = units[position] + result;
      else result = kanjiDigits[digit] + units[position] + result;
    }
    n = Math.floor(n / 10);
    position++;
  }
  return result;
}

export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    if (url.pathname === '/search') {
      try {
        const { query, queries, originalQuery, topN = 20 } = await request.json();

        // queries配列があればマルチクエリモード、なければ従来モード
        const searchQueries = queries || (query ? [query] : []);
        if (searchQueries.length === 0) {
          return new Response(JSON.stringify({ error: 'クエリが必要です' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // 複数の法令+条文を抽出
        const multipleLawInfos = extractMultipleLawInfos(originalQuery || searchQueries[0]);
        // 後方互換用に最初の1つも保持
        const lawInfo = multipleLawInfos.length > 0 ? multipleLawInfos[0] : extractLawInfo(originalQuery || searchQueries[0]);
        const expectedArticleTitle = lawInfo.articleNum ? '第' + numberToKanji(lawInfo.articleNum) + '条' : null;

        // 各クエリで並列検索
        const searchPromises = searchQueries.map(async (q) => {
          const embeddingResult = await env.AI.run('@cf/baai/bge-m3', { text: [q] });
          const queryVector = embeddingResult.data[0];
          return env.VECTORIZE.query(queryVector, { topK: 50, returnMetadata: 'all' });
        });
        const allResults = await Promise.all(searchPromises);

        // RRF (Reciprocal Rank Fusion) でランキング統合
        const rrfScores = new Map();
        const metadataCache = new Map();
        const K = 60; // RRF parameter

        allResults.forEach((result, queryIndex) => {
          result.matches.forEach((match, rank) => {
            const key = match.metadata.law_id + '_' + match.metadata.article_title;
            const rrfScore = 1 / (K + rank + 1);
            const existing = rrfScores.get(key) || 0;
            rrfScores.set(key, existing + rrfScore);
            if (!metadataCache.has(key)) {
              metadataCache.set(key, match.metadata);
            }
          });
        });

        // 条文タイトルを生成するヘルパー関数（枝番対応）
        const buildArticleTitle = (info) => {
          let title = '第' + numberToKanji(info.articleNum) + '条';
          if (info.subNum) {
            title += 'の' + numberToKanji(info.subNum);
          }
          return title;
        };

        // 複数条文直接指定の場合：検索結果に該当条文がなければ強制追加
        // （ベクトル検索では「第三百二十三条」のような条文番号はマッチしにくいため）
        for (const info of multipleLawInfos) {
          if (!info.articleNum || !info.lawName) continue;
          const artTitle = buildArticleTitle(info);

          // 検索結果に目的の条文があるかチェック
          let found = false;
          let foundLawId = null;
          for (const [key] of rrfScores.entries()) {
            const meta = metadataCache.get(key);
            if (meta && meta.law_title && meta.law_title.includes(info.lawName)) {
              // この法令の法令IDを保存（後で使う可能性あり）
              if (!foundLawId) foundLawId = meta.law_id;
              if (meta.article_title === artTitle) {
                found = true;
                break;
              }
            }
          }

          // 検索結果からIDが見つからなければCOMMON_LAW_IDSを参照
          if (!foundLawId && COMMON_LAW_IDS[info.lawName]) {
            foundLawId = COMMON_LAW_IDS[info.lawName];
          }

          // 見つからなければダミーで追加（後でR2から取得される）
          if (!found && foundLawId) {
            const key = foundLawId + '_' + artTitle;
            metadataCache.set(key, {
              law_id: foundLawId,
              law_title: info.lawName,
              article_title: artTitle
            });
            rrfScores.set(key, 1 / (K + 1)); // 最高ランクとして追加
          }
        }

        // ボーナス適用（複数条文対応・枝番対応）
        const scoreMap = new Map();
        for (const [key, rrfScore] of rrfScores.entries()) {
          const metadata = metadataCache.get(key);
          let bonus = 0, matchType = null;

          // 複数の指定条文それぞれに対してチェック
          for (const info of multipleLawInfos) {
            if (!info.lawName) continue;
            const artTitle = info.articleNum ? buildArticleTitle(info) : null;

            if (metadata.law_title && metadata.law_title.includes(info.lawName)) {
              if (artTitle && metadata.article_title === artTitle) {
                bonus = EXACT_MATCH_BONUS;
                matchType = '🎯完全一致';
                break; // 完全一致が見つかったら終了
              } else if (bonus < LAW_NAME_MATCH_BONUS) {
                bonus = LAW_NAME_MATCH_BONUS;
                matchType = '📘法令名一致';
              }
            }
          }

          const finalScore = rrfScore + bonus;
          scoreMap.set(key, { metadata, similarity: rrfScore, score: finalScore, matchType, sources: ['RRF'] });
        }

        const sortedEntries = [...scoreMap.values()].sort((a, b) => b.score - a.score).slice(0, topN);
        const uniqueLawIds = [...new Set(sortedEntries.map(e => e.metadata.law_id))];
        
        // R2バインディングを使用（CDNキャッシュを回避）
        const mapObj = await env.R2.get('law_chunk_map.json');
        const lawChunkMap = await mapObj.json();

        // 法令ID→条文タイトルのマッピングを作成
        const articlesByLaw = new Map();
        for (const entry of sortedEntries) {
          const lawId = entry.metadata.law_id;
          if (!articlesByLaw.has(lawId)) articlesByLaw.set(lawId, new Set());
          articlesByLaw.get(lawId).add(entry.metadata.article_title);
        }

        const lawDataCache = {};

        // 民法（サブチャンク対応）- 条文番号範囲でサブチャンクを特定
        // サブチャンク1: 1-246, 2: 247-408, 3: 409-545, 4: 546-724, 5: 725-892, 6: 893-1044, 7: 1045-1050
        const MINPO_ID = '129AC0000000089';
        const MINPO_RANGES = [
          { sub: 1, min: 1, max: 246 },
          { sub: 2, min: 247, max: 408 },
          { sub: 3, min: 409, max: 545 },
          { sub: 4, min: 546, max: 724 },
          { sub: 5, min: 725, max: 892 },
          { sub: 6, min: 893, max: 1044 },
          { sub: 7, min: 1045, max: 1050 }
        ];

        if (articlesByLaw.has(MINPO_ID)) {
          const minpoArticles = articlesByLaw.get(MINPO_ID);
          const subChunksNeeded = new Set();
          for (const articleTitle of minpoArticles) {
            // 枝番（第三条の二など）に対応：「の」の前までを取得
            const match = articleTitle.match(/第([一二三四五六七八九十百千]+)条/);
            if (match) {
              const artNum = kanjiToNumber(match[1]);
              for (const range of MINPO_RANGES) {
                if (artNum >= range.min && artNum <= range.max) {
                  subChunksNeeded.add(range.sub);
                  break;
                }
              }
            }
          }
          const minpoPromises = [...subChunksNeeded].map(async (subChunk) => {
            try {
              const obj = await env.R2.get(`laws_chunk_286_${subChunk}_light.json`);
              if (obj) {
                const data = await obj.json();
                if (data.laws[MINPO_ID]) {
                  if (!lawDataCache[MINPO_ID]) {
                    lawDataCache[MINPO_ID] = { ...data.laws[MINPO_ID], articles: [] };
                  }
                  lawDataCache[MINPO_ID].articles.push(...data.laws[MINPO_ID].articles);
                }
              }
            } catch (e) { }
          });
          await Promise.all(minpoPromises);
        }

        // 会社法（複数チャンクに分散: 076, 100, 101, 102, 103, 104, 105）
        // 条文番号範囲: 076(1-178), 100(179-327), 101(328-449), 102(450-574), 103(575-702), 104(703-821), 105(822-979)
        const KAISHAHO_ID = '417AC0000000086';
        const KAISHAHO_RANGES = [
          { chunk: 76, min: 1, max: 178 },
          { chunk: 100, min: 179, max: 327 },
          { chunk: 101, min: 328, max: 449 },
          { chunk: 102, min: 450, max: 574 },
          { chunk: 103, min: 575, max: 702 },
          { chunk: 104, min: 703, max: 821 },
          { chunk: 105, min: 822, max: 979 }
        ];

        if (articlesByLaw.has(KAISHAHO_ID)) {
          const kaishahoArticles = articlesByLaw.get(KAISHAHO_ID);
          const chunksNeeded = new Set();
          for (const articleTitle of kaishahoArticles) {
            // 枝番（第四百二十三条の二など）に対応
            const match = articleTitle.match(/第([一二三四五六七八九十百千]+)条/);
            if (match) {
              const artNum = kanjiToNumber(match[1]);
              for (const range of KAISHAHO_RANGES) {
                if (artNum >= range.min && artNum <= range.max) {
                  chunksNeeded.add(range.chunk);
                  break;
                }
              }
            }
          }
          const kaishahoPromises = [...chunksNeeded].map(async (chunkNum) => {
            try {
              const chunkName = 'laws_chunk_' + String(chunkNum).padStart(3, '0') + '_light.json';
              const obj = await env.R2.get(chunkName);
              if (obj) {
                const data = await obj.json();
                if (data.laws[KAISHAHO_ID]) {
                  if (!lawDataCache[KAISHAHO_ID]) {
                    lawDataCache[KAISHAHO_ID] = { ...data.laws[KAISHAHO_ID], articles: [] };
                  }
                  lawDataCache[KAISHAHO_ID].articles.push(...data.laws[KAISHAHO_ID].articles);
                }
              }
            } catch (e) { }
          });
          await Promise.all(kaishahoPromises);
        }

        // 他の法令（軽量版チャンクから取得）
        const neededChunks = new Set();
        for (const lawId of uniqueLawIds) {
          if (lawId === MINPO_ID || lawId === KAISHAHO_ID) continue;
          if (lawChunkMap[lawId] !== undefined) {
            const firstChunk = Array.isArray(lawChunkMap[lawId]) ? lawChunkMap[lawId][0] : lawChunkMap[lawId];
            neededChunks.add(firstChunk);
          }
        }

        const chunkPromises = [...neededChunks].map(async (chunkId) => {
          // 軽量版ファイル名を使用
          const chunkName = 'laws_chunk_' + String(chunkId).padStart(3, '0') + '_light.json';
          try {
            const chunkObj = await env.R2.get(chunkName);
            if (!chunkObj) return;
            const chunkData = await chunkObj.json();
            for (const lawId of uniqueLawIds) {
              if (lawId === MINPO_ID) continue;
              if (chunkData.laws[lawId]) {
                lawDataCache[lawId] = chunkData.laws[lawId];
              }
            }
          } catch (err) { }
        });
        await Promise.all(chunkPromises);

        const results = sortedEntries.map(entry => {
          const metadata = entry.metadata;
          let articleData = null;
          const lawData = lawDataCache[metadata.law_id];
          if (lawData && lawData.articles) {
            articleData = lawData.articles.find(a => a.title === metadata.article_title);
          }
          return {
            law: { law_title: metadata.law_title, law_id: metadata.law_id },
            article: {
              title: metadata.article_title,
              caption: articleData ? articleData.caption : (metadata.article_caption || ''),
              paragraphs: articleData ? articleData.paragraphs : []
            },
            similarity: entry.similarity,
            score: entry.score,
            matchType: entry.matchType,
            sources: entry.sources
          };
        });

        return new Response(JSON.stringify({ results, total_searched: scoreMap.size }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    if (url.pathname === '/' || url.pathname === '/embed') {
      try {
        const { text } = await request.json();
        const embedding = await env.AI.run('@cf/baai/bge-m3', { text: text });
        return new Response(JSON.stringify({ embedding: embedding.data[0] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // クエリ分類API（Claude経由）
    if (url.pathname === '/api/classify') {
      try {
        const { query, conversationHistory } = await request.json();
        const CLAUDE_API_KEY = env.CLAUDE_API_KEY;

        if (!CLAUDE_API_KEY) {
          return new Response(JSON.stringify({ error: 'CLAUDE_API_KEY not configured' }), {
            status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // 会話履歴から文脈を構築
        let contextText = '';
        if (conversationHistory && conversationHistory.length > 0) {
          const recentConvs = conversationHistory.slice(-2);
          contextText = '\n【直近の会話履歴】\n';
          recentConvs.forEach(conv => {
            contextText += `Q: ${conv.question}\n`;
            const shortAnswer = conv.answer.length > 200 ? conv.answer.substring(0, 200) + '...' : conv.answer;
            contextText += `A: ${shortAnswer}\n\n`;
          });
        }

        const classifyPrompt = `あなたはユーザーの入力を分類するアシスタントです。

入力を以下の3種類に分類してください：
1. "greeting" - 挨拶や雑談（こんにちは、ありがとう、など）
2. "direct" - 特定の法令条文を直接参照（「民法709条」「会社法423条」など）
3. "legal" - 法的な質問や相談

${contextText}
【ユーザー入力】
${query}

以下のJSON形式で回答してください（他の文章は不要）：
{
  "type": "greeting" | "direct" | "legal",
  "queries": ["検索クエリ1", "検索クエリ2", "検索クエリ3"],  // legalの場合のみ3つのクエリを生成
  "greeting_response": "挨拶への返答"  // greetingの場合のみ
}

注意：
- directの場合、queriesには入力をそのまま1つだけ入れてください
- legalの場合、queriesには3つの異なる検索クエリを生成してください
- greetingの場合、queriesは空配列、greeting_responseに返答を入れてください`;

        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': CLAUDE_API_KEY,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 500,
            messages: [{ role: 'user', content: classifyPrompt }]
          })
        });

        const data = await response.json();
        const text = data.content?.[0]?.text || '{}';

        // JSONを抽出
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        const result = jsonMatch ? JSON.parse(jsonMatch[0]) : { type: 'legal', queries: [query] };

        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // チャットAPI（Claude経由）
    if (url.pathname === '/api/chat') {
      try {
        const { messages, system } = await request.json();
        const CLAUDE_API_KEY = env.CLAUDE_API_KEY;

        if (!CLAUDE_API_KEY) {
          return new Response(JSON.stringify({ error: 'CLAUDE_API_KEY not configured' }), {
            status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': CLAUDE_API_KEY,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 2000,
            system: system || '',
            messages: messages
          })
        });

        const data = await response.json();

        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  }
};
