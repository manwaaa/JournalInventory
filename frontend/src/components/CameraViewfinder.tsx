import React, { useState } from 'react';
import { Camera, RefreshCw, Eye, EyeOff, AlertCircle, Zap, ZapOff, ShieldCheck } from 'lucide-react';
import { AngleGuideOverlay } from './AngleGuideOverlay';
import { CameraDevice, CaptureStep } from '../types';

interface CameraViewfinderProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  isStreaming: boolean;
  cameraError: string | null;
  devices: CameraDevice[];
  selectedDeviceId: string;
  onSwitchCamera: (deviceId: string) => void;
  onCapture: () => void;
  currentStep: CaptureStep;
  resolution: { width: number; height: number };
  isCapturing: boolean;
  hasTorch?: boolean;
  isTorchOn?: boolean;
  onToggleTorch?: () => void;
}

export const CameraViewfinder: React.FC<CameraViewfinderProps> = ({
  videoRef,
  isStreaming,
  cameraError,
  devices,
  selectedDeviceId,
  onSwitchCamera,
  onCapture,
  currentStep,
  resolution,
  isCapturing,
  hasTorch = false,
  isTorchOn = false,
  onToggleTorch
}) => {
  const [showGuide, setShowGuide] = useState<boolean>(true);
  const [triggerFlash, setTriggerFlash] = useState<boolean>(false);

  const handleCaptureClick = () => {
    if (isCapturing || !isStreaming) return;
    setTriggerFlash(true);
    setTimeout(() => setTriggerFlash(false), 350);
    onCapture();
  };

  const isStepCaptureActive = currentStep === 'CAPTURE_SHOT_1' || currentStep === 'CAPTURE_SHOT_2';

  return (
    <div className="relative w-full rounded-2xl overflow-hidden glass-panel border border-slate-200 dark:border-slate-800 shadow-xl bg-slate-950">
      
      {/* Top Floating Controls Bar */}
      <div className="absolute top-3 left-3 right-3 z-20 flex items-center justify-between pointer-events-auto">
        
        {/* Camera Selector */}
        {devices.length > 1 ? (
          <select
            value={selectedDeviceId}
            onChange={(e) => onSwitchCamera(e.target.value)}
            className="bg-black/60 backdrop-blur-md text-white text-xs rounded-lg px-2.5 py-1.5 border border-white/20 outline-none focus:ring-2 focus:ring-brand-500 cursor-pointer"
          >
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId} className="bg-slate-900 text-white">
                {d.label}
              </option>
            ))}
          </select>
        ) : (
          <div className="bg-black/60 backdrop-blur-md text-white text-xs px-2.5 py-1.5 rounded-lg border border-white/20 flex items-center space-x-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Live Camera</span>
          </div>
        )}

        {/* Status & Guide toggle */}
        <div className="flex items-center space-x-2">
          {resolution.width > 0 && (
            <span className="bg-black/60 backdrop-blur-md text-slate-300 text-[11px] font-mono px-2 py-1 rounded-md border border-white/10 hidden sm:inline-block">
              {resolution.width}×{resolution.height}
            </span>
          )}

          {/* Flashlight / Torch Toggle (Mobile) */}
          {hasTorch && onToggleTorch && (
            <button
              onClick={onToggleTorch}
              title={isTorchOn ? "Turn off flashlight" : "Turn on flashlight"}
              className={`p-1.5 rounded-lg border backdrop-blur-md transition-colors ${
                isTorchOn 
                  ? 'bg-amber-400/90 text-slate-900 border-amber-300 shadow-md shadow-amber-400/30' 
                  : 'bg-black/60 text-white border-white/20 hover:bg-black/80'
              }`}
            >
              {isTorchOn ? <Zap className="w-4 h-4 fill-current" /> : <ZapOff className="w-4 h-4 text-slate-400" />}
            </button>
          )}

          {isStepCaptureActive && (
            <button
              onClick={() => setShowGuide(!showGuide)}
              title={showGuide ? "Hide Angle Guide" : "Show Angle Guide"}
              className="bg-black/60 backdrop-blur-md text-white p-1.5 rounded-lg border border-white/20 hover:bg-black/80 transition-colors"
            >
              {showGuide ? <Eye className="w-4 h-4 text-brand-400" /> : <EyeOff className="w-4 h-4 text-slate-400" />}
            </button>
          )}
        </div>
      </div>

      {/* Video Viewport */}
      <div className="relative aspect-[4/3] sm:aspect-[16/10] md:aspect-[16/9] w-full flex items-center justify-center bg-black overflow-hidden">
        
        {/* Video Element */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover transition-opacity duration-300 ${
            isStreaming ? 'opacity-100' : 'opacity-0'
          }`}
        />

        {/* Shutter flash overlay effect */}
        {triggerFlash && (
          <div className="absolute inset-0 bg-white z-30 animate-shutter-flash pointer-events-none" />
        )}

        {/* Overlay 3D Guide */}
        <AngleGuideOverlay currentStep={currentStep} visible={showGuide && isStepCaptureActive} />

        {/* Error / Loading State */}
        {!isStreaming && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center z-20">
            {cameraError ? (
              <div className="max-w-md bg-red-950/80 border border-red-500/50 rounded-2xl p-5 text-red-200">
                <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
                <h4 className="font-bold text-sm text-white mb-1">Camera Unavailable</h4>
                <p className="text-xs text-red-300 mb-3">{cameraError}</p>
                <button
                  onClick={() => onSwitchCamera(selectedDeviceId)}
                  className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Retry Camera</span>
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center text-slate-400">
                <RefreshCw className="w-8 h-8 animate-spin mb-2 text-brand-400" />
                <p className="text-xs font-medium">Initializing camera stream...</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Shutter Capture Bar */}
      {isStepCaptureActive && (
        <div className="p-3 bg-slate-900/90 border-t border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3 pl-1">
            <div className="text-xs text-slate-300">
              {currentStep === 'CAPTURE_SHOT_1' ? (
                <span>Take <b className="text-brand-400">Shot 1 of 2</b> (Front Cover & Spine)</span>
              ) : (
                <span>Take <b className="text-emerald-400">Shot 2 of 2</b> (Author & Title Page)</span>
              )}
            </div>
            <div className="inline-flex items-center space-x-1 text-[10px] text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 px-2 py-0.5 rounded-full w-fit">
              <ShieldCheck className="w-3 h-3 shrink-0" />
              <span>Direct to PC &bull; 0% Phone Storage</span>
            </div>
          </div>

          <button
            onClick={handleCaptureClick}
            disabled={!isStreaming || isCapturing}
            className="flex items-center justify-center space-x-2 px-6 py-2.5 rounded-xl font-bold text-sm text-white shadow-lg transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed bg-gradient-to-r from-brand-600 to-indigo-600 hover:from-brand-500 hover:to-indigo-500 shadow-brand-500/30 shrink-0"
          >
            <Camera className="w-4 h-4" />
            <span>{isCapturing ? 'Saving to PC...' : 'Capture Photo'}</span>
          </button>
        </div>
      )}

    </div>
  );
};
