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
 * Host-neutral socket.io-client Manager identity across connected and pending
 * namespaces. It models no Engine.IO transport, retry, heartbeat, or fallback (0028).
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

  disconnect(initiator: ManagerServerSocket): void {
    for (const client of [...this.connectedClients]) client.disconnectFromServer();
    for (const client of [...this.pendingClients]) {
      // The initiating socket may still be pending inside its server `connection` handler.
      if (!client.ownsConnection(initiator)) client.cancelConnectionAttemptFromManager();
    }
    // Include that initiator explicitly; the connected path's teardown guard deduplicates it.
    initiator.disconnectNamespaceFromServer();
  }
}
