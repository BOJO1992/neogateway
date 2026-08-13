import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {
    const providerCount = await db.provider.count();
    const modelCount = await db.providerModel.count();
    const dbOk = providerCount > 0;
    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: dbOk ? 'connected' : 'empty',
      providers: providerCount,
      models: modelCount,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'DB error';
    return NextResponse.json({ status: 'error', database: 'disconnected', error: message }, { status: 503 });
  }
}
