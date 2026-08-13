"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search, Zap, Shield, Server, TestTube, Radio, ChevronRight, ExternalLink,
  CheckCircle2, XCircle, Clock, Loader2, Activity, Key, QrCode, Settings,
  Play, Pause, RotateCcw, Copy, Trash2, Plus, ArrowUpDown, ToggleLeft, ToggleRight,
  Terminal, Globe, BarChart3, AlertTriangle, ScanLine, Eye, EyeOff, Send
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { categoryColors, regionLabels } from '@/lib/providers-data';

// ─── Types ───────────────────────────────────────────────
interface ProviderModel { id: string; modelId: string; modelName: string; contextWindow: number | null; maxOutput: number | null; capabilities: string; status: string; }
interface Provider {
  id: string; name: string; slug: string; category: string; region: string;
  baseUrl: string; apiFormat: string; authType: string; authHeader: string;
  keyPrefix: string; freeTier: boolean; status: string; notes: string;
  priority: number; enabled: boolean; apiKey: string; customBaseUrl: string;
  quotaLimit: number; quotaUsed: number; avgLatency: number; totalCalls: number;
  errorCount: number; lastChecked: string | null; models: ProviderModel[];
}

interface SandboxTest {
  id: string; providerId: string; modelId: string; testType: string;
  status: string; latencyMs: number | null; responseJson: string; error: string;
  createdAt: string; sandboxMode: boolean;
  provider?: { name: string; slug: string };
}

interface GatewayLog {
  id: string; providerId: string | null; modelId: string; latencyMs: number;
  status: string; errorMessage: string; agentMode: boolean; toolCalls: number;
  createdAt: string; provider?: { name: string; slug: string };
}

interface ApiKey { id: string; key: string; name: string; rateLimit: number; totalLimit: number; totalUsed: number; enabled: boolean; createdAt: string; }

interface Stats {
  total: number; enabled: number; freeTier: number; withKeys: number;
  totalModels: number; totalTests: number; totalLogs: number;
  logStats: { status: string; count: number }[];
  topProviders: { name: string; slug: string; totalCalls: number; avgLatency: number; errorCount: number }[];
  testStats: { status: string; count: number }[];
  recentLogs: (GatewayLog & { provider?: { name: string; slug: string } })[];
}

// ─── Main Component ───────────────────────────────────────
export default function GatewayDashboard() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [tests, setTests] = useState<SandboxTest[]>([]);
  const [logs, setLogs] = useState<GatewayLog[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sandboxMode, setSandboxMode] = useState(false);
  const [agentMode, setAgentMode] = useState(false);
  const [activeTab, setActiveTab] = useState('providers');

  // Test state
  const [testProviderId, setTestProviderId] = useState('');
  const [testModelId, setTestModelId] = useState('');
  const [testApiKey, setTestApiKey] = useState('');
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

  // Configure dialog
  const [configProvider, setConfigProvider] = useState<Provider | null>(null);
  const [configKey, setConfigKey] = useState('');
  const [configPriority, setConfigPriority] = useState(0);
  const [configBaseUrl, setConfigBaseUrl] = useState('');
  const [configQuota, setConfigQuota] = useState(0);
  const [showKey, setShowKey] = useState(false);

  // Chat playground
  const [chatModel, setChatModel] = useState('');
  const [chatMessages, setChatMessages] = useState<{ role: string; content: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // QR Scanner
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const [qrResult, setQrResult] = useState<string>('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const [qrScanning, setQrScanning] = useState(false);

  // New key dialog
  const [newKeyName, setNewKeyName] = useState('');

  // ─── Data Fetching ─────────────────────────────────────
  const fetchData = useCallback(async () => {
    try {
      const [provRes, statRes, logRes, keyRes] = await Promise.all([
        fetch('/api/providers').then(r => r.json()),
        fetch('/api/stats').then(r => r.json()),
        fetch('/api/logs?limit=50').then(r => r.json()),
        fetch('/api/keys').then(r => r.json()),
      ]);
      setProviders(provRes.providers || []);
      setStats(statRes);
      setLogs(logRes.logs || []);
      setApiKeys(keyRes.keys || []);
    } catch (e) { console.error('Fetch error:', e); }
    finally { setLoading(false); }
  }, []);

  const fetchTests = useCallback(async (providerId?: string) => {
    const url = providerId ? `/api/sandbox/run?providerId=${providerId}` : '/api/sandbox/run';
    const res = await fetch(url);
    const data = await res.json();
    setTests(data.tests || []);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { if (activeTab === 'sandbox') fetchTests(); }, [activeTab, fetchTests]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

  // ─── Actions ────────────────────────────────────────────
  const runTest = async (providerId: string, modelId: string, testType: string = 'chat') => {
    setTestRunning(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/sandbox/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId, modelId, testType, apiKey: testApiKey, sandboxMode }),
      });
      const data = await res.json();
      setTestResult(data);
      fetchTests(providerId);
      fetchData();
    } catch (e: any) { setTestResult({ status: 'failed', error: e.message }); }
    finally { setTestRunning(false); }
  };

  const saveConfig = async () => {
    if (!configProvider) return;
    await fetch('/api/providers/configure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerId: configProvider.id, apiKey: configKey, priority: configPriority,
        enabled: configProvider.enabled, customBaseUrl: configBaseUrl, quotaLimit: configQuota,
      }),
    });
    setConfigProvider(null);
    fetchData();
  };

  const toggleProvider = async (p: Provider) => {
    await fetch('/api/providers/configure', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: p.id, enabled: !p.enabled }),
    });
    fetchData();
  };

  const createKey = async () => {
    const res = await fetch('/api/keys', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newKeyName || 'Default' }),
    });
    const data = await res.json();
    if (data.key) {
      await navigator.clipboard.writeText(data.key);
      alert(`API Key created & copied: ${data.key}`);
    }
    setNewKeyName('');
    fetchData();
  };

  const deleteKey = async (id: string) => {
    await fetch(`/api/keys?id=${id}`, { method: 'DELETE' });
    fetchData();
  };

  const sendChat = async () => {
    if (!chatInput.trim() || !chatModel) return;
    const msg = { role: 'user', content: chatInput };
    setChatMessages(prev => [...prev, msg]);
    setChatInput('');
    setChatLoading(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: chatModel,
          messages: [...chatMessages, msg],
          agent_mode: agentMode,
          max_tokens: 1024,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setChatMessages(prev => [...prev, { role: 'assistant', content: `Error: ${data.error.message}` }]);
      } else {
        const content = data.choices?.[0]?.message?.content || JSON.stringify(data);
        setChatMessages(prev => [...prev, { role: 'assistant', content }]);
      }
      fetchData();
    } catch (e: any) {
      setChatMessages(prev => [...prev, { role: 'assistant', content: `Network error: ${e.message}` }]);
    }
    finally { setChatLoading(false); }
  };

  // QR Scanner
  const startQrScan = async () => {
    setQrScanning(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      // Poll for QR (simplified - in production use jsQR library)
      // For now, manual paste fallback
    } catch (e) {
      setQrResult('Camera not available. Paste config JSON or URI below:');
    }
  };

  const applyQrConfig = async () => {
    if (!qrResult.trim()) return;
    try {
      let config: any;
      if (qrResult.trim().startsWith('{')) {
        config = JSON.parse(qrResult.trim());
      } else {
        const url = new URL(qrResult.trim());
        config = { slug: url.searchParams.get('provider') || url.searchParams.get('slug'),
          apiKey: url.searchParams.get('key') || undefined,
          baseUrl: url.searchParams.get('baseUrl') || undefined };
      }
      if (config.slug) {
        const prov = providers.find(p => p.slug === config.slug);
        if (prov) {
          await fetch('/api/providers/configure', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ providerId: prov.id, apiKey: config.apiKey, customBaseUrl: config.baseUrl, sandboxMode }),
          });
          fetchData();
          setQrDialogOpen(false);
          setQrResult('');
        }
      }
    } catch (e: any) { setQrResult(`Parse error: ${e.message}`); }
  };

  // ─── Filtered Data ──────────────────────────────────────
  const filteredProviders = providers.filter(p => {
    if (categoryFilter !== 'all' && p.category !== categoryFilter) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.slug.includes(search.toLowerCase())) return false;
    return true;
  }).sort((a, b) => b.priority - a.priority);

  const configuredProviders = providers.filter(p => p.apiKey && p.apiKey.length > 0);
  const availableModels = configuredProviders.flatMap(p => p.models.map(m => ({ providerId: p.id, providerName: p.name, ...m })));

  // ─── Render ─────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
    </div>
  );

  return (
    <TooltipProvider>
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Zap className="w-5 h-5 text-blue-500" />
            <h1 className="font-bold text-lg">NeoGateway</h1>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">{stats?.enabled || 0} Active</Badge>
            <Badge variant="outline" className="text-xs">{stats?.withKeys || 0} Keys Set</Badge>
            <Badge variant="outline" className="text-xs">{stats?.totalLogs || 0} Requests</Badge>
            <Button size="sm" variant="ghost" onClick={() => setQrDialogOpen(true)}><QrCode className="w-4 h-4" /></Button>
            <Button size="sm" variant="ghost" onClick={fetchData}><RotateCcw className="w-4 h-4" /></Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Top Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Providers', value: stats?.total || 0, sub: `${stats?.freeTier || 0} free tier`, icon: Server, color: 'text-blue-500' },
            { label: 'Configured', value: stats?.withKeys || 0, sub: `${stats?.enabled || 0} enabled`, icon: Key, color: 'text-emerald-500' },
            { label: 'Tests Run', value: stats?.totalTests || 0, sub: `${stats?.testStats?.find(t => t.status === 'passed')?.count || 0} passed`, icon: TestTube, color: 'text-amber-500' },
            { label: 'Gateway Calls', value: stats?.totalLogs || 0, sub: `${stats?.logStats?.find(l => l.status === 'success')?.count || 0} success`, icon: Activity, color: 'text-violet-500' },
          ].map(s => (
            <Card key={s.label} className="bg-zinc-900 border-zinc-800">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-zinc-500 uppercase tracking-wider">{s.label}</span>
                  <s.icon className={`w-4 h-4 ${s.color}`} />
                </div>
                <p className="text-2xl font-bold">{s.value}</p>
                <p className="text-xs text-zinc-500 mt-1">{s.sub}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-zinc-900 border border-zinc-800 mb-6">
            <TabsTrigger value="providers" className="gap-1.5"><Server className="w-3.5 h-3.5" /> Providers</TabsTrigger>
            <TabsTrigger value="sandbox" className="gap-1.5"><TestTube className="w-3.5 h-3.5" /> Sandbox</TabsTrigger>
            <TabsTrigger value="chat" className="gap-1.5"><Terminal className="w-3.5 h-3.5" /> Chat</TabsTrigger>
            <TabsTrigger value="keys" className="gap-1.5"><Key className="w-3.5 h-3.5" /> Keys</TabsTrigger>
            <TabsTrigger value="logs" className="gap-1.5"><BarChart3 className="w-3.5 h-3.5" /> Logs</TabsTrigger>
          </TabsList>

          {/* ═══ PROVIDERS TAB ═══ */}
          <TabsContent value="providers">
            <div className="flex flex-col md:flex-row gap-3 mb-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <Input placeholder="Search providers..." value={search} onChange={e => setSearch(e.target.value)}
                  className="pl-9 bg-zinc-900 border-zinc-800" />
              </div>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-44 bg-zinc-900 border-zinc-800"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-800">
                  <SelectItem value="all">All Categories</SelectItem>
                  {['first-party', 'inference', 'gateway', 'cloud', 'chinese', 'asian', 'hosting', 'emerging'].map(c => (
                    <SelectItem key={c} value={c}>{c.replace('-', ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2">
                <Label className="text-xs text-zinc-400 whitespace-nowrap">Sandbox</Label>
                <Switch checked={sandboxMode} onCheckedChange={setSandboxMode} />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredProviders.map(p => (
                <Card key={p.id} className={`bg-zinc-900 border-zinc-800 transition-all hover:border-zinc-700 ${!p.enabled ? 'opacity-50' : ''}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-sm font-semibold truncate">{p.name}</CardTitle>
                          {p.freeTier && <Badge className="text-[10px] px-1.5 py-0 bg-emerald-500/20 text-emerald-400 border-emerald-500/30">FREE</Badge>}
                          {p.apiKey && <Badge className="text-[10px] px-1.5 py-0 bg-blue-500/20 text-blue-400 border-blue-500/30">KEY SET</Badge>}
                        </div>
                        <p className="text-xs text-zinc-500 mt-0.5">{p.slug} · {p.apiFormat} · {regionLabels[p.region] || p.region}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Tooltip><TooltipTrigger asChild><Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => toggleProvider(p)}>
                          {p.enabled ? <ToggleRight className="w-4 h-4 text-emerald-500" /> : <ToggleLeft className="w-4 h-4 text-zinc-600" />}
                        </Button></TooltipTrigger><TooltipContent>Toggle enabled</TooltipContent></Tooltip>
                        <Tooltip><TooltipTrigger asChild><Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => {
                          setConfigProvider(p); setConfigKey(p.apiKey); setConfigPriority(p.priority);
                          setConfigBaseUrl(p.customBaseUrl); setConfigQuota(p.quotaLimit);
                        }}><Settings className="w-3.5 h-3.5" /></Button></TooltipTrigger><TooltipContent>Configure</TooltipContent></Tooltip>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <Badge className={`text-[10px] ${categoryColors[p.category] || ''}`}>{p.category}</Badge>
                    <div className="flex items-center justify-between mt-2 text-xs text-zinc-500">
                      <span>{p.models.length} models</span>
                      {p.totalCalls > 0 && <span>{p.totalCalls} calls · {p.avgLatency}ms</span>}
                      {p.avgLatency > 0 && p.totalCalls === 0 && <span>{p.avgLatency}ms avg</span>}
                    </div>
                    {p.quotaLimit > 0 && (
                      <div className="mt-2">
                        <Progress value={(p.quotaUsed / p.quotaLimit) * 100} className="h-1" />
                        <p className="text-[10px] text-zinc-500 mt-0.5">Quota: {p.quotaUsed}/{p.quotaLimit}</p>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 mt-3">
                      {p.models.slice(0, 3).map(m => (
                        <Badge key={m.id} variant="outline" className="text-[10px] truncate max-w-[120px]">{m.modelId}</Badge>
                      ))}
                      {p.models.length > 3 && <Badge variant="outline" className="text-[10px]">+{p.models.length - 3}</Badge>}
                    </div>
                    <div className="flex items-center gap-1 mt-3">
                      <Button size="sm" variant="outline" className="h-7 text-xs flex-1" disabled={!p.apiKey || !p.models[0]}
                        onClick={() => { setTestProviderId(p.id); setTestModelId(p.models[0]?.modelId || ''); setActiveTab('sandbox'); }}>
                        <Play className="w-3 h-3 mr-1" /> Test
                      </Button>
                      {p.docsUrl && <a href={p.docsUrl} target="_blank" rel="noopener">
                        <Button size="icon" variant="ghost" className="h-7 w-7"><ExternalLink className="w-3 h-3" /></Button>
                      </a>}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* ═══ SANDBOX TAB ═══ */}
          <TabsContent value="sandbox">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Test Config */}
              <Card className="bg-zinc-900 border-zinc-800">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Sandbox Test</CardTitle>
                  <CardDescription className="text-xs">Real network requests to providers</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label className="text-xs">Provider</Label>
                    <Select value={testProviderId} onValueChange={setTestProviderId}>
                      <SelectTrigger className="bg-zinc-950 border-zinc-800"><SelectValue placeholder="Select provider" /></SelectTrigger>
                      <SelectContent className="bg-zinc-900 border-zinc-800">
                        {configuredProviders.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Model</Label>
                    <Select value={testModelId} onValueChange={setTestModelId}>
                      <SelectTrigger className="bg-zinc-950 border-zinc-800"><SelectValue placeholder="Select model" /></SelectTrigger>
                      <SelectContent className="bg-zinc-900 border-zinc-800">
                        {availableModels.filter(m => m.providerId === testProviderId).map(m => (
                          <SelectItem key={m.modelId} value={m.modelId}>{m.modelName || m.modelId}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">API Key (optional override)</Label>
                    <div className="relative">
                      <Input type={showKey ? 'text' : 'password'} placeholder="sk-..." value={testApiKey} onChange={e => setTestApiKey(e.target.value)}
                        className="bg-zinc-950 border-zinc-800 pr-9" />
                      <Button variant="ghost" size="icon" className="absolute right-0 top-0 h-full w-9" onClick={() => setShowKey(!showKey)}>
                        {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={sandboxMode} onCheckedChange={setSandboxMode} />
                    <Label className="text-xs">Sandbox Mode (isolated logs)</Label>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1" disabled={!testProviderId || !testModelId || testRunning}
                      onClick={() => runTest(testProviderId, testModelId, 'chat')}>
                      {testRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3 mr-1" />} Chat Test
                    </Button>
                    <Button size="sm" variant="outline" disabled={!testProviderId || !testModelId || testRunning}
                      onClick={() => runTest(testProviderId, testModelId, 'streaming')}>
                      <Radio className="w-3 h-3 mr-1" /> Stream
                    </Button>
                  </div>
                  {testResult && (
                    <div className={`p-3 rounded-lg text-xs ${testResult.status === 'passed' ? 'bg-emerald-500/10 border border-emerald-500/20' :
                      testResult.status === 'timeout' ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-red-500/10 border border-red-500/20'}`}>
                      <div className="flex items-center gap-1.5 mb-1">
                        {testResult.status === 'passed' ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> :
                         testResult.status === 'timeout' ? <Clock className="w-3.5 h-3.5 text-amber-400" /> :
                         <XCircle className="w-3.5 h-3.5 text-red-400" />}
                        <span className="font-medium">{testResult.status.toUpperCase()}</span>
                        <span className="text-zinc-500 ml-auto">{testResult.latencyMs}ms</span>
                        {testResult.streamChunks && <Badge className="text-[10px]">{testResult.streamChunks} chunks</Badge>}
                      </div>
                      <p className="text-zinc-400 break-all">{testResult.response?.substring(0, 200)}</p>
                      {testResult.error && <p className="text-red-400 mt-1">{testResult.error}</p>}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Test History */}
              <Card className="bg-zinc-900 border-zinc-800 lg:col-span-2">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">Test History</CardTitle>
                    <Button size="sm" variant="ghost" onClick={() => fetchTests()}><RotateCcw className="w-3.5 h-3.5" /></Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[400px]">
                    <div className="space-y-2">
                      {tests.map(t => (
                        <div key={t.id} className="flex items-center gap-3 p-2 rounded-lg bg-zinc-950/50 text-xs">
                          {t.status === 'passed' ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> :
                           t.status === 'timeout' ? <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" /> :
                           <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                          <span className="font-medium truncate w-28">{t.provider?.name}</span>
                          <span className="text-zinc-500 truncate flex-1">{t.modelId}</span>
                          {t.latencyMs && <span className="text-zinc-500">{t.latencyMs}ms</span>}
                          {t.sandboxMode && <Badge className="text-[10px] bg-amber-500/20 text-amber-400 border-amber-500/30">SANDBOX</Badge>}
                          <span className="text-zinc-600">{new Date(t.createdAt).toLocaleTimeString()}</span>
                        </div>
                      ))}
                      {tests.length === 0 && <p className="text-zinc-600 text-center py-8">No tests yet. Configure a provider key and hit Test.</p>}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ═══ CHAT TAB ═══ */}
          <TabsContent value="chat">
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
              <Card className="bg-zinc-900 border-zinc-800">
                <CardHeader className="pb-3"><CardTitle className="text-sm">Chat Playground</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label className="text-xs">Model</Label>
                    <Select value={chatModel} onValueChange={setChatModel}>
                      <SelectTrigger className="bg-zinc-950 border-zinc-800"><SelectValue placeholder="Select configured model" /></SelectTrigger>
                      <SelectContent className="bg-zinc-900 border-zinc-800">
                        {availableModels.map(m => (
                          <SelectItem key={m.providerId + '/' + m.modelId} value={`${m.providerName.toLowerCase()}/${m.modelId}`}>
                            {m.providerName}/{m.modelId}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Agent Mode (Hermes)</Label>
                    <Switch checked={agentMode} onCheckedChange={setAgentMode} />
                  </div>
                  <Separator className="bg-zinc-800" />
                  <div className="space-y-1.5">
                    <Label className="text-xs text-zinc-500">Gateway Endpoint</Label>
                    <code className="block text-[11px] bg-zinc-950 p-2 rounded border border-zinc-800 break-all text-blue-400">POST /api/chat</code>
                    <p className="text-[10px] text-zinc-600">OpenAI-compatible. Use with any client.</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-zinc-500">Curl Example</Label>
                    <pre className="text-[10px] bg-zinc-950 p-2 rounded border border-zinc-800 overflow-x-auto text-zinc-400">
{`curl ${window.location.origin}/api/chat \
  -H "Authorization: Bearer gw-..." \
  -H "Content-Type: application/json" \
  -d '{"model":"openai/gpt-4o-mini",
  "messages":[{"role":"user",
  "content":"Hello"}]}'`}
                    </pre>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-zinc-900 border-zinc-800 lg:col-span-3">
                <CardContent className="p-0">
                  <ScrollArea className="h-[500px] p-4">
                    <div className="space-y-3">
                      {chatMessages.length === 0 && (
                        <div className="text-center py-16 text-zinc-600">
                          <Terminal className="w-10 h-10 mx-auto mb-3 opacity-30" />
                          <p className="text-sm">Select a model and start chatting</p>
                          <p className="text-xs mt-1">Routes through configured providers with auto-fallback</p>
                        </div>
                      )}
                      {chatMessages.map((m, i) => (
                        <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[80%] p-3 rounded-lg text-sm ${
                            m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-200'}`}>
                            <pre className="whitespace-pre-wrap font-sans text-sm">{m.content}</pre>
                          </div>
                        </div>
                      ))}
                      {chatLoading && (
                        <div className="flex justify-start"><div className="bg-zinc-800 p-3 rounded-lg"><Loader2 className="w-4 h-4 animate-spin text-zinc-400" /></div></div>
                      )}
                      <div ref={chatEndRef} />
                    </div>
                  </ScrollArea>
                  <div className="border-t border-zinc-800 p-3 flex gap-2">
                    <Input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendChat()}
                      placeholder="Type a message... (Enter to send)" className="flex-1 bg-zinc-950 border-zinc-800" disabled={chatLoading} />
                    <Button onClick={sendChat} disabled={chatLoading || !chatInput.trim() || !chatModel}><Send className="w-4 h-4" /></Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ═══ KEYS TAB ═══ */}
          <TabsContent value="keys">
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-sm">Gateway API Keys</CardTitle>
                    <CardDescription className="text-xs">Keys for external clients to access /api/chat</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input placeholder="Key name" value={newKeyName} onChange={e => setNewKeyName(e.target.value)} className="w-40 h-8 text-xs bg-zinc-950 border-zinc-800" />
                    <Button size="sm" onClick={createKey}><Plus className="w-3.5 h-3.5 mr-1" /> Create Key</Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {apiKeys.length === 0 ? (
                  <p className="text-zinc-600 text-sm text-center py-8">No API keys yet. Create one to use the gateway endpoint.</p>
                ) : (
                  <div className="space-y-2">
                    {apiKeys.map(k => (
                      <div key={k.id} className="flex items-center gap-3 p-3 rounded-lg bg-zinc-950/50 text-xs">
                        <Key className="w-4 h-4 text-zinc-500" />
                        <span className="font-medium flex-1">{k.name}</span>
                        <code className="text-zinc-500">{k.key}</code>
                        <span className="text-zinc-600">{k.totalUsed} uses</span>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => deleteKey(k.id)}><Trash2 className="w-3.5 h-3.5 text-red-400" /></Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══ LOGS TAB ═══ */}
          <TabsContent value="logs">
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">Gateway Logs</CardTitle>
                  <Button size="sm" variant="ghost" onClick={fetchData}><RotateCcw className="w-3.5 h-3.5" /></Button>
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[500px]">
                  <div className="space-y-1.5">
                    {logs.map(l => (
                      <div key={l.id} className="flex items-center gap-3 p-2 rounded-lg text-xs hover:bg-zinc-950/50">
                        {l.status === 'success' ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> :
                         l.status === 'fallback' ? <ArrowUpDown className="w-3.5 h-3.5 text-amber-400 shrink-0" /> :
                         <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                        <span className="font-medium w-24 truncate">{l.provider?.name || 'unknown'}</span>
                        <span className="text-zinc-500 flex-1 truncate">{l.modelId}</span>
                        <span className="text-zinc-600">{l.latencyMs}ms</span>
                        {l.agentMode && <Badge className="text-[10px] bg-violet-500/20 text-violet-400">AGENT</Badge>}
                        {l.toolCalls > 0 && <Badge className="text-[10px]">{l.toolCalls} tools</Badge>}
                        <span className="text-zinc-700">{new Date(l.createdAt).toLocaleTimeString()}</span>
                      </div>
                    ))}
                    {logs.length === 0 && <p className="text-zinc-600 text-center py-8">No gateway calls yet. Use Chat tab or send requests to /api/chat.</p>}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* ═══ CONFIGURE DIALOG ═══ */}
      <Dialog open={!!configProvider} onOpenChange={() => setConfigProvider(null)}>
        <DialogContent className="bg-zinc-900 border-zinc-800">
          <DialogHeader>
            <DialogTitle className="text-sm">Configure {configProvider?.name}</DialogTitle>
            <DialogDescription className="text-xs">Set API key, priority, custom URL, and quota</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">API Key</Label>
              <Input type="password" placeholder={`${configProvider?.keyPrefix || 'sk-'}...`} value={configKey}
                onChange={e => setConfigKey(e.target.value)} className="bg-zinc-950 border-zinc-800" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Priority (higher = first)</Label>
                <Input type="number" value={configPriority} onChange={e => setConfigPriority(parseInt(e.target.value) || 0)} className="bg-zinc-950 border-zinc-800" />
              </div>
              <div>
                <Label className="text-xs">Quota Limit (0=unlimited)</Label>
                <Input type="number" value={configQuota} onChange={e => setConfigQuota(parseInt(e.target.value) || 0)} className="bg-zinc-950 border-zinc-800" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Custom Base URL (override)</Label>
              <Input placeholder={configProvider?.baseUrl} value={configBaseUrl} onChange={e => setConfigBaseUrl(e.target.value)} className="bg-zinc-950 border-zinc-800" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfigProvider(null)}>Cancel</Button>
            <Button onClick={saveConfig}>Save Configuration</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ QR SCANNER DIALOG ═══ */}
      <Dialog open={qrDialogOpen} onOpenChange={setQrDialogOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-800">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2"><QrCode className="w-4 h-4" /> Scan QR / Paste Config</DialogTitle>
            <DialogDescription className="text-xs">Scan a QR code or paste provider config JSON/URI to add a provider</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <video ref={videoRef} className="w-full rounded-lg bg-zinc-950 h-48 object-cover" />
            <Button size="sm" variant="outline" onClick={startQrScan} className="w-full"><ScanLine className="w-3.5 h-3.5 mr-1" /> {qrScanning ? 'Scanning...' : 'Start Camera'}</Button>
            <div>
              <Label className="text-xs">Or paste config:</Label>
              <textarea className="w-full h-24 bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs font-mono"
                placeholder={'{"slug":"openai","apiKey":"sk-..."}\nor omniroute://configure?provider=openai&key=sk-...'}
                value={qrResult} onChange={e => setQrResult(e.target.value)} />
            </div>
            {sandboxMode && <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">Sandbox Mode ON - will be added as sandbox only</Badge>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setQrDialogOpen(false); setQrResult(''); }}>Cancel</Button>
            <Button onClick={applyQrConfig} disabled={!qrResult.trim()}>Apply Config</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </TooltipProvider>
  );
}
