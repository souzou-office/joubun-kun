const fs = require('fs');

async function main() {
  const url = 'https://pub-31e9c70796b94125976e0d215b8de3b1.r2.dev/laws_chunk_003_embedded.json';
  const res = await fetch(url);
  const json = await res.json();

  let maxLen = 0;
  let maxInfo = '';

  for (const [lawId, law] of Object.entries(json.laws)) {
    if (!law.articles) continue;
    for (const art of law.articles) {
      if (!art.paragraphs) continue;
      for (const para of art.paragraphs) {
        const text = para.sentences.map(s => s.text).join('');
        if (text.length > maxLen) {
          maxLen = text.length;
          maxInfo = `${law.law_title} ${art.title}`;
        }
      }
    }
  }

  console.log('最長の項:', maxLen, '文字');
  console.log('場所:', maxInfo);
}

main();
