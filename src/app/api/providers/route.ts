import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { seedDatabase } from '@/lib/seed';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category');
  const region = searchParams.get('region');
  const search = searchParams.get('search');
  const freeTier = searchParams.get('freeTier');
  const status = searchParams.get('status');

  // Auto-seed on first request
  const count = await db.provider.count();
  if (count === 0) {
    await seedDatabase();
  }

  const where: Record<string, unknown> = {};
  if (category && category !== 'all') where.category = category;
  if (region && region !== 'all') where.region = region;
  if (freeTier === 'true') where.freeTier = true;
  if (status && status !== 'all') where.status = status;
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { slug: { contains: search } },
      { notes: { contains: search } },
    ];
  }

  const providers = await db.provider.findMany({
    where,
    include: { models: true },
    orderBy: { discoveredAt: 'desc' },
  });

  return NextResponse.json({ providers, total: providers.length });
}