import OpenAI from 'openai';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type Provider = 'local' | 'groq';

function getProvider(): Provider {
  return process.env.INFERENCE_PROVIDER === 'groq' ? 'groq' : 'local';
}

let localClient: OpenAI | undefined;
let groqClient: OpenAI | undefined;

/**
 * Local AI stack (Open WebUI's OpenAI-compatible API), reached through a
 * Cloudflare Tunnel + a path-scoped Access Service Auth policy. Never points
 * at llama.cpp's own port directly — that's intentionally loopback-only.
 */
function getLocalClient(): OpenAI {
  if (!localClient) {
    const baseURL = process.env.LOCAL_AI_BASE_URL;
    const apiKey = process.env.LOCAL_AI_API_KEY;
    if (!baseURL || !apiKey) {
      throw new Error(
        'LOCAL_AI_BASE_URL / LOCAL_AI_API_KEY are not set. Copy .env.example to .env.local and fill them in.',
      );
    }

    const cfClientId = process.env.CF_ACCESS_CLIENT_ID;
    const cfClientSecret = process.env.CF_ACCESS_CLIENT_SECRET;

    localClient = new OpenAI({
      baseURL,
      apiKey,
      defaultHeaders: {
        ...(cfClientId ? { 'CF-Access-Client-Id': cfClientId } : {}),
        ...(cfClientSecret ? { 'CF-Access-Client-Secret': cfClientSecret } : {}),
      },
    });
  }
  return localClient;
}

/** Manual, opt-in fallback — only used when INFERENCE_PROVIDER=groq is set explicitly. */
function getGroqClient(): OpenAI {
  if (!groqClient) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error('GROQ_API_KEY is not set. Copy .env.example to .env.local and fill it in.');
    }
    groqClient = new OpenAI({ baseURL: 'https://api.groq.com/openai/v1', apiKey });
  }
  return groqClient;
}

export async function chatCompletion(model: string, messages: ChatMessage[]): Promise<string> {
  const client = getProvider() === 'groq' ? getGroqClient() : getLocalClient();
  const completion = await client.chat.completions.create({ model, messages });
  const reply = completion.choices[0]?.message?.content;

  if (!reply) {
    throw new Error('Inference provider returned an empty response.');
  }
  return reply;
}
