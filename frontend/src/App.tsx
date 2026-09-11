import React, { useState, useEffect, useRef, useCallback } from 'react';
import confetti from 'canvas-confetti';
import { 
  Barcode, 
  Camera, 
  ArrowRight, 
  RotateCcw, 
  Sparkles, 
  ShieldCheck, 
  CheckCircle2, 
  AlertCircle,
  Keyboard
} from 'lucide-react';

import { Navbar } from './components/Navbar';
import { StepProgressBar } from './components/StepProgressBar';
import { CameraViewfinder } from './components/CameraViewfinder';
import { ReviewCard } from './components/ReviewCard';
import { RecentCapturesModal } from './components/RecentCapturesModal';
import { SettingsModal } from './components/SettingsModal';

import { useCamera } from './hooks/useCamera';
import { useBarcodeScanner } from './hooks/useBarcodeScanner';
import { useSoundEffects } from './hooks/useSoundEffects';

import { CaptureStep, ShotInfo, JournalMetadata, SystemStatus } from './types';

export function App() {
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [isbnInput, setIsbnInput] = useState<string>('');
  const [activeIsbn, setActiveIsbn] = useState<string>('');
  const [currentStep, setCurrentStep] = useState<CaptureStep>('SCAN_ISBN');

  const [shot1, setShot1] = useState<ShotInfo | null>(null);
  const [shot2, setShot2] = useState<ShotInfo | null>(null);
  const [metadata, setMetadata] = useState<JournalMetadata | null>(null);

  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Modals
  const [recentModalOpen, setRecentModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);

  const isbnInputRef = useRef<HTMLInputElement | null>(null);

  // Custom hooks
  const {
    videoRef,
    devices,
    selectedDeviceId,
    isStreaming,
    cameraError,
    resolution,
    switchCamera,
    captureSnapshot
  } = useCamera();

  const { playAudioCue } = useSoundEffects(true);

  // Dark mode effect
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  // Fetch system status
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/system/status');
      const data = await res.json();
      setSystemStatus(data);
    } catch (err) {
      console.error('Failed to fetch system status:', err);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    // Focus ISBN input on start
    setTimeout(() => isbnInputRef.current?.focus(), 300);
  }, [fetchStatus]);

  // Handle ISBN submission (from input or physical barcode scanner)
  const handleProcessIsbn = async (code: string) => {
    const clean = code.trim();
    if (!clean) return;

    setErrorMessage(null);
    playAudioCue('beep');

    try {
      const res = await fetch('/api/capture/init-isbn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isbn: clean })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to initialize ISBN');
      }

      setActiveIsbn(data.isbn);
      setIsbnInput(data.isbn);

      // Check if shots already exist
      if (data.existingShots && data.existingShots.includes('1_front_spine.jpg')) {
        setShot1({
          filename: '1_front_spine.jpg',
          savedAt: data.metadata?.shots?.['1']?.savedAt || new Date().toISOString(),
          type: 'Front Cover & Spine Angle'
        });
      } else {
        setShot1(null);
      }

      if (data.existingShots && data.existingShots.includes('2_author_title.jpg')) {
        setShot2({
          filename: '2_author_title.jpg',
          savedAt: data.metadata?.shots?.['2']?.savedAt || new Date().toISOString(),
          type: 'Author & Title Page Angle'
        });
      } else {
        setShot2(null);
      }

      if (data.metadata) {
        setMetadata(data.metadata);
      }

      if (data.existingShots?.length >= 2) {
        setCurrentStep('COMPLETE');
        playAudioCue('success');
      } else if (data.existingShots?.includes('1_front_spine.jpg')) {
        setCurrentStep('CAPTURE_SHOT_2');
      } else {
        setCurrentStep('CAPTURE_SHOT_1');
      }

      fetchStatus();
    } catch (err: any) {
      setErrorMessage(err.message || 'Error processing ISBN');
      playAudioCue('error');
    }
  };

  // Hardware barcode scanner wedge listener
  useBarcodeScanner({
    onScan: (scannedCode) => {
      handleProcessIsbn(scannedCode);
    },
    enabled: currentStep === 'SCAN_ISBN' || currentStep === 'COMPLETE'
  });

  // Handle Photo Capture
  const handleCapturePhoto = async () => {
    if (!activeIsbn || isCapturing) return;

    const shotNumber = currentStep === 'CAPTURE_SHOT_1' ? 1 : 2;
    const base64Data = captureSnapshot(0.95);

    if (!base64Data) {
      setErrorMessage('Could not capture frame from camera.');
      return;
    }

    playAudioCue('shutter');
    setIsCapturing(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/capture/save-shot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isbn: activeIsbn,
          shotNumber,
          imageBase64: base64Data
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save shot');
      }

      const newShotInfo: ShotInfo = {
        filename: data.filename,
        savedAt: new Date().toISOString(),
        type: shotNumber === 1 ? 'Front Cover & Spine Angle' : 'Author & Title Page Angle',
        previewDataUrl: base64Data
      };

      if (shotNumber === 1) {
        setShot1(newShotInfo);
        setCurrentStep('CAPTURE_SHOT_2');
      } else {
        setShot2(newShotInfo);
        setCurrentStep('COMPLETE');
        playAudioCue('success');

        // Confetti celebration
        try {
          confetti({
            particleCount: 50,
            spread: 60,
            origin: { y: 0.8 }
          });
        } catch (e) {}
      }

      if (data.metadata) {
        setMetadata(data.metadata);
      }
      fetchStatus();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to upload photo');
      playAudioCue('error');
    } finally {
      setIsCapturing(false);
    }
  };

  // Retake a specific shot
  const handleRetakeShot = (shotNumber: 1 | 2) => {
    playAudioCue('click');
    if (shotNumber === 1) {
      setCurrentStep('CAPTURE_SHOT_1');
    } else {
      setCurrentStep('CAPTURE_SHOT_2');
    }
  };

  // Reset to next journal
  const handleNextJournal = () => {
    playAudioCue('click');
    setActiveIsbn('');
    setIsbnInput('');
    setShot1(null);
    setShot2(null);
    setMetadata(null);
    setErrorMessage(null);
    setCurrentStep('SCAN_ISBN');
    setTimeout(() => isbnInputRef.current?.focus(), 150);
  };

  // Open Windows Explorer for an ISBN or default root
  const handleOpenExplorer = async (targetIsbn?: string) => {
    try {
      await fetch('/api/system/open-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isbn: targetIsbn || activeIsbn || '' })
      });
    } catch (e) {
      console.error('Explorer error:', e);
    }
  };

  // Download ZIP
  const handleDownloadZip = (targetIsbn: string) => {
    if (!targetIsbn) return;
    window.location.href = `/api/capture/zip/${encodeURIComponent(targetIsbn)}`;
  };

  // Global Keyboard Shortcuts (Space to capture)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        const target = e.target as HTMLElement;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

        if (currentStep === 'CAPTURE_SHOT_1' || currentStep === 'CAPTURE_SHOT_2') {
          e.preventDefault();
          handleCapturePhoto();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentStep, activeIsbn, isCapturing, isStreaming]);

  return (
    <div className="min-h-screen ambient-bg flex flex-col font-sans transition-colors">
      
      {/* Top Navbar */}
      <Navbar
        darkMode={darkMode}
        setDarkMode={setDarkMode}
        systemStatus={systemStatus}
        onOpenRecent={() => setRecentModalOpen(true)}
        onOpenSettings={() => setSettingsModalOpen(true)}
        onOpenStorageFolder={() => handleOpenExplorer()}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 flex flex-col gap-6">
        
        {/* Step Progress Bar */}
        <StepProgressBar currentStep={currentStep} isbn={activeIsbn} />

        {/* Error Alert if any */}
        {errorMessage && (
          <div className="flex items-center space-x-2.5 p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-red-700 dark:text-red-300 text-xs animate-fade-in">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
            <span className="font-medium flex-1">{errorMessage}</span>
            <button onClick={() => setErrorMessage(null)} className="text-red-500 hover:text-red-700 text-xs font-bold">Dismiss</button>
          </div>
        )}

        {/* ISBN Scan/Input Bar */}
        <div className="w-full glass-panel rounded-2xl p-4 sm:p-5 shadow-sm">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleProcessIsbn(isbnInput);
            }}
            className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3"
          >
            <div className="relative flex-1">
              <Barcode className="w-5 h-5 text-slate-400 dark:text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                ref={isbnInputRef}
                type="text"
                value={isbnInput}
                onChange={(e) => setIsbnInput(e.target.value)}
                placeholder="Scan or type Journal ISBN (e.g. 9780132350884)..."
                className="w-full pl-11 pr-4 py-3 text-sm font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 shadow-inner text-slate-900 dark:text-white transition-all"
              />
            </div>

            <button
              type="submit"
              className="inline-flex items-center justify-center space-x-2 px-6 py-3 rounded-xl font-bold text-sm text-white bg-brand-600 hover:bg-brand-500 shadow-md shadow-brand-500/20 active:scale-95 transition-all shrink-0"
            >
              <span>{activeIsbn === isbnInput.trim() && activeIsbn ? 'Re-Init' : 'Start Capture'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {/* Quick Helper Badge */}
          <div className="flex flex-wrap items-center justify-between gap-2 mt-3 pt-2 text-[11px] text-slate-400 border-t border-slate-100 dark:border-slate-800/60">
            <span className="flex items-center space-x-1">
              <Keyboard className="w-3.5 h-3.5 text-slate-400" />
              <span>Barcode scanner wedge is active. Scan barcode anytime to auto-begin.</span>
            </span>
            {activeIsbn && (
              <span className="font-mono text-brand-600 dark:text-brand-400 font-bold">
                Target: C:\Journal_Proofs\{activeIsbn}\
              </span>
            )}
          </div>
        </div>

        {/* Dynamic Workflow Viewport (Camera or Review) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* Left / Main Column: Viewfinder (7 cols) */}
          <div className="lg:col-span-7 flex flex-col gap-4">
            <CameraViewfinder
              videoRef={videoRef}
              isStreaming={isStreaming}
              cameraError={cameraError}
              devices={devices}
              selectedDeviceId={selectedDeviceId}
              onSwitchCamera={switchCamera}
              onCapture={handleCapturePhoto}
              currentStep={currentStep}
              resolution={resolution}
              isCapturing={isCapturing}
            />
          </div>

          {/* Right Column: Review & Realtime Proof Card (5 cols) */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            {activeIsbn ? (
              <ReviewCard
                isbn={activeIsbn}
                shot1={shot1}
                shot2={shot2}
                metadata={metadata}
                onRetakeShot={handleRetakeShot}
                onOpenExplorer={handleOpenExplorer}
                onDownloadZip={handleDownloadZip}
                onNextJournal={handleNextJournal}
              />
            ) : (
              <div className="glass-panel rounded-2xl p-8 border border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center text-center text-slate-400 min-h-[380px]">
                <div className="w-16 h-16 rounded-2xl bg-brand-500/10 text-brand-600 dark:text-brand-400 flex items-center justify-center mb-4 shadow-inner">
                  <ShieldCheck className="w-8 h-8" />
                </div>
                <h3 className="font-bold text-base text-slate-800 dark:text-slate-200 mb-1">
                  Ready for Journal Proof Capture
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mb-4">
                  Scan an ISBN using your handheld scanner or enter it manually to begin taking anti-plagiarism verification photos.
                </p>
                <div className="space-y-1.5 text-left text-[11px] bg-slate-50 dark:bg-slate-900/60 p-3 rounded-xl border border-slate-200 dark:border-slate-800 font-mono text-slate-600 dark:text-slate-300">
                  <div>1. Automatic folder creation under <code className="text-brand-500">C:\Journal_Proofs\&lt;ISBN&gt;\</code></div>
                  <div>2. Shot 1: Front cover & spine side angle</div>
                  <div>3. Shot 2: Author & title page angle</div>
                  <div>4. High-resolution output with metadata.json</div>
                </div>
              </div>
            )}
          </div>

        </div>

      </main>

      {/* Modals */}
      <RecentCapturesModal
        isOpen={recentModalOpen}
        onClose={() => setRecentModalOpen(false)}
        onSelectIsbn={(selected) => handleProcessIsbn(selected)}
        onOpenExplorer={(selected) => handleOpenExplorer(selected)}
        onDownloadZip={(selected) => handleDownloadZip(selected)}
      />

      <SettingsModal
        isOpen={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
        systemStatus={systemStatus}
        onConfigUpdated={() => fetchStatus()}
      />

      {/* Footer */}
      <footer className="py-4 border-t border-slate-200/60 dark:border-slate-800/60 text-center text-xs text-slate-400 dark:text-slate-500">
        Journal Proof & Anti-Plagiarism Capture System &bull; Local Inventory PC Tool
      </footer>

    </div>
  );
}
