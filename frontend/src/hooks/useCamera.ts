import { useState, useEffect, useRef, useCallback } from 'react';
import { CameraDevice } from '../types';
import { calculateSharpnessScore, isImageBlurry } from '../utils/imageQuality';
import { drawAuditWatermark, WatermarkOptions } from '../utils/watermark';

export interface CaptureOptions {
  quality?: number;
  watermark?: WatermarkOptions | null;
  checkBlur?: boolean;
}

export interface CaptureResult {
  base64Data: string;
  sharpnessScore: number;
  isBlurry: boolean;
}

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const activeRequestId = useRef<number>(0);

  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [resolution, setResolution] = useState<{ width: number; height: number }>({ width: 1920, height: 1080 });

  const [hasTorch, setHasTorch] = useState<boolean>(false);
  const [isTorchOn, setIsTorchOn] = useState<boolean>(false);

  // Load available video devices
  const updateDeviceList = useCallback(async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        return;
      }
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const videoDevs = allDevices
        .filter((d) => d.kind === 'videoinput')
        .map((d, index) => ({
          deviceId: d.deviceId,
          label: d.label || `Camera ${index + 1}`
        }));
      setDevices(videoDevs);
      if (videoDevs.length > 0 && !selectedDeviceId) {
        setSelectedDeviceId(videoDevs[0].deviceId);
      }
    } catch (err: any) {
      console.error('Error enumerating cameras:', err);
    }
  }, [selectedDeviceId]);

  // Start camera stream
  const startCamera = useCallback(async (deviceId?: string) => {
    const requestId = ++activeRequestId.current;
    setCameraError(null);
    setIsTorchOn(false);

    // Stop existing stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    try {
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          facingMode: { ideal: 'environment' }
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      // If a newer startCamera request was made while awaiting getUserMedia, discard this stream
      if (requestId !== activeRequestId.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;

      if (videoRef.current) {
        const video = videoRef.current;
        video.srcObject = stream;

        try {
          await video.play();
          setIsStreaming(true);
        } catch (playErr: any) {
          if (playErr.name === 'AbortError' || playErr.message?.includes('interrupted')) {
            return;
          }
          console.warn('Video play warning:', playErr);
        }

        const videoTrack = stream.getVideoTracks()[0];
        const settings = videoTrack?.getSettings();
        if (settings?.width && settings?.height) {
          setResolution({ width: settings.width, height: settings.height });
        }

        // Check torch / flashlight support
        try {
          const capabilities = (videoTrack as any)?.getCapabilities?.();
          setHasTorch(Boolean(capabilities && 'torch' in capabilities));
        } catch (e) {
          setHasTorch(false);
        }
      }

      await updateDeviceList();
    } catch (err: any) {
      if (requestId !== activeRequestId.current) return;
      if (err.name === 'AbortError' || err.message?.includes('interrupted')) return;

      console.error('Error starting camera stream:', err);
      setIsStreaming(false);
      if (err.name === 'NotAllowedError') {
        setCameraError('Camera access was denied. Please allow camera permissions in your browser.');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setCameraError('No camera found. Please plug in a USB webcam or document camera.');
      } else {
        setCameraError(`Camera error: ${err.message || 'Unable to open video stream'}`);
      }
    }
  }, [updateDeviceList]);

  // Toggle flashlight / torch on smartphones
  const toggleTorch = useCallback(async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (track) {
      try {
        const nextState = !isTorchOn;
        await (track as any).applyConstraints({
          advanced: [{ torch: nextState }]
        });
        setIsTorchOn(nextState);
      } catch (err) {
        console.warn('Torch toggle error:', err);
      }
    }
  }, [isTorchOn]);

  // Capture snapshot to Base64 JPEG with optional watermark and blur evaluation
  const captureSnapshot = useCallback((options?: number | CaptureOptions): CaptureResult | null => {
    if (!videoRef.current || !isStreaming) return null;

    const opts: CaptureOptions = typeof options === 'number' 
      ? { quality: options } 
      : (options || { quality: 0.95 });

    const quality = opts.quality ?? 0.95;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1920;
    canvas.height = video.videoHeight || 1080;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Draw full resolution video frame to canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Calculate sharpness score before watermark (to measure genuine frame sharpness)
    const sharpnessScore = calculateSharpnessScore(canvas);
    const blurry = isImageBlurry(sharpnessScore);

    // Apply audit watermark overlay if provided
    if (opts.watermark) {
      drawAuditWatermark(canvas, opts.watermark);
    }

    // Convert to high-quality JPEG
    const base64Data = canvas.toDataURL('image/jpeg', quality);

    return {
      base64Data,
      sharpnessScore,
      isBlurry: blurry
    };
  }, [isStreaming]);

  // Switch camera
  const switchCamera = useCallback((newDeviceId: string) => {
    setSelectedDeviceId(newDeviceId);
    startCamera(newDeviceId);
  }, [startCamera]);

  useEffect(() => {
    startCamera(selectedDeviceId);

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  return {
    videoRef,
    devices,
    selectedDeviceId,
    isStreaming,
    cameraError,
    resolution,
    hasTorch,
    isTorchOn,
    toggleTorch,
    startCamera,
    switchCamera,
    captureSnapshot
  };
}
