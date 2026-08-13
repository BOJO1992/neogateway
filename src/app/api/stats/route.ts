// Gateway stats
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { seedDatabase } from '@/lib/seed';

export async function GET() {
  const count = await db.provider.count();
  if (count === 0) await seedDatabase();

  const [total, enabled, freeTier, withKeys, totalModels, totalTests, totalLogs, recentLogs] = await Promise.all([
    db.provider.count(),
    db.provider.count({ where: { enabled: true } }),
    db.provider.count({ where: { freeTier: true } }),
    db.provider.count({ where: { apiKey: { not: '' } } }),
    db.providerModel.count(),
    db.sandboxTest.count(),
    db.gatewayLog.count(),
    db.gatewayLog.findMany({ orderBy: { createdAt: 'desc' }, take: 10, include: { provider: { select: { name: true, slug: true } } } }),
  ]);

  const logStats = await db.gatewayLog.groupBy({ by: ['status'], _count: true });
  const topProviders = await db.provider.findMany({
    where: { apiKey: { not: '' }, enabled: true },
    orderBy: { totalCalls: 'desc' }, take: 5,
    select: { name: true, slug: true, totalCalls: true, avgLatency: true, errorCount: true },
  });
  const testStats = await db.sandboxTest.groupBy({ by: ['status'], _count: true });

  return NextResponse.json({
    total, enabled, freeTier, withKeys,
    totalModels, totalTests, totalLogs,
    logStats: logStats.map(s => ({ status: s.status, count: s._count })),
    topProviders,
    testStats: testStats.map(s => ({ status: s.status, count: s._count })),
    recentLogs,
  });
}
