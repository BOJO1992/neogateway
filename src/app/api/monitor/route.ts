import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { seedDatabase } from '@/lib/seed';

export async function GET() {
  const count = await db.provider.count();
  if (count === 0) await seedDatabase();

  const events = await db.monitorEvent.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return NextResponse.json({ events });
}

export async function POST(request: Request) {
  const { eventType, providerSlug, title, description, source, severity } = await request.json();
  const event = await db.monitorEvent.create({
    data: { eventType, providerSlug, title, description, source, severity: severity || 'info' },
  });
  return NextResponse.json({ event });
}