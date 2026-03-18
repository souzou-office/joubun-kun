import React, { useState, useEffect, useRef } from 'react';
import html2canvas from 'html2canvas';
import logoA from '/logo_A.png';
import logoB from '/logo_B.png';
import { ALL_LAW_IDS } from './lawIds.js';

// Cloudflare Worker URL
const WORKER_URL = 'https://morning-surf-f117.ikeda-250.workers.dev';
// メモリキャッシュ廃止（OOM対策）

// 全法令の名前→ID マッピング（8,878法令）
const COMMON_LAW_IDS = ALL_LAW_IDS;

// 施行令・施行規則→親法令のマッピング（「法第X条」の解決用）
const PARENT_LAW_MAP = {
  '会社計算規則': '会社法',
  '会社法施行令': '会社法',
  '会社法施行規則': '会社法',
  '民法施行規則': '民法',
  '所得税法施行令': '所得税法',
  '所得税法施行規則': '所得税法',
  '法人税法施行令': '法人税法',
  '法人税法施行規則': '法人税法',
  '消費税法施行令': '消費税法',
  '消費税法施行規則': '消費税法',
  '相続税法施行令': '相続税法',
  '相続税法施行規則': '相続税法',
  '租税特別措置法施行令': '租税特別措置法',
  '租税特別措置法施行規則': '租税特別措置法',
  '金融商品取引法施行令': '金融商品取引法',
  '民事訴訟規則': '民事訴訟法',
  '刑事訴訟規則': '刑事訴訟法',
  '破産規則': '破産法',
  '民事再生規則': '民事再生法',
  '会社更生規則': '会社更生法',
  '不動産登記規則': '不動産登記法',
  '不動産登記令': '不動産登記法',
  '商業登記規則': '商業登記法',
  '労働基準法施行規則': '労働基準法',
  '労働契約法施行規則': '労働契約法',
  '特許法施行令': '特許法',
  '特許法施行規則': '特許法',
  '著作権法施行令': '著作権法',
  '著作権法施行規則': '著作権法',
};

// ===== 参照条文取得（e-Gov API経由）=====
// lawIdがない場合はlawName（法令名）で検索
// 漢数字をアラビア数字に変換（fetchReferencedArticle用）
const kanjiToNum = (str) => {
  const kanjiMap = { '〇': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10, '百': 100, '千': 1000 };
  let result = 0, temp = 0;
  for (const c of str) {
    const val = kanjiMap[c];
    if (val === undefined) continue;
    if (val >= 10) {
      result += (temp || 1) * val;
      temp = 0;
    } else {
      temp = temp * 10 + val;
    }
  }
  return result + temp;
};

// 数字を漢数字に変換（fetchReferencedArticle用）
const numToKanji = (num) => {
  const kanjiNums = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const units = ['', '十', '百', '千'];
  if (num === 0) return '〇';
  let result = '';
  let n = num;
  let unitIndex = 0;
  while (n > 0) {
    const digit = n % 10;
    if (digit > 0) {
      if (unitIndex === 0) {
        result = kanjiNums[digit] + result;
      } else if (digit === 1) {
        result = units[unitIndex] + result;
      } else {
        result = kanjiNums[digit] + units[unitIndex] + result;
      }
    }
    n = Math.floor(n / 10);
    unitIndex++;
  }
  return result;
};

const fetchReferencedArticle = async (lawId, articleNum, lawName = null) => {
  try {
    console.log(`🔍 参照条文取得: lawId=${lawId}, articleNum=${articleNum}, lawName=${lawName}`);
    // lawIdがない場合、lawNameから解決を試みる
    let resolvedLawId = lawId;
    if (!resolvedLawId && lawName) {
      resolvedLawId = COMMON_LAW_IDS[lawName];
    }

    if (!resolvedLawId) {
      // マッピングにない場合、Vectorize検索で法令IDを取得
      try {
        const searchQuery = `${lawName} 第一条`;
        const searchResponse = await fetch(`${WORKER_URL}/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ queries: [searchQuery], originalQuery: searchQuery, topN: 1 })
        });
        if (searchResponse.ok) {
          const searchData = await searchResponse.json();
          if (searchData.results && searchData.results.length > 0 && searchData.results[0].law.law_title === lawName) {
            resolvedLawId = searchData.results[0].law.law_id;
          }
        }
      } catch (e) {
        console.error('Vectorize検索エラー:', e);
      }
    }

    if (!resolvedLawId) {
      throw new Error(`法令ID不明: ${lawName}`);
    }

    // articleNumを条文ID形式に変換（例: "454" → "Art454", "454_2" → "Art454_2"）
    let articleId;
    if (/^\d+$/.test(articleNum)) {
      articleId = `${resolvedLawId}_Art${articleNum}`;
    } else if (articleNum.includes('_')) {
      articleId = `${resolvedLawId}_Art${articleNum}`;
    } else {
      // すでに「第X条」形式の場合、数字に変換
      const match = articleNum.match(/第([一二三四五六七八九十百千]+)条(?:の([一二三四五六七八九十]+))?/);
      if (match) {
        const mainNum = kanjiToNum(match[1]);
        const subNum = match[2] ? kanjiToNum(match[2]) : null;
        articleId = subNum ? `${resolvedLawId}_Art${mainNum}_${subNum}` : `${resolvedLawId}_Art${mainNum}`;
      } else {
        articleId = `${resolvedLawId}_Art${articleNum}`;
      }
    }

    // /api/articles エンドポイントを使用（POST）
    const requestBody = {
      articleIds: [articleId]
    };


    const response = await fetch(`${WORKER_URL}/api/articles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) throw new Error(`API error: ${response.status}`);
    const data = await response.json();


    // 結果を単一の条文形式で返す
    if (data.results && data.results.length > 0) {
      const result = data.results[0];
      // APIは { id, law_id, law_title, article: { title, caption, paragraphs } } を返す
      return {
        law_title: result.law_title,
        law_id: result.law_id,
        article: result.article  // そのまま使用
      };
    }
    console.warn(`⚠️ 条文が見つかりませんでした: lawId=${lawId}, articleNum=${articleNum}, lawName=${lawName}`);
    return null;
  } catch (err) {
    console.error('参照条文取得エラー:', err, { lawId, articleNum, lawName });
    return null;  // エラーでもnullを返して処理継続
  }
};

// 法令内の条文参照を抽出するパターン（例: 第五百四十五条、第10条、第42条の2）
const ARTICLE_REF_PATTERN = /第([一二三四五六七八九十百千〇]+|\d+)条(?:の([一二三四五六七八九十〇]+|\d+))?(?:第([一二三四五六七八九十]+|\d+)項)?/g;

// 他法令参照パターン（例: 商法第五百二十六条、民事訴訟法第275条、任意後見契約法第二条）
// 「○○法」「○○令」「○○規則」などの形式で法令名を動的に検出
// 法令名は2文字以上（「法」「令」単独を除外）
const OTHER_LAW_REF_PATTERN = /([\u4e00-\u9fff]{2,}(?:法|令|規則|条例))第([一二三四五六七八九十百千〇]+|\d+)条(?:の([一二三四五六七八九十〇]+|\d+))?(?:第([一二三四五六七八九十]+|\d+)(?:項|号))?/g;

// 特殊な省令・規則 → 親法令マッピング
// 「○○法施行規則」形式ではない規則のための静的マッピング
const SPECIAL_PARENT_LAW_MAP = {
  '会社計算規則': { '法': '会社法', '令': '会社法施行令' },
  '会社法施行規則': { '法': '会社法', '令': '会社法施行令' },
  '電子公告規則': { '法': '会社法', '令': '会社法施行令' },
  '商業登記規則': { '法': '商業登記法', '令': '商業登記法施行令' },
  '不動産登記規則': { '法': '不動産登記法', '令': '不動産登記法施行令' },
  '戸籍法施行規則': { '法': '戸籍法', '令': '戸籍法施行令' },
  '民事執行規則': { '法': '民事執行法', '令': '民事執行法施行令' },
  '民事保全規則': { '法': '民事保全法', '令': '民事保全法施行令' },
  '破産規則': { '法': '破産法', '令': '破産法施行令' },
  '民事再生規則': { '法': '民事再生法', '令': '民事再生法施行令' },
  '会社更生規則': { '法': '会社更生法', '令': '会社更生法施行令' },
  '供託規則': { '法': '供託法', '令': '供託法施行令' },
  '法人税法施行規則': { '法': '法人税法', '令': '法人税法施行令' },
  '所得税法施行規則': { '法': '所得税法', '令': '所得税法施行令' },
  '消費税法施行規則': { '法': '消費税法', '令': '消費税法施行令' },
  '相続税法施行規則': { '法': '相続税法', '令': '相続税法施行令' },
  '地方税法施行規則': { '法': '地方税法', '令': '地方税法施行令' },
  '租税特別措置法施行規則': { '法': '租税特別措置法', '令': '租税特別措置法施行令' },
};

// 法令名から親法令情報を動的に生成（施行令・施行規則用）
// APIから取得した parent_law_info がない場合のフォールバック
const getParentLawInfo = (lawTitle) => {
  if (!lawTitle) return null;

  // 1. 特殊マッピングをチェック
  if (SPECIAL_PARENT_LAW_MAP[lawTitle]) {
    return SPECIAL_PARENT_LAW_MAP[lawTitle];
  }

  // 2. 「○○法施行令」「○○法施行規則」「○○法律施行令」「○○法律施行規則」から親法令名を抽出
  const shikoPattern = lawTitle.match(/^(.+(?:法律|法))施行(令|規則)$/);
  if (shikoPattern) {
    const parentLawName = shikoPattern[1];
    return {
      '法': parentLawName,
      '令': parentLawName + '施行令'
    };
  }

  // 3. 「○○規則」で終わる場合、対応する法令を探す（最後の手段）
  // 例: 「○○法施行規則」ではないが「○○規則」のパターン
  const kisokuPattern = lawTitle.match(/^(.+)規則$/);
  if (kisokuPattern) {
    // 「○○計算規則」「○○登記規則」などは親法令が異なるので個別対応が必要
    // ここでは対応できないのでnullを返す（SPECIAL_PARENT_LAW_MAPに追加すべき）
    console.log(`ℹ️ 規則の親法令が不明: ${lawTitle} - SPECIAL_PARENT_LAW_MAPへの追加を検討`);
  }

  // 4. 「○○法」「○○法律」で終わる法令の場合、「法」は自分自身を指す
  // 例: 会社法の条文内で「法第○条」→ 会社法第○条
  if (lawTitle.match(/(法|法律)$/)) {
    return {
      '法': lawTitle
    };
  }

  return null;
};

// 主要法令名 → law_id マッピング（law_idが分かるもののみ）
const LAW_NAME_TO_ID = {
  '民法': '129AC0000000089',
  '商法': '132AC0000000048',
  '会社法': '417AC0000000086',
  '民事訴訟法': '408AC0000000109',
  '刑事訴訟法': '323AC0000000131',
  '刑法': '140AC0000000045',
  '憲法': '321CONSTITUTION',
  '日本国憲法': '321CONSTITUTION',
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
  // 税法関係
  '所得税法': '340AC0000000033',
  '法人税法': '340AC0000000034',
  '相続税法': '325AC0000000073',
  '消費税法': '363AC0000000108',
  '地方税法': '325AC0000000226',
  '国税通則法': '337AC0000000066',
  '国税徴収法': '334AC0000000147',
  // 行政法関係
  '行政不服審査法': '326AC0000000160',
  '行政代執行法': '323AC0000000043',
  // 民事関係
  '民事執行法': '354AC0000000004',
  '民事保全法': '401AC0000000091',
  '民事調停法': '326AC1000000222',
  '家事事件手続法': '423AC0000000052',
  '非訟事件手続法': '423AC0000000051',
  '仲裁法': '415AC0000000138',
  // 商事・会社関係
  '信託法': '418AC0000000108',
  '信託業法': '416AC0000000154',
  '銀行法': '356AC0000000059',
  '保険業法': '407AC0000000105',
  '手形法': '307AC0000000020',
  '小切手法': '308AC0000000057',
  // 不動産・建築関係
  '宅地建物取引業法': '327AC1000000176',
  '建築基準法': '325AC0000000201',
  '都市計画法': '343AC0000000100',
  '土地区画整理法': '329AC0000000119',
  'マンション管理適正化法': '412AC0000000149',
  // 知的財産関係
  '実用新案法': '334AC0000000123',
  '意匠法': '334AC0000000125',
  '商標法': '334AC0000000127',
  // 労働関係
  '労働組合法': '324AC0000000174',
  '労働安全衛生法': '347AC0000000057',
  '男女雇用機会均等法': '347AC0000000113',
  // その他
  '道路交通法': '335AC0000000105',
  '戸籍法': '322AC0000000224',
  '住民基本台帳法': '342AC0000000081',
  '任意後見契約法': '411AC0000000150',
  '成年後見登記法': '411AC0000000152',
  '後見登記法': '411AC0000000152',
};

// 漢数字をアラビア数字に変換
const kanjiToArabic = (kanjiStr) => {
  if (/^\d+$/.test(kanjiStr)) return parseInt(kanjiStr, 10);
  const kanjiNums = { '〇': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  let result = 0, temp = 0;
  for (let i = 0; i < kanjiStr.length; i++) {
    const char = kanjiStr[i];
    if (char === '千') { temp = (temp || 1) * 1000; result += temp; temp = 0; }
    else if (char === '百') { temp = (temp || 1) * 100; result += temp; temp = 0; }
    else if (char === '十') { temp = (temp || 1) * 10; result += temp; temp = 0; }
    else if (kanjiNums[char] !== undefined) { temp = temp * 10 + kanjiNums[char]; }
  }
  return result + temp;
};

// 条文番号を表示用にフォーマット（例: "54_2" → "54条の2"、"54" → "54条"）
const formatArticleNum = (articleNum) => {
  const str = String(articleNum);
  if (str.includes('_')) {
    const [main, sub] = str.split('_');
    return `${main}条の${sub}`;
  }
  return `${str}条`;
};

// ===== クエリ分類 & マルチクエリ生成 =====
// 挨拶/条文直接指定/法的質問を分類し、必要に応じて3種類のクエリを生成
const classifyAndGenerateQueries = async (originalQuery, conversationHistory = []) => {
  try {
    // 直前の会話の要約を取得（あれば）
    const lastConv = conversationHistory.length > 0 ? conversationHistory[conversationHistory.length - 1] : null;
    const previousSummary = lastConv?.summary || null;

    if (previousSummary) {
      console.log('📎 前回の要約をclassifyに送信:', previousSummary);
    }

    const response = await fetch(`${WORKER_URL}/api/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: originalQuery,
        previousSummary: previousSummary,
        conversationHistory: conversationHistory.slice(-2).map(conv => ({
          question: conv.question,
          summary: conv.summary || ''
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
const SEARCH_HISTORY_STORAGE = 'joubun_search_history';
const MAX_HISTORY = 10;

const saveProMode = (enabled) => {
  localStorage.setItem(PRO_MODE_STORAGE, enabled ? 'true' : 'false');
};

const getProMode = () => {
  return localStorage.getItem(PRO_MODE_STORAGE) === 'true';
};

const saveSearchHistory = (query) => {
  try {
    const history = getSearchHistory();
    const filtered = history.filter(h => h !== query);
    const updated = [query, ...filtered].slice(0, MAX_HISTORY);
    localStorage.setItem(SEARCH_HISTORY_STORAGE, JSON.stringify(updated));
  } catch (e) {
    console.error('履歴保存エラー:', e);
  }
};

const getSearchHistory = () => {
  try {
    const stored = localStorage.getItem(SEARCH_HISTORY_STORAGE);
    return stored ? JSON.parse(stored) : [];
  } catch (e) {
    return [];
  }
};

const clearSearchHistory = () => {
  localStorage.removeItem(SEARCH_HISTORY_STORAGE);
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
  // ストリーミング中も含め、【要約】行を表示から除去（改行がまだ来ていない途中状態も含む）
  text = text.replace(/^【要約】[^\n]*(\n|$)/, '').trim();
  // 全ての区切り線（---）を除去し、連続する空行を整理
  text = text.replace(/^---\s*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();

  // Markdownテーブルを先にHTMLテーブルに変換
  const parseMarkdownTable = (text) => {
    const lines = text.split('\n');
    const result = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      // テーブル行の検出: | で始まり | で終わる
      if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
        const tableLines = [];
        // 連続するテーブル行を収集
        while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
          tableLines.push(lines[i]);
          i++;
        }

        if (tableLines.length >= 2) {
          // セパレータ行（|---|---|）を検出
          const sepIndex = tableLines.findIndex(l => /^\|[\s\-:|]+\|$/.test(l.trim()));
          if (sepIndex === 1) {
            // 有効なテーブル
            const headerRow = tableLines[0];
            const dataRows = tableLines.slice(2);

            const parseRow = (row) => {
              return row.split('|').slice(1, -1).map(cell => cell.trim());
            };

            const headers = parseRow(headerRow);
            const rows = dataRows.map(parseRow);

            // HTMLテーブルを生成
            let html = '<div class="overflow-x-auto my-4"><table class="min-w-full border-collapse border border-gray-300 text-sm">';
            html += '<thead class="bg-gray-100"><tr>';
            headers.forEach(h => {
              html += `<th class="border border-gray-300 px-3 py-2 text-left font-semibold">${h}</th>`;
            });
            html += '</tr></thead><tbody>';
            rows.forEach((row, idx) => {
              const bgClass = idx % 2 === 0 ? 'bg-white' : 'bg-gray-50';
              html += `<tr class="${bgClass}">`;
              row.forEach(cell => {
                html += `<td class="border border-gray-300 px-3 py-2">${cell}</td>`;
              });
              html += '</tr>';
            });
            html += '</tbody></table></div>';

            result.push(html);
            continue;
          }
        }
        // テーブルとして認識できない場合はそのまま追加
        tableLines.forEach(l => result.push(l));
      } else {
        result.push(line);
        i++;
      }
    }

    return result.join('\n');
  };

  let cleanText = parseMarkdownTable(text)
    .replace(/^#{4,6}\s+/gm, '    ')
    .replace(/^###\s+/gm, '   ')
    .replace(/^##\s+/gm, '  ')
    .replace(/^#\s+/gm, ' ')
    .trim();

  // 「同法」「本法」などを直前の法令名に置き換える前処理
  // 最後に出現した法令名を記録しながら順番に置き換え
  const referenceMap = {
    '同法': '法', '本法': '法',
    '同法律': '法律', '本法律': '法律',
    '同令': '令', '本令': '令',
    '同規則': '規則', '本規則': '規則',
    '同規程': '規程', '本規程': '規程'
  };

  // 最後に見た各種法令名を記録
  const lastSeen = { '法': null, '法律': null, '令': null, '規則': null, '規程': null };

  // テキストを文字単位でスキャンして置き換え
  const allPattern = /【([^】]+?)(法律|法|令|規則|規程)\s*(第[一二三四五六七八九十百千0-9]+条(?:の[一二三四五六七八九十0-9]+)*)】/g;
  let result = '';
  let lastIndex = 0;
  let match;

  while ((match = allPattern.exec(cleanText)) !== null) {
    // マッチ前のテキストを追加
    result += cleanText.slice(lastIndex, match.index);

    const fullLawName = match[1] + match[2]; // 例: "民" + "法" = "民法"
    const suffix = match[2]; // 法、令、規則、規程
    const articleNum = match[3];

    // 「同法」「本法」などかチェック
    const refKey = match[1] + match[2]; // "同法", "本法" など
    if (referenceMap[refKey]) {
      // 直前の法令名で置き換え
      const actualLaw = lastSeen[suffix];
      if (actualLaw) {
        result += `【${actualLaw} ${articleNum}】`;
      } else {
        // 見つからない場合はそのまま
        result += match[0];
      }
    } else {
      // 通常の法令名 → 記録して出力
      lastSeen[suffix] = fullLawName;
      result += match[0];
    }

    lastIndex = match.index + match[0].length;
  }

  // 残りのテキストを追加
  result += cleanText.slice(lastIndex);
  cleanText = result;

  const paragraphs = cleanText.split('\n').filter(p => p.trim());

  return paragraphs.map((paragraph, index) => {
    // HTMLテーブルはそのまま出力
    if (paragraph.trim().startsWith('<div class="overflow-x-auto')) {
      return <div key={index} dangerouslySetInnerHTML={{ __html: paragraph }} />;
    }

    let content = paragraph;

    const originalContent = content;

    // 条文番号をクリッカブルなボタンに（太字変換より先に処理）
    // すべてのパターンを1つの関数で処理して重複マッチを防ぐ
    // 「法律」で終わる法令名にも対応（電子署名及び認証業務に関する法律など）
    content = content.replace(
      /(\*\*)?【(\*\*)?([^】*]+?(?:法律|法|令|規則|規程))(\*\*)?\s*(第[一二三四五六七八九十百千0-9]+条(?:の[一二三四五六七八九十0-9]+)*(?:第[一二三四五六七八九十0-9]+項)?)(?:[（(]([^）)]+)[）)])?】(\*\*)?/g,
      (match, preBold, innerBoldStart, lawName, innerBoldEnd, articleNum, caption, postBold) => {
        const trimmedLawName = lawName.trim();
        // captionがあれば表示に含める（ただしdata属性には含めない）
        const displayText = caption ? `【${trimmedLawName} ${articleNum}（${caption}）】` : `【${trimmedLawName} ${articleNum}】`;
        return `<button class="article-link inline-block font-bold text-blue-700 bg-blue-100 px-1.5 py-0.5 sm:px-2 sm:py-1 rounded border sm:border-2 border-blue-300 mx-0.5 shadow-sm hover:bg-blue-200 hover:border-blue-400 cursor-pointer transition-colors text-sm sm:text-base" data-law="${trimmedLawName}" data-article="${articleNum}">${displayText}</button>`;
      }
    );

    // 太字を強調（より目立つスタイル）
    content = content.replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-gray-900 bg-gray-100 px-1 rounded">$1</strong>');
    content = content.replace(/\*(.*?)\*/g, '<em class="italic text-gray-700">$1</em>');

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
        <div key={index} className="flex items-start gap-2 mb-2 ml-1">
          <span className="flex-shrink-0 w-5 h-5 sm:w-6 sm:h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs sm:text-sm font-bold">{number}</span>
          <p className="text-gray-800 leading-5 sm:leading-6 flex-1 pt-0.5 text-sm sm:text-base" dangerouslySetInnerHTML={{ __html: text }} />
        </div>
      );
    }

    if (isBulletList) {
      return (
        <div key={index} className="flex items-start gap-2 mb-2 ml-2">
          <span className="text-blue-600 font-bold text-sm">•</span>
          <p className="text-gray-800 leading-5 sm:leading-6 flex-1 text-sm sm:text-base" dangerouslySetInnerHTML={{ __html: content.replace(/^[・•]\s/, '') }} />
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
        <h4 key={index} className="font-bold text-gray-900 mt-3 mb-1 text-sm sm:text-base border-l-4 border-blue-600 pl-2 bg-blue-50 py-1" dangerouslySetInnerHTML={{ __html: content }} />
      );
    }

    // セクション区切り
    const isSectionStart = /^(まず|次に|また|さらに|最後に|ただし|なお|具体的には)、?/.test(paragraph);

    if (isSectionStart) {
      return (
        <p key={index} className="text-gray-800 leading-5 sm:leading-6 mb-2 mt-3 pl-2 border-l-2 border-blue-400 bg-blue-50 py-1.5 pr-2 text-sm sm:text-base" dangerouslySetInnerHTML={{ __html: content }} />
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
        <div key={index} className="bg-yellow-50 border-2 border-yellow-400 rounded-lg p-3 my-3">
          <div className="flex items-start gap-2">
            <span className="text-lg sm:text-xl">⚠️</span>
            <p className="text-gray-900 leading-5 sm:leading-6 font-semibold text-sm sm:text-base flex-1" dangerouslySetInnerHTML={{ __html: yellowContent }} />
          </div>
        </div>
      );
    }

    // 通常の段落
    return (
      <p key={index} className="text-gray-800 leading-5 sm:leading-6 mb-2 text-sm sm:text-base" dangerouslySetInnerHTML={{ __html: content }} />
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
  const [searchHistory, setSearchHistory] = useState([]);
  const [articlePopup, setArticlePopup] = useState(null); // { lawId, lawTitle, articleNum, loading, data, error }
  const [articlePopupPos, setArticlePopupPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // 最新の会話へのスクロール用ref
  const latestConversationRef = useRef(null);
  const [exportingConvId, setExportingConvId] = useState(null);

  // スクリーンショットエクスポート
  const handleExportScreenshot = async (convId) => {
    const el = document.querySelector(`[data-conv-export-id="${convId}"]`);
    if (!el) return;
    setExportingConvId(convId);
    try {
      // 一時的にスクロール制限を解除して全体をキャプチャ
      const scrollContainers = el.querySelectorAll('.lg\\:max-h-\\[calc\\(100vh-180px\\)\\]');
      const origStyles = [];
      scrollContainers.forEach(c => {
        origStyles.push({ maxHeight: c.style.maxHeight, overflow: c.style.overflow });
        c.style.maxHeight = 'none';
        c.style.overflow = 'visible';
      });

      const canvas = await html2canvas(el, {
        backgroundColor: '#f9fafb',
        scale: 2,
        useCORS: true,
        logging: false,
      });

      // スタイルを復元
      scrollContainers.forEach((c, i) => {
        c.style.maxHeight = origStyles[i].maxHeight;
        c.style.overflow = origStyles[i].overflow;
      });

      // ダウンロード
      const link = document.createElement('a');
      link.download = `joubun-kun_${new Date().toISOString().slice(0, 10)}_${convId.slice(0, 6)}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('スクリーンショットエラー:', err);
    } finally {
      setExportingConvId(null);
    }
  };

  // ===== ポップアップドラッグ処理 =====
  const handleDragStart = (e) => {
    if (e.target.tagName === 'BUTTON') return; // 閉じるボタンはドラッグ対象外
    setIsDragging(true);
    const rect = e.currentTarget.parentElement.getBoundingClientRect();
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    });
  };

  const handleDragMove = (e) => {
    if (!isDragging) return;
    setArticlePopupPos({
      x: Math.max(0, Math.min(e.clientX - dragOffset.x, window.innerWidth - 400)),
      y: Math.max(0, e.clientY - dragOffset.y)
    });
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  // ===== 参照条文クリック処理 =====
  const handleArticleRefClick = async (e, lawId, articleNum, lawTitle) => {
    e.preventDefault();
    e.stopPropagation();

    // クリック位置を取得
    const rect = e.target.getBoundingClientRect();
    setArticlePopupPos({
      x: Math.min(rect.left, window.innerWidth - 400),
      y: rect.bottom + window.scrollY + 5
    });

    // ローディング状態で表示
    setArticlePopup({ lawId, lawTitle, articleNum, loading: true, data: null, error: null });

    try {
      // lawIdがない場合はlawTitle（法令名）で検索
      const data = await fetchReferencedArticle(lawId, articleNum, lawId ? null : lawTitle);
      setArticlePopup(prev => ({ ...prev, loading: false, data }));
    } catch (err) {
      setArticlePopup(prev => ({ ...prev, loading: false, error: err.message }));
    }
  };

  // ポップアップを閉じる
  const closeArticlePopup = () => setArticlePopup(null);

  // 条文テキスト内の「第○条」をリンク化する関数
  // 他法令参照（例: 商法第526条）と同一法令参照（例: 第545条）の両方に対応
  // parentLawInfo: APIから取得した親法令情報（「法」「令」の解決用）
  const renderTextWithArticleLinks = (text, currentLawId, currentLawTitle, parentLawInfo = null, currentArticleNum = null) => {
    if (!text) return null;

    // マッチ結果を集める（位置でソートするため）
    const matches = [];

    // 4. 「前条」「次条」パターンをマッチ（現在の条文番号が必要）
    if (currentArticleNum) {
      const relativePattern = /(前条|次条)(?:第([一二三四五六七八九十]+|\d+)項)?(?:第([一二三四五六七八九十]+|\d+)号)?/g;
      let relMatch;
      while ((relMatch = relativePattern.exec(text)) !== null) {
        const relType = relMatch[1]; // 「前条」or「次条」
        // 現在の条文番号から相対条文を計算
        const currentNum = parseInt(currentArticleNum, 10);
        if (!isNaN(currentNum)) {
          const targetNum = relType === '前条' ? currentNum - 1 : currentNum + 1;
          if (targetNum > 0) {
            matches.push({
              index: relMatch.index,
              length: relMatch[0].length,
              fullMatch: relMatch[0],
              lawId: currentLawId,
              lawTitle: currentLawTitle,
              articleNum: String(targetNum),
              isOtherLaw: false,
              isRelativeRef: true
            });
          }
        }
      }
    }

    // 親法令情報を取得（APIから取得した情報を優先、なければ動的生成）
    const parentMap = parentLawInfo || getParentLawInfo(currentLawTitle);

    // 1. 他法令参照パターンを先にマッチ（完全な法令名を優先）
    // 例: 「法人税法第百四十一条」→ 法人税法への参照
    const otherLawPattern = new RegExp(OTHER_LAW_REF_PATTERN.source, 'g');
    let match;
    while ((match = otherLawPattern.exec(text)) !== null) {
      const lawName = match[1];
      const articleNumKanji = match[2];
      const articleNum = kanjiToArabic(articleNumKanji);
      const subNumKanji = match[3]; // 枝番（「の二」の「二」部分）
      const subNum = subNumKanji ? kanjiToArabic(subNumKanji) : null;
      const targetLawId = LAW_NAME_TO_ID[lawName] || null;

      // 法令名が現在の法令と同じ場合はスキップ（同一法令参照として扱う）
      if (lawName === currentLawTitle) continue;

      // 枝番がある場合は「54_2」形式、なければ「54」形式
      const articleKey = subNum ? `${articleNum}_${subNum}` : `${articleNum}`;

      matches.push({
        index: match.index,
        length: match[0].length,
        fullMatch: match[0],
        lawId: targetLawId,
        lawTitle: lawName,
        articleNum: articleKey,
        isOtherLaw: true,
        hasLawId: !!targetLawId
      });
    }

    // 2. 「法第X条」「令第X条」形式をマッチ（施行令・施行規則から親法令への参照）
    // 注意: 「○○法第X条」などの完全な法令名参照は除外（上で処理済み）
    // 親法令情報がある場合のみ処理（施行令・施行規則の場合）
    if (parentMap) {
      const shortRefPattern = /(法|令)第([一二三四五六七八九十百千〇]+|\d+)条(?:の([一二三四五六七八九十〇]+|\d+))?(?:第([一二三四五六七八九十]+|\d+)(?:項|号))?/g;
      while ((match = shortRefPattern.exec(text)) !== null) {
        // 既存のマッチ（完全な法令名参照）と重複していないかチェック
        const overlaps = matches.some(m =>
          (match.index >= m.index && match.index < m.index + m.length) ||
          (m.index >= match.index && m.index < match.index + match[0].length)
        );
        if (overlaps) continue;

        // マッチ位置の直前の文字をチェック
        // 「○○法第X条」のような完全な法令名参照の場合はスキップ
        const prevCharIndex = match.index - 1;
        if (prevCharIndex >= 0) {
          const prevChar = text[prevCharIndex];
          // 直前が漢字で、かつ一般的な助詞・区切りでない場合はスキップ
          // これは「法人税法第X条」の「法」部分にマッチしないようにするため
          // 許可する文字: 助詞（の、は、が、を、に、で、と、へ、も、や）、句読点、括弧など
          if (/[\u4e00-\u9fff]/.test(prevChar)) {
            const allowedPrev = /[のはがをにでとへもやよりからまでばかたてるれ]/.test(prevChar);
            if (!allowedPrev) {
              continue;
            }
          }
        }

        const shortName = match[1]; // 「法」or「令」
        const articleNumKanji = match[2];
        const articleNum = kanjiToArabic(articleNumKanji);
        const subNumKanji = match[3];
        const subNum = subNumKanji ? kanjiToArabic(subNumKanji) : null;

        // 親法令マッピングから実際の法令名を取得
        if (parentMap[shortName]) {
          const resolvedLawName = parentMap[shortName];
          const targetLawId = parentMap[shortName + '_id'] || LAW_NAME_TO_ID[resolvedLawName] || null;
          const articleKey = subNum ? `${articleNum}_${subNum}` : `${articleNum}`;

          matches.push({
            index: match.index,
            length: match[0].length,
            fullMatch: match[0],
            lawId: targetLawId,
            lawTitle: resolvedLawName,  // 解決された法令名（例: 地方税法）
            displayLawTitle: shortName, // 表示用（元の「法」「令」）
            articleNum: articleKey,
            isOtherLaw: true,
            hasLawId: !!targetLawId,
            isShortRef: true  // 略称参照フラグ
          });
        }
      }
    }

    // 3. 同一法令参照パターンをマッチ（他法令参照・略称参照と重複しない位置のみ）
    const sameLawPattern = new RegExp(ARTICLE_REF_PATTERN.source, 'g');
    while ((match = sameLawPattern.exec(text)) !== null) {
      // 他法令パターンと重複していないかチェック
      const overlaps = matches.some(m =>
        (match.index >= m.index && match.index < m.index + m.length) ||
        (m.index >= match.index && m.index < match.index + match[0].length)
      );

      if (!overlaps) {
        const articleNumKanji = match[1];
        const articleNum = kanjiToArabic(articleNumKanji);
        const subNumKanji = match[2]; // 枝番（「の二」の「二」部分）
        const subNum = subNumKanji ? kanjiToArabic(subNumKanji) : null;

        // 枝番がある場合は「54_2」形式、なければ「54」形式
        const articleKey = subNum ? `${articleNum}_${subNum}` : `${articleNum}`;

        matches.push({
          index: match.index,
          length: match[0].length,
          fullMatch: match[0],
          lawId: currentLawId,
          lawTitle: currentLawTitle,
          articleNum: articleKey,
          isOtherLaw: false
        });
      }
    }

    // マッチがなければそのまま返す
    if (matches.length === 0) return text;

    // 位置でソート
    matches.sort((a, b) => a.index - b.index);

    // パーツを構築
    const parts = [];
    let lastIndex = 0;

    matches.forEach((m, i) => {
      // マッチ前のテキスト
      if (m.index > lastIndex) {
        parts.push(text.slice(lastIndex, m.index));
      }

      // 他法令リンクは緑系、同一法令リンクは青系で区別
      // law_idがない他法令は薄緑（クリック可能だが法令名検索になる）
      let colorClass;
      let titleText;

      if (m.isOtherLaw) {
        if (m.isShortRef) {
          // 「法」「令」略称参照 → 紫系で表示、ツールチップで解決先を表示
          colorClass = "text-purple-600 hover:text-purple-800 hover:underline cursor-pointer font-medium";
          titleText = `${m.lawTitle} 第${formatArticleNum(m.articleNum)}を表示（「${m.displayLawTitle}」= ${m.lawTitle}）`;
        } else if (m.hasLawId) {
          colorClass = "text-green-600 hover:text-green-800 hover:underline cursor-pointer font-medium";
          titleText = `${m.lawTitle} 第${formatArticleNum(m.articleNum)}を表示（e-Gov API）`;
        } else {
          colorClass = "text-teal-600 hover:text-teal-800 hover:underline cursor-pointer font-medium";
          titleText = `${m.lawTitle} 第${formatArticleNum(m.articleNum)}を表示（法令名で検索）`;
        }
      } else {
        colorClass = "text-blue-600 hover:text-blue-800 hover:underline cursor-pointer font-medium";
        titleText = `${m.lawTitle} ${m.fullMatch}を表示`;
      }

      parts.push(
        <span
          key={`${m.index}-${i}`}
          className={colorClass}
          onClick={(e) => handleArticleRefClick(e, m.lawId, m.articleNum, m.lawTitle)}
          title={titleText}
        >
          {m.fullMatch}
        </span>
      );

      lastIndex = m.index + m.length;
    });

    // 残りのテキスト
    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    return parts;
  };

  // ハイライト情報を使ってテキストにハイライトを適用する関数
  const applyHighlights = (text, highlights, lawTitle, articleTitle) => {
    if (!highlights || highlights.length === 0) return text;

    // この条文に対するハイライトを探す
    const articleHighlights = highlights.filter(h =>
      h.law === lawTitle && h.article === articleTitle
    );

    if (articleHighlights.length === 0) return text;

    let result = text;
    for (const h of articleHighlights) {
      if (h.text && h.text.length > 5) {
        // 部分一致でハイライト（前後の文字も考慮）
        const escapedText = h.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${escapedText})`, 'g');
        result = result.replace(regex, '<mark class="bg-yellow-200 px-0.5 rounded">$1</mark>');
      }
    }
    return result;
  };

  // refsデータの位置情報を使ってテキストにリンクを埋め込む関数
  const renderTextWithRefsLinks = (text, refs, paragraphNum, currentLawId, currentLawTitle, currentArticleTitle = null) => {
    // 現在の条文番号を抽出（「第四百五十五条」→「455」）
    let currentArticleNum = null;
    if (currentArticleTitle) {
      const match = currentArticleTitle.match(/第([一二三四五六七八九十百千〇]+|\d+)条/);
      if (match) {
        currentArticleNum = String(kanjiToArabic(match[1]));
      }
    }

    // 親法令情報を取得（「法第X条」→ 親法令へのリンク用）
    const parentLawInfo = getParentLawInfo(currentLawTitle);

    if (!text || !refs || refs.length === 0) {
      return renderTextWithArticleLinks(text, currentLawId, currentLawTitle, parentLawInfo, currentArticleNum);
    }
    // この項に対応するrefsを抽出
    const paragraphRefs = refs.filter(r => r.paragraph === paragraphNum);
    if (paragraphRefs.length === 0) {
      return renderTextWithArticleLinks(text, currentLawId, currentLawTitle, parentLawInfo, currentArticleNum);
    }
    // 位置でソート
    const sortedRefs = [...paragraphRefs].sort((a, b) => (a.start || 0) - (b.start || 0));
    // 重複する範囲をマージ
    const mergedRefs = [];
    for (const ref of sortedRefs) {
      if (ref.start === undefined || ref.end === undefined) continue;
      const existing = mergedRefs.find(m => m.start === ref.start && m.end === ref.end);
      if (existing) {
        existing.targets.push(ref.target);
      } else {
        mergedRefs.push({ start: ref.start, end: ref.end, text: ref.text, targets: [ref.target] });
      }
    }
    if (mergedRefs.length === 0) {
      return renderTextWithArticleLinks(text, currentLawId, currentLawTitle, parentLawInfo, currentArticleNum);
    }
    // テキストを分割してリンク化
    const parts = [];
    let lastIndex = 0;
    for (const ref of mergedRefs) {
      if (ref.start > lastIndex) {
        const beforeText = text.slice(lastIndex, ref.start);
        const linkedBefore = renderTextWithArticleLinks(beforeText, currentLawId, currentLawTitle, parentLawInfo, currentArticleNum);
        parts.push(<React.Fragment key={`before-${ref.start}`}>{linkedBefore}</React.Fragment>);
      }
      const linkText = text.slice(ref.start, ref.end);
      const firstTarget = ref.targets[0];
      const targetMatch = firstTarget.match(/_Art(\d+)/);
      const targetArticleNum = targetMatch ? targetMatch[1] : null;
      parts.push(
        <span
          key={`ref-${ref.start}`}
          className="text-blue-600 hover:text-blue-800 hover:underline cursor-pointer font-medium"
          onClick={(e) => handleArticleRefClick(e, currentLawId, targetArticleNum, currentLawTitle)}
          title={`${currentLawTitle} 第${targetArticleNum}条を表示${ref.targets.length > 1 ? ` (他${ref.targets.length - 1}条)` : ''}`}
        >
          {linkText}
        </span>
      );
      lastIndex = ref.end;
    }
    if (lastIndex < text.length) {
      const afterText = text.slice(lastIndex);
      const linkedAfter = renderTextWithArticleLinks(afterText, currentLawId, currentLawTitle, parentLawInfo, currentArticleNum);
      parts.push(<React.Fragment key={`after-${lastIndex}`}>{linkedAfter}</React.Fragment>);
    }
  return parts;
};

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
    loadSearchHistory();
    initialize();
  }, []);

  // ===== 新しい会話が追加されたらスクロール（ストリーミング中は除く）=====
  const prevConversationsLengthRef = useRef(0);
  useEffect(() => {
    // 会話の数が増えた時のみスクロール（ストリーミング中の更新では発動しない）
    if (latestConversationRef.current && conversations.length > prevConversationsLengthRef.current) {
      latestConversationRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    prevConversationsLengthRef.current = conversations.length;
  }, [conversations.length]);

  // ===== 条文リンクのクリックイベント（ネイティブイベントリスナー）=====
  useEffect(() => {
    const handleArticleLinkClick = (e) => {
      const target = e.target.closest('.article-link');
      if (!target) return;

      e.preventDefault();
      e.stopPropagation();

      const lawName = target.dataset.law;
      const articleNum = target.dataset.article;

      // データ属性が取得できない場合は無視
      if (!lawName || !articleNum) {
        console.warn('条文リンクのdata属性が不正:', { lawName, articleNum });
        return;
      }

      // 該当する会話のIDを取得（親要素から探す）
      const conversationDiv = target.closest('[data-explanation-conv-id]');
      const convId = conversationDiv?.dataset.explanationConvId;

      // 右側の条文エリアで該当条文を探す
      const selector = convId
        ? `[data-conv-id="${convId}"] .article-card`
        : '.article-card';
      const articleElements = document.querySelectorAll(selector);

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

      let found = false;
      for (const el of articleElements) {
        const text = el.textContent;

        // 法令名チェック
        const lawMatched = text.includes(lawName);
        // 条文番号チェック（漢数字で検索、枝番号含む）
        const articleMatched = text.includes(fullArticlePattern);

        if (lawMatched && articleMatched) {
          found = true;

          // 会話IDを使って直接その会話の条文コンテナを取得
          let scrollContainer = null;
          if (convId) {
            scrollContainer = document.getElementById(`articles-container-${convId}`);
          }

          // 見つからない場合は従来の方法でスクロールコンテナを探す
          if (!scrollContainer) {
            scrollContainer = el.closest('.overflow-y-auto');
          }
          if (!scrollContainer) {
            // lg:overflow-y-auto の場合、実際のスタイルで判定
            let parent = el.parentElement;
            while (parent) {
              const style = window.getComputedStyle(parent);
              if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
                scrollContainer = parent;
                break;
              }
              parent = parent.parentElement;
            }
          }

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
            // フォールバック: 条文要素を画面に表示
            el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }

          el.classList.add('ring-4', 'ring-yellow-400');
          setTimeout(() => el.classList.remove('ring-4', 'ring-yellow-400'), 2000);
          break; // 最初のマッチで終了
        }
      }

      if (!found) {
        // カスタムイベントを発火してポップアップ表示をトリガー
        const customEvent = new CustomEvent('showArticlePopup', {
          detail: {
            lawTitle: lawName,
            articleNum: articleNumber + (articleSuffix ? articleSuffix.replace('の', '_') : ''),
            targetElement: target,
            lawId: COMMON_LAW_IDS[lawName] || null  // 法令名からIDを解決
          }
        });
        document.dispatchEvent(customEvent);
      }
    };

    // ドキュメント全体にイベントリスナーを追加
    document.addEventListener('click', handleArticleLinkClick);

    // カスタムイベントをリッスンしてサイドバースクロール or ポップアップ表示
    const handleShowArticlePopup = async (e) => {
      const { lawTitle, articleNum, targetElement, lawId } = e.detail;

      // 条文番号を「第○条」形式に変換（8_4 → 第八条の四）
      const formatArticleTitle = (num) => {
        // アラビア数字を漢数字に変換
        const arabicToKanji = (n) => {
          const digits = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
          const units = ['', '十', '百', '千'];
          let result = '';
          const numStr = String(n);
          const len = numStr.length;
          for (let i = 0; i < len; i++) {
            const digit = parseInt(numStr[i], 10);
            const unitIndex = len - i - 1;
            if (digit === 0) continue;
            if (unitIndex > 0 && digit === 1) {
              result += units[unitIndex];
            } else {
              result += digits[digit] + units[unitIndex];
            }
          }
          return result || '〇';
        };

        // 「8_4」→「八」「四」の形式
        const parts = String(num).split('_');
        const mainNum = arabicToKanji(parseInt(parts[0], 10));
        if (parts.length > 1) {
          const subNum = arabicToKanji(parseInt(parts[1], 10));
          return `第${mainNum}条の${subNum}`;
        }
        return `第${mainNum}条`;
      };

      const articleTitle = formatArticleTitle(articleNum);
      const searchId = `${lawTitle}-${articleTitle}`;

      // サイドバーに該当条文があるか確認
      const targetCard = document.querySelector(`[data-article-id="${searchId}"]`);
      if (targetCard) {
        // サイドバーにスクロール + ハイライト
        targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        targetCard.classList.add('ring-4', 'ring-yellow-400', 'ring-opacity-75');
        setTimeout(() => {
          targetCard.classList.remove('ring-4', 'ring-yellow-400', 'ring-opacity-75');
        }, 2000);
        return;
      }

      // サイドバーにない場合はポップアップ表示
      const rect = targetElement.getBoundingClientRect();
      setArticlePopupPos({
        x: Math.min(rect.left, window.innerWidth - 400),
        y: rect.bottom + window.scrollY + 5
      });

      setArticlePopup({ lawId, lawTitle, articleNum, loading: true, data: null, error: null });

      try {
        const data = await fetchReferencedArticle(lawId, articleNum, lawTitle);
        setArticlePopup(prev => ({ ...prev, loading: false, data }));
      } catch (err) {
        setArticlePopup(prev => ({ ...prev, loading: false, error: err.message }));
      }
    };

    document.addEventListener('showArticlePopup', handleShowArticlePopup);

    return () => {
      document.removeEventListener('click', handleArticleLinkClick);
      document.removeEventListener('showArticlePopup', handleShowArticlePopup);
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

  const loadSearchHistory = () => {
    setSearchHistory(getSearchHistory());
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

  // ===== Claude API ストリーミング呼び出し（Worker経由）=====
  const callClaudeStream = async (messages, system = '', onChunk) => {
    const response = await fetch(`${WORKER_URL}/api/chat-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, system })
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`Claude API error: ${errorData}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              fullText += parsed.delta.text;
              onChunk(fullText);
            }
          } catch (e) {
            // パースエラーは無視
          }
        }
      }
    }

    return fullText;
  };

  // ===== 検索処理 =====
  const handleSearch = async (searchQuery = null) => {
    const actualQuery = (typeof searchQuery === 'string') ? searchQuery : query;

    if (!actualQuery.trim() || modelLoading) return;

    // 検索履歴を保存
    saveSearchHistory(actualQuery.trim());
    setSearchHistory(getSearchHistory());

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
        const greetingResponse = queryResult.greeting_response || 'こんにちは！法令に関する質問があればお気軽にどうぞ。';
        setConversations(prev => [...prev, {
          id: Date.now(),
          question: actualQuery,
          answer: greetingResponse,
          relevantArticles: [],
          refsMap: {},
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

      setProgress(70);

      // 【第3段階】Claude呼び出し1回目：条文選定のみ
      setProcessingStep('🤖 AIが条文を選定中...');

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

      // 条文選定プロンプト（1回目）
      const selectionPrompt = `あなたは法令検索のアシスタントです。

【ユーザーの質問】
${actualQuery}

${articleContext}

【タスク】
上記の候補条文から、ユーザーの質問に関連する条文を選んでください。

【選択基準】
- スコアが高い条文を優先
- 上位10番以内の条文を優先
- 条文の内容全体を見て判断

【回答形式】
必ず以下のJSON形式のみで回答してください（他の文章は不要）：

{"selected_indices": [1, 2, 3]}

- selected_indices: 関連する条文の番号（候補リストの1〜20から選択、最大5件）
- **重要度が高い順に並べてください**（最も関連性の高い条文を先頭に）
- 見つからない場合は空配列 []
`;

      let selectionResponse;
      try {
        selectionResponse = await callClaude([{ role: "user", content: selectionPrompt }], '', 200);
      } catch (apiError) {
        console.error('❌ Claude条文選定エラー:', apiError);
        throw apiError;
      }

      // 選定結果をパース
      let selectedIndices = [];
      try {
        const cleanJson = selectionResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const parsed = JSON.parse(cleanJson);
        selectedIndices = parsed.selected_indices || [];
      } catch (parseError) {
        console.error('⚠️ 選定結果パースエラー、上位3件を使用');
        selectedIndices = [1, 2, 3];
      }

      // 選択された条文を抽出
      let selectedArticles = selectedIndices
        .filter(idx => idx >= 1 && idx <= top20.length)
        .map(idx => top20[idx - 1]);

      // paragraphsが空のものを除外＆重複除去
      const seenKeys = new Set();
      selectedArticles = selectedArticles.filter(item => {
        if (!item.article.paragraphs || item.article.paragraphs.length === 0) return false;
        const key = `${item.law.law_id}_${item.article.title}`;
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
      });

      // プロフェッショナルモード: refs取得後、説明文生成をスキップして条文のみ表示
      if (proMode) {
        setProcessingStep('🔗 関連条文を取得中...');
        setProgress(80);

        // refs取得
        let refsData = [];
        if (selectedArticles.length > 0) {
          try {
            const refsResponse = await fetch(`${WORKER_URL}/api/refs`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                articles: selectedArticles.map(item => ({
                  law_id: item.law.law_id,
                  article_title: item.article.title
                }))
              })
            });
            if (refsResponse.ok) {
              const refsResult = await refsResponse.json();
              refsData = refsResult.results || [];
            }
          } catch (refsError) {
            console.error('⚠️ 参照情報取得エラー（続行）:', refsError);
          }
        }

        // refsMapを作成
        const refsMap = {};
        refsData.forEach(r => {
          const key = `${r.law_id}_${r.article_title}`;
          refsMap[key] = r.refs || [];
        });

        // 参照先条文のIDを収集
        const refTargets = new Set();
        refsData.forEach(r => {
          r.refs?.forEach(ref => {
            if (ref.target) refTargets.add(ref.target);
          });
          r.reverse_refs?.slice(0, 5).forEach(revRef => {
            if (typeof revRef === 'string') refTargets.add(revRef);
          });
        });

        // 参照先条文をフェッチ
        let refArticlesData = {};
        if (refTargets.size > 0) {
          setProcessingStep('📖 参照条文を取得中...');
          try {
            const articlesResponse = await fetch(`${WORKER_URL}/api/articles`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ articleIds: [...refTargets] })
            });
            if (articlesResponse.ok) {
              const articlesResult = await articlesResponse.json();
              (articlesResult.results || []).forEach(art => {
                refArticlesData[art.id] = art;
              });
            }
          } catch (refArticlesError) {
            console.error('⚠️ 参照先条文取得エラー（続行）:', refArticlesError);
          }
        }

        setProgress(100);

        // 選定条文
        const displayArticles = selectedArticles.map(item => ({
          article: item.article,
          lawData: item.law,
          similarity: item.score
        }));

        // 参照条文（オレンジ）を追加
        const refArticles = Object.values(refArticlesData)
          .filter(refArt => refArt.article?.paragraphs?.length > 0)
          .map(refArt => ({
            article: refArt.article,
            lawData: { law_id: refArt.law_id, law_title: refArt.law_title },
            similarity: 0,
            isReference: true
          }));

        setConversations(prev => [...prev, {
          id: Date.now(),
          question: actualQuery,
          answer: null,  // 説明文なし
          relevantArticles: [...displayArticles, ...refArticles],
          refsMap: refsMap,
          timestamp: new Date(),
          isProMode: true
        }]);

        setQuery('');
        setProcessingStep('');
        setProgress(0);
        setLoading(false);
        return;
      }

      // 【第4段階】参照条文情報を取得
      setProcessingStep('🔗 関連条文を取得中...');
      setProgress(75);

      let refsData = [];
      if (selectedArticles.length > 0) {
        try {
          const refsResponse = await fetch(`${WORKER_URL}/api/refs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              articles: selectedArticles.map(item => ({
                law_id: item.law.law_id,
                article_title: item.article.title
              }))
            })
          });
          if (refsResponse.ok) {
            const refsResult = await refsResponse.json();
            refsData = refsResult.results || [];
          }
        } catch (refsError) {
          console.error('⚠️ 参照情報取得エラー（続行）:', refsError);
        }
      }

      // 参照先条文の内容を取得（refs内のtargetから）
      const refTargets = new Set();
      refsData.forEach(r => {
        r.refs?.forEach(ref => {
          if (ref.target) {
            refTargets.add(ref.target);
          }
        });
        // reverse_refsは条文IDの配列（最大5件に制限）
        r.reverse_refs?.slice(0, 5).forEach(revRef => {
          if (typeof revRef === 'string') refTargets.add(revRef);
        });
      });

      // 参照先条文をフェッチ
      let refArticlesData = {};
      if (refTargets.size > 0) {
        try {
          const articlesResponse = await fetch(`${WORKER_URL}/api/articles`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ articleIds: [...refTargets] })
          });
          if (articlesResponse.ok) {
            const articlesResult = await articlesResponse.json();
            // IDでアクセスできるようにMap化
            (articlesResult.results || []).forEach(art => {
              refArticlesData[art.id] = art;
            });
          }
        } catch (refArticlesError) {
          console.error('⚠️ 参照先条文取得エラー（続行）:', refArticlesError);
        }
      }

      // 【第5段階】Claude呼び出し2回目：説明文生成
      setProcessingStep('🤖 AIが解説を生成中...');
      setProgress(85);

      // 選定条文 + 参照情報をコンテキストに
      let explainContext = '\n\n【選定された条文】\n';
      selectedArticles.forEach((item, index) => {
        explainContext += `\n${index + 1}. ${item.law.law_title} ${item.article.title}`;
        if (item.article.caption) {
          explainContext += ` ${item.article.caption}`;
        }
        explainContext += `\n`;
        item.article.paragraphs.forEach(p => {
          // 項の本文（sentences）
          p.sentences.forEach(s => {
            explainContext += `${p.num !== "1" ? p.num + " " : ""}${s.text}\n`;
          });
          // 号（items）がある場合は追加
          if (p.items && p.items.length > 0) {
            p.items.forEach(it => {
              const itemLabel = it.item_title || it.item_num || '';
              it.sentences?.forEach(s => {
                explainContext += `  ${itemLabel} ${s.text}\n`;
              });
              // 号の中のsub_items（イ、ロ、ハ等）がある場合
              if (it.sub_items && it.sub_items.length > 0) {
                it.sub_items.forEach(sub => {
                  const subLabel = sub.sub_item_title || sub.sub_item_num || '';
                  sub.sentences?.forEach(s => {
                    explainContext += `    ${subLabel} ${s.text}\n`;
                  });
                });
              }
            });
          }
        });

        // 参照情報を追加
        const articleRefs = refsData.find(r =>
          r.law_id === item.law.law_id && r.article_title === item.article.title
        );
        if (articleRefs) {
          if (articleRefs.refs.length > 0) {
            explainContext += `  → この条文が参照: ${articleRefs.refs.map(r => r.text || r.target).join(', ')}\n`;
          }
          if (articleRefs.reverse_refs.length > 0) {
            explainContext += `  ← この条文を参照している条文: ${articleRefs.reverse_refs.slice(0, 5).join(', ')}${articleRefs.reverse_refs.length > 5 ? '...' : ''}\n`;
          }
        }
        explainContext += '\n';
      });

      // 参照先条文の内容を追加
      if (Object.keys(refArticlesData).length > 0) {
        explainContext += '\n【参照先条文の内容】\n';
        for (const [refId, refArt] of Object.entries(refArticlesData)) {
          explainContext += `\n◆ ${refArt.law_title} ${refArt.article.title}`;
          if (refArt.article.caption) explainContext += ` ${refArt.article.caption}`;
          explainContext += '\n';
          refArt.article.paragraphs?.forEach(p => {
            // 項の本文
            p.sentences?.forEach(s => {
              explainContext += `${p.num !== "1" ? p.num + " " : ""}${s.text}\n`;
            });
            // 号（items）がある場合は追加
            if (p.items && p.items.length > 0) {
              p.items.forEach(it => {
                const itemLabel = it.item_title || it.item_num || '';
                it.sentences?.forEach(s => {
                  explainContext += `  ${itemLabel} ${s.text}\n`;
                });
                // sub_items（イ、ロ、ハ等）
                if (it.sub_items && it.sub_items.length > 0) {
                  it.sub_items.forEach(sub => {
                    const subLabel = sub.sub_item_title || sub.sub_item_num || '';
                    sub.sentences?.forEach(s => {
                      explainContext += `    ${subLabel} ${s.text}\n`;
                    });
                  });
                }
              });
            }
          });
        }
      }

      // 簡潔モードと通常モードでプロンプトを分岐
      const instructionText = proMode
        ? `【指示（簡潔回答）】
- 関連条文を列挙し、各条文の関連性を簡潔に記載
- 条文内容の説明は不要
- 「【法令名 第X条】：関連性」の形式で`
        : `【指示】
- まず結論を述べる
- 関連条文を「【法令名 第X条】」形式で引用しつつ、平易な言葉で説明
- 参照関係（→/←）がある場合は、その関連性も説明に含める
- 法律用語は必要に応じて補足
- 注意点や例外があれば明記`;

      const explainPrompt = `あなたは法令検索のアシスタントです。

【ユーザーの質問】
${actualQuery}

${explainContext}

【絶対厳守】
- 回答には**上記の選定条文のみ**を使用してください
- リストにない条文は、たとえ関連がありそうでも**絶対に言及しないでください**
- 条文を引用する際は必ず「【法令名 第X条】」の形式を使用してください
- 「同法」「本法」「前条」などの省略表現は**絶対に使用禁止**です。必ず正式な法令名を毎回書いてください

${instructionText}

まず最初に、以下の形式で要約を1行で記載してください：
【要約】質問内容と言及する条文（条文番号＋見出し）を簡潔に要約（例：「不法行為による損害賠償について、民法709条（不法行為による損害賠償）、710条（財産以外の損害の賠償）を説明」）

その後、改行して本文の回答を生成してください。見つからない場合は「お探しの内容に直接該当する条文は見つかりませんでした。」と記載してください。
`;

      // 過去の会話履歴を構築
      const messages = [];
      conversations.forEach(conv => {
        messages.push({ role: "user", content: conv.question });
        messages.push({ role: "assistant", content: conv.answer });
      });
      messages.push({ role: "user", content: explainPrompt });

      // ストリーミング用の一時的な会話エントリを作成
      const tempConvId = Date.now();
      setConversations(prev => [...prev, {
        id: tempConvId,
        question: actualQuery,
        answer: '',
        relevantArticles: [],
        refsMap: {},
        timestamp: new Date(),
        isStreaming: true
      }]);

      let answer;
      try {
        answer = await callClaudeStream(messages, '', (partialText) => {
          // ストリーミング中に回答を逐次更新
          setConversations(prev => prev.map(conv =>
            conv.id === tempConvId
              ? { ...conv, answer: partialText }
              : conv
          ));
        });
      } catch (apiError) {
        console.error('❌ Claude説明文生成エラー:', apiError);
        // エラー時は一時エントリを削除
        setConversations(prev => prev.filter(conv => conv.id !== tempConvId));
        throw apiError;
      }

      // 【第6段階】説明文から言及された条文を抽出してフィルタリング
      setProcessingStep('📖 条文を整理中...');
      setProgress(95);

      // 説明文から「【法令名 第X条】」「法令名第X条」などのパターンを抽出
      // → 説明文に言及された条文のみを右サイドバーに表示
      const mentionedInAnswer = new Set(); // 「法令名_条文タイトル」のセット
      // アラビア数字と漢数字の両方に対応、スペースなし・枝番複数にも対応
      // 「法律」で終わる法令名にも対応（電子署名及び認証業務に関する法律など）
      const mentionPatterns = [
        // 【法令名 第X条】【法令名第X条】【法令名 第X条の7の4】など
        /【([^】]+?(?:法律|法|令|規則|規程))\s*第([一二三四五六七八九十百千〇0-9]+)条((?:の[一二三四五六七八九十0-9]+)*)(?:第[0-9一二三四五六七八九十]+項)?】/g,
        /(?:^|[（(「『\s])([^\s（(「『【】）)」』]+?(?:法律|法|令|規則|規程))\s*第([一二三四五六七八九十百千〇0-9]+)条((?:の[一二三四五六七八九十0-9]+)*)/gm
      ];

      // 別表パターン（「【登録免許税法 別表第一】」「登録免許税法別表第一」等）
      const appendixPatterns = [
        /【([^】]+?(?:法律|法|令|規則|規程))\s*別表\s*(?:第\s*)?([一二三四五六七八九十0-9]+)】/g,
        /(?:^|[（(「『\s])([^\s（(「『【】）)」』]+?(?:法律|法|令|規則|規程))\s*別表\s*(?:第\s*)?([一二三四五六七八九十0-9]+)/gm
      ];

      // アラビア数字を漢数字に変換するヘルパー
      const arabicToKanjiLocal = (str) => {
        if (!str) return str;
        if (/^\d+$/.test(str)) {
          const num = parseInt(str, 10);
          const digits = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
          const units = ['', '十', '百', '千'];
          if (num === 0) return '〇';
          let result = '';
          let n = num;
          let pos = 0;
          while (n > 0) {
            const digit = n % 10;
            if (digit !== 0) {
              if (pos > 0 && digit === 1) {
                result = units[pos] + result;
              } else {
                result = digits[digit] + units[pos] + result;
              }
            }
            n = Math.floor(n / 10);
            pos++;
          }
          return result;
        }
        return str;
      };

      // 法令名として無効なパターン（「同法」「本法」「前法」など）
      const invalidLawNames = ['同法', '本法', '前法', '同法律', '本法律', '前法律', '同令', '本令', '前令', '同規則', '本規則', '前規則'];

      // 選定条文から親法令を特定（「法第X条」の解決用）
      // 例：選定条文に「会社計算規則」があれば、「法」→「会社法」と解釈
      let detectedParentLaw = null;
      for (const item of selectedArticles) {
        const parentLaw = PARENT_LAW_MAP[item.law.law_title];
        if (parentLaw) {
          detectedParentLaw = parentLaw;
          console.log(`📚 親法令検出: ${item.law.law_title} → ${parentLaw}`);
          break;
        }
      }

      for (const pattern of mentionPatterns) {
        let match;
        while ((match = pattern.exec(answer)) !== null) {
          let lawName = match[1].trim();
          // 無効な法令名はスキップ
          if (invalidLawNames.includes(lawName)) {
            continue;
          }
          // 「法」単体の場合、親法令に変換
          if (lawName === '法' && detectedParentLaw) {
            lawName = detectedParentLaw;
            console.log(`🔄 「法」→「${detectedParentLaw}」に変換`);
          } else if (lawName === '法') {
            // 親法令が特定できない場合はスキップ
            continue;
          }
          // アラビア数字を漢数字に変換して統一
          const articleNum = arabicToKanjiLocal(match[2]);
          // 枝番部分（「の7の4」→「の七の四」）を処理
          let subNumPart = match[3] || '';
          if (subNumPart) {
            // 「の7の4」を分解して各数字を漢数字に変換
            subNumPart = subNumPart.replace(/の([一二三四五六七八九十0-9]+)/g, (_, num) => {
              return 'の' + arabicToKanjiLocal(num);
            });
          }
          const articleTitle = `第${articleNum}条${subNumPart}`;
          mentionedInAnswer.add(`${lawName}_${articleTitle}`);
        }
      }

      // 別表パターンのマッチ処理（法令名付き）
      for (const pattern of appendixPatterns) {
        let match;
        while ((match = pattern.exec(answer)) !== null) {
          let lawName = match[1].trim();
          if (invalidLawNames.includes(lawName)) continue;
          if (lawName === '法' && detectedParentLaw) {
            lawName = detectedParentLaw;
          } else if (lawName === '法') {
            continue;
          }
          const appendixNum = arabicToKanjiLocal(match[2]);
          const articleTitle = `別表第${appendixNum}`;
          mentionedInAnswer.add(`${lawName}_${articleTitle}`);
        }
      }

      // 別表パターン（法令名なし「別表第一」等）→ 選定条文から法令名を推定
      const standaloneAppendixPattern = /別表\s*(?:第\s*)?([一二三四五六七八九十0-9]+)/g;
      let saMatch;
      while ((saMatch = standaloneAppendixPattern.exec(answer)) !== null) {
        const appendixNum = arabicToKanjiLocal(saMatch[1]);
        const articleTitle = `別表第${appendixNum}`;
        // 選定条文に同じ別表があれば、その法令名を使う
        for (const item of selectedArticles) {
          if (item.article.title === articleTitle) {
            mentionedInAnswer.add(`${item.law.law_title}_${articleTitle}`);
          }
        }
      }

      // 選定条文のうち、説明で言及されたもののみ抽出
      const mentionedSelectedArticles = selectedArticles.filter(item => {
        const key = `${item.law.law_title}_${item.article.title}`;
        return mentionedInAnswer.has(key);
      });

      // 参照条文のうち、説明で言及されたもののみ抽出
      const mentionedRefArticles = Object.values(refArticlesData).filter(refArt => {
        const key = `${refArt.law_title}_${refArt.article?.title}`;
        return mentionedInAnswer.has(key);
      }).map(refArt => ({
        article: refArt.article,
        lawData: { law_title: refArt.law_title, law_id: refArt.law_id },
        similarity: 0,
        isReference: true
      }));

      // refsDataをlaw_id + article_titleでアクセスできるMapに変換
      const refsMap = {};
      refsData.forEach(r => {
        const key = `${r.law_id}_${r.article_title}`;
        refsMap[key] = r.refs || [];
      });

      // 説明文で言及された条文のみを表示
      // 1. 選定条文のうち言及されたもの（青）
      // 2. 参照条文のうち言及されたもの（オレンジ）
      const displayArticles = [
        ...mentionedSelectedArticles.map(item => ({
          article: item.article,
          lawData: item.law,
          similarity: item.similarity
        })),
        ...mentionedRefArticles
      ];

      // 回答から要約を分離（冒頭の【要約】行を抽出）
      // 【要約】の後に改行がある場合も対応
      let displayAnswer = answer;
      let summary = '';

      // パターン1: 【要約】の後に同一行でテキストが続く場合
      const summaryMatch = answer.match(/^【要約】[ \t]*([^\n]+)(?:\n|$)/);
      if (summaryMatch && summaryMatch[1].trim()) {
        summary = summaryMatch[1].trim();
        displayAnswer = answer.replace(/^【要約】[ \t]*[^\n]+\n?/, '').trim();
        console.log('📝 要約抽出(同一行):', summary);
      } else {
        // パターン2: 【要約】の後に改行があり、次の行から要約が始まる場合
        const multilineMatch = answer.match(/^【要約】\s*\n([\s\S]+?)(?:\n\n|\n(?=[\d１-９一-九]))/);
        if (multilineMatch) {
          summary = multilineMatch[1].trim().replace(/\n/g, ' ');
          displayAnswer = answer.replace(/^【要約】\s*\n[\s\S]+?(?:\n\n|\n(?=[\d１-９一-九]))/, '').trim();
          console.log('📝 要約抽出(複数行):', summary);
        } else {
          // フォールバック: 行単位で処理
          const lines = answer.split('\n');
          if (lines[0].startsWith('【要約】')) {
            let summaryLines = [];
            let i = 0;
            // 【要約】行自体にテキストがあれば追加
            const firstLineText = lines[0].replace('【要約】', '').trim();
            if (firstLineText) {
              summaryLines.push(firstLineText);
            }
            // 次の行から空行までを要約として収集
            for (i = 1; i < lines.length; i++) {
              if (lines[i].trim() === '') {
                break;
              }
              summaryLines.push(lines[i].trim());
            }
            if (summaryLines.length > 0) {
              summary = summaryLines.join(' ').trim();
              displayAnswer = lines.slice(i).join('\n').trim();
              console.log('📝 要約抽出(フォールバック):', summary);
            } else {
              console.log('⚠️ 要約が見つかりませんでした。回答冒頭:', answer.slice(0, 200));
            }
          } else {
            console.log('⚠️ 要約が見つかりませんでした。回答冒頭:', answer.slice(0, 200));
          }
        }
      }

      // ストリーミングで作成した一時エントリを最終データで更新
      setConversations(prev => prev.map(conv =>
        conv.id === tempConvId
          ? {
              ...conv,
              answer: displayAnswer,
              summary: summary,
              relevantArticles: displayArticles,
              refsMap: refsMap,
              isStreaming: false
            }
          : conv
      ));

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
      <div className="w-full px-1 sm:px-4 lg:px-8">
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
            <div className="flex-1 overflow-y-auto p-2 sm:p-4 lg:p-6">
              {conversations.length === 0 && (
                <div className="py-8 px-4 max-w-2xl mx-auto flex flex-col" style={{ maxHeight: 'calc(100vh - 240px)' }}>
                  {/* 検索履歴（スクロール可能、最大5件表示） */}
                  <div className="flex-1 overflow-y-auto min-h-0">
                    {searchHistory.length > 0 ? (
                      <div className="mb-4">
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-sm font-medium text-gray-600">検索履歴</h3>
                          <button
                            onClick={() => {
                              clearSearchHistory();
                              setSearchHistory([]);
                            }}
                            className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer"
                          >
                            履歴をクリア
                          </button>
                        </div>
                        <div className="space-y-2">
                          {searchHistory.slice(0, 10).map((item, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                              <button
                                onClick={() => {
                                  setQuery(item);
                                  handleSearch(item);
                                }}
                                disabled={loading}
                                className={`flex-1 text-left px-4 py-3 bg-white rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-colors text-sm text-gray-700 ${loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                              >
                                🔍 {item}
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const newHistory = searchHistory.filter((_, i) => i !== idx);
                                  setSearchHistory(newHistory);
                                  localStorage.setItem(SEARCH_HISTORY_STORAGE, JSON.stringify(newHistory));
                                }}
                                className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                                title="この履歴を削除"
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-gray-400 space-y-2 text-center mb-4">
                        <p className="text-gray-500 mb-4">法的な質問を入力してください</p>
                        <div>💡 例：「手付金を放棄して契約解除できる？」</div>
                        <div>💡 例：「株式会社の設立に必要な書類は？」</div>
                        <div>💡 例：「民法の境界線についての規定を教えて」</div>
                      </div>
                    )}
                  </div>

                </div>
              )}

              <div className="space-y-8">
                {conversations.map((conv, index) => (
                  <div
                    key={conv.id}
                    className="space-y-4"
                    data-conv-export-id={conv.id}
                    ref={index === conversations.length - 1 ? latestConversationRef : null}
                  >
                    {/* ユーザーの質問 */}
                    <div className="flex justify-end">
                      <div className="max-w-full sm:max-w-2xl">
                        {/* ユーザーアイコンとエクスポートボタン */}
                        <div className="flex items-center gap-2 mb-1 justify-end">
                          {!conv.isStreaming && conv.answer !== undefined && (
                            <button
                              onClick={() => handleExportScreenshot(conv.id)}
                              disabled={exportingConvId === conv.id}
                              className="text-gray-400 hover:text-blue-600 transition-colors cursor-pointer text-xs flex items-center gap-1"
                              title="スクリーンショットを保存"
                            >
                              {exportingConvId === conv.id ? (
                                <span className="animate-spin">⏳</span>
                              ) : (
                                <>📷 共有</>
                              )}
                            </button>
                          )}
                          <span className="text-xs text-gray-500">あなた</span>
                          <div className="w-5 h-5 sm:w-6 sm:h-6 bg-gray-200 rounded-full flex items-center justify-center text-gray-600 text-[10px] sm:text-xs">
                            👤
                          </div>
                        </div>
                        <div className="bg-gradient-to-br from-blue-600 to-blue-700 text-white rounded-2xl px-3 py-2 sm:px-5 sm:py-3 shadow-md">
                          <p className="leading-relaxed">{conv.question}</p>
                        </div>
                      </div>
                    </div>

                    {/* AIの回答と条文を左右分割（PCのみ）- プロフェッショナルモードでは条文のみ全幅表示 */}
                    <div className={`flex flex-col ${conv.isProMode ? '' : 'lg:flex-row'} gap-2 sm:gap-4`}>
                      {/* 左側: AI解説（プロフェッショナルモードでは非表示） */}
                      {!conv.isProMode && (
                        <div className="lg:w-1/2">
                          {/* AIアイコンを吹き出しの上に配置 */}
                          <div className="flex items-center gap-2 mb-1">
                            <div className="w-5 h-5 sm:w-6 sm:h-6 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white text-[10px] sm:text-xs font-bold shadow-md">
                              AI
                            </div>
                            <span className="text-xs text-gray-500">条文くん</span>
                          </div>
                          <div
                            className="bg-white rounded-xl sm:rounded-2xl shadow-sm border border-gray-200 px-2 py-2 sm:px-4 sm:py-4"
                            data-explanation-conv-id={conv.id}
                          >
                            <div className="prose prose-base max-w-none">
                              {conv.isStreaming && !conv.answer ? (
                                <div className="flex items-center gap-2 text-blue-600">
                                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                                  回答を生成中...
                                </div>
                              ) : (
                                formatExplanation(conv.answer)
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* 右側: 関連条文（sticky + 独立スクロール）- プロフェッショナルモードでは全幅 */}
                      <div className={`${conv.isProMode ? 'w-full' : 'lg:w-1/2'} lg:self-start lg:sticky lg:top-4`} data-conv-id={conv.id}>
                        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-2 sm:p-4 border border-blue-200 shadow-sm">
                          <div className="flex items-center gap-2 mb-4">
                            <span className="text-lg">📋</span>
                            <span className="text-blue-700 font-bold text-base">{conv.isProMode ? '選定条文' : '参照条文'}</span>
                            {conv.relevantArticles && conv.relevantArticles.length > 0 && (
                              <span className="text-xs text-blue-600 bg-blue-100 px-2 py-1 rounded-full">{conv.relevantArticles.length}件</span>
                            )}
                            {conv.isProMode && (
                              <span className="text-xs bg-purple-500 text-white px-2 py-0.5 rounded-full">AI解説省略</span>
                            )}
                          </div>
                          {conv.isStreaming ? (
                            <div className="text-blue-600 text-sm py-4 text-center flex items-center justify-center gap-2">
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                              条文を取得中...
                            </div>
                          ) : (!conv.relevantArticles || conv.relevantArticles.length === 0) ? (
                            <div className="text-gray-500 text-sm py-4 text-center">該当なし</div>
                          ) : (
                            <div id={`articles-container-${conv.id}`} className="space-y-2 sm:space-y-3 lg:max-h-[calc(100vh-180px)] lg:overflow-y-auto">
                              {conv.relevantArticles.map((item, index) => (
                                <div key={`${item.lawData.law_id}-${item.article.number}-${index}`}
                                     data-article-id={`${item.lawData.law_title}-${item.article.title}`}
                                     className={`article-card bg-white rounded-lg border-2 transition-all p-2 sm:p-4 ${item.isReference ? 'border-orange-200 hover:border-orange-300' : 'border-blue-100 hover:border-blue-300'}`}>
                                  <div className="flex items-start justify-between">
                                    <div className="flex-grow">
                                      <div className="flex flex-wrap items-center gap-2 mb-2">
                                        {item.isReference && (
                                          <span className="text-xs bg-orange-500 text-white px-2 py-0.5 rounded-full font-semibold">
                                            参照
                                          </span>
                                        )}
                                        <span className={`text-xs ${item.isReference ? 'bg-gradient-to-r from-orange-500 to-orange-600' : 'bg-gradient-to-r from-blue-600 to-blue-700'} text-white px-3 py-1 rounded-full font-semibold`}>
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
                                          ) : isAppendixTable(item.article.title) ? (
                                            <div className="max-h-32 overflow-hidden relative">
                                              <AppendixTableContent text={item.article.paragraphs[0]?.sentences?.[0]?.text?.substring(0, 500)} />
                                              <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-gray-50 to-transparent"></div>
                                            </div>
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
                                      ) : isAppendixTable(item.article.title) ? (
                                        <div className="leading-6 bg-gray-50 p-4 rounded border border-gray-200 text-gray-800 text-sm max-h-[600px] overflow-y-auto">
                                          <AppendixTableContent text={item.article.paragraphs?.[0]?.sentences?.[0]?.text} />
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
                                                {displaySentences.length > 0 && (
                                                  <div className="mb-2">
                                                    {paragraph.num !== "1" && (
                                                      <span className="font-bold text-blue-600 mr-1">{paragraph.num}</span>
                                                    )}
                                                    {displaySentences.map((sentence, sIndex) => {
                                                      const articleKey = `${item.lawData.law_id}_${item.article.title}`;
                                                      const refs = conv.refsMap?.[articleKey] || [];
                                                      return (
                                                        <span key={sIndex}>{renderTextWithRefsLinks(sentence.text, refs, paragraph.num, item.lawData.law_id, item.lawData.law_title, item.article.title)}</span>
                                                      );
                                                    })}
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
                                                          {subItem.sentences.map((sentence, sIndex) => {
                                                            // 参照条文の場合はリンクなしでプレーンテキスト表示
                                                            if (item.isReference) {
                                                              return <span key={sIndex}>{sentence.text}</span>;
                                                            }
                                                            const articleKey = `${item.lawData.law_id}_${item.article.title}`;
                                                            const refs = conv.refsMap?.[articleKey] || [];
                                                            return (
                                                              <span key={sIndex}>{renderTextWithRefsLinks(sentence.text, refs, paragraph.num, item.lawData.law_id, item.lawData.law_title, item.article.title)}</span>
                                                            );
                                                          })}
                                                          {/* sub_items（イ、ロ、ハ等）の表示 */}
                                                          {subItem.sub_items && subItem.sub_items.length > 0 && (
                                                            <div className="space-y-1 mt-2 ml-2">
                                                              {subItem.sub_items.map((subSubItem, subSubIndex) => (
                                                                <div key={subSubIndex} className="flex gap-2 border-l-2 border-green-300 pl-2 py-0.5">
                                                                  <span className="font-bold text-green-700 bg-green-100 px-1.5 py-0.5 rounded min-w-[30px] text-center flex-shrink-0 h-fit text-xs">
                                                                    {subSubItem.subitem_title}
                                                                  </span>
                                                                  <div className="flex-1 text-sm">
                                                                    {subSubItem.sentences?.map((sentence, sIdx) => (
                                                                      <span key={sIdx}>{sentence.text}</span>
                                                                    ))}
                                                                  </div>
                                                                </div>
                                                              ))}
                                                            </div>
                                                          )}
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
            <div className="bg-white p-2 sm:p-4">
              {/* プロフェッショナルモード切替（トップページ時のみ、入力窓の上に表示） */}
              {conversations.length === 0 && (
                <div className="flex items-center justify-center gap-3 mb-3">
                  <span className={`text-sm ${proMode ? 'text-gray-400' : 'text-gray-700 font-medium'}`}>
                    通常
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
                    } ${proMode ? 'bg-purple-600' : 'bg-gray-300'}`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        proMode ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                  <span className={`text-sm ${proMode ? 'text-purple-700 font-medium' : 'text-gray-400'}`}>
                    AI解説省略
                  </span>
                </div>
              )}
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
                  <div className="flex gap-2 sm:gap-3">
                    <input
                      type="text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && !loading && handleSearch()}
                      placeholder="法的な質問を入力..."
                      className="flex-1 px-3 py-2 sm:px-4 sm:py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm sm:text-base"
                      disabled={loading}
                    />
                    <button
                      onClick={handleSearch}
                      disabled={loading || !query.trim()}
                      className="px-4 py-2 sm:px-6 sm:py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-2 text-sm sm:text-base"
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

      {/* 参照条文ポップアップ */}
      {articlePopup && (
        <div
          className="fixed inset-0 z-50"
          onClick={closeArticlePopup}
          onMouseMove={handleDragMove}
          onMouseUp={handleDragEnd}
          onMouseLeave={handleDragEnd}
        >
          <div
            className="absolute bg-white border border-gray-300 rounded-lg shadow-2xl max-w-md w-full max-h-[80vh] overflow-hidden"
            style={{ left: articlePopupPos.x, top: articlePopupPos.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* ヘッダー（ドラッグ可能） */}
            <div
              className="flex items-center justify-between px-4 py-3 bg-blue-50 border-b border-gray-200 cursor-move select-none"
              onMouseDown={handleDragStart}
            >
              <div className="font-bold text-blue-800 text-sm">
                {articlePopup.data?.law_title || articlePopup.lawTitle} 第{formatArticleNum(articlePopup.articleNum)}
              </div>
              <button
                onClick={closeArticlePopup}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* コンテンツ */}
            <div className="p-4 overflow-y-auto max-h-[calc(80vh-60px)] text-sm text-gray-800">
              {articlePopup.loading && (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                  <span className="ml-2 text-gray-500">読み込み中...</span>
                </div>
              )}

              {articlePopup.error && (
                <div className="text-red-600 bg-red-50 p-3 rounded">
                  エラー: {articlePopup.error}
                </div>
              )}

              {articlePopup.data && articlePopup.data.article && (
                <div className="text-sm space-y-3">
                  {articlePopup.data.article.caption && (
                    <div className="text-gray-600 font-medium">{articlePopup.data.article.caption}</div>
                  )}
                  {articlePopup.data.article.title && (
                    <div className="font-bold">{articlePopup.data.article.title}</div>
                  )}
                  {articlePopup.data.article.paragraphs?.length > 0 ? (
                    <div className="space-y-3">
                      {articlePopup.data.article.paragraphs.map((p, i) => (
                        <div key={i} className="space-y-1">
                          {/* 項番号（2以降のみ表示） */}
                          {p.num && p.num !== "1" && (
                            <div className="font-semibold text-gray-700">第{p.num}項</div>
                          )}
                          {/* 項の本文（itemsがない場合のsentences） */}
                          {p.sentences?.filter((s, idx) => !p.items?.length || idx === 0).map((s, j) => (
                            <div key={j}>{s.text}</div>
                          ))}
                          {/* 号 */}
                          {p.items?.length > 0 && (
                            <div className="ml-4 space-y-1">
                              {p.items.map((item, k) => (
                                <div key={k} className="flex">
                                  <span className="text-gray-500 mr-2 flex-shrink-0">{item.item_title}</span>
                                  <span>{item.sentences?.map(s => s.text).join('')}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-gray-500 italic">条文内容がありません</div>
                  )}
                </div>
              )}

              {articlePopup.data && !articlePopup.data.article && (
                <div className="text-gray-500 italic">条文が見つかりませんでした</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ===== 別表テキスト整形表示コンポーネント =====
// フラットテキストを「一」「（一）」「イ」等で改行・インデントして表示
function AppendixTableContent({ text }) {
  if (!text) return null;

  const segments = [];

  // 全パターンの統合正規表現（大項目、中項目、小項目、全角数字、注）
  const itemScanRegex = /(?:(?:^|\s)([一二三四五六七八九十]+(?:の[一二三四五六七八九十]+)?)　)|(（([一二三四五六七八九十]+(?:の[一二三四五六七八九十]+)?)）\s*)|((?:^|\s)([イロハニホヘトチリヌルヲワカヨタレソツネナラム])　)|(（注）)|(（([０-９0-9]+)）\s*)|(\s([１-９][０-９]?)\s)/g;

  // まず先頭のヘッダー部分を取得
  const firstItemMatch = text.match(/(?:^|\s)([一二三四五六七八九十]+)　/);
  const headerEnd = firstItemMatch ? firstItemMatch.index : 0;

  if (headerEnd > 0) {
    const headerText = text.substring(0, headerEnd).trim();
    // ヘッダー内を全角数字「１」「２」「３」等で分割して構造化
    const headerParts = headerText.split(/(?=\s[１-９][０-９]?\s)/);
    for (const part of headerParts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const numMatch = trimmed.match(/^([１-９][０-９]?)\s+(.*)$/s);
      if (numMatch) {
        segments.push({ type: 'header-num', num: numMatch[1], text: numMatch[2], level: 0 });
      } else {
        segments.push({ type: 'header', text: trimmed, level: 0 });
      }
    }
  }

  // 各項目を検出して分割
  const allItems = [];
  let scanMatch;
  while ((scanMatch = itemScanRegex.exec(text)) !== null) {
    // ヘッダー範囲内のマッチはスキップ
    if (scanMatch.index < headerEnd) continue;
    allItems.push({
      index: scanMatch.index,
      majorNum: scanMatch[1],
      middleNum: scanMatch[3],
      minorChar: scanMatch[5],
      isNote: !!scanMatch[6],
      digitNum: scanMatch[8],
      headerDigit: scanMatch[10],
    });
  }

  // 各項目のテキスト範囲を決定
  for (let i = 0; i < allItems.length; i++) {
    const item = allItems[i];
    const nextIndex = i + 1 < allItems.length ? allItems[i + 1].index : text.length;
    const content = text.substring(item.index, nextIndex).trim();

    if (item.majorNum) {
      segments.push({ type: 'major', num: item.majorNum, text: content, level: 0 });
    } else if (item.middleNum) {
      segments.push({ type: 'middle', num: item.middleNum, text: content, level: 1 });
    } else if (item.minorChar) {
      segments.push({ type: 'minor', num: item.minorChar, text: content, level: 2 });
    } else if (item.isNote) {
      segments.push({ type: 'note', text: content, level: 1 });
    } else if (item.digitNum) {
      segments.push({ type: 'digit', num: item.digitNum, text: content, level: 3 });
    }
  }

  // セグメントがなければフォールバック
  if (segments.length === 0) {
    return <div className="whitespace-pre-wrap">{text}</div>;
  }

  const levelStyles = {
    0: 'ml-0',
    1: 'ml-4',
    2: 'ml-8',
    3: 'ml-12',
  };

  const labelStyles = {
    major: 'font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded',
    'header-num': 'font-bold text-gray-700 bg-gray-100 px-1.5 py-0.5 rounded',
    middle: 'font-bold text-blue-600 bg-blue-50 px-1 py-0.5 rounded text-xs',
    minor: 'font-bold text-indigo-600 bg-indigo-50 px-1 py-0.5 rounded text-xs',
    digit: 'font-bold text-purple-600 bg-purple-50 px-1 py-0.5 rounded text-xs',
    note: 'text-gray-500 text-xs italic',
    header: '',
  };

  // テキストからラベル部分を除去する関数
  function stripLabel(seg) {
    return seg.text
      .replace(/^[\s]*[一二三四五六七八九十]+(?:の[一二三四五六七八九十]+)?[\s　]+/, '')
      .replace(/^（[一二三四五六七八九十]+(?:の[一二三四五六七八九十]+)?）[\s]*/, '')
      .replace(/^[\s]*[イロハニホヘトチリヌルヲワカヨタレソツネナラム][\s　]+/, '')
      .replace(/^（注）[\s]*/, '')
      .replace(/^（[０-９0-9]+）[\s]*/, '');
  }

  // 全角スペースで区切られたテーブルセルを整形表示
  function renderCellText(cellText) {
    // 全角スペース3つ以上連続を区切りとみなしてセル分割表示
    const cells = cellText.split(/\u3000{2,}/);
    if (cells.length > 1) {
      return cells.map((cell, j) => (
        <span key={j}>
          {j > 0 && <span className="text-gray-300 mx-1">│</span>}
          {cell.trim()}
        </span>
      ));
    }
    return cellText;
  }

  return (
    <div className="space-y-1.5 text-sm">
      {segments.map((seg, i) => (
        <div key={i} className={`${levelStyles[seg.level] || 'ml-0'} leading-relaxed`}>
          {seg.type === 'header' ? (
            <div className="text-gray-600 text-xs mb-2 pb-1 border-b border-gray-200 whitespace-pre-line">{seg.text}</div>
          ) : (
            <div className="flex gap-1.5">
              {(seg.num) && (
                <span className={`${labelStyles[seg.type]} flex-shrink-0 h-fit`}>
                  {seg.type === 'middle' ? `（${seg.num}）` : seg.type === 'digit' ? `（${seg.num}）` : seg.num}
                </span>
              )}
              <span className="flex-1">
                {renderCellText(stripLabel(seg))}
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// 条文タイトルが別表かどうか判定
function isAppendixTable(articleTitle) {
  return articleTitle && articleTitle.startsWith('別表');
}

// ===== 条文表示コンポーネント（e-Gov API JSON構造用）=====
function ArticleContent({ lawFullText }) {
  // 再帰的にテキストを抽出（特定タグを除外可能）
  const extractText = (element, excludeTags = []) => {
    if (typeof element === 'string') return element;
    if (!element || typeof element !== 'object') return '';

    // 除外タグならスキップ
    if (excludeTags.includes(element.tag)) return '';

    // children から再帰的にテキストを抽出
    if (element.children && Array.isArray(element.children)) {
      return element.children.map(child => extractText(child, excludeTags)).join('');
    }
    return '';
  };

  // ParagraphSentenceのテキストのみ抽出（Itemを含まない）
  const extractParagraphSentenceText = (paragraphElement) => {
    if (!paragraphElement?.children) return '';

    const texts = [];
    for (const child of paragraphElement.children) {
      if (typeof child === 'object' && child.tag === 'ParagraphSentence') {
        texts.push(extractText(child));
      }
    }
    return texts.join('');
  };

  // Itemを抽出
  const extractItems = (paragraphElement) => {
    if (!paragraphElement?.children) return [];

    const items = [];
    for (const child of paragraphElement.children) {
      if (typeof child === 'object' && child.tag === 'Item') {
        const itemTitle = child.children?.find(c => c.tag === 'ItemTitle');
        const itemSentence = child.children?.find(c => c.tag === 'ItemSentence');
        items.push({
          title: itemTitle ? extractText(itemTitle) : '',
          text: itemSentence ? extractText(itemSentence) : ''
        });
      }
    }
    return items;
  };

  // 段落を抽出（Itemは別途抽出）
  const extractParagraphs = (element, paragraphs = []) => {
    if (!element || typeof element !== 'object') return paragraphs;

    if (element.tag === 'Paragraph') {
      const num = element.attr?.Num || '';
      // ParagraphSentenceのみからテキスト抽出（Itemは別）
      const text = extractParagraphSentenceText(element);
      const items = extractItems(element);

      if (text.trim() || items.length > 0) {
        paragraphs.push({ num, text: text.trim(), items });
      }
    }

    if (element.children && Array.isArray(element.children)) {
      element.children.forEach(child => {
        if (typeof child === 'object') {
          extractParagraphs(child, paragraphs);
        }
      });
    }

    return paragraphs;
  };

  // ArticleCaptionを抽出
  const extractCaption = (element) => {
    if (!element || typeof element !== 'object') return '';
    if (element.tag === 'ArticleCaption') {
      return extractText(element);
    }
    if (element.children && Array.isArray(element.children)) {
      for (const child of element.children) {
        const caption = extractCaption(child);
        if (caption) return caption;
      }
    }
    return '';
  };

  const caption = extractCaption(lawFullText);
  const paragraphs = extractParagraphs(lawFullText);

  return (
    <div className="space-y-3">
      {caption && (
        <div className="text-gray-500 text-xs mb-2">（{caption}）</div>
      )}
      {paragraphs.map((p, i) => (
        <div key={i} className="leading-relaxed">
          {/* 項番号（1項目以外） */}
          {p.num !== '1' && p.num && (
            <span className="font-bold text-blue-600 mr-1">{p.num}</span>
          )}
          {/* 本文 */}
          {p.text && <span>{p.text}</span>}
          {/* 号 */}
          {p.items && p.items.length > 0 && (
            <div className="ml-4 mt-1 space-y-1">
              {p.items.map((item, j) => (
                <div key={j} className="flex gap-2">
                  <span className="font-bold text-blue-500 flex-shrink-0">{item.title}</span>
                  <span>{item.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      {paragraphs.length === 0 && (
        <div className="text-gray-400 italic">条文内容を解析できませんでした</div>
      )}
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
          {/* AI解説省略モード設定 */}
          <div>
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-sm font-medium text-gray-700">AI解説省略モード</label>
                <p className="text-xs text-gray-500 mt-1">
                  AIによる詳細解説を省略し、選定条文のみ表示
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
