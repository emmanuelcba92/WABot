import { DurableObject } from 'cloudflare:workers';

interface SseConnection {
  writer: WritableStreamDefaultWriter;
  type: 'gateway' | 'webapp';
  clientId: string;
}

export class SseBroker extends DurableObject {
  private connections: Map<string, SseConnection> = new Map();
  private keepaliveIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const clientId = url.searchParams.get('client') || `client_${Date.now()}`;
    const type = (url.searchParams.get('type') || 'webapp') as 'gateway' | 'webapp';

    console.log(`🔌 [SSE-DO] Nueva conexión: type=${type}, clientId=${clientId}`);

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    this.connections.set(clientId, { writer, type, clientId });

    writer.write(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'connected', clientId, timestamp: Date.now() })}\n\n`));

    const keepaliveInterval = setInterval(() => {
      writer.write(new TextEncoder().encode(': keepalive\n\n')).catch(() => {
        this.removeConnection(clientId);
      });
    }, 15000);
    this.keepaliveIntervals.set(clientId, keepaliveInterval);

    request.signal?.addEventListener('abort', () => {
      this.removeConnection(clientId);
    });

    const stats = this.getConnectionStats();
    console.log(`🔌 [SSE-DO] ${type} conectado: ${clientId} (total: ${stats.total}, gateways: ${stats.gateways}, webapps: ${stats.webapps})`);

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*',
      }
    });
  }

  private removeConnection(clientId: string): void {
    const conn = this.connections.get(clientId);
    if (conn) {
      conn.writer.close().catch(() => {});
      this.connections.delete(clientId);
      const interval = this.keepaliveIntervals.get(clientId);
      if (interval) {
        clearInterval(interval);
        this.keepaliveIntervals.delete(clientId);
      }
      const stats = this.getConnectionStats();
      console.log(`🔌 [SSE-DO] Desconectado: ${clientId} (total: ${stats.total})`);
    }
  }

  private getConnectionStats(): { total: number; gateways: number; webapps: number } {
    let gateways = 0;
    let webapps = 0;
    for (const conn of this.connections.values()) {
      if (conn.type === 'gateway') gateways++;
      else webapps++;
    }
    return { total: this.connections.size, gateways, webapps };
  }

  async broadcast(data: any): Promise<void> {
    const stats = this.getConnectionStats();
    console.log(`📢 [SSE-DO] broadcast: ${stats.total} total connections, data type: ${data?.type || 'unknown'}`);
    
    if (stats.total === 0) {
      console.log(`⚠️ [SSE-DO] NO connections - broadcast will be lost`);
      return;
    }
    
    const msg = `data: ${JSON.stringify(data)}\n\n`;
    const encoded = new TextEncoder().encode(msg);
    let sent = 0;
    let failed = 0;
    
    for (const [id, conn] of this.connections) {
      try {
        await conn.writer.write(encoded);
        sent++;
      } catch (e) {
        console.error(`❌ [SSE-DO] Failed to write to ${id}:`, e);
        this.removeConnection(id);
        failed++;
      }
    }
    
    console.log(`📢 [SSE-DO] broadcast complete: sent=${sent}, failed=${failed}`);
  }

  async broadcastToGateways(data: any): Promise<void> {
    const stats = this.getConnectionStats();
    console.log(`📢 [SSE-DO] broadcastToGateways: ${stats.gateways} gateway connections, data type: ${data?.type || 'unknown'}`);
    
    if (stats.gateways === 0) {
      console.log(`⚠️ [SSE-DO] NO gateway connections - broadcast will be lost`);
      return;
    }
    
    const msg = `data: ${JSON.stringify(data)}\n\n`;
    const encoded = new TextEncoder().encode(msg);
    let sent = 0;
    let failed = 0;
    
    for (const [id, conn] of this.connections) {
      if (conn.type === 'gateway') {
        try {
          await conn.writer.write(encoded);
          sent++;
        } catch (e) {
          console.error(`❌ [SSE-DO] Failed to write to gateway ${id}:`, e);
          this.removeConnection(id);
          failed++;
        }
      }
    }
    
    console.log(`📢 [SSE-DO] broadcastToGateways complete: sent=${sent}, failed=${failed}`);
  }

  async broadcastToWebApps(data: any): Promise<void> {
    const stats = this.getConnectionStats();
    console.log(`📢 [SSE-DO] broadcastToWebApps: ${stats.webapps} webapp connections, data type: ${data?.type || 'unknown'}`);
    
    if (stats.webapps === 0) {
      console.log(`⚠️ [SSE-DO] NO webapp connections - broadcast will be lost`);
      return;
    }
    
    const msg = `data: ${JSON.stringify(data)}\n\n`;
    const encoded = new TextEncoder().encode(msg);
    let sent = 0;
    let failed = 0;
    
    for (const [id, conn] of this.connections) {
      if (conn.type === 'webapp') {
        try {
          await conn.writer.write(encoded);
          sent++;
        } catch (e) {
          console.error(`❌ [SSE-DO] Failed to write to webapp ${id}:`, e);
          this.removeConnection(id);
          failed++;
        }
      }
    }
    
    console.log(`📢 [SSE-DO] broadcastToWebApps complete: sent=${sent}, failed=${failed}`);
  }

  async getConnections(): Promise<{ total: number; gateways: number; webapps: number }> {
    return this.getConnectionStats();
  }

  async debugConnections(): Promise<{ connections: Array<{ id: string; type: string; clientId: string }>; stats: { total: number; gateways: number; webapps: number } }> {
    const connections = [];
    for (const [id, conn] of this.connections) {
      connections.push({ id, type: conn.type, clientId: conn.clientId });
    }
    return { connections, stats: this.getConnectionStats() };
  }
}
