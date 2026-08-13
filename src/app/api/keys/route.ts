// Gateway API Keys management
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { randomUUID } from 'crypto';

export async function GET() {
  const keys = await db.apiKey.findMany({ orderBy: { createdAt: 'desc' } });
  // Mask keys for security
  const masked = keys.map(k => ({ ...k, key: k.key.substring(0, 8) + '...' + k.key.substring(k.key.length - 4) }));
  return NextResponse.json({ keys: masked });
}

export async function POST(request: NextRequest) {
  try {
    const { name, providerIds, rateLimit, totalLimit } = await request.json();
    const key = `gw-${randomUUID().replace(/-/g, '').substring(0, 32)}`;
    const created = await db.apiKey.create({
      data: {
        key,
        name: name || 'Default Key',
        providerIds: JSON.stringify(providerIds || []),
        rateLimit: rateLimit || 60,
        totalLimit: totalLimit || 0,
      },
    });
    return NextResponse.json({ key: created.key, id: created.id, name: created.name });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await db.apiKey.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
