import type { AddressInfo } from './contracts';

export interface RegisteredServer {
  readonly host: string | undefined;
  readonly path: string | undefined;
}

interface Registration {
  server: RegisteredServer;
  host: string;
  address: AddressInfo;
}

// This registry belongs only to ws. It never consults the Socket.IO origin registry.
const registrations = new Set<Registration>();
let nextPort = 49152;

function normalizeHost(host: string): string {
  const lower = host.toLowerCase().replace(/^\[|\]$/g, '');
  return lower.includes(':') ? new URL(`http://[${lower}]`).hostname.slice(1, -1) : lower;
}

function hostKey(host: string): string {
  const normalized = normalizeHost(host);
  if (['localhost', '127.0.0.1', '::1'].includes(normalized)) return 'local';
  return normalized;
}

function accepts(bound: string, target: string): boolean {
  return (
    bound === '*' ||
    bound === '::' ||
    bound === target ||
    (bound === '0.0.0.0' && !target.includes(':'))
  );
}

export function register(server: RegisteredServer, port: number): AddressInfo | null {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new RangeError('port must be an integer between 0 and 65535');
  }
  const boundHost = server.host === undefined ? undefined : normalizeHost(server.host);
  if (
    boundHost !== undefined &&
    boundHost !== 'localhost' &&
    !boundHost.includes(':') &&
    !(
      /^(\d{1,3}\.){3}\d{1,3}$/.test(boundHost) &&
      boundHost.split('.').every((part) => Number(part) <= 255)
    )
  ) {
    throw new TypeError('Server host must be an IP address or localhost');
  }
  if (port === 0) {
    let attempts = 0;
    do {
      port = nextPort;
      nextPort = nextPort === 65535 ? 49152 : nextPort + 1;
      if (++attempts > 16384) throw new Error('No virtual ports are available');
    } while ([...registrations].some((entry) => entry.address.port === port));
  }
  const host = boundHost === undefined ? '*' : hostKey(boundHost);
  if (
    [...registrations].some(
      (entry) =>
        entry.address.port === port && (accepts(entry.host, host) || accepts(host, entry.host)),
    )
  )
    return null;

  const address = boundHost === undefined ? '::' : boundHost === 'localhost' ? '::1' : boundHost;
  const info = { address, family: address.includes(':') ? 'IPv6' : 'IPv4', port };
  registrations.add({ server, host, address: info });
  return info;
}

export function unregister(server: RegisteredServer): void {
  for (const entry of registrations) {
    if (entry.server === server) registrations.delete(entry);
  }
}

export function findServer(url: URL): RegisteredServer | undefined {
  const port = Number(url.port || (url.protocol === 'wss:' ? 443 : 80));
  const host = hostKey(url.hostname);
  return [...registrations].find(
    (entry) =>
      entry.address.port === port &&
      accepts(entry.host, host) &&
      (!entry.server.path || entry.server.path === url.pathname),
  )?.server;
}
