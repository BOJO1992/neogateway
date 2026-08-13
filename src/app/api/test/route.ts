import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function POST(request: Request) {
  try {
    const { providerId, modelId, testType, apiKey } = await request.json();

    const provider = await db.provider.findUnique({ where: { id: providerId } });
    if (!provider) {
      return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
    }

    // Create test record
    const test = await db.sandboxTest.create({
      data: {
        providerId,
        modelId,
        testType: testType || 'chat',
        status: 'running',
        requestJson: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'Say "NeoGateway test OK" and nothing else.' }],
          max_tokens: 50,
        }),
      },
    });

    // Attempt actual API call in sandbox
    const startTime = Date.now();
    let result: { status: string; latencyMs: number; response: string; error?: string };

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (provider.authType === 'bearer') {
        headers['Authorization'] = `Bearer ${apiKey}`;
      } else if (provider.authType === 'header') {
        headers[provider.authHeader] = apiKey;
      }

      let endpoint = provider.baseUrl;
      if (provider.apiFormat === 'openai') {
        if (!endpoint.endsWith('/')) endpoint += '/';
        endpoint += 'chat/completions';
      } else if (provider.apiFormat === 'anthropic') {
        if (!endpoint.endsWith('/')) endpoint += '/';
        endpoint += 'messages';
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'Say "NeoGateway test OK" and nothing else.' }],
          max_tokens: 50,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const latencyMs = Date.now() - startTime;
      const data = await response.json();

      if (response.ok) {
        const content = data.choices?.[0]?.message?.content || data.content?.[0]?.text || JSON.stringify(data).substring(0, 500);
        result = { status: 'passed', latencyMs, response: content };
      } else {
        result = { status: 'failed', latencyMs, response: JSON.stringify(data), error: `HTTP ${response.status}` };
      }
    } catch (err: unknown) {
      const latencyMs = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      result = { status: 'timeout', latencyMs, response: '', error: errorMessage };
    }

    // Update test record
    await db.sandboxTest.update({
      where: { id: test.id },
      data: {
        status: result.status,
        latencyMs: result.latencyMs,
        responseJson: result.response,
        error: result.error || '',
      },
    });

    // Update provider last checked
    await db.provider.update({
      where: { id: providerId },
      data: { lastChecked: new Date() },
    });

    return NextResponse.json({ testId: test.id, ...result });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
