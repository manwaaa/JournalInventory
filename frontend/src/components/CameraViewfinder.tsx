import React, { useState, useEffect } from 'react';
import { Camera, RefreshCw, AlertCircle, Zap, ZapOff, ArrowRight, Package, ArrowLeftRight, Check, CheckCircle2, RotateCcw } from 'lucide-react';
import { CameraDevice, CaptureStep, SHOT_DEFINITIONS, StationRole } from '../types';

interface CameraViewfinderProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  isStreaming: boolean;
  cameraError: string | null;
  devices: CameraDevice[];
  selectedDeviceId: string;
  boxCameraDeviceId?: string;
  bookCameraDeviceId?: string;
  autoSwitchCamera?: boolean;
  onSwitchCamera: (deviceId: string) => void;
  onQuickSwitchCamera?: () => void;
  onToggleAutoSwitch?: () => void;
  onCapture: () => void;
  onRetakeShot?: (shotNumber: number) => void;
  currentStep: CaptureStep;
  resolution: { width: number; height: number };
  isCapturing: boolean;
  stationRole?: StationRole;
  isBoxLevelDone?: boolean;
  hasBoxShots?: boolean;
  onNextJournal?: () => void;
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
  boxCameraDeviceId,
  bookCameraDeviceId,
  autoSwitchCamera = true,
  onSwitchCamera,
  onQuickSwitchCamera,
  onToggleAutoSwitch,
  onCapture,
  onRetakeShot,
  currentStep,
  resolution,
  isCapturing,
  stationRole = 'book_level',
  isBoxLevelDone = false,
  hasBoxShots = false,
  onNextJournal,
  hasTorch = false,
  isTorchOn = false,
  onToggleTorch
}) => {
  const [triggerFlash, setTriggerFlash] = useState<boolean>(false);

  // Keyboard shortcut listener for 'C' to quickly swap cameras
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if ((e.key === 'c' || e.key === 'C') && devices.length > 1 && onQuickSwitchCamera) {
        e.preventDefault();
        onQuickSwitchCamera();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [devices.length, onQuickSwitchCamera]);

  const handleCaptureClick = () => {
    if (isCapturing || !isStreaming) return;
    setTriggerFlash(true);
    setTimeout(() => setTriggerFlash(false), 350);
    onCapture();
  };

  const isStepCaptureActive = currentStep.startsWith('CAPTURE_SHOT_');
  const shotNum = isStepCaptureActive ? parseInt(currentStep.replace('CAPTURE_SHOT_', ''), 10) : 1;
  const currentDef = SHOT_DEFINITIONS.find(d => d.shotNumber === shotNum) || SHOT_DEFINITIONS[0];

  const isBoxStationFinished = stationRole === 'box_level' && isBoxLevelDone;

  const getCameraLabel = (device: CameraDevice) => {
    let roleTag = '';
    if (device.deviceId === boxCameraDeviceId && device.deviceId === bookCameraDeviceId) {
      roleTag = ' (All Shots)';
    } else if (device.deviceId === boxCameraDeviceId) {
      roleTag = ' 📦 [Box Cam 1-2]';
    } else if (device.deviceId === bookCameraDeviceId) {
      roleTag = ' 📖 [Book Cam 3-7]';
    }
    return `${device.label}${roleTag}`;
  };

  return (
    <div className="relative w-full rounded-2xl overflow-hidden white-card shadow-lg bg-slate-950">
      
      {/* Top Floating Controls Bar */}
      <div className="absolute top-3 left-3 right-3 z-20 flex flex-wrap items-center justify-between gap-2 pointer-events-auto">
        
        {/* Left: Camera Selector & Dual Camera Quick Switch */}
        <div className="flex items-center space-x-1.5 sm:space-x-2">
          {devices.length > 1 ? (
            <>
              <select
                value={selectedDeviceId}
                onChange={(e) => onSwitchCamera(e.target.value)}
                className="bg-black/80 backdrop-blur-md text-white text-xs rounded-xl px-3 py-1.5 border border-white/20 outline-none focus:ring-2 focus:ring-brand-500 cursor-pointer max-w-[180px] sm:max-w-[240px] truncate"
                title="Select Active Camera"
              >
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId} className="bg-slate-900 text-white">
                    {getCameraLabel(d)}
                  </option>
                ))}
              </select>

              {/* 1-Click Quick Camera Swap Button */}
              {onQuickSwitchCamera && (
                <button
                  type="button"
                  onClick={onQuickSwitchCamera}
                  title="Swap between Camera 1 & Camera 2 (or press 'C' key)"
                  className="bg-brand-600/90 hover:bg-brand-500 text-white text-[11px] font-bold px-2.5 py-1.5 rounded-xl border border-brand-400/40 shadow-sm backdrop-blur-md flex items-center space-x-1 transition-all active:scale-95 cursor-pointer"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Swap (C)</span>
                </button>
              )}

              {/* Auto-Switch Toggle Badge */}
              {onToggleAutoSwitch && (
                <button
                  type="button"
                  onClick={onToggleAutoSwitch}
                  title={autoSwitchCamera ? "Auto-switching is active (Box Cam for 1-2, Book Cam for 3-7). Click to toggle." : "Auto-switching is OFF. Click to turn ON."}
                  className={`text-[10px] font-bold px-2.5 py-1.5 rounded-xl border backdrop-blur-md transition-all cursor-pointer ${
                    autoSwitchCamera
                      ? 'bg-emerald-600/80 hover:bg-emerald-500 text-white border-emerald-400/40'
                      : 'bg-black/70 hover:bg-black/90 text-slate-400 border-white/10'
                  }`}
                >
                  <span className="hidden sm:inline">Auto-Cam: </span>
                  <span>{autoSwitchCamera ? 'ON' : 'OFF'}</span>
                </button>
              )}
            </>
          ) : (
            <div className="bg-black/70 backdrop-blur-md text-white text-xs px-3 py-1.5 rounded-xl border border-white/20 flex items-center space-x-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span className="font-semibold">Live Camera</span>
            </div>
          )}
        </div>

        {/* Right: Station Role Badge & Guide Toggle */}
        <div className="flex items-center space-x-2">
          {stationRole === 'box_level' && (
            <span className="bg-blue-600/90 text-white text-[11px] font-bold px-2.5 py-1 rounded-lg shadow-sm border border-blue-400/40">
              📦 PC 1 (Box Only 1-2)
            </span>
          )}
          {stationRole === 'book_level' && (
            <span className="bg-indigo-600/90 text-white text-[11px] font-bold px-2.5 py-1 rounded-lg shadow-sm border border-indigo-400/40">
              📖 PC 2 (Book Only 3-7)
            </span>
          )}
          {stationRole === 'all_in_one' && (
            <span className="bg-emerald-600/90 text-white text-[11px] font-bold px-2.5 py-1 rounded-lg shadow-sm border border-emerald-400/40">
              ⚡ Full Station (1-7)
            </span>
          )}

          {resolution.width > 0 && (
            <span className="bg-black/70 backdrop-blur-md text-slate-200 text-[11px] font-mono px-2.5 py-1 rounded-lg border border-white/10 hidden sm:inline-block">
              {resolution.width}×{resolution.height}
            </span>
          )}

          {/* Flashlight / Torch Toggle (Mobile) */}
          {hasTorch && onToggleTorch && (
            <button
              onClick={onToggleTorch}
              title={isTorchOn ? "Turn off flashlight" : "Turn on flashlight"}
              className={`p-1.5 rounded-xl border backdrop-blur-md transition-colors ${
                isTorchOn 
                  ? 'bg-amber-400/90 text-slate-900 border-amber-300 shadow-md shadow-amber-400/30' 
                  : 'bg-black/70 text-white border-white/20 hover:bg-black/90'
              }`}
            >
              {isTorchOn ? <Zap className="w-4 h-4 fill-current" /> : <ZapOff className="w-4 h-4 text-slate-400" />}
            </button>
          )}
        </div>
      </div>

      {/* Video Viewport */}
      <div className="relative aspect-[4/3] sm:aspect-[16/10] md:aspect-[16/9] w-full flex items-center justify-center bg-black overflow-hidden">
        
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover transition-opacity duration-300 ${
            isStreaming ? 'opacity-100' : 'opacity-0'
          }`}
        />

        {triggerFlash && (
          <div className="absolute inset-0 bg-white z-30 animate-shutter-flash pointer-events-none" />
        )}

        {/* Overlay for PC 1 when Box Level (1 & 2) is finished */}
        {isBoxStationFinished && (
          <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-sm z-25 flex flex-col items-center justify-center p-6 text-center animate-fade-in">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 text-white flex items-center justify-center shadow-xl shadow-blue-500/30 mb-3 animate-bounce">
              <Package className="w-7 h-7" />
            </div>
            <h3 className="text-lg font-extrabold text-white mb-1">
              Box Level Shots Completed! (2/2)
            </h3>
            <p className="text-xs text-blue-200 max-w-sm mb-4 leading-relaxed">
              Shot 1 (Box) and Shot 2 (Unbox) are safely saved. PC 2 can now continue with Shots 3 to 7 (Book Level).
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
              {onRetakeShot && (
                <>
                  <button
                    onClick={() => onRetakeShot(1)}
                    className="flex items-center space-x-1.5 px-4 py-2.5 rounded-xl font-semibold text-xs text-white bg-white/10 hover:bg-white/20 border border-white/20 transition-all active:scale-95 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Retake 1. Box</span>
                  </button>
                  <button
                    onClick={() => onRetakeShot(2)}
                    className="flex items-center space-x-1.5 px-4 py-2.5 rounded-xl font-semibold text-xs text-white bg-white/10 hover:bg-white/20 border border-white/20 transition-all active:scale-95 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Retake 2. Unbox</span>
                  </button>
                </>
              )}
              {onNextJournal && (
                <button
                  onClick={onNextJournal}
                  className="flex items-center space-x-2 px-6 py-2.5 rounded-xl font-bold text-xs text-white btn-primary-gradient shadow-lg shadow-brand-500/30 hover:scale-105 active:scale-95 transition-all cursor-pointer"
                >
                  <span>Proceed to Next Box (Enter ↵)</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Overlay when All Verification Shots are Completed */}
        {currentStep === 'COMPLETE' && !isBoxStationFinished && (
          <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-sm z-25 flex flex-col items-center justify-center p-6 text-center animate-fade-in">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 text-white flex items-center justify-center shadow-xl shadow-emerald-500/30 mb-3 animate-bounce">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-extrabold text-white mb-1">
              Verification Photos Completed!
            </h3>
            <p className="text-xs text-emerald-200 max-w-sm mb-4 leading-relaxed">
              All required photos are saved. Press <b className="text-white">Enter ↵</b> on your keyboard or click below to verify the next book.
            </p>
            {onNextJournal && (
              <button
                onClick={onNextJournal}
                className="flex items-center space-x-2 px-7 py-3 rounded-xl font-bold text-sm text-white btn-primary-gradient shadow-xl shadow-brand-500/30 hover:scale-105 active:scale-95 transition-all cursor-pointer ring-2 ring-white/30"
              >
                <span>Proceed to Next Book (Enter ↵)</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        {/* Overlay for PC 2 while waiting for PC 1 to capture Box & Unbox */}
        {stationRole === 'book_level' && !hasBoxShots && (currentStep === 'CAPTURE_SHOT_1' || currentStep === 'CAPTURE_SHOT_2') && (
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-xs z-25 flex flex-col items-center justify-center p-6 text-center animate-fade-in">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-600 to-blue-500 text-white flex items-center justify-center shadow-xl shadow-indigo-500/30 mb-3 animate-pulse">
              <Package className="w-7 h-7" />
            </div>
            <h3 className="text-lg font-extrabold text-white mb-1">
              Waiting for PC 1 (Box Level)
            </h3>
            <p className="text-xs text-indigo-200 max-w-sm mb-4 leading-relaxed">
              PC 1 is capturing <b>Shot 1 (Box)</b> & <b>Shot 2 (Unbox)</b>. As soon as PC 1 snaps them, this screen will automatically activate for <b>Shot 3 (Front Cover)</b>!
            </p>
            <div className="flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-indigo-950/80 border border-indigo-700 text-indigo-300 text-[11px] font-semibold shadow-inner">
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400" />
              <span>Listening for live Box sync...</span>
            </div>
          </div>
        )}

        {!isStreaming && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center z-20">
            {cameraError ? (
              <div className="max-w-md bg-red-950/90 border border-red-500/50 rounded-2xl p-5 text-red-200 shadow-2xl">
                <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
                <h4 className="font-bold text-sm text-white mb-1">Camera Unavailable</h4>
                <p className="text-xs text-red-300 mb-3">{cameraError}</p>
                <button
                  onClick={() => onSwitchCamera(selectedDeviceId)}
                  className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold"
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
      {isStepCaptureActive && !isBoxStationFinished && !(stationRole === 'book_level' && !hasBoxShots && (currentStep === 'CAPTURE_SHOT_1' || currentStep === 'CAPTURE_SHOT_2')) && (
        <div className="p-3.5 bg-slate-900 border-t border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3 pl-1">
            <div className="text-xs text-slate-200">
              <span>Capturing <b className="text-brand-400 font-bold">Shot {shotNum} of 7</b>: {currentDef.label}</span>
              <span className={`ml-2 text-[10px] font-bold px-2 py-0.5 rounded border ${
                currentDef.scope === 'box_level'
                  ? 'bg-blue-900/60 text-blue-300 border-blue-800'
                  : 'bg-indigo-900/60 text-indigo-300 border-indigo-800'
              }`}>
                {currentDef.scope === 'box_level' ? '📦 Box Level' : '📖 Book Level'}
              </span>
              {stationRole !== 'box_level' && hasBoxShots && shotNum === 3 && (
                <span className="ml-2 text-[10px] font-bold text-emerald-400">
                  ✓ Box Shots 1 & 2 Loaded
                </span>
              )}
            </div>
          </div>

          <button
            onClick={handleCaptureClick}
            disabled={!isStreaming || isCapturing}
            className="flex items-center justify-center space-x-2 px-7 py-2.5 rounded-xl font-bold text-sm text-white transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed btn-primary-gradient shrink-0 cursor-pointer"
          >
            <Camera className="w-4 h-4" />
            <span>{isCapturing ? 'Saving to PC...' : `Take Shot ${shotNum}`}</span>
          </button>
        </div>
      )}

    </div>
  );
};
