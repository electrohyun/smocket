export interface ManagerServerSocket {
  disconnectNamespaceFromServer(): void;
  isActive(): boolean;
}

export interface ManagedClient {
  cancelConnectionAttemptFromManager(): void;
  disconnectFromServer(): void;
  ownsConnection(socket: ManagerServerSocket): boolean;
}

/**
 * One host-neutral socket.io-client Manager identity (0028). It remembers the
 * namespace sockets created through it, including admission still in progress, and
 * the order in which they connect, but models no Engine.IO transport, retry,
 * heartbeat, or fallback behavior.
 */
export class Manager {
  private readonly namespaces = new Set<string>();
  private readonly pendingClients = new Set<ManagedClient>();
  private readonly connectedClients = new Set<ManagedClient>();

  constructor(namespace: string) {
    this.namespaces.add(namespace);
  }

  owns(namespace: string): boolean {
    return this.namespaces.has(namespace);
  }

  claim(namespace: string): void {
    this.namespaces.add(namespace);
  }

  registerPending(client: ManagedClient): void {
    this.pendingClients.add(client);
  }

  settlePending(client: ManagedClient): void {
    this.pendingClients.delete(client);
  }

  connected(client: ManagedClient): void {
    this.pendingClients.delete(client);
    this.connectedClients.add(client);
  }

  disconnected(client: ManagedClient): void {
    this.connectedClients.delete(client);
  }

  /** Close connected namespaces in order and cancel admission still pending on this Manager. */
  disconnect(initiator: ManagerServerSocket): void {
    for (const client of [...this.connectedClients]) client.disconnectFromServer();
    for (const client of [...this.pendingClients]) {
      // The server `connection` handler runs while its client attempt is technically
      // pending. Preserve that initiating socket's synchronous server lifecycle below;
      // every other pending namespace must be cancelled with the shared Manager.
      if (!client.ownsConnection(initiator)) client.cancelConnectionAttemptFromManager();
    }
    // A server `connection` handler runs before the initiating client reaches its
    // `connect` event and Manager roster. Include that socket explicitly; on the
    // ordinary connected path its teardown guard makes this duplicate a no-op.
    initiator.disconnectNamespaceFromServer();
  }
}
