// Configure provider: set API key, priority, enable/disable, custom URL
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const { providerId, apiKey, priority, enabled, customBaseUrl, quotaLimit } = await request.json();

    const provider = await db.provider.findUnique({ where: { id: providerId } });
    if (!provider) return NextResponse.json({ error: 'Provider not found' }, { status: 404 });

    const updateData: any = {};
    if (apiKey !== undefined) updateData.apiKey = apiKey;
    if (priority !== undefined) updateData.priority = priority;
    if (enabled !== undefined) updateData.enabled = enabled;
    if (customBaseUrl !== undefined) updateData.customBaseUrl = customBaseUrl;
    if (quotaLimit !== undefined) updateData.quotaLimit = quotaLimit;

    const updated = await db.provider.update({ where: { id: providerId }, data: updateData });
    return NextResponse.json({ provider: updated });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to configure' }, { status: 500 });
  }
}
