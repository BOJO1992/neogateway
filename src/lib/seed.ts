import { db } from '@/lib/db';
import { providers } from './providers-data';

export async function seedDatabase() {
  console.log('Seeding database v3...');

  const count = await db.provider.count();
  if (count > 0) {
    console.log(`Database already has ${count} providers. Skipping seed.`);
    return;
  }

  let created = 0;
  for (const p of providers) {
    try {
      await db.provider.create({
        data: {
          name: p.name,
          slug: p.slug,
          category: p.category,
          region: p.region,
          baseUrl: p.baseUrl,
          apiFormat: p.apiFormat,
          authType: p.authType,
          authHeader: p.authHeader,
          keyPrefix: p.keyPrefix,
          modelsUrl: p.modelsUrl,
          docsUrl: p.docsUrl,
          pricing: p.pricing,
          freeTier: p.freeTier,
          status: p.status,
          notes: p.notes,
          models: {
            create: p.models.map((m) => ({
              modelId: m.modelId,
              modelName: m.modelName,
              contextWindow: m.contextWindow,
              maxOutput: m.maxOutput,
              pricing: m.pricing,
              capabilities: JSON.stringify(m.capabilities),
            })),
          },
        },
      });
      created++;
      console.log(`  Created: ${p.name} (${p.models.length} models)`);
    } catch (err) {
      console.error(`  Failed: ${p.name}`, err instanceof Error ? err.message : err);
    }
  }

  await db.monitorEvent.createMany({
    data: [
      { eventType: 'new_provider', providerSlug: 'cerebras', title: 'Cerebras API Launched', description: 'Cerebras now offers LLM inference API with WSE-3 chip. Ultra-fast speeds.', source: 'web_search', severity: 'info' },
      { eventType: 'model_update', providerSlug: 'openai', title: 'GPT-4.1 Released', description: 'OpenAI released GPT-4.1 with 1M context window.', source: 'web_search', severity: 'info' },
      { eventType: 'new_provider', providerSlug: 'moonshot', title: 'Moonshot AI Kimi K3 Open-Weight', description: 'Kimi K3 weights published. Available via API.', source: 'web_search', severity: 'info' },
      { eventType: 'new_provider', providerSlug: 'minimax', title: 'MiniMax-01 Open-Sourced', description: 'MiniMax-01 MoE model open-sourced. 4M context window.', source: 'web_search', severity: 'info' },
      { eventType: 'pricing_change', providerSlug: 'groq', title: 'Groq Free Tier Updated', description: 'Groq increased free tier to 30 req/min, 14400 tok/day.', source: 'web_search', severity: 'info' },
    ],
  });

  console.log(`Seed complete! ${created} providers created.`);
}
