// QR Code parser for provider configuration
// Supports JSON config and URI format: omniroute://configure?provider=slug&key=xxx&baseUrl=xxx

export interface QrProviderConfig {
  slug: string;
  apiKey?: string;
  baseUrl?: string;
  priority?: number;
  quotaLimit?: number;
}

export function parseQrConfig(data: string): QrProviderConfig | null {
  // Try JSON first
  if (data.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(data.trim());
      if (parsed.slug) return parsed as QrProviderConfig;
    } catch {}
  }

  // Try URI format
  try {
    const url = new URL(data.trim());
    if (url.protocol === 'omniroute:' || url.protocol === 'http:' || url.protocol === 'https:') {
      const params = url.searchParams;
      const slug = params.get('provider') || params.get('slug');
      if (!slug) return null;
      return {
        slug,
        apiKey: params.get('key') || undefined,
        baseUrl: params.get('baseUrl') || undefined,
        priority: params.get('priority') ? parseInt(params.get('priority')!) : undefined,
        quotaLimit: params.get('quotaLimit') ? parseInt(params.get('quotaLimit')!) : undefined,
      };
    }
  } catch {}

  return null;
}