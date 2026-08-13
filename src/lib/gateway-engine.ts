// Core Gateway Engine - Priority routing, quota tracking, auto-fallback
import { db } from './db';

interface GatewayRequest {
  model: string;
  messages: Array<{ role: string; content: string | ContentPart[]; tool_calls?: any[]; tool_call_id?: string }>;
  tools?: any[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string[];
}

interface ContentPart {
  type: string;
  text?: string;
  image_url?: { url: string };
  tool_call_id?: string;
  name?: string;
  content?: string;
}

interface ProviderRoute {
  id: string;
  name: string;
  slug: string;
  baseUrl: string;
  apiFormat: string;
  authType: string;
  authHeader: string;
  apiKey: string;
  priority: number;
  avgLatency: number;
  errorCount: number;
  quotaLimit: number;
  quotaUsed: number;
  enabled: boolean;
  customBaseUrl: string;
}

// Get providers that support a given model, ordered by priority
export async function getProvidersForModel(model: string, allowedProviderIds?: string[]): Promise<ProviderRoute[]> {
  // Find which provider models match (exact or wildcard)
  const allModels = await db.providerModel.findMany({
    where: {
      modelId: model,
      status: 'active',
      provider: { enabled: true },
    },
    include: { provider: true },
  });

  // If no exact match, find providers with the model in their capabilities or try direct lookup
  if (allModels.length === 0) {
    // Try to find by provider slug prefix (e.g. "openai/gpt-4o" -> slug "openai")
    const slugMatch = model.includes('/') ? model.split('/')[0] : null;
    if (slugMatch) {
      const provider = await db.provider.findFirst({
        where: { slug: slugMatch, enabled: true, apiKey: { not: '' } },
      });
      if (provider) {
        const cleanModel = model.includes('/') ? model.split('/').slice(1).join('/') : model;
        return [{
          id: provider.id,
          name: provider.name,
          slug: provider.slug,
          baseUrl: provider.customBaseUrl || provider.baseUrl,
          apiFormat: provider.apiFormat,
          authType: provider.authType,
          authHeader: provider.authHeader,
          apiKey: provider.apiKey,
          priority: provider.priority,
          avgLatency: provider.avgLatency,
          errorCount: provider.errorCount,
          quotaLimit: provider.quotaLimit,
          quotaUsed: provider.quotaUsed,
          enabled: provider.enabled,
          customBaseUrl: provider.customBaseUrl,
        }];
      }
    }
    return [];
  }

  let routes = allModels.map(m => ({
    id: m.provider.id,
    name: m.provider.name,
    slug: m.provider.slug,
    baseUrl: m.provider.customBaseUrl || m.provider.baseUrl,
    apiFormat: m.provider.apiFormat,
    authType: m.provider.authType,
    authHeader: m.provider.authHeader,
    apiKey: m.provider.apiKey,
    priority: m.provider.priority,
    avgLatency: m.provider.avgLatency,
    errorCount: m.provider.errorCount,
    quotaLimit: m.provider.quotaLimit,
    quotaUsed: m.provider.quotaUsed,
    enabled: m.provider.enabled,
    customBaseUrl: m.provider.customBaseUrl,
  }));

  // Filter by allowed provider IDs if specified
  if (allowedProviderIds && allowedProviderIds.length > 0) {
    routes = routes.filter(r => allowedProviderIds.includes(r.id));
  }

  // Filter out providers without API keys configured
  routes = routes.filter(r => r.apiKey && r.apiKey.length > 0);

  // Sort by priority (descending) then by error count (ascending) then by avgLatency (ascending)
  routes.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (a.errorCount !== b.errorCount) return a.errorCount - b.errorCount;
    return a.avgLatency - b.avgLatency;
  });

  return routes;
}

// Check if provider quota is exhausted (>90% used)
function isQuotaExhausted(provider: ProviderRoute): boolean {
  if (provider.quotaLimit === 0) return false;
  return (provider.quotaUsed / provider.quotaLimit) > 0.9;
}

// Build auth headers for a provider
function buildAuthHeaders(provider: ProviderRoute): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
   if (provider.authType === 'bearer') {
    headers['Authorization'] = `Bearer ${provider.apiKey}`;
  } else if (provider.authType === 'header') {
    headers[provider.authHeader] = provider.apiKey;
  } else if (provider.authType === 'query') {
    // For query auth, we append to URL later
  }
  return headers;
}

// Build the endpoint URL for a provider
function buildEndpoint(provider: ProviderRoute, streaming: boolean = false): string {
  let base = provider.baseUrl.replace(/\/$/, '');

  if (provider.authType === 'query') {
    base += `?key=${provider.apiKey}`;
  }

  if (provider.apiFormat === 'openai') {
    return `${base}/chat/completions`;
  } else if (provider.apiFormat === 'anthropic') {
    return `${base}/messages`;
  } else if (provider.apiFormat === 'google') {
    return `${base}/models/${streaming ? 'streamGenerateContent' : 'generateContent'}`;
  }
  return `${base}/chat/completions`; // default to openai
}

// Convert request body based on provider format
function convertRequestBody(req: GatewayRequest, provider: ProviderRoute): any {
  if (provider.apiFormat === 'anthropic') {
    // Convert OpenAI format to Anthropic format
    const systemMsg = req.messages.find(m => m.role === 'system');
    const anthropicMessages = req.messages
      .filter(m => m.role !== 'system')
      .map(m => {
        if (m.role === 'tool') {
          return {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: typeof m.content === 'string' ? m.content : '' }],
          };
        }
        if (m.role === 'assistant' && m.tool_calls) {
          const content: any[] = m.tool_calls.map(tc => ({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments || '{}'),
          }));
          // Add text content if present
          if (typeof m.content === 'string' && m.content) {
            content.unshift({ type: 'text', text: m.content });
          }
          return { role: 'assistant', content };
        }
        return { role: m.role, content: typeof m.content === 'string' ? m.content : m.content };
      });

    const body: any = {
      model: req.model,
      messages: anthropicMessages,
      max_tokens: req.max_tokens || 4096,
    };
    if (systemMsg) body.system = typeof systemMsg.content === 'string' ? systemMsg.content : '';
    if (req.tools) {
      body.tools = req.tools.map(t => ({
        name: t.function.name,
        description: t.function.description || '',
        input_schema: t.function.parameters || { type: 'object', properties: {} },
      }));
    }
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.top_p !== undefined) body.top_p = req.top_p;
    return body;
  }

  if (provider.apiFormat === 'google') {
    const systemMsg = req.messages.find(m => m.role === 'system');
    const contents = req.messages
      .filter(m => m.role !== 'system')
      .map(m => {
        const role = m.role === 'assistant' ? 'model' : 'user';
        const parts: any[] = [];
        if (typeof m.content === 'string') {
          parts.push({ text: m.content });
        } else if (Array.isArray(m.content)) {
          m.content.forEach(c => {
            if (c.type === 'text') parts.push({ text: c.text });
            if (c.type === 'image_url') parts.push({ inlineData: { mimeType: 'image/png', data: c.image_url?.url?.split(',')[1] || '' } });
          });
        }
        return { role, parts };
      });

    const body: any = { contents };
    if (systemMsg) body.systemInstruction = { parts: [{ text: typeof systemMsg.content === 'string' ? systemMsg.content : '' }] };
    if (req.tools) {
      body.tools = [{ functionDeclarations: req.tools.map(t => ({
        name: t.function.name,
        description: t.function.description || '',
        parameters: t.function.parameters || { type: 'object', properties: {} },
      })) }];
    }
    if (req.temperature !== undefined) body.generationConfig = { ...body.generationConfig, temperature: req.temperature };
    if (req.max_tokens) body.generationConfig = { ...body.generationConfig, maxOutputTokens: req.max_tokens };
    return body;
  }

  // Default: OpenAI format - pass through
  const body: any = { ...req };
  return body;
}

// Convert provider response back to OpenAI format
function convertResponse(data: any, provider: ProviderRoute, model: string, latencyMs: number): any {
  if (provider.apiFormat === 'anthropic') {
    const content: any[] = [];
    const toolCalls: any[] = [];

    (data.content || []).forEach((block: any) => {
      if (block.type === 'text') {
        content.push(block.text);
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: { name: block.name, arguments: JSON.stringify(block.input || {}) },
        });
      }
    });

    const msg: any = { role: 'assistant', content: content.join('') || null };
    if (toolCalls.length > 0) msg.tool_calls = toolCalls;

    return {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, message: msg, finish_reason: data.stop_reason === 'tool_use' ? 'tool_calls' : (data.stop_reason || 'stop') }],
      usage: {
        prompt_tokens: data.usage?.input_tokens || 0,
        completion_tokens: data.usage?.output_tokens || 0,
        total_tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
      },
      _gateway: { provider: provider.slug, latencyMs },
    };
  }

  if (provider.apiFormat === 'google') {
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const text = parts.filter((p: any) => p.text).map((p: any) => p.text).join('');
    const functionCall = parts.find((p: any) => p.functionCall);

    const msg: any = { role: 'assistant', content: text || null };
    if (functionCall) {
      msg.tool_calls = [{
        id: `call_${Date.now()}`,
        type: 'function',
        function: { name: functionCall.name, arguments: JSON.stringify(functionCall.args || {}) },
      }];
    }

    return {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, message: msg, finish_reason: functionCall ? 'tool_calls' : (candidate?.finishReason || 'stop').toLowerCase() }],
      usage: {
        prompt_tokens: data.usageMetadata?.promptTokenCount || 0,
        completion_tokens: data.usageMetadata?.candidatesTokenCount || 0,
        total_tokens: data.usageMetadata?.totalTokenCount || 0,
      },
      _gateway: { provider: provider.slug, latencyMs },
    };
  }

  // OpenAI format - pass through with gateway metadata
  return {
    ...data,
    _gateway: { provider: provider.slug, latencyMs },
  };
}

// Main gateway proxy function
export async function proxyRequest(
  req: GatewayRequest,
  allowedProviderIds?: string[],
): Promise<{ response: Response; provider: ProviderRoute; latencyMs: number }> {
  const routes = await getProvidersForModel(req.model, allowedProviderIds);

  if (routes.length === 0) {
    throw new GatewayError('no_provider', `No configured provider found for model: ${req.model}`, 404);
  }

  let lastError: Error | null = null;
  let fallbackUsed = false;

  for (const route of routes) {
    // Skip if quota exhausted
    if (isQuotaExhausted(route)) {
      console.log(`[Gateway] Skipping ${route.slug} - quota exhausted (${route.quotaUsed}/${route.quotaLimit})`);
      fallbackUsed = true;
      continue;
    }

    const startTime = Date.now();
    try {
      const headers = buildAuthHeaders(route);
      const endpoint = buildEndpoint(route, req.stream || false);
      const body = convertRequestBody(req, route);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      const fetchResponse = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const latencyMs = Date.now() - startTime;

      if (!fetchResponse.ok) {
        const errBody = await fetchResponse.text();
        throw new Error(`HTTP ${fetchResponse.status}: ${errBody.substring(0, 200)}`);
      }

      // Update provider stats
      await db.provider.update({
        where: { id: route.id },
        data: {
          totalCalls: { increment: 1 },
          avgLatency: Math.round((route.avgLatency + latencyMs) / 2),
          quotaUsed: route.quotaLimit > 0 ? { increment: 1 } : route.quotaUsed,
          lastChecked: new Date(),
        },
      });

      // Log the request
      await db.gatewayLog.create({
        data: {
          providerId: route.id,
          modelId: req.model,
          latencyMs,
          status: fallbackUsed ? 'fallback' : 'success',
        },
      });

      // For streaming, return the raw response (it's already SSE)
      if (req.stream) {
        return { response: fetchResponse, provider: route, latencyMs };
      }

      // For non-streaming, parse and convert
      const data = await fetchResponse.json();
      const normalized = convertResponse(data, route, req.model, latencyMs);

      const proxyResponse = new Response(JSON.stringify(normalized), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

      return { response: proxyResponse, provider: route, latencyMs };
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      lastError = err;
      fallbackUsed = true;

      // Increment error count
      await db.provider.update({
        where: { id: route.id },
        data: { errorCount: { increment: 1 } },
      });

      // Log the error
      await db.gatewayLog.create({
        data: {
          providerId: route.id,
          modelId: req.model,
          latencyMs,
          status: 'error',
          errorMessage: err.message?.substring(0, 500) || 'Unknown error',
        },
      });

      console.error(`[Gateway] ${route.slug} failed: ${err.message}. Trying next...`);
    }
  }

  throw new GatewayError(
    'all_providers_failed',
    `All ${routes.length} provider(s) failed. Last error: ${lastError?.message}`,
    502,
  );
}

export class GatewayError extends Error {
  code: string;
  statusCode: number;
  constructor(code: string, message: string, statusCode: number = 500) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}
