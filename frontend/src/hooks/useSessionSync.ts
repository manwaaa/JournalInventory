import { useEffect, useRef, useState, useCallback } from 'react';
import { SessionEvent } from '../types';

interface UseSessionSyncOptions {
  onSessionSync?: (event: SessionEvent) => void;
  enabled?: boolean;
}

export function useSessionSync({ onSessionSync, enabled = true }: UseSessionSyncOptions = {}) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [lastEvent, setLastEvent] = useState<SessionEvent | null>(null);
  const [lastHeartbeat, setLastHeartbeat] = useState<Date | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let es: EventSource | null = null;
    let reconnectTimeout: any = null;

    const connect = () => {
      try {
        es = new EventSource('/api/session/stream');
        eventSourceRef.current = es;

        es.onopen = () => {
          setIsConnected(true);
          setConnectionError(null);
          setLastHeartbeat(new Date());
        };

        es.onmessage = (event) => {
          try {
            setLastHeartbeat(new Date());
            setIsConnected(true);
            setConnectionError(null);

            if (!event.data || event.data.startsWith(':')) return; // ignore heartbeat comments
            
            const data: SessionEvent = JSON.parse(event.data);
            setLastEvent(data);

            if (onSessionSync) {
              onSessionSync(data);
            }
          } catch (err) {
            console.warn('Failed to parse SSE session message:', err);
          }
        };

        es.onerror = () => {
          setIsConnected(false);
          setConnectionError('Reconnecting to LAN peer session...');
          if (es) {
            es.close();
          }
          // Attempt auto-reconnect after 3s
          reconnectTimeout = setTimeout(connect, 3000);
        };
      } catch (err: any) {
        setIsConnected(false);
        setConnectionError(err.message || 'SSE connection error');
        reconnectTimeout = setTimeout(connect, 4000);
      }
    };

    connect();

    return () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (es) es.close();
      setIsConnected(false);
    };
  }, [enabled, onSessionSync]);

  const resetRemoteSession = useCallback(async (opts?: { clearBoxContext?: boolean; lotNumber?: string; boxNumber?: string }) => {
    try {
      const res = await fetch('/api/session/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts || {})
      });
      return await res.json();
    } catch (err) {
      console.error('Failed to reset remote session:', err);
    }
  }, []);

  return {
    isConnected,
    lastEvent,
    lastHeartbeat,
    connectionError,
    resetRemoteSession
  };
}
