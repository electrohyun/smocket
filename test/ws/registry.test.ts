import { beforeEach, expect, it, vi } from 'vitest';

let registry: typeof import('../../src/ws/registry');

beforeEach(async () => {
  // A fresh registry keeps fixed ports and allocator exhaustion local to each case.
  vi.resetModules();
  registry = await import('../../src/ws/registry');
});

const server = (host?: string) => ({ host, path: undefined });

it.each([-1, 65536, 1.5, NaN, Infinity])('rejects invalid virtual port %s', (port) => {
  expect(() => registry.register(server(), port)).toThrow(RangeError);
});

it.each(['example.test', '256.0.0.1', '127.0.0'])('rejects unsupported server host %s', (host) => {
  expect(() => registry.register(server(host), 0)).toThrow(
    'Server host must be an IP address or localhost',
  );
});

it('routes default ws and wss ports to the matching registration', () => {
  const plain = server('127.0.0.1');
  const secure = server('127.0.0.1');
  registry.register(plain, 80);
  registry.register(secure, 443);
  expect(registry.findServer(new URL('ws://localhost/'))).toBe(plain);
  expect(registry.findServer(new URL('wss://localhost/'))).toBe(secure);
});

it('limits IPv4 wildcard lookup and detects wildcard collisions in either registration order', () => {
  const wildcard = server('0.0.0.0');
  registry.register(wildcard, 8080);
  expect(registry.findServer(new URL('ws://192.0.2.1:8080/'))).toBe(wildcard);
  expect(registry.findServer(new URL('ws://[2001:db8::1]:8080/'))).toBeUndefined();
  expect(registry.register(server('192.0.2.1'), 8080)).toBeNull();
  registry.unregister(wildcard);
  const specific = server('192.0.2.1');
  registry.register(specific, 8080);
  expect(registry.register(wildcard, 8080)).toBeNull();
  expect(registry.register(server('::'), 8080)).toBeNull();
  expect(registry.findServer(new URL('ws://192.0.2.2:8080/'))).toBeUndefined();
});

it('accepts IPv4 and IPv6 targets through an IPv6 wildcard', () => {
  const wildcard = server('::');
  expect(registry.register(wildcard, 8080)).toEqual({ address: '::', family: 'IPv6', port: 8080 });
  expect(registry.findServer(new URL('ws://192.0.2.1:8080/'))).toBe(wildcard);
  expect(registry.findServer(new URL('ws://[2001:db8::1]:8080/'))).toBe(wildcard);
});

it('skips occupied ports, wraps the allocator, reports exhaustion, and reuses a released port', () => {
  const reserved = server();
  registry.register(reserved, 49152);
  const automatic = server();
  expect(registry.register(automatic, 0)?.port).toBe(49153);
  for (let count = 0; count < 16382; count++) registry.register(automatic, 0);
  expect(() => registry.register(automatic, 0)).toThrow('No virtual ports are available');
  registry.unregister(reserved);
  expect(registry.register(automatic, 0)?.port).toBe(49152);
}, 30000);
