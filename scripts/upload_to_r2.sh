#!/bin/bash
cd "K:/joubun-kun-web"
for file in output_v2/laws_chunk_*.json; do
  filename=$(basename "$file")
  echo "Uploading $filename..."
  npx wrangler r2 object put "joubun-kun-data/$filename" --file="$file" --remote
done
echo "Done!"
