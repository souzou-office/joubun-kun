#!/bin/bash
# R2に大きなファイルをアップロード

ACCOUNT_ID="250683c5bd97fce8145096b2e9158a0c"
BUCKET="joubun-kun-data"
ENDPOINT="https://${ACCOUNT_ID}.r2.cloudflarestorage.com"
BASE_DIR="K:/joubun-kun-web/output_v2"

for FILE in laws_chunk_069_light.json laws_chunk_072_light.json laws_chunk_073_light.json laws_chunk_074_light.json laws_chunk_075_light.json; do
  echo "Uploading $FILE..."
  aws s3 cp "${BASE_DIR}/${FILE}" "s3://${BUCKET}/${FILE}" \
    --endpoint-url "$ENDPOINT" \
    --content-type "application/json"
  echo "Done: $FILE"
done

echo "All files uploaded!"
