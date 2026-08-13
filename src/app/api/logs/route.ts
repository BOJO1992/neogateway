// Gateway logs viewer
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const providerId = searchParams.get('providerId');
  const status = searchParams.get('status');
  const limit = parseInt(searchParams.get('limit') || '50');

  const where: any = {};
  if (providerId) where.providerId = providerId;
  if (status) where.status = status;

  const logs = await db.gatewayLog.findMany({
    where,
    include: { provider: { select: { name: true, slug: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  const total = await db.gatewayLog.count({ where });

  return NextResponse.json({ logs, total });
}
