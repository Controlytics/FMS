import { useEffect, useRef, useState, useCallback } from 'react';
import { mutate } from 'swr';

export function useEntityWebSocket(entityId: string | null) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'AUTH_OK') {
          ws.send(JSON.stringify({ type: 'SUBSCRIBE', entityId: entityIdRef.current }));
        } else if (msg.type === 'SUBSCRIBED') {
          setConnected(true);
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
      } catch { /* ignore parse errors */ }
    };

    ws.onclose = () => {
      setConnected(false);
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => ws.close();
  }, []);

  useEffect(() => {
    connect();
    const ping = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'PING' }));
      }
    }, 25000);

    return () => {
      clearInterval(ping);
      clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
      setConnected(false);
    };
  }, [connect]);

  return { connected };
}
