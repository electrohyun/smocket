import { afterEach, beforeEach } from 'vitest';
import type {
  ClientSocketContract,
  ConnectOptions,
  ServerContext,
  ServerContract,
} from './contract';

/**
 * The `mock` target: same `ServerContext` the tests are written against, but
 * backed by smocket instead of a real socket.io server, with no HTTP server and no
 * port. smocket has no implementation yet, so every seam below throws a legible
 * "not implemented" message rather than failing on a mystery `undefined`.
 * Running `SMOCKET_TARGET=mock` red across the board is the intended state for
 * this stage; section 2 turns these reds green one at a time, and each message
 * names the seam whose turn it is.
 */
export function setupMockServer(): ServerContext {
  const ctx = {} as ServerContext;

  beforeEach(() => {
    // A stand-in server so `ctx.io` is defined, so reaching `ctx.io.to()` (the
    // most travelled path) throws the same legible message as the other seams
    // instead of a bare TypeError. Section 2 swaps this for a real smocket
    // server. (Today `connectClient` throws first, so these method seams are
    // only reached once that one goes green, so this keeps the next red legible.)
    ctx.io = createMockServer();
  });

  afterEach(() => {
    // Section 2 seam: tear the smocket server down between tests.
  });

  ctx.nextConnection = (namespace = '/') => {
    throw new Error(`smocket: nextConnection(${namespace}) is not implemented yet`);
  };

  ctx.connectClient = async ({ namespace = '/' }: ConnectOptions = {}) => {
    // Section 2 ordering note: the real target awaits the client 'connect' and
    // the server-side 'connection' together (Promise.all) because they race.
    // If the mock establishes the connection synchronously inside
    // connectMockClient, the server socket already exists by the time we get
    // here, and a `nextConnection` that waits for the *next* connection would
    // hang. Whatever fills this in must hand back the socket that this connect
    // created, not await a fresh one.
    const client = connectMockClient(ctx.io, namespace);
    const serverSocket = await ctx.nextConnection(namespace);
    return { client, serverSocket };
  };

  return ctx;
}

/**
 * Stand-in server whose every method throws legibly. Decision ③ is in-memory
 * pairing (no URL, no port). smocket's public client API keeps socket.io-client's
 * `io(url)` signature, but that lives on smocket; this factory and
 * `connectMockClient` are only this file's internal seams into it.
 */
function createMockServer(): ServerContract {
  const seam = (member: string) => (): never => {
    throw new Error(`smocket: server.${member}() is not implemented yet`);
  };
  return {
    emit: seam('emit'),
    to: seam('to'),
    in: seam('in'),
    except: seam('except'),
    of: seam('of'),
  };
}

/**
 * The mock adapter's seam for attaching a client to the in-memory server on a
 * namespace (decision ③). When smocket grows its public API this delegates to
 * it; for now it throws so mock mode fails legibly.
 */
function connectMockClient(_server: ServerContract, namespace: string): ClientSocketContract {
  throw new Error(`smocket: connectMockClient(${namespace}) is not implemented yet`);
}
