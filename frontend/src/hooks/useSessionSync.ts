import { useEffect, useRef, useCallback } from 'react';
import { SessionEvent } from '../types';

interface UseSessionSyncOptions {
  onSessionSync?: (event: SessionEvent) => void;
  enabled?: boolean;
}

export function useSessionSync({ onSessionSync, enabled = true }: UseSessionSyncOptions = {}) {
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let es: EventSource | null = null;
    let reconnectTimeout: any = null;

    const connect = () => {
      try {
        es = new EventSource('/api/session/stream');
        eventSourceRef.current = es;

        es.onmessage = (event) => {
          try {
            if (!event.data || event.data.startsWith(':')) return; // ignore heartbeat
            const data: SessionEvent = JSON.parse(event.data);
            if (onSessionSync) {
              onSessionSync(data);
            }
          } catch (err) {
            console.warn('Failed to parse SSE session message:', err);
          }
        };

        es.onerror = () => {
          if (es) {
            es.close();
          }
          // Attempt auto-reconnect after 3s
          reconnectTimeout = setTimeout(connect, 3000);
        };
      } catch (err) {
        console.warn('SSE connection error:', err);
        reconnectTimeout = setTimeout(connect, 4000);
      }
    };

    connect();

    return () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (es) es.close();
    };
  }, [enabled, onSessionSync]);

  const resetRemoteSession = useCallback(async (opts?: { clearBoxContext?: boolean; lotNumber?: string; boxNumber?: string }) => {
    try {
      await fetch('/api/session/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts || {})
      });
    } catch (err) {
      console.error('Failed to reset remote session:', err);
    }
  }, []);

  return {
    resetRemoteSession
  };
}

