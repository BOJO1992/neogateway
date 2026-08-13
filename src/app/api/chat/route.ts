// Core Gateway Proxy - OpenAI-compatible /v1/chat/completions endpoint
import { NextRequest } from 'next/server';
import { proxyRequest, GatewayError } from '@/lib/gateway-engine';
import { buildHermesMessages, agentLoop } from '@/lib/hermes-engine';
import { db } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { model, messages, tools, stream, temperature, max_tokens, agent_mode, mcp_servers, ...rest } = body;

    // Check for gateway API key
    const authHeader = request.headers.get('authorization');
    let allowedProviderIds: string[] | undefined;

    if (authHeader) {
      const key = authHeader.replace('Bearer ', '');
      if (key.startsWith('gw-')) {
        const apiKey = await db.apiKey.findUnique({ where: { key } });
        if (!apiKey || !apiKey.enabled) {
          return new Response(JSON.stringify({ error: { message: 'Invalid or disabled gateway API key', type: 'invalid_request_error', code: 'invalid_api_key' } }), { status: 401, headers: { 'Content-Type': 'application/json' } });
        }
        if (apiKey.providerIds && apiKey.providerIds !== '[]') {
          allowedProviderIds = JSON.parse(apiKey.providerIds);
        }
        await db.apiKey.update({ where: { id: apiKey.id }, data: { lastUsed: new Date(), totalUsed: { increment: 1 } } });
      }
    }

    if (!model || !messages) {
      return new Response(JSON.stringify({ error: { message: 'model and messages are required', type: 'invalid_request_error' } }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // Agent mode with Hermes format
    if (agent_mode && tools && tools.length > 0) {
      const hermesMessages = buildHermesMessages(messages, tools);

      const result = await agentLoop(
        async (msgs, mdl, tls) => {
          const { response } = await proxyRequest({
            model: mdl,
            messages: msgs as any,
            tools: tls,
            temperature,
            max_tokens: max_tokens || 4096,
            stream: false,
            ...rest,
          }, allowedProviderIds);
          const data = await response.json();
          return data;
        },
        { maxIterations: 10, model, messages: hermesMessages as any, tools, allowedProviderIds, mcp_servers: mcp_servers || [] },
      );

      await db.gatewayLog.create({
        data: { modelId: model, latencyMs: 0, status: 'success', agentMode: true, toolCalls: result.totalToolCalls },
      });

      return new Response(JSON.stringify(result.finalMessage), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-Agent-Steps': String(result.steps.length), 'X-Tool-Calls': String(result.totalToolCalls) },
      });
    }

    // Standard proxy
    const { response, provider, latencyMs } = await proxyRequest(
      { model, messages, tools, temperature, max_tokens, stream: stream || false, ...rest },
      allowedProviderIds,
    );

    if (stream) {
      return new Response(response.body, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Gateway-Provider': provider.slug,
        },
      });
    }

    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal gateway error';
    const status = err instanceof GatewayError ? err.statusCode : 500;
    console.error('[Gateway] Error:', err);
    return new Response(JSON.stringify({ error: { message, type: 'server_error' } }), { status, headers: { 'Content-Type': 'application/json' } });
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' } });
}