// Cloudflare Workers - Claude API Proxy
// https://morning-surf-f117.ikeda-250.workers.dev/

export default {
  async fetch(request, env) {
    // CORS対応
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
    };

    // OPTIONSリクエスト（プリフライト）
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // ===== Embedding API（既存） =====
    if (url.pathname === '/' || url.pathname === '/embed') {
      try {
        const { text } = await request.json();
        
        const embedding = await env.AI.run('@cf/baai/bge-small-en-v1.5', {
          text: text
        });
        
        return new Response(JSON.stringify({ embedding: embedding.data[0] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // ===== Claude API Proxy（新規追加） =====
    if (url.pathname === '/claude') {
      try {
        const { messages, maxTokens = 2000, apiKey } = await request.json();

        if (!apiKey) {
          throw new Error('APIキーが必要です');
        }

        // Claude APIを呼び出し
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: maxTokens,
            messages: messages
          })
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(JSON.stringify(errorData));
        }

        const data = await response.json();
        
        return new Response(JSON.stringify({ 
          answer: data.content[0].text 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      } catch (error) {
        return new Response(JSON.stringify({ 
          error: error.message 
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    return new Response('Not Found', { 
      status: 404,
      headers: corsHeaders
    });
  }
};
