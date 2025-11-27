import json
import re

data = json.load(open('K:/joubun-kun-web/public/data/laws_chunk_075_embedded.json', encoding='utf-8'))

for law in data['laws'].values():
    if law.get('law_title') == '民法':
        for a in law.get('articles', []):
            title = a.get('title', '')
            if '五百二十五' in title:
                print(f"Title: {title}")
                # JS正規表現と同じパターンでテスト
                match = re.match(r'第([一二三四五六七八九十百千]+)条', title)
                if match:
                    print(f"Matched: {match.group(1)}")
                else:
                    print("No match!")
                    # 各文字のコードポイントを確認
                    for c in title:
                        print(f"  '{c}' = U+{ord(c):04X}")
