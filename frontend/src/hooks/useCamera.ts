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
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>(() => {
    return localStorage.getItem('journal_active_camera_id') || '';
  });
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [resolution, setResolution] = useState<{ width: number; height: number }>({ width: 1920, height: 1080 });

  // Dual Camera Configuration
  const [boxCameraDeviceId, setBoxCameraDeviceIdState] = useState<string>(() => {
    return localStorage.getItem('journal_box_camera_id') || '';
  });
  const [bookCameraDeviceId, setBookCameraDeviceIdState] = useState<string>(() => {
    return localStorage.getItem('journal_book_camera_id') || '';
  });
  const [autoSwitchCamera, setAutoSwitchCameraState] = useState<boolean>(() => {
    const saved = localStorage.getItem('journal_auto_switch_camera');
    return saved === null ? true : saved === 'true';
  });

  // Camera Orientation & Flipping
  const [rotation, setRotationState] = useState<number>(() => {
    const saved = localStorage.getItem('journal_camera_rotation');
    return saved ? (parseInt(saved, 10) || 0) : 0;
  });
  const [flipHorizontal, setFlipHorizontalState] = useState<boolean>(() => {
    return localStorage.getItem('journal_camera_flip_h') === 'true';
  });
  const [flipVertical, setFlipVerticalState] = useState<boolean>(() => {
    return localStorage.getItem('journal_camera_flip_v') === 'true';
  });

  const setRotation = useCallback((deg: number) => {
    const normalized = ((deg % 360) + 360) % 360;
    setRotationState(normalized);
    localStorage.setItem('journal_camera_rotation', String(normalized));
  }, []);

  const rotateCamera = useCallback(() => {
    setRotationState((prev) => {
      const next = (prev + 90) % 360;
      localStorage.setItem('journal_camera_rotation', String(next));
      return next;
    });
  }, []);

  const setFlipHorizontal = useCallback((flipped: boolean) => {
    setFlipHorizontalState(flipped);
    localStorage.setItem('journal_camera_flip_h', String(flipped));
  }, []);

  const toggleFlipHorizontal = useCallback(() => {
    setFlipHorizontalState((prev) => {
      const next = !prev;
      localStorage.setItem('journal_camera_flip_h', String(next));
      return next;
    });
  }, []);

  const setFlipVertical = useCallback((flipped: boolean) => {
    setFlipVerticalState(flipped);
    localStorage.setItem('journal_camera_flip_v', String(flipped));
  }, []);

  const toggleFlipVertical = useCallback(() => {
    setFlipVerticalState((prev) => {
      const next = !prev;
      localStorage.setItem('journal_camera_flip_v', String(next));
      return next;
    });
  }, []);

  const resetOrientation = useCallback(() => {
    setRotation(0);
    setFlipHorizontal(false);
    setFlipVertical(false);
  }, [setRotation, setFlipHorizontal, setFlipVertical]);

  const [hasTorch, setHasTorch] = useState<boolean>(false);
  const [isTorchOn, setIsTorchOn] = useState<boolean>(false);

  const setBoxCameraDeviceId = useCallback((id: string) => {
    setBoxCameraDeviceIdState(id);
    localStorage.setItem('journal_box_camera_id', id);
  }, []);

  const setBookCameraDeviceId = useCallback((id: string) => {
    setBookCameraDeviceIdState(id);
    localStorage.setItem('journal_book_camera_id', id);
  }, []);

  const setAutoSwitchCamera = useCallback((enabled: boolean) => {
    setAutoSwitchCameraState(enabled);
    localStorage.setItem('journal_auto_switch_camera', String(enabled));
  }, []);

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

      if (videoDevs.length > 0) {
        // Auto-assign default box camera (Cam 1) and book camera (Cam 2) if not already set
        if (!boxCameraDeviceId || !videoDevs.some(d => d.deviceId === boxCameraDeviceId)) {
          setBoxCameraDeviceId(videoDevs[0].deviceId);
        }
        if (videoDevs.length > 1) {
          if (!bookCameraDeviceId || !videoDevs.some(d => d.deviceId === bookCameraDeviceId)) {
            setBookCameraDeviceId(videoDevs[1].deviceId);
          }
        } else if (!bookCameraDeviceId) {
          setBookCameraDeviceId(videoDevs[0].deviceId);
        }

        if (!selectedDeviceId || !videoDevs.some(d => d.deviceId === selectedDeviceId)) {
          setSelectedDeviceId(videoDevs[0].deviceId);
          localStorage.setItem('journal_active_camera_id', videoDevs[0].deviceId);
        }
      }
    } catch (err: any) {
      console.error('Error enumerating cameras:', err);
    }
  }, [boxCameraDeviceId, bookCameraDeviceId, selectedDeviceId, setBoxCameraDeviceId, setBookCameraDeviceId]);

  // Start camera stream
  const startCamera = useCallback(async (deviceId?: string) => {
    const requestId = ++activeRequestId.current;
    setIsStreaming(false);
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
          // Give video a brief moment to decode first live frame
          if (video.videoWidth > 0) {
            setIsStreaming(true);
            setResolution({ width: video.videoWidth, height: video.videoHeight });
          } else {
            video.onloadedmetadata = () => {
              if (requestId === activeRequestId.current) {
                setIsStreaming(true);
                setResolution({ width: video.videoWidth, height: video.videoHeight });
              }
            };
          }
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

  // Switch camera
  const switchCamera = useCallback((newDeviceId: string) => {
    if (!newDeviceId) return;
    setSelectedDeviceId(newDeviceId);
    localStorage.setItem('journal_active_camera_id', newDeviceId);
    startCamera(newDeviceId);
  }, [startCamera]);

  // Quick switch toggle between Box Camera (Cam 1) and Book Camera (Cam 2)
  const quickSwitchCamera = useCallback(() => {
    if (devices.length < 2) return;
    
    // If currently on box camera, switch to book camera; otherwise switch to box camera
    if (selectedDeviceId === boxCameraDeviceId && bookCameraDeviceId) {
      switchCamera(bookCameraDeviceId);
    } else if (boxCameraDeviceId) {
      switchCamera(boxCameraDeviceId);
    } else {
      const otherDevice = devices.find(d => d.deviceId !== selectedDeviceId);
      if (otherDevice) {
        switchCamera(otherDevice.deviceId);
      }
    }
  }, [devices, selectedDeviceId, boxCameraDeviceId, bookCameraDeviceId, switchCamera]);

  // Auto-switch camera based on current capture step
  const autoSwitchForStep = useCallback((step: string) => {
    if (!autoSwitchCamera || devices.length < 2) return;

    if (step === 'CAPTURE_SHOT_1' || step === 'CAPTURE_SHOT_2') {
      const targetId = boxCameraDeviceId || devices[0]?.deviceId;
      if (targetId && targetId !== selectedDeviceId) {
        switchCamera(targetId);
      }
    } else if (step.startsWith('CAPTURE_SHOT_')) {
      const targetId = bookCameraDeviceId || devices[1]?.deviceId || devices[0]?.deviceId;
      if (targetId && targetId !== selectedDeviceId) {
        switchCamera(targetId);
      }
    }
  }, [autoSwitchCamera, devices, boxCameraDeviceId, bookCameraDeviceId, selectedDeviceId, switchCamera]);

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
    const video = videoRef.current;

    // Check video readiness & genuine dimensions
    if (
      video.readyState < 2 || 
      !video.videoWidth || 
      !video.videoHeight || 
      video.videoWidth < 20 || 
      video.videoHeight < 20 ||
      video.paused ||
      video.ended
    ) {
      console.warn('[useCamera] Camera frame not ready yet (readyState: ' + video.readyState + ', dimensions: ' + video.videoWidth + 'x' + video.videoHeight + ')');
      return null;
    }

    const opts: CaptureOptions = typeof options === 'number' 
      ? { quality: options } 
      : (options || { quality: 0.95 });

    const quality = opts.quality ?? 0.95;
    const canvas = document.createElement('canvas');

    // If rotated 90 or 270 degrees, swap canvas dimensions
    const isSwapped = rotation === 90 || rotation === 270;
    canvas.width = isSwapped ? video.videoHeight : video.videoWidth;
    canvas.height = isSwapped ? video.videoWidth : video.videoHeight;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    // Apply rotation & flip transformations centered on canvas
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(flipHorizontal ? -1 : 1, flipVertical ? -1 : 1);
    ctx.drawImage(video, -video.videoWidth / 2, -video.videoHeight / 2, video.videoWidth, video.videoHeight);
    ctx.restore();

    // Verify canvas is not completely black/empty
    try {
      const sample = ctx.getImageData(0, 0, Math.min(canvas.width, 80), Math.min(canvas.height, 80)).data;
      let nonZero = 0;
      for (let i = 0; i < sample.length; i += 4) {
        if (sample[i] > 10 || sample[i + 1] > 10 || sample[i + 2] > 10) {
          nonZero++;
        }
      }
      if (nonZero === 0 && video.readyState < 4) {
        console.warn('[useCamera] Video frame is completely blank/black, skipping capture until live frame renders.');
        return null;
      }
    } catch (e) {}

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
  }, [isStreaming, rotation, flipHorizontal, flipVertical]);

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
    boxCameraDeviceId,
    bookCameraDeviceId,
    autoSwitchCamera,
    isStreaming,
    cameraError,
    resolution,
    rotation,
    flipHorizontal,
    flipVertical,
    rotateCamera,
    toggleFlipHorizontal,
    toggleFlipVertical,
    setRotation,
    setFlipHorizontal,
    setFlipVertical,
    resetOrientation,
    hasTorch,
    isTorchOn,
    setBoxCameraDeviceId,
    setBookCameraDeviceId,
    setAutoSwitchCamera,
    quickSwitchCamera,
    autoSwitchForStep,
    toggleTorch,
    startCamera,
    switchCamera,
    captureSnapshot
  };
}
