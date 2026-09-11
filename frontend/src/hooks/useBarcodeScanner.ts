import { useEffect, useRef } from 'react';

interface UseBarcodeScannerOptions {
  onScan: (barcode: string) => void;
  enabled?: boolean;
  minChars?: number;
  maxIntervalMs?: number;
}

export function useBarcodeScanner({
  onScan,
  enabled = true,
  minChars = 3,
  maxIntervalMs = 50
}: UseBarcodeScannerOptions) {
  const bufferRef = useRef<string>('');
  const lastTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an active input or textarea
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        // If Enter is pressed inside an input, we let the form handle it
        return;
      }

      const currentTime = Date.now();
      const diff = currentTime - lastTimeRef.current;
      lastTimeRef.current = currentTime;

      // Enter key submits the barcode buffer
      if (e.key === 'Enter') {
        if (bufferRef.current.length >= minChars) {
          const scannedCode = bufferRef.current.trim();
          bufferRef.current = '';
          onScan(scannedCode);
        }
        bufferRef.current = '';
        return;
      }

      // If typed characters are too far apart (> 250ms), reset buffer
      if (diff > 250) {
        bufferRef.current = '';
      }

      // Ignore modifiers and functional keys
      if (e.key.length === 1) {
        bufferRef.current += e.key;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, minChars, maxIntervalMs, onScan]);
}
