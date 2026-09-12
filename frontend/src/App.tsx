import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Barcode, 
  Camera, 
  ArrowRight, 
  RotateCcw, 
  Sparkles, 
  ShieldCheck, 
  CheckCircle2, 
  AlertCircle,
  Keyboard,
  BookOpen,
  Layers,
  Plus,
  Eye,
  AlertTriangle,
  Loader2,
  Trash2,
  X
} from 'lucide-react';

import { Navbar } from './components/Navbar';
import { StepProgressBar } from './components/StepProgressBar';
import { CameraViewfinder } from './components/CameraViewfinder';
import { ReviewCard } from './components/ReviewCard';
import { RecentCapturesModal } from './components/RecentCapturesModal';
import { SettingsModal } from './components/SettingsModal';
import { MobilePairingModal } from './components/MobilePairingModal';

import { useCamera } from './hooks/useCamera';
import { useBarcodeScanner } from './hooks/useBarcodeScanner';
import { useSoundEffects } from './hooks/useSoundEffects';
import { useSessionSync } from './hooks/useSessionSync';

import { 
  CaptureStep, 
  ShotInfo, 
  JournalMetadata, 
  SystemStatus, 
  SystemConfig, 
  BookDetails, 
  ExistingCopy,
  SessionEvent
} from './types';

export function App() {
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [systemConfig, setSystemConfig] = useState<SystemConfig | null>(null);
  const [isbnInput, setIsbnInput] = useState<string>('');
  const [activeIsbn, setActiveIsbn] = useState<string>('');
  const [currentStep, setCurrentStep] = useState<CaptureStep>('SCAN_ISBN');

  const [shot1, setShot1] = useState<ShotInfo | null>(null);
  const [shot2, setShot2] = useState<ShotInfo | null>(null);
  const [metadata, setMetadata] = useState<JournalMetadata | null>(null);
  const [bookDetails, setBookDetails] = useState<BookDetails | null>(null);
  const [isLookingUpMeta, setIsLookingUpMeta] = useState<boolean>(false);

  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Modals & Dialogs
  const [recentModalOpen, setRecentModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [mobilePairingOpen, setMobilePairingOpen] = useState(false);
  const [duplicateModal, setDuplicateModal] = useState<{
    baseIsbn: string;
    existingCopies: ExistingCopy[];
  } | null>(null);
  const [blurWarning, setBlurWarning] = useState<{
    shotNumber: 1 | 2;
    base64Data: string;
    sharpnessScore: number;
  } | null>(null);

  const isbnInputRef = useRef<HTMLInputElement | null>(null);

  // Custom hooks
  const {
    videoRef,
    devices,
    selectedDeviceId,
    isStreaming,
    cameraError,
    resolution,
    hasTorch,
    isTorchOn,
    toggleTorch,
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

  // Fetch system status & config
  const fetchStatus = useCallback(async () => {
    try {
      const [resStatus, resConfig] = await Promise.all([
        fetch('/api/system/status'),
        fetch('/api/system/config')
      ]);
      if (resStatus.ok) {
        const data = await resStatus.json();
        setSystemStatus(data);
      }
      if (resConfig.ok) {
        const cfg = await resConfig.json();
        setSystemConfig(cfg);
      }
    } catch (err) {
      console.error('Failed to fetch system status/config:', err);
    }
  }, []);

  // Real-time multi-device cross-synchronization (PC & Phone)
  const { resetRemoteSession } = useSessionSync({
    onSessionSync: useCallback((event: SessionEvent) => {
      if (event.type === 'CONNECTED') {
        if (event.session?.activeIsbn && currentStep === 'SCAN_ISBN') {
          setActiveIsbn(event.session.activeIsbn);
          setIsbnInput(event.session.activeIsbn);
          setCurrentStep(event.session.currentStep);
          setShot1(event.session.shot1);
          setShot2(event.session.shot2);
          setMetadata(event.session.metadata);
          setBookDetails(event.session.bookDetails);
        }
      } else if (event.type === 'ISBN_INITIALIZED') {
        setActiveIsbn(event.session.activeIsbn);
        setIsbnInput(event.session.activeIsbn);
        setCurrentStep(event.session.currentStep);
        setShot1(event.session.shot1);
        setShot2(event.session.shot2);
        setMetadata(event.session.metadata);
        setBookDetails(event.session.bookDetails);
        playAudioCue('beep');
      } else if (event.type === 'SHOT_SAVED') {
        if (event.session.shot1) setShot1(event.session.shot1);
        if (event.session.shot2) setShot2(event.session.shot2);
        if (event.session.metadata) setMetadata(event.session.metadata);
        if (event.session.bookDetails) setBookDetails(event.session.bookDetails);
        setCurrentStep(event.session.currentStep);

        if (event.isComplete) {
          playAudioCue('success');
          fetchStatus();
        }
      } else if (event.type === 'SESSION_RESET') {
        setActiveIsbn('');
        setIsbnInput('');
        setShot1(null);
        setShot2(null);
        setMetadata(null);
        setBookDetails(null);
        setErrorMessage(null);
        setDuplicateModal(null);
        setBlurWarning(null);
        setCurrentStep('SCAN_ISBN');
      }
    }, [currentStep, fetchStatus, playAudioCue])
  });

  useEffect(() => {
    fetchStatus();
    setTimeout(() => isbnInputRef.current?.focus(), 300);
  }, [fetchStatus]);

  // Auto-lookup Book/Journal Metadata
  const lookupMetadata = async (isbn: string) => {
    setIsLookingUpMeta(true);
    try {
      const res = await fetch(`/api/lookup/isbn/${encodeURIComponent(isbn)}`);
      const data = await res.json();
      if (data.success && data.data) {
        setBookDetails(data.data);
      } else {
        setBookDetails(null);
      }
    } catch (e) {
      console.error('Metadata lookup error:', e);
    } finally {
      setIsLookingUpMeta(false);
    }
  };

  // Handle ISBN submission (from input or physical barcode scanner)
  const handleProcessIsbn = async (code: string, forceNewCopy: boolean = false, targetIdentifier?: string) => {
    const clean = code.trim();
    if (!clean) return;

    setErrorMessage(null);
    playAudioCue('beep');

    try {
      const res = await fetch('/api/capture/init-isbn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          isbn: clean,
          forceNewCopy,
          targetIdentifier
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to initialize ISBN');
      }

      // Check if duplicate copies exist and this is an initial scan
      if (data.hasDuplicateCopies && data.existingCopies?.some((c: ExistingCopy) => c.isComplete)) {
        setDuplicateModal({
          baseIsbn: data.baseIsbn,
          existingCopies: data.existingCopies
        });
        return;
      }

      setDuplicateModal(null);
      setActiveIsbn(data.isbn);
      setIsbnInput(data.isbn);

      // Trigger automatic bibliographic lookup
      lookupMetadata(data.baseIsbn || data.isbn);

      // Check if shots already exist
      if (data.existingShots && data.existingShots.includes('1_front_spine.jpg')) {
        setShot1({
          filename: '1_front_spine.jpg',
          savedAt: data.metadata?.shots?.['1']?.savedAt || new Date().toISOString(),
          type: 'Front Cover & Spine Angle',
          blurScore: data.metadata?.shots?.['1']?.blurScore
        });
      } else {
        setShot1(null);
      }

      if (data.existingShots && data.existingShots.includes('2_author_title.jpg')) {
        setShot2({
          filename: '2_author_title.jpg',
          savedAt: data.metadata?.shots?.['2']?.savedAt || new Date().toISOString(),
          type: 'Author & Title Page Angle',
          blurScore: data.metadata?.shots?.['2']?.blurScore
        });
      } else {
        setShot2(null);
      }

      if (data.metadata) {
        setMetadata(data.metadata);
        if (data.metadata.bookDetails) {
          setBookDetails(data.metadata.bookDetails);
        }
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

  // Save shot payload helper
  const commitSaveShot = async (
    shotNumber: 1 | 2, 
    base64Data: string, 
    blurScore?: number
  ) => {
    setIsCapturing(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/capture/save-shot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isbn: activeIsbn,
          shotNumber,
          imageBase64: base64Data,
          bookDetails: bookDetails,
          blurScore
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
        previewDataUrl: base64Data,
        blurScore
      };

      if (shotNumber === 1) {
        setShot1(newShotInfo);
        setCurrentStep('CAPTURE_SHOT_2');
      } else {
        setShot2(newShotInfo);
        setCurrentStep('COMPLETE');
        playAudioCue('success');
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
      setBlurWarning(null);
    }
  };

  // Handle Photo Capture
  const handleCapturePhoto = async () => {
    if (!activeIsbn || isCapturing) return;

    const shotNumber = currentStep === 'CAPTURE_SHOT_1' ? 1 : 2;

    const watermarkConfig = systemConfig?.watermarkEnabled !== false ? {
      isbn: activeIsbn,
      stationName: systemConfig?.watermarkStation || systemStatus?.watermarkStation || 'Station-01',
      shotLabel: shotNumber === 1 ? 'Shot 1: Front & Spine' : 'Shot 2: Author & Title',
      timestamp: new Date().toLocaleString()
    } : null;

    const result = captureSnapshot({
      quality: systemConfig?.imageQuality || 0.95,
      watermark: watermarkConfig
    });

    if (!result) {
      setErrorMessage('Could not capture frame from camera.');
      return;
    }

    playAudioCue('shutter');

    // Check for blur if blur check is enabled
    if (result.isBlurry && systemConfig?.blurCheckEnabled !== false) {
      setBlurWarning({
        shotNumber,
        base64Data: result.base64Data,
        sharpnessScore: result.sharpnessScore
      });
      return;
    }

    // Save directly
    await commitSaveShot(shotNumber, result.base64Data, result.sharpnessScore);
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

  // Discard current active journal session and delete its folder/shots
  const handleDiscardSession = async () => {
    playAudioCue('click');
    try {
      await fetch('/api/capture/discard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isbn: activeIsbn })
      });
    } catch (e) {
      console.error('Discard session error:', e);
    }
    setActiveIsbn('');
    setIsbnInput('');
    setShot1(null);
    setShot2(null);
    setMetadata(null);
    setBookDetails(null);
    setErrorMessage(null);
    setDuplicateModal(null);
    setBlurWarning(null);
    setCurrentStep('SCAN_ISBN');
    fetchStatus();
    setTimeout(() => isbnInputRef.current?.focus(), 150);
  };

  // Reset to next journal
  const handleNextJournal = () => {
    playAudioCue('click');
    resetRemoteSession();
    setActiveIsbn('');
    setIsbnInput('');
    setShot1(null);
    setShot2(null);
    setMetadata(null);
    setBookDetails(null);
    setErrorMessage(null);
    setDuplicateModal(null);
    setBlurWarning(null);
    setCurrentStep('SCAN_ISBN');
    fetchStatus();
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
        onOpenMobilePairing={() => setMobilePairingOpen(true)}
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

        {/* ISBN Scan/Input Bar & Bibliographic Metadata Banner */}
        <div className="w-full glass-panel rounded-2xl p-4 sm:p-5 shadow-sm space-y-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleProcessIsbn(isbnInput);
            }}
            className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3"
          >
            <div className="relative flex-1">
              <Barcode className="w-5 h-5 text-slate-400 dark:text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={isbnInputRef}
                type="text"
                value={isbnInput}
                onChange={(e) => setIsbnInput(e.target.value)}
                placeholder="Scan or type Journal ISBN (e.g. 9780132350884)..."
                className="w-full pl-11 pr-32 py-3 text-sm font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 shadow-inner text-slate-900 dark:text-white transition-all"
              />

              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center space-x-1.5">
                {isbnInput.trim().length > 0 && (
                  <>
                    {(() => {
                      const digitsOnly = isbnInput.replace(/[^0-9Xx]/g, '');
                      const len = digitsOnly.length;
                      if (len === 13) {
                        return (
                          <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800">
                            13 digits (ISBN-13)
                          </span>
                        );
                      } else if (len === 10) {
                        return (
                          <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800">
                            10 digits (ISBN-10)
                          </span>
                        );
                      } else if (len === 8) {
                        return (
                          <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400 border border-blue-300 dark:border-blue-800">
                            8 digits (ISSN)
                          </span>
                        );
                      } else if (len > 0) {
                        return (
                          <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400 border border-amber-300 dark:border-amber-800">
                            {len} digits
                          </span>
                        );
                      }
                      return null;
                    })()}

                    <button
                      type="button"
                      onClick={() => {
                        setIsbnInput('');
                        isbnInputRef.current?.focus();
                      }}
                      className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      title="Clear text"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {activeIsbn && (
                <button
                  type="button"
                  onClick={handleDiscardSession}
                  className="px-4 py-3 rounded-xl font-bold text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/60 border border-rose-200 dark:border-rose-900/40 shadow-sm transition-all"
                  title="Discard this session and start over"
                >
                  Clear / Reset
                </button>
              )}

              <button
                type="submit"
                className="inline-flex items-center justify-center space-x-2 px-6 py-3 rounded-xl font-bold text-sm text-white bg-brand-600 hover:bg-brand-500 shadow-md shadow-brand-500/20 active:scale-95 transition-all shrink-0"
              >
                <span>{activeIsbn === isbnInput.trim() && activeIsbn ? 'Re-Init' : 'Start Capture'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </form>

          {/* Bibliographic Metadata Card (Auto-Lookup) */}
          {activeIsbn && (
            <div className="pt-2 border-t border-slate-200/60 dark:border-slate-800/60">
              {isLookingUpMeta ? (
                <div className="flex items-center space-x-2 text-xs text-brand-600 dark:text-brand-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Looking up journal catalog details (OpenLibrary / CrossRef)...</span>
                </div>
              ) : bookDetails?.title ? (
                <div className="flex items-start justify-between gap-3 bg-brand-50/50 dark:bg-brand-950/20 p-3 rounded-xl border border-brand-100 dark:border-brand-900/40">
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <BookOpen className="w-4 h-4 text-brand-600 dark:text-brand-400 shrink-0" />
                      <span className="text-xs font-bold text-slate-900 dark:text-white">
                        {bookDetails.title}
                      </span>
                      {bookDetails.publishYear && (
                        <span className="text-[10px] font-semibold px-2 py-0.2 rounded-full bg-brand-100 text-brand-800 dark:bg-brand-900/60 dark:text-brand-300">
                          {bookDetails.publishYear}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 text-[11px] text-slate-500 dark:text-slate-400 pl-6">
                      {bookDetails.authors && <span><b>Authors:</b> {bookDetails.authors}</span>}
                      {bookDetails.publisher && <span><b>Publisher:</b> {bookDetails.publisher}</span>}
                      {bookDetails.source && <span className="text-[10px] text-slate-400">via {bookDetails.source}</span>}
                    </div>
                  </div>

                  <button
                    onClick={() => handleProcessIsbn(activeIsbn, true)}
                    title="Add another physical copy for this ISBN"
                    className="inline-flex items-center space-x-1 px-2.5 py-1 text-[11px] font-semibold text-brand-700 dark:text-brand-300 bg-white dark:bg-slate-800 border border-brand-200 dark:border-brand-800 rounded-lg hover:bg-brand-50 dark:hover:bg-slate-700 transition-colors shrink-0 shadow-sm"
                  >
                    <Plus className="w-3 h-3" />
                    <span>+ Add Copy</span>
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>Target Folder: <code className="font-mono text-brand-600 dark:text-brand-400 font-semibold">C:\Journal_Proofs\{activeIsbn}\</code></span>
                  <button
                    onClick={() => handleProcessIsbn(activeIsbn, true)}
                    className="text-brand-600 hover:text-brand-500 font-semibold flex items-center space-x-1"
                  >
                    <Plus className="w-3 h-3" />
                    <span>+ Add Another Copy</span>
                  </button>
                </div>
              )}
            </div>
          )}
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
              hasTorch={hasTorch}
              isTorchOn={isTorchOn}
              onToggleTorch={toggleTorch}
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
                onDiscardSession={handleDiscardSession}
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
                  Scan an ISBN using your handheld scanner or enter it manually to begin taking verification photos.
                </p>
                <div className="space-y-1.5 text-left text-[11px] bg-slate-50 dark:bg-slate-900/60 p-3 rounded-xl border border-slate-200 dark:border-slate-800 font-mono text-slate-600 dark:text-slate-300">
                  <div>1. Automatic folder creation under <code className="text-brand-500">C:\Journal_Proofs\&lt;ISBN&gt;\</code></div>
                  <div>2. Auto-fetches Journal Title, Author, Publisher</div>
                  <div>3. Shot 1: Front cover & spine side angle</div>
                  <div>4. Shot 2: Author & title page angle</div>
                  <div>5. Embedded audit timestamp & tamper-proof metadata</div>
                </div>
              </div>
            )}
          </div>

        </div>

      </main>

      {/* Duplicate / Multi-Copy Prompt Modal */}
      {duplicateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-overlay-in">
          <div className="w-full max-w-md rounded-2xl glass-panel shadow-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400">
                <Layers className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Existing Journal Copy Detected
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  ISBN: <span className="font-mono font-bold text-slate-700 dark:text-slate-300">{duplicateModal.baseIsbn}</span>
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300">
              This ISBN already has <b>{duplicateModal.existingCopies.length}</b> captured record(s) on file. How would you like to proceed?
            </p>

            <div className="space-y-2">
              {/* Option 1: Create Next Copy */}
              <button
                onClick={() => handleProcessIsbn(duplicateModal.baseIsbn, true)}
                className="w-full p-3 rounded-xl border border-brand-200 dark:border-brand-800 bg-brand-50/70 dark:bg-brand-950/40 hover:bg-brand-100/80 dark:hover:bg-brand-900/50 text-left flex items-center justify-between group transition-colors"
              >
                <div>
                  <div className="text-xs font-bold text-brand-700 dark:text-brand-300 flex items-center gap-1.5">
                    <Plus className="w-3.5 h-3.5" />
                    <span>Capture as New Copy (Copy #{duplicateModal.existingCopies.length + 1})</span>
                  </div>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Creates folder <code className="font-mono">{duplicateModal.baseIsbn}_Copy{duplicateModal.existingCopies.length + 1}</code>
                  </span>
                </div>
                <ArrowRight className="w-4 h-4 text-brand-600 group-hover:translate-x-1 transition-transform" />
              </button>

              {/* Option 2: Review / Edit Existing */}
              <button
                onClick={() => {
                  const target = duplicateModal.existingCopies[0]?.identifier || duplicateModal.baseIsbn;
                  handleProcessIsbn(duplicateModal.baseIsbn, false, target);
                }}
                className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 text-left flex items-center justify-between group transition-colors"
              >
                <div>
                  <div className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <Eye className="w-3.5 h-3.5 text-slate-500" />
                    <span>Review / Retake Existing (Copy #1)</span>
                  </div>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Open existing proof records
                  </span>
                </div>
                <ArrowRight className="w-4 h-4 text-slate-400 group-hover:translate-x-1 transition-transform" />
              </button>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setDuplicateModal(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Blur / Sharpness Quality Warning Dialog */}
      {blurWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-overlay-in">
          <div className="w-full max-w-lg rounded-2xl glass-panel shadow-2xl border border-amber-300/40 dark:border-amber-700/40 bg-white dark:bg-slate-900 p-6 space-y-4">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Potential Motion Blur / Focus Issue
                </h3>
                <p className="text-xs text-amber-600 dark:text-amber-400 font-semibold">
                  Sharpness Score: {blurWarning.sharpnessScore} / 100 (Below recommended threshold)
                </p>
              </div>
            </div>

            {/* Thumbnail Preview */}
            <div className="relative aspect-[16/10] w-full rounded-xl overflow-hidden bg-black border border-slate-200 dark:border-slate-800">
              <img
                src={blurWarning.base64Data}
                alt="Captured Snapshot"
                className="w-full h-full object-contain"
              />
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300">
              The camera may have moved or the text might be out of focus. Would you like to retake this shot or keep it anyway?
            </p>

            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                onClick={() => {
                  setBlurWarning(null);
                  playAudioCue('click');
                }}
                className="px-4 py-2 text-xs font-bold rounded-xl text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              >
                Retake Photo
              </button>

              <button
                onClick={() => commitSaveShot(blurWarning.shotNumber, blurWarning.base64Data, blurWarning.sharpnessScore)}
                className="px-4 py-2 text-xs font-bold rounded-xl text-white bg-amber-600 hover:bg-amber-500 shadow-md transition-colors"
              >
                Keep & Save Anyway
              </button>
            </div>
          </div>
        </div>
      )}

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

      <MobilePairingModal
        isOpen={mobilePairingOpen}
        onClose={() => setMobilePairingOpen(false)}
        systemStatus={systemStatus}
      />

      {/* Footer */}
      <footer className="py-4 border-t border-slate-200/60 dark:border-slate-800/60 text-center text-xs text-slate-400 dark:text-slate-500">
        Journal Proof Capture System &bull; Local Inventory PC Tool
      </footer>

    </div>
  );
}
