// Cloudflare Workers - 法令検索API（Vectorize版 + R2バインディング）
// https://morning-surf-f117.ikeda-250.workers.dev/
// Version: 2025-12-23-v2 (refs split by law_id)

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
  '租税特別措置法': '332AC0000000026',
  '租税特別措置法施行令': '332CO0000000043',
  '租税特別措置法施行規則': '332M50000040015',
  '特定受託事業者に係る取引の適正化等に関する法律': '505AC0000000025',
  '特定受託事業者に係る取引の適正化等に関する法律施行令': '506CO0000000200',
  'フリーランス保護法': '505AC0000000025',
  'フリーランス新法': '505AC0000000025',
};

// 単一の法令+条文を抽出（後方互換用）
function extractLawInfo(query) {
  const result = { lawName: null, articleNum: null };
  const lawPatterns = [/^(.+?法律)/, /^(.+?法)/, /(.+?法律)(?:第|の)/, /(.+?法)(?:第|の)/];
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

// 複数の法令+条文を抽出（「著作権法121条と民法323条」「民法42条の2」「租税特別措置法70条の2の4」のようなクエリ対応）
function extractMultipleLawInfos(query) {
  const results = [];
  // 全角数字を半角に正規化
  const normalizedQuery = normalizeNumbers(query);
  // 「〇〇法XXX条」または「〇〇法XXX条のYのZ...」のパターンを全て抽出
  // 複数の枝番（の二の四、の2の4等）にも対応
  // 注: ひらがな・カタカナを含む法令名にも対応 (例: 「特定受託事業者に係る取引の適正化等に関する法律」)
  const pattern = /([\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ffー]+(?:施行規則|施行令|法律|規則|条例|新法|法|令))[\s]*(?:第)?(\d+|[一二三四五六七八九十百千]+)条((?:の(?:\d+|[一二三四五六七八九十]+))*)/g;
  let match;
  while ((match = pattern.exec(normalizedQuery)) !== null) {
    const lawName = match[1];
    const numStr = match[2];
    const articleNum = /^\d+$/.test(numStr) ? parseInt(numStr, 10) : kanjiToNumber(numStr);
    // 枝番部分（「の二の四」等）をそのまま保持
    const subNumsStr = match[3] || '';  // 例: "の二の四"
    results.push({ lawName, articleNum, subNumsStr });
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
        const timings = {};
        const startTotal = Date.now();

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
        const startVectorize = Date.now();
        const searchPromises = searchQueries.map(async (q) => {
          const embeddingResult = await env.AI.run('@cf/baai/bge-m3', { text: [q] });
          const queryVector = embeddingResult.data[0];
          return env.VECTORIZE.query(queryVector, { topK: 50, returnMetadata: 'all' });
        });
        const allResults = await Promise.all(searchPromises);
        timings.vectorize = Date.now() - startVectorize;

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

        // 条文タイトルを生成するヘルパー関数（複数枝番対応）
        const buildArticleTitle = (info) => {
          let title = '第' + numberToKanji(info.articleNum) + '条';
          // subNumsStr（「の二の四」等）をそのまま追加、またはアラビア数字を漢数字に変換
          if (info.subNumsStr) {
            // アラビア数字が含まれていれば漢数字に変換
            const converted = info.subNumsStr.replace(/の(\d+)/g, (m, num) => 'の' + numberToKanji(parseInt(num, 10)));
            title += converted;
          } else if (info.subNum) {
            // 後方互換: 旧形式のsubNum
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
          let foundLawIdPartial = null;  // 部分一致のlaw_id（フォールバック用）
          for (const [key] of rrfScores.entries()) {
            const meta = metadataCache.get(key);
            if (meta && meta.law_title) {
              // 完全一致を優先
              if (meta.law_title === info.lawName) {
                foundLawId = meta.law_id;
                if (meta.article_title === artTitle) {
                  found = true;
                  break;
                }
              } else if (meta.law_title.includes(info.lawName) && !foundLawIdPartial) {
                // 部分一致はフォールバックとして保存
                foundLawIdPartial = meta.law_id;
              }
            }
          }
          // 完全一致が見つからなければ部分一致を使用
          if (!foundLawId) foundLawId = foundLawIdPartial;

          // COMMON_LAW_IDSに登録されていれば優先的に使用（Vectorizeのデータが壊れている場合の対策）
          if (COMMON_LAW_IDS[info.lawName]) {
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
          const metadata = { ...metadataCache.get(key) }; // 浅いコピー
          let bonus = 0, matchType = null;

          // law_titleからCOMMON_LAW_IDSでlaw_idを修正（Vectorizeのデータ不整合対策）
          if (metadata.law_title && COMMON_LAW_IDS[metadata.law_title]) {
            metadata.law_id = COMMON_LAW_IDS[metadata.law_title];
          }

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
        const startR2 = Date.now();
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
        // 条文番号範囲: 076(1-178), 100(179-317), 101(318-449), 102(450-662), 103(663-801), 104(802-966), 105(967-979)
        const KAISHAHO_ID = '417AC0000000086';
        const KAISHAHO_RANGES = [
          { chunk: 76, min: 1, max: 178 },
          { chunk: 100, min: 179, max: 317 },
          { chunk: 101, min: 318, max: 449 },
          { chunk: 102, min: 450, max: 662 },
          { chunk: 103, min: 663, max: 801 },
          { chunk: 104, min: 802, max: 966 },
          { chunk: 105, min: 967, max: 979 }
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

        // LARGE法令（条文単位ファイルから取得）- LARGE と LARGE_075 両方に対応
        // 注意: sortedEntriesにはダミー追加された条文も含まれるので、すべて取得対象にする
        const largeLawArticles = new Map(); // lawId -> Set of articleTitles
        for (const entry of sortedEntries) {
          const lawId = entry.metadata.law_id;
          if (lawId === MINPO_ID || lawId === KAISHAHO_ID) continue;
          const chunkInfo = lawChunkMap[lawId];
          if (chunkInfo === 'LARGE' || chunkInfo === 'LARGE_075') {
            if (!largeLawArticles.has(lawId)) {
              largeLawArticles.set(lawId, new Set());
            }
            largeLawArticles.get(lawId).add(entry.metadata.article_title);
          }
        }
        // SetをArrayに変換
        for (const [lawId, titles] of largeLawArticles.entries()) {
          largeLawArticles.set(lawId, [...titles]);
        }

        // LARGE法令の条文を個別に取得（v2形式: articles配列）
        const largeLawFetchLog = [];
        const largeLawPromises = [...largeLawArticles.entries()].map(async ([lawId, articleTitles]) => {
          const articlePromises = articleTitles.map(async (articleTitle) => {
            const r2Key = `large_law_articles_v2/${lawId}/${articleTitle}.json`;
            try {
              const obj = await env.R2.get(r2Key);
              if (!obj) {
                largeLawFetchLog.push({ r2Key, status: 'not_found' });
                return null;
              }
              const data = await obj.json();
              largeLawFetchLog.push({ r2Key, status: 'ok', articlesCount: data.articles?.length });
              return data;
            } catch (e) {
              largeLawFetchLog.push({ r2Key, status: 'error', error: e.message });
              return null;
            }
          });

          const results = await Promise.all(articlePromises);
          for (const data of results) {
            if (!data) continue;
            if (!lawDataCache[lawId]) {
              lawDataCache[lawId] = {
                law_id: data.law_id,
                law_title: data.law_title,
                law_num: data.law_num,
                articles: []
              };
            }
            // articles配列をすべて追加
            lawDataCache[lawId].articles.push(...data.articles);
          }
        });
        await Promise.all(largeLawPromises);

        // 他の法令（軽量版チャンクから取得）
        const neededChunks = new Set();
        for (const lawId of uniqueLawIds) {
          if (lawId === MINPO_ID || lawId === KAISHAHO_ID) continue;
          const chunkInfo = lawChunkMap[lawId];
          if (chunkInfo === 'LARGE' || chunkInfo === 'LARGE_075') continue; // LARGE法令はスキップ
          if (chunkInfo !== undefined) {
            const firstChunk = Array.isArray(chunkInfo) ? chunkInfo[0] : chunkInfo;
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

        // デバッグ用
        const sortedArticleTitles = sortedEntries
          .filter(e => e.metadata.law_id === '332M50000040015')
          .map(e => e.metadata.article_title);
        const resultsArticleTitles = results
          .filter(r => r.law.law_id === '332M50000040015')
          .map(r => r.article.title);
        const debugInfo = {
          sortedEntriesCount: sortedEntries.length,
          resultsCount: results.length,
          sortedArticleTitlesFor332M: sortedArticleTitles,
          resultsArticleTitlesFor332M: resultsArticleTitles,
          largeLawArticleTitles: largeLawArticles.get('332M50000040015') || [],
          largeLawFetchLogCount: largeLawFetchLog.length
        };
        timings.r2_fetch = Date.now() - startR2;
        timings.total = Date.now() - startTotal;
        console.log('[/search timings]', JSON.stringify(timings));

        return new Response(JSON.stringify({ results, total_searched: scoreMap.size, debug: debugInfo, timings }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // デバッグ: R2ファイルを直接取得
    if (url.pathname === '/debug-r2') {
      try {
        const { lawId, articleTitle } = await request.json();
        const r2Key = `large_law_articles_v2/${lawId}/${articleTitle}.json`;
        const obj = await env.R2.get(r2Key);
        if (!obj) {
          return new Response(JSON.stringify({ r2Key, status: 'not_found' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        // JSONとしてパースせず、テキストとして最初の200文字を返す
        const text = await obj.text();
        return new Response(JSON.stringify({ r2Key, status: 'ok', textLength: text.length, textPreview: text.slice(0, 200) }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message, stack: e.stack?.slice(0, 200) }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    if (url.pathname === '/' || url.pathname === '/embed') {
      // GETリクエストの場合はステータスを返す
      if (request.method === 'GET') {
        return new Response(JSON.stringify({ status: 'ok', message: '条文くんAPI' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
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
        const startTime = Date.now();
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
            model: 'claude-haiku-4-5-20251001',  // クエリ分類は高速なHaikuを使用
            max_tokens: 500,
            messages: [{ role: 'user', content: classifyPrompt }]
          })
        });

        const data = await response.json();
        const text = data.content?.[0]?.text || '{}';

        // JSONを抽出
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        const result = jsonMatch ? JSON.parse(jsonMatch[0]) : { type: 'legal', queries: [query] };

        const elapsed = Date.now() - startTime;
        console.log(`[/api/classify] ${elapsed}ms`);
        result._timing = elapsed;

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
        const startTime = Date.now();
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
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 2000,
            system: system || '',
            messages: messages
          })
        });

        const data = await response.json();

        const elapsed = Date.now() - startTime;
        console.log(`[/api/chat] ${elapsed}ms`);
        data._timing = elapsed;

        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // ストリーミングチャットAPI（Claude経由）
    if (url.pathname === '/api/chat-stream') {
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
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 2000,
            stream: true,
            system: system || '',
            messages: messages
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          return new Response(JSON.stringify({ error: errorText }), {
            status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // ストリーミングレスポンスをそのまま転送
        return new Response(response.body, {
          headers: {
            ...corsHeaders,
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // 条文取得API（条文IDから条文内容を取得）
    if (url.pathname === '/api/articles') {
      try {
        const { articleIds } = await request.json();
        // articleIds: ["417AC0000000086_Art453", "129AC0000000089_Art415", ...]

        if (!articleIds || !Array.isArray(articleIds)) {
          return new Response(JSON.stringify({ error: 'articleIds array is required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // 条文IDをパース: law_id と article_title に分解
        const parsedArticles = articleIds.map(id => {
          const match = id.match(/^(.+?)_(Art(\d+)(?:_(\d+))?)$/);
          if (!match) return null;
          const lawId = match[1];
          const mainNum = parseInt(match[3], 10);
          const subNum = match[4] ? parseInt(match[4], 10) : null;
          // 条文タイトルを漢数字形式に変換
          let articleTitle = '第' + numberToKanji(mainNum) + '条';
          if (subNum) articleTitle += 'の' + numberToKanji(subNum);
          return { lawId, articleTitle, originalId: id };
        }).filter(Boolean);

        // 法令IDごとにグループ化
        const articlesByLaw = new Map();
        for (const art of parsedArticles) {
          if (!articlesByLaw.has(art.lawId)) articlesByLaw.set(art.lawId, []);
          articlesByLaw.get(art.lawId).push(art);
        }

        // law_chunk_map を取得
        const startR2 = Date.now();
        const mapObj = await env.R2.get('law_chunk_map.json');
        const lawChunkMap = await mapObj.json();

        const results = [];

        // 民法の範囲定義
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

        // 会社法の範囲定義
        const KAISHAHO_ID = '417AC0000000086';
        const KAISHAHO_RANGES = [
          { chunk: 76, min: 1, max: 178 },
          { chunk: 100, min: 179, max: 317 },
          { chunk: 101, min: 318, max: 449 },
          { chunk: 102, min: 450, max: 662 },
          { chunk: 103, min: 663, max: 801 },
          { chunk: 104, min: 802, max: 966 },
          { chunk: 105, min: 967, max: 979 }
        ];

        // 各法令の条文を取得
        for (const [lawId, articles] of articlesByLaw.entries()) {
          const chunkInfo = lawChunkMap[lawId];

          // 民法の場合
          if (lawId === MINPO_ID) {
            for (const art of articles) {
              const match = art.articleTitle.match(/第([一二三四五六七八九十百千]+)条/);
              if (!match) continue;
              const artNum = kanjiToNumber(match[1]);
              const range = MINPO_RANGES.find(r => artNum >= r.min && artNum <= r.max);
              if (!range) continue;
              try {
                const obj = await env.R2.get(`laws_chunk_286_${range.sub}_light.json`);
                if (obj) {
                  const data = await obj.json();
                  const lawData = data.laws[MINPO_ID];
                  const foundArticle = lawData?.articles?.find(a => a.title === art.articleTitle);
                  if (foundArticle) {
                    results.push({ id: art.originalId, law_id: lawId, law_title: lawData.law_title, article: foundArticle });
                  }
                }
              } catch (e) { }
            }
            continue;
          }

          // 会社法の場合
          if (lawId === KAISHAHO_ID || chunkInfo === 'KAISHAHO') {
            for (const art of articles) {
              const match = art.articleTitle.match(/第([一二三四五六七八九十百千]+)条/);
              if (!match) continue;
              const artNum = kanjiToNumber(match[1]);
              const range = KAISHAHO_RANGES.find(r => artNum >= r.min && artNum <= r.max);
              if (!range) continue;
              try {
                const chunkName = 'laws_chunk_' + String(range.chunk).padStart(3, '0') + '_light.json';
                const obj = await env.R2.get(chunkName);
                if (obj) {
                  const data = await obj.json();
                  const lawData = data.laws[KAISHAHO_ID];
                  const foundArticle = lawData?.articles?.find(a => a.title === art.articleTitle);
                  if (foundArticle) {
                    results.push({ id: art.originalId, law_id: lawId, law_title: lawData.law_title, article: foundArticle });
                  }
                }
              } catch (e) { }
            }
            continue;
          }

          if (!chunkInfo) continue;

          let lawData = null;

          // LARGE法令の場合は条文単位ファイルから取得
          if (chunkInfo === 'LARGE' || chunkInfo === 'LARGE_075') {
            for (const art of articles) {
              try {
                const r2Key = `large_law_articles_v2/${lawId}/${art.articleTitle}.json`;
                const obj = await env.R2.get(r2Key);
                if (obj) {
                  const data = await obj.json();
                  const foundArticle = data.articles?.find(a => a.title === art.articleTitle);
                  if (foundArticle) {
                    results.push({
                      id: art.originalId,
                      law_id: lawId,
                      law_title: data.law_title,
                      article: foundArticle
                    });
                  }
                }
              } catch (e) { }
            }
          } else {
            // 通常チャンクから取得
            const chunkNum = Array.isArray(chunkInfo) ? chunkInfo[0] : chunkInfo;
            const chunkName = 'laws_chunk_' + String(chunkNum).padStart(3, '0') + '_light.json';
            try {
              const chunkObj = await env.R2.get(chunkName);
              if (chunkObj) {
                const chunkData = await chunkObj.json();
                lawData = chunkData.laws[lawId];
              }
            } catch (e) { }

            if (lawData) {
              for (const art of articles) {
                const foundArticle = lawData.articles?.find(a => a.title === art.articleTitle);
                if (foundArticle) {
                  results.push({
                    id: art.originalId,
                    law_id: lawId,
                    law_title: lawData.law_title,
                    article: foundArticle
                  });
                }
              }
            }
          }
        }

        return new Response(JSON.stringify({ results }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // 参照条文API（refs/reverse_refs取得）
    if (url.pathname === '/api/refs') {
      try {
        const { articles } = await request.json();
        // articles: [{ law_id, article_title }, ...]

        if (!articles || !Array.isArray(articles)) {
          return new Response(JSON.stringify({ error: 'articles array is required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // 条文タイトルをArtキーに変換（例: 第七百九条 → Art709）
        const titleToArtKey = (lawId, title) => {
          // 「第X条」「第X条のY」形式を「lawId_ArtX」「lawId_ArtX_Y」に変換
          const match = title.match(/第([一二三四五六七八九十百千]+)条(?:の([一二三四五六七八九十]+))?/);
          if (!match) return null;
          const mainNum = kanjiToNumber(match[1]);
          const subNum = match[2] ? kanjiToNumber(match[2]) : null;
          const artPart = subNum ? `Art${mainNum}_${subNum}` : `Art${mainNum}`;
          return `${lawId}_${artPart}`;
        };

        // 法令IDごとにグループ化
        const lawIds = [...new Set(articles.map(a => a.law_id))];

        // refs_chunks形式: まずインデックスを取得して、必要なチャンクを特定
        const refsDataByLaw = {};
        const fetchErrors = [];

        // インデックスファイルを取得
        let refsIndex = {};
        try {
          const indexObj = await env.R2.get('refs_chunks/refs_index.json');
          if (indexObj) {
            refsIndex = JSON.parse(await indexObj.text());
          }
        } catch (e) {
          fetchErrors.push({ type: 'index', error: e.message });
        }

        // 必要なチャンク番号を特定
        const neededChunks = new Set();
        for (const lawId of lawIds) {
          const chunkNum = refsIndex[lawId];
          if (chunkNum !== undefined) {
            neededChunks.add(chunkNum);
          }
        }

        // チャンクを取得
        const chunkDataMap = {};
        await Promise.all([...neededChunks].map(async (chunkNum) => {
          const r2Key = `refs_chunks/refs_chunk_${String(chunkNum).padStart(3, '0')}.json`;
          try {
            const chunkObj = await env.R2.get(r2Key);
            if (chunkObj) {
              chunkDataMap[chunkNum] = JSON.parse(await chunkObj.text());
            }
          } catch (e) {
            fetchErrors.push({ chunkNum, r2Key, error: e.message });
          }
        }));

        // 法令IDごとにデータを抽出
        for (const lawId of lawIds) {
          const chunkNum = refsIndex[lawId];
          if (chunkNum !== undefined && chunkDataMap[chunkNum] && chunkDataMap[chunkNum][lawId]) {
            refsDataByLaw[lawId] = chunkDataMap[chunkNum][lawId];
          } else {
            refsDataByLaw[lawId] = { refs: {}, reverse_refs: {} };
          }
        }

        if (fetchErrors.length > 0) {
          console.log('Refs fetch errors:', JSON.stringify(fetchErrors));
        }

        // 各条文のrefs/reverse_refsを取得
        const results = [];
        for (const article of articles) {
          const fullKey = titleToArtKey(article.law_id, article.article_title);
          const lawData = refsDataByLaw[article.law_id] || { refs: {}, reverse_refs: {} };

          const articleRefs = {
            law_id: article.law_id,
            article_title: article.article_title,
            refs: [],
            reverse_refs: []
          };

          if (fullKey) {
            // この条文が参照している条文
            if (lawData.refs[fullKey]) {
              articleRefs.refs = lawData.refs[fullKey];
            }
            // この条文を参照している条文
            if (lawData.reverse_refs[fullKey]) {
              articleRefs.reverse_refs = lawData.reverse_refs[fullKey];
            }
          }

          results.push(articleRefs);
        }

        return new Response(JSON.stringify({ results }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          error: error.message,
          stack: error.stack,
          name: error.name
        }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // デバッグ: refs test endpoint
    if (url.pathname === '/debug/refs-test') {
      try {
        const lawId = '417AC0000000086';
        const r2Key = `refs/${lawId}.json`;
        const refsObj = await env.R2.get(r2Key);

        if (!refsObj) {
          return new Response(JSON.stringify({ error: 'File not found', r2Key }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const text = await refsObj.text();
        const size = text.length;
        const preview = text.substring(0, 200);
        let isValid = false;
        try {
          JSON.parse(text);
          isValid = true;
        } catch (e) {}

        return new Response(JSON.stringify({ size, preview, isValid }), {
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
