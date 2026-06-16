import { ProxyAgent, type Dispatcher } from 'undici';

type FetchInitWithDispatcher = RequestInit & { dispatcher?: Dispatcher };

const proxyAgents = new Map<string, ProxyAgent>();

function proxyEnvForProtocol(protocol: string): string {
  const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy || '';
  const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy || httpProxy;
  return protocol === 'https:' ? httpsProxy : httpProxy;
}

function noProxyEntries(): string[] {
  return (process.env.NO_PROXY || process.env.no_proxy || 'localhost,127.0.0.1,::1')
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function shouldBypassProxy(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return true;
  }

  for (const rawEntry of noProxyEntries()) {
    if (rawEntry === '*') return true;
    const entry = rawEntry.replace(/^\*\./, '.');
    if (entry.startsWith('.')) {
      if (hostname.endsWith(entry)) return true;
      continue;
    }
    if (hostname === entry) return true;
  }
  return false;
}

function dispatcherFor(input: RequestInfo | URL): Dispatcher | undefined {
  const url = input instanceof URL
    ? input
    : typeof input === 'string'
      ? new URL(input)
      : new URL(input.url);
  if (shouldBypassProxy(url)) return undefined;

  const proxyUrl = proxyEnvForProtocol(url.protocol);
  if (!proxyUrl) return undefined;

  let agent = proxyAgents.get(proxyUrl);
  if (!agent) {
    agent = new ProxyAgent(proxyUrl);
    proxyAgents.set(proxyUrl, agent);
  }
  return agent;
}

export async function proxyAwareFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const dispatcher = dispatcherFor(input);
  if (!dispatcher) return fetch(input, init);
  return fetch(input, { ...init, dispatcher } as FetchInitWithDispatcher);
}
