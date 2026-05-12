import { useEffect, useRef, useState, useCallback } from 'react';
import { mutate } from 'swr';

export function useEntityWebSocket(entityId: string | null) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pongTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reconnectAttempts = useRef(0);
  const MAX_RECONNECT_ATTEMPTS = 10;
  const entityIdRef = useRef(entityId);
  entityIdRef.current = entityId;

  const connect = useCallback(() => {
    const eid = entityIdRef.current;
    if (!eid) return;
    const token = sessionStorage.getItem('access_token');
    if (!token) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'AUTH', token }));
    };

    ws.onmessage = (event) => {
      // Clear pong timeout on any message received (connection is alive)
      clearTimeout(pongTimer.current);
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'AUTH_OK') {
          ws.send(JSON.stringify({ type: 'SUBSCRIBE', entityId: entityIdRef.current }));
        } else if (msg.type === 'SUBSCRIBED') {
          setConnected(true);
          reconnectAttempts.current = 0; // Reset on successful connection
        } else if (msg.type === 'DATA' && msg.entityId === entityIdRef.current) {
          const eid = entityIdRef.current!;
          // Revalidate all SWR keys related to this entity
          mutate(
            (key: unknown) => typeof key === 'string' && (
              key.includes(`/api/telemetry/${eid}`) ||
              key.includes(`/api/attributes/${eid}`) ||
              key.includes(`/api/connectivity/${eid}`) ||
              key.includes(`/api/checklist/${eid}`) ||
              key.includes('/api/alarms')
            ),
            undefined,
            { revalidate: true },
          );
        }
      } catch (parseErr) {
        // WebSocket message wasn't valid JSON or had an unexpected shape.
        // We can't recover, but log so silently-dropped events are visible
        // when debugging stale UI (CLAUDE.md "Never swallow exceptions").
        console.warn('[ws] failed to handle entity event:', parseErr);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      if (reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
        reconnectAttempts.current++;
        reconnectTimer.current = setTimeout(connect, delay);
      }
    };

    ws.onerror = () => ws.close();
  }, []);

  useEffect(() => {
    connect();
    const ping = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'PING' }));
        // Set a pong timeout — if no message received within 10s, connection is likely dead
        pongTimer.current = setTimeout(() => {
          wsRef.current?.close();
        }, 10000);
      }
    }, 25000);

    return () => {
      clearInterval(ping);
      clearTimeout(reconnectTimer.current);
      clearTimeout(pongTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
      setConnected(false);
    };
  }, [connect]);

  return { connected };
}
