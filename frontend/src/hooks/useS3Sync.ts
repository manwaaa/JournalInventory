import { useState, useEffect, useCallback, useRef } from 'react';

import { S3SyncStatus, S3SyncProgress } from '../types';
export type { S3SyncStatus, S3SyncProgress };

export function useS3Sync(pollIntervalMs = 5000) {
  const [status, setStatus] = useState<S3SyncStatus>({
    s3Configured: false,
    queueSize: 0,
    progress: {
      isSyncing: false,
      totalPending: 0,
      completedCount: 0,
      failedCount: 0,
      currentIsbn: null,
      lastSyncAt: null,
      lastError: null,
    },
    isLoading: true,
  });

  const [isManualSyncing, setIsManualSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
  const pollTimerRef = useRef<any>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/s3/sync-status');
      if (res.ok) {
        const data = await res.json();
        setStatus({
          s3Configured: Boolean(data.s3Configured),
          queueSize: data.queueSize || 0,
          progress: data.progress || {
            isSyncing: false,
            totalPending: 0,
            completedCount: 0,
            failedCount: 0,
            currentIsbn: null,
            lastSyncAt: null,
            lastError: null,
          },
          isLoading: false,
        });
      }
    } catch (err) {
      // Keep previous status or mark not loading
      setStatus((prev: S3SyncStatus) => ({ ...prev, isLoading: false }));
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    pollTimerRef.current = setInterval(fetchStatus, pollIntervalMs);

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [fetchStatus, pollIntervalMs]);

  const triggerSyncAll = useCallback(async (force = false) => {
    setIsManualSyncing(true);
    setSyncFeedback(null);
    try {
      const res = await fetch('/api/s3/sync-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      const data = await res.json();
      if (data.success) {
        setSyncFeedback(data.queued > 0 ? `Queued ${data.queued} journals for S3 upload` : 'All journals already synced to S3');
      } else {
        setSyncFeedback(data.error || 'Failed to start S3 sync');
      }
      // Re-fetch status immediately
      await fetchStatus();
    } catch (err: any) {
      setSyncFeedback(err.message || 'S3 sync request failed');
    } finally {
      setIsManualSyncing(false);
      setTimeout(() => setSyncFeedback(null), 4000);
    }
  }, [fetchStatus]);

  return {
    status,
    isManualSyncing,
    syncFeedback,
    refreshStatus: fetchStatus,
    triggerSyncAll,
  };
}
