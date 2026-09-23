import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Barcode, 
  ArrowRight, 
  ShieldCheck, 
  AlertTriangle,
  BookOpen, 
  Layers, 
  Plus, 
  Eye, 
  Trash2, 
  X,
  Search,
  Scan,
  Lock,
  Package,
  CheckCircle2
} from 'lucide-react';

import { Navbar } from './components/Navbar';
import { StepProgressBar } from './components/StepProgressBar';
import { CameraViewfinder } from './components/CameraViewfinder';
import { ReviewCard } from './components/ReviewCard';
import { SettingsModal } from './components/SettingsModal';
import { MobilePairingModal } from './components/MobilePairingModal';
import { ManifestImportModal } from './components/ManifestImportModal';
import { SearchViewCatalog } from './components/SearchViewCatalog';

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
  SessionEvent,
  ViewMode,
  StationRole,
  BoxSummary,
  SHOT_DEFINITIONS
} from './types';

export function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('CAPTURE');

  // Station Role: 'box_level' (PC 1: Shots 1-2) | 'book_level' (PC 2: Shots 3-7) | 'all_in_one' (Full: Shots 1-7)
  const [stationRole, setStationRoleState] = useState<StationRole>(() => {
    const saved = localStorage.getItem('verification_station_role') as StationRole;
    if (saved === 'box_level' || saved === 'book_level' || saved === 'all_in_one') return saved;
    return 'box_level';
  });

  const setStationRole = (role: StationRole) => {
    localStorage.setItem('verification_station_role', role);
    setStationRoleState(role);
  };

  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [systemConfig, setSystemConfig] = useState<SystemConfig | null>(null);
  
  // Dynamic Lot and Box numbers automatically populated from manifest
  const [lotNumber, setLotNumber] = useState<string>('');
  const [boxNumber, setBoxNumber] = useState<string>('');
  const [isbnInput, setIsbnInput] = useState<string>('');
  const [activeIsbn, setActiveIsbn] = useState<string>('');
  const [currentStep, setCurrentStep] = useState<CaptureStep>('SCAN_ISBN');

  // 7 Verification Shots
  const [shots, setShots] = useState<Record<number, ShotInfo | null>>({
    1: null,
    2: null,
    3: null,
    4: null,
    5: null,
    6: null,
    7: null
  });

  const [metadata, setMetadata] = useState<JournalMetadata | null>(null);
  const [bookDetails, setBookDetails] = useState<BookDetails | null>(null);
  const [isLookingUpMeta, setIsLookingUpMeta] = useState<boolean>(false);
  const [isCapturing, setIsCapturing] = useState<boolean>(false);

  // Box-level list & active summary (PC 1 / PC 2 Workflow)
  const [boxesList, setBoxesList] = useState<BoxSummary[]>([]);
  const [activeBoxSummary, setActiveBoxSummary] = useState<BoxSummary | null>(null);

  // Red Toast Alert Banner
  const [toastAlert, setToastAlert] = useState<{
    message: string;
    type?: 'error' | 'warning' | 'info';
  } | null>(null);

  // Modals & Dialogs
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [mobilePairingOpen, setMobilePairingOpen] = useState(false);
  const [manifestModalOpen, setManifestModalOpen] = useState(false);
  const [quickSearchOpen, setQuickSearchOpen] = useState(false);
  const [quickSearchText, setQuickSearchText] = useState('');
  const [manifestCount, setManifestCount] = useState<number>(0);

  const [duplicateModal, setDuplicateModal] = useState<{
    baseIsbn: string;
    existingCopies: ExistingCopy[];
  } | null>(null);

  const [blurWarning, setBlurWarning] = useState<{
    shotNumber: number;
    base64Data: string;
    sharpnessScore: number;
  } | null>(null);

  const isbnInputRef = useRef<HTMLInputElement | null>(null);
  const quickSearchInputRef = useRef<HTMLInputElement | null>(null);
  const pendingNextRef = useRef<boolean>(false);
  const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Custom camera & sound hooks
  const {
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
    switchCamera,
    captureSnapshot
  } = useCamera();

  // Auto-switch camera as steps advance (if Dual Camera auto-switching is enabled)
  useEffect(() => {
    autoSwitchForStep(currentStep);
  }, [currentStep, autoSwitchForStep]);

  const { playAudioCue } = useSoundEffects(true);

  // Fetch Boxes List from manifest
  const fetchBoxesList = useCallback(async () => {
    try {
      const res = await fetch('/api/boxes/list');
      if (res.ok) {
        const data = await res.json();
        setBoxesList(data.boxes || []);
      }
    } catch (e) {
      console.warn('Failed to fetch boxes list:', e);
    }
  }, []);

  // Fetch status & config
  const fetchStatus = useCallback(async () => {
    try {
      const [resStatus, resConfig, resManifest] = await Promise.all([
        fetch('/api/system/status'),
        fetch('/api/system/config'),
        fetch('/api/manifest')
      ]);
      if (resStatus.ok) {
        const data = await resStatus.json();
        setSystemStatus(data);
      }
      if (resConfig.ok) {
        const cfg = await resConfig.json();
        setSystemConfig(cfg);
      }
      if (resManifest.ok) {
        const m = await resManifest.json();
        setManifestCount(m.totalCount || 0);
      }
      fetchBoxesList();
    } catch (err) {
      console.error('Failed to fetch system status:', err);
    }
  }, [fetchBoxesList]);

  // Multi-device SSE Synchronization
  const { resetRemoteSession } = useSessionSync({
    onSessionSync: useCallback((event: SessionEvent) => {
      if (event.type === 'CONNECTED') {
        if (event.session?.activeIsbn && currentStep === 'SCAN_ISBN' && !activeIsbn) {
          setActiveIsbn(event.session.activeIsbn);
          setIsbnInput(event.session.activeIsbn);
          setLotNumber(event.session.lotNumber || '');
          setBoxNumber(event.session.boxNumber || '');
          setCurrentStep(event.session.currentStep);
          setShots(event.session.shots || { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null, 7: null });
          setMetadata(event.session.metadata);
          setBookDetails(event.session.bookDetails);
        }
      } else if (event.type === 'ISBN_INITIALIZED') {
        if (stationRole === 'book_level' && (!activeIsbn || event.session.activeIsbn === activeIsbn)) {
          setActiveIsbn(event.session.activeIsbn);
          setIsbnInput(event.session.activeIsbn);
          setLotNumber(event.session.lotNumber || '');
          setBoxNumber(event.session.boxNumber || '');
          
          const initialShots = event.session.shots || { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null, 7: null };
          setShots(initialShots);
          setMetadata(event.session.metadata);
          setBookDetails(event.session.bookDetails);

          // On PC 2, advance to first missing book shot (3 to 7)
          let nextBookShot = 3;
          for (let s = 3; s <= 7; s++) {
            if (!initialShots[s]) {
              nextBookShot = s;
              break;
            }
          }
          if (initialShots[3] && initialShots[4] && initialShots[5] && initialShots[6] && initialShots[7]) {
            setCurrentStep('COMPLETE');
          } else {
            setCurrentStep(`CAPTURE_SHOT_${nextBookShot}` as CaptureStep);
          }
          playAudioCue('beep');
        }
      } else if (event.type === 'BOX_INITIALIZED') {
        if (stationRole === 'book_level' && (!activeIsbn || event.session.activeIsbn === activeIsbn)) {
          setActiveIsbn(event.session.activeIsbn);
          setIsbnInput('');
          setLotNumber(event.session.lotNumber || '');
          setBoxNumber(event.session.boxNumber || '');
          setCurrentStep('CAPTURE_SHOT_3');
          setShots(event.session.shots || { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null, 7: null });
          setMetadata(event.session.metadata);
          setBookDetails(event.session.bookDetails);
          if (event.boxSummary) setActiveBoxSummary(event.boxSummary);
          playAudioCue('beep');
        }
      } else if (event.type === 'BOX_SHOT_SAVED') {
        fetchBoxesList();
        // When PC 1 captures Box/Unbox shot, immediately show it on PC 2
        if (event.boxNumber) {
          const isMatchingBox = !boxNumber || String(event.boxNumber).toLowerCase() === String(boxNumber).toLowerCase();
          if (stationRole === 'book_level' && isMatchingBox) {
            setLotNumber(event.lotNumber || lotNumber || '');
            setBoxNumber(event.boxNumber);
            if (event.boxShots) {
              setShots(prev => ({
                ...prev,
                1: event.boxShots.hasBoxShot ? {
                  filename: 'shot_1_box.jpg',
                  savedAt: new Date().toISOString(),
                  type: 'Box',
                  scope: 'box_level',
                  previewDataUrl: event.boxShots.boxShotUrl,
                  inheritedFromBox: true
                } : prev[1],
                2: event.boxShots.hasUnboxShot ? {
                  filename: 'shot_2_unbox.jpg',
                  savedAt: new Date().toISOString(),
                  type: 'Unbox',
                  scope: 'box_level',
                  previewDataUrl: event.boxShots.unboxShotUrl,
                  inheritedFromBox: true
                } : prev[2]
              }));

              if (event.boxShots.hasBoxShot && event.boxShots.hasUnboxShot) {
                if (currentStep === 'CAPTURE_SHOT_1' || currentStep === 'CAPTURE_SHOT_2') {
                  setCurrentStep('CAPTURE_SHOT_3');
                }
                playAudioCue('success');
                setToastAlert({
                  message: `✓ Box & Unbox photos received from PC 1 for Box ${event.boxNumber}! Ready for Book shots (Shots 3–7).`,
                  type: 'info'
                });
              }
            }
          }
        }
      } else if (event.type === 'SHOT_SAVED') {
        const isTargetMatch = event.isbn === activeIsbn || (stationRole === 'book_level' && !activeIsbn);
        if (isTargetMatch) {
          if (!activeIsbn && event.isbn) {
            setActiveIsbn(event.isbn);
            setIsbnInput(event.isbn);
            setLotNumber(event.session.lotNumber || '');
            setBoxNumber(event.session.boxNumber || '');
          }
          if (event.session.shots) setShots(event.session.shots);
          if (event.session.metadata) setMetadata(event.session.metadata);
          if (event.session.bookDetails) setBookDetails(event.session.bookDetails);

          if (stationRole === 'book_level') {
            let nextBookShot = 3;
            for (let s = 3; s <= 7; s++) {
              if (!event.session.shots?.[s]) {
                nextBookShot = s;
                break;
              }
            }
            if (event.session.shots?.[3] && event.session.shots?.[4] && event.session.shots?.[5] && event.session.shots?.[6] && event.session.shots?.[7]) {
              setCurrentStep('COMPLETE');
            } else {
              setCurrentStep(`CAPTURE_SHOT_${nextBookShot}` as CaptureStep);
            }
            if (event.shotNumber === 2 && event.session.shots?.[1] && event.session.shots?.[2]) {
              playAudioCue('success');
              setToastAlert({
                message: `✓ Box & Unbox photos completed on PC 1! You can now capture Shots 3 to 7 on PC 2.`,
                type: 'info'
              });
            }
          } else {
            setCurrentStep(event.session.currentStep);
          }

          if (event.isComplete) {
            playAudioCue('success');
            fetchStatus();
          }
        }
      } else if (event.type === 'SESSION_RESET') {
        if (event.isbn === activeIsbn) {
          setActiveIsbn('');
          setIsbnInput('');
          if (stationRole === 'box_level') {
            setLotNumber('');
            setBoxNumber('');
            setActiveBoxSummary(null);
          }
          setShots({ 1: null, 2: null, 3: null, 4: null, 5: null, 6: null, 7: null });
          setMetadata(null);
          setBookDetails(null);
          setToastAlert(null);
          setDuplicateModal(null);
          setBlurWarning(null);
          setCurrentStep('SCAN_ISBN');
        }
      } else if (event.type === 'MANIFEST_UPDATED') {
        fetchStatus();
        fetchBoxesList();
      } else if (event.type === 'S3_AUTO_UPLOADED') {
        if (event.isbn === activeIsbn && event.s3Upload) {
          setMetadata(prev => prev ? { ...prev, s3Upload: event.s3Upload } : prev);
        }
        fetchStatus();
      }
    }, [currentStep, stationRole, activeIsbn, boxNumber, fetchStatus, fetchBoxesList, playAudioCue])
  });

  useEffect(() => {
    fetchStatus();
    fetchBoxesList();
    setTimeout(() => isbnInputRef.current?.focus(), 300);
  }, [fetchStatus, fetchBoxesList]);

  // Global Ctrl+K shortcut for Quick Search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setQuickSearchOpen(true);
        setTimeout(() => quickSearchInputRef.current?.focus(), 150);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Auto-lookup Book Metadata
  const lookupMetadata = async (isbn: string) => {
    setIsLookingUpMeta(true);
    try {
      const res = await fetch(`/api/lookup/isbn/${encodeURIComponent(isbn)}`);
      const data = await res.json();
      if (data.success && data.data) {
        setBookDetails(data.data);
      }
    } catch (e) {
      console.error('Metadata lookup error:', e);
    } finally {
      setIsLookingUpMeta(false);
    }
  };

  // Process ISBN & validate processable status
  const handleProcessIsbn = async (code: string, forceNewCopy: boolean = false, targetIdentifier?: string) => {
    const clean = code.trim();
    if (!clean) return;

    // Immediately blur input so cursor stops blinking and keyboard capture shortcuts work hands-free
    isbnInputRef.current?.blur();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    setToastAlert(null);
    playAudioCue('beep');

    // Check manifest processable validation & pre-fetch lot and box (Validation 4.2)
    let matchedLot = '';
    let matchedBox = '';
    try {
      const checkRes = await fetch(`/api/manifest/check/${encodeURIComponent(clean)}`);
      if (checkRes.ok) {
        const checkData = await checkRes.json();
        matchedLot = checkData.item?.lotNumber || '';
        matchedBox = checkData.item?.boxNumber || '';
        if (matchedLot) setLotNumber(matchedLot);
        if (matchedBox) setBoxNumber(matchedBox);

        if (checkData.manifestActive && !checkData.isProcessable) {
          const reasonMsg = checkData.reason || 'Journal is marked as Not Processable in the imported manifest.';
          const locStr = matchedLot || matchedBox ? `[Lot: ${matchedLot || 'N/A'}${matchedBox ? ` • Box: ${matchedBox}` : ''}] ` : '';
          setToastAlert({
            message: `${locStr}ISBN ${clean} is NOT processable. ${reasonMsg} You cannot start a verification session for this journal.`,
            type: 'error'
          });
          playAudioCue('error');
          return;
        }
      }
    } catch (e) {
      console.warn('Manifest pre-check failed, continuing:', e);
    }

    try {
      const res = await fetch('/api/capture/init-isbn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          isbn: clean,
          forceNewCopy,
          targetIdentifier,
          lotNumber: matchedLot || lotNumber || activeBoxSummary?.lotNumber || '',
          boxNumber: matchedBox || boxNumber || activeBoxSummary?.boxNumber || ''
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to initialize verification session');
      }

      const resolvedLot = data.lotNumber || data.manifestMatch?.lotNumber || data.metadata?.lotNumber || matchedLot || '';
      const resolvedBox = data.boxNumber || data.manifestMatch?.boxNumber || data.metadata?.boxNumber || matchedBox || '';
      setLotNumber(resolvedLot);
      setBoxNumber(resolvedBox);

      // Find or set matching Box Summary
      if (resolvedBox && boxesList.length > 0) {
        const foundBox = boxesList.find(b => 
          (b.lotNumber || 'Unassigned').toLowerCase() === (resolvedLot || 'Unassigned').toLowerCase() &&
          (b.boxNumber || '').toLowerCase() === resolvedBox.toLowerCase()
        );
        if (foundBox) {
          setActiveBoxSummary(foundBox);
        }
      }

      if (data.isProcessable === false) {
        const locStr = resolvedLot || resolvedBox ? `[Lot: ${resolvedLot || 'N/A'}${resolvedBox ? ` • Box: ${resolvedBox}` : ''}] ` : '';
        setToastAlert({
          message: `${locStr}ISBN ${clean} is NOT processable. ${data.nonProcessableReason || 'Manifest restriction.'} Cannot capture images.`,
          type: 'error'
        });
        playAudioCue('error');
        return;
      }

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

      lookupMetadata(data.baseIsbn || data.isbn);

      const newShots: Record<number, ShotInfo | null> = { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null, 7: null };
      for (let s = 1; s <= 7; s++) {
        if (data.existingShots && data.existingShots[s]) {
          newShots[s] = {
            filename: data.existingShots[s],
            savedAt: data.metadata?.shots?.[s]?.savedAt || new Date().toISOString(),
            type: SHOT_DEFINITIONS[s - 1]?.label || `Shot ${s}`,
            scope: SHOT_DEFINITIONS[s - 1]?.scope,
            previewDataUrl: `/proofs/${encodeURIComponent(data.isbn)}/${encodeURIComponent(data.existingShots[s])}?t=${Date.now()}`,
            blurScore: data.metadata?.shots?.[s]?.blurScore
          };
        }
      }
      setShots(newShots);

      if (data.metadata) {
        setMetadata(data.metadata);
        if (data.metadata.bookDetails) {
          setBookDetails(data.metadata.bookDetails);
        }
      }

      if (data.shotsCount >= 7) {
        setCurrentStep('COMPLETE');
        playAudioCue('success');
      } else if (stationRole === 'box_level') {
        // PC 1 (Box Level: Shots 1 & 2)
        if (newShots[1] && newShots[2]) {
          setCurrentStep('CAPTURE_SHOT_3'); // triggers Box Level Complete view
        } else if (!newShots[1]) {
          setCurrentStep('CAPTURE_SHOT_1');
        } else {
          setCurrentStep('CAPTURE_SHOT_2');
        }
      } else if (stationRole === 'book_level') {
        // PC 2 (Book Level: Shots 3 to 7)
        // Automatically find next missing book shot among 3..7
        let nextBookShot = 3;
        for (let s = 3; s <= 7; s++) {
          if (!newShots[s]) {
            nextBookShot = s;
            break;
          }
        }
        if (newShots[3] && newShots[4] && newShots[5] && newShots[6] && newShots[7] && newShots[1] && newShots[2]) {
          setCurrentStep('COMPLETE');
          playAudioCue('success');
        } else {
          setCurrentStep(`CAPTURE_SHOT_${nextBookShot}` as CaptureStep);
        }
      } else {
        let firstMissing = 1;
        for (let s = 1; s <= 7; s++) {
          if (!newShots[s]) {
            firstMissing = s;
            break;
          }
        }
        setCurrentStep(`CAPTURE_SHOT_${firstMissing}` as CaptureStep);
      }

      fetchStatus();
      setTimeout(() => {
        isbnInputRef.current?.blur();
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      }, 50);
    } catch (err: any) {
      setToastAlert({
        message: err.message || 'Error initializing verification session',
        type: 'error'
      });
      playAudioCue('error');
    }
  };

  // Direct Box Selection handler (PC 1: Receiving / Box Level)
  const handleSelectBox = async (targetLot: string, targetBox: string) => {
    if (!targetBox) return;
    setToastAlert(null);
    playAudioCue('beep');

    try {
      const res = await fetch('/api/capture/init-box', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lotNumber: targetLot, boxNumber: targetBox })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to initialize box session');
      }

      setLotNumber(data.lotNumber || targetLot);
      setBoxNumber(data.boxNumber || targetBox);
      setActiveIsbn(data.sampleIsbn || `BOX_${targetBox}`);
      setIsbnInput('');
      setCurrentStep(data.currentStep);
      if (data.shots) {
        setShots(data.shots);
      }
      if (data.boxSummary) {
        setActiveBoxSummary(data.boxSummary);
      }

      if (data.currentStep === 'CAPTURE_SHOT_3') {
        setToastAlert({
          message: `📦 Box ${targetBox} already has Shot 1 & 2 saved! (${data.boxSummary?.totalBooks || 0} journals in manifest).`,
          type: 'info'
        });
      } else {
        setToastAlert({
          message: `📦 Selected Box ${targetBox} (${data.boxSummary?.totalBooks || 0} journals). Take Shot 1 (Box) & Shot 2 (Unbox).`,
          type: 'info'
        });
      }
      fetchBoxesList();
    } catch (err: any) {
      setToastAlert({
        message: err.message || 'Failed to select box',
        type: 'error'
      });
      playAudioCue('error');
    }
  };

  // Hardware scanner listener
  useBarcodeScanner({
    onScan: (scannedCode) => {
      handleProcessIsbn(scannedCode);
    },
    enabled: currentStep === 'SCAN_ISBN' || currentStep === 'COMPLETE'
  });

  // Save shot payload helper (1 to 7)
  const commitSaveShot = async (
    shotNumber: number, 
    base64Data: string, 
    blurScore?: number
  ) => {
    setIsCapturing(true);
    setToastAlert(null);

    try {
      const res = await fetch('/api/capture/save-shot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isbn: activeIsbn,
          shotNumber,
          imageBase64: base64Data,
          bookDetails,
          blurScore,
          lotNumber,
          boxNumber
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save shot');
      }

      const shotDef = SHOT_DEFINITIONS[shotNumber - 1];
      const newShotInfo: ShotInfo = {
        filename: data.filename,
        savedAt: new Date().toISOString(),
        type: shotDef.label,
        scope: shotDef.scope,
        previewDataUrl: base64Data,
        blurScore
      };

      const updatedShots = {
        ...shots,
        [shotNumber]: newShotInfo
      };

      setShots(updatedShots);

      if (data.isComplete) {
        setCurrentStep('COMPLETE');
        playAudioCue('success');
      } else if (stationRole === 'box_level' && shotNumber === 2) {
        // Shot 2 is complete on PC 1
        playAudioCue('success');
        setCurrentStep('CAPTURE_SHOT_3');
        setToastAlert({
          message: `📦 Box level completed for ${activeIsbn}! Shot 1 & 2 saved. PC 2 can now capture book shots.`,
          type: 'info'
        });
      } else if (stationRole === 'book_level') {
        let nextBookShot = 3;
        for (let s = 3; s <= 7; s++) {
          if (!updatedShots[s]) {
            nextBookShot = s;
            break;
          }
        }
        if (updatedShots[3] && updatedShots[4] && updatedShots[5] && updatedShots[6] && updatedShots[7]) {
          if (updatedShots[1] && updatedShots[2]) {
            setCurrentStep('COMPLETE');
            playAudioCue('success');
          } else {
            setCurrentStep('COMPLETE');
            playAudioCue('success');
            setToastAlert({
              message: `📖 Book level completed (Shots 3–7 saved)!`,
              type: 'info'
            });
          }
        } else {
          setCurrentStep(`CAPTURE_SHOT_${nextBookShot}` as CaptureStep);
        }
      } else {
        setCurrentStep(data.currentStep as CaptureStep);
      }

      if (data.metadata) {
        setMetadata(data.metadata);
      }
      fetchStatus();
    } catch (err: any) {
      setToastAlert({
        message: err.message || 'Failed to upload photo',
        type: 'error'
      });
      playAudioCue('error');
    } finally {
      setIsCapturing(false);
      setBlurWarning(null);
      if (pendingNextRef.current) {
        pendingNextRef.current = false;
        setTimeout(() => handleNextJournal(), 60);
      }
    }
  };

  // Handle Photo Capture
  const handleCapturePhoto = async () => {
    if (!activeIsbn || isCapturing) return;
    if (!currentStep.startsWith('CAPTURE_SHOT_')) return;

    const shotNumber = parseInt(currentStep.replace('CAPTURE_SHOT_', ''), 10);
    const shotDef = SHOT_DEFINITIONS[shotNumber - 1];

    const watermarkConfig = systemConfig?.watermarkEnabled !== false ? {
      isbn: activeIsbn,
      stationName: systemConfig?.watermarkStation || 'Station-01',
      shotLabel: `Shot ${shotNumber}: ${shotDef.label} (${shotDef.scope === 'box_level' ? 'Box Level' : 'Book Level'})`,
      timestamp: new Date().toLocaleString()
    } : null;

    const result = captureSnapshot({
      quality: systemConfig?.imageQuality || 0.95,
      watermark: watermarkConfig
    });

    if (!result) {
      setToastAlert({
        message: 'Could not capture frame from camera stream.',
        type: 'error'
      });
      return;
    }

    playAudioCue('shutter');

    if (result.isBlurry && systemConfig?.blurCheckEnabled !== false) {
      setBlurWarning({
        shotNumber,
        base64Data: result.base64Data,
        sharpnessScore: result.sharpnessScore
      });
      return;
    }

    await commitSaveShot(shotNumber, result.base64Data, result.sharpnessScore);
  };

  // Retake a specific shot (1 to 7)
  const handleRetakeShot = (shotNumber: number) => {
    playAudioCue('click');
    setCurrentStep(`CAPTURE_SHOT_${shotNumber}` as CaptureStep);
  };

  // Incomplete shots warning (Validation 4.1)
  const handleIncompleteWarning = () => {
    let captured = 0;
    for (let s = 1; s <= 7; s++) {
      if (shots[s]) captured++;
    }
    const locStr = lotNumber || boxNumber ? `[Lot: ${lotNumber || 'N/A'}${boxNumber ? ` • Box: ${boxNumber}` : ''}] ` : '';
    setToastAlert({
      message: `${locStr}Verification pictures for ISBN ${activeIsbn} are incomplete (${captured} of 7 shots). You cannot proceed to the next book until all 7 shots are taken.`,
      type: 'error'
    });
    playAudioCue('error');
  };

  // Discard current active session
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
    setLotNumber('');
    setBoxNumber('');
    setShots({ 1: null, 2: null, 3: null, 4: null, 5: null, 6: null, 7: null });
    setMetadata(null);
    setBookDetails(null);
    setToastAlert(null);
    setDuplicateModal(null);
    setBlurWarning(null);
    setCurrentStep('SCAN_ISBN');
    fetchStatus();
    setTimeout(() => isbnInputRef.current?.focus(), 150);
  };

  // Reset to next journal (Validation 4.1 enforced)
  const handleNextJournal = () => {
    if (isCapturing) {
      pendingNextRef.current = true;
      return;
    }

    let captured = 0;
    for (let s = 1; s <= 7; s++) {
      if (shots[s]) captured++;
    }

    if (stationRole === 'box_level') {
      // PC 1 requires Shot 1 & Shot 2
      if (!shots[1] || !shots[2]) {
        setToastAlert({
          message: `Please capture both Shot 1 (Box) and Shot 2 (Unbox) before proceeding on PC 1.`,
          type: 'error'
        });
        playAudioCue('error');
        return;
      }
    } else if (stationRole === 'book_level') {
      // PC 2 requires Shots 3 to 7
      if (!shots[3] || !shots[4] || !shots[5] || !shots[6] || !shots[7]) {
        handleIncompleteWarning();
        return;
      }
    } else {
      const hasAllBookShots = Boolean(shots[3] && shots[4] && shots[5] && shots[6] && shots[7]);
      if (captured < 7 && !hasAllBookShots) {
        handleIncompleteWarning();
        return;
      }
    }

    // Automatically ensure S3 upload is triggered when clicking Next Journal
    if (activeIsbn && captured > 0) {
      fetch('/api/s3/upload-isbn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isbn: activeIsbn })
      }).catch(err => console.error('[S3 Upload on Next] Error:', err));
    }

    playAudioCue('click');
    resetRemoteSession({
      clearBoxContext: stationRole === 'box_level',
      lotNumber,
      boxNumber
    });
    setActiveIsbn('');
    setIsbnInput('');
    if (isbnInputRef.current) {
      isbnInputRef.current.value = '';
    }
    // For PC 1 (box_level), Next means proceeding to the next box.
    // For PC 2 (book_level) and Standalone, keep active lotNumber & boxNumber so the box context
    // and inherited Box / Unbox shots stay active for the remaining journals in this box!
    if (stationRole === 'box_level') {
      setLotNumber('');
      setBoxNumber('');
      setActiveBoxSummary(null);
    }
    setShots({ 1: null, 2: null, 3: null, 4: null, 5: null, 6: null, 7: null });
    setMetadata(null);
    setBookDetails(null);
    setToastAlert(null);
    setDuplicateModal(null);
    setBlurWarning(null);
    setCurrentStep('SCAN_ISBN');
    fetchStatus();
    setTimeout(() => {
      isbnInputRef.current?.focus();
    }, 100);
  };

  // Open Explorer
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

  // Global Keyboard shortcuts: Spacebar to capture photo, Enter to proceed to Next Journal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      // Enter key: When session is complete or box level is done, proceed to Next Journal in 1 single press!
      if (e.key === 'Enter') {
        const hasAllBookShots = Boolean(shots[3] && shots[4] && shots[5] && shots[6] && shots[7]);
        const hasBoxShots = Boolean(shots[1] && shots[2]);
        const isReadyForNext = currentStep === 'COMPLETE' ||
          (stationRole === 'box_level' && (currentStep === 'CAPTURE_SHOT_3' || hasBoxShots)) ||
          (hasAllBookShots && !currentStep.startsWith('CAPTURE_SHOT_')) ||
          (isCapturing && (currentStep === 'CAPTURE_SHOT_7' || (stationRole === 'box_level' && currentStep === 'CAPTURE_SHOT_2')));

        if (activeIsbn && isReadyForNext) {
          e.preventDefault();
          e.stopPropagation();
          handleNextJournal();
          return;
        }
      }

      if (isInput) return;

      // Spacebar key: Capture photo
      if (e.code === 'Space') {
        if (currentStep.startsWith('CAPTURE_SHOT_')) {
          e.preventDefault();
          handleCapturePhoto();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [currentStep, activeIsbn, isCapturing, isStreaming, stationRole, shots, handleNextJournal, handleCapturePhoto]);

  // Count captured shots
  let totalCapturedShots = 0;
  for (let s = 1; s <= 7; s++) {
    if (shots[s]) totalCapturedShots++;
  }

  return (
    <div className="min-h-screen ambient-bg flex flex-col font-sans">
      
      {/* Top Navbar */}
      <Navbar
        viewMode={viewMode}
        setViewMode={setViewMode}
        stationRole={stationRole}
        setStationRole={setStationRole}
        systemStatus={systemStatus}
        manifestItemCount={manifestCount}
        onOpenQuickSearch={() => setQuickSearchOpen(true)}
        onOpenManifestModal={() => setManifestModalOpen(true)}
        onOpenSettings={() => setSettingsModalOpen(true)}
        onOpenMobilePairing={() => setMobilePairingOpen(true)}
        onOpenStorageFolder={() => handleOpenExplorer()}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col gap-6 relative">
        
        {/* Floating Red Toast Notification */}
        {toastAlert && (
          <div className="fixed top-20 right-4 sm:right-8 z-50 max-w-md w-full animate-slide-down">
            <div className="bg-[#e11d48] text-white p-4 rounded-2xl shadow-2xl flex items-start space-x-3 border border-red-400/30">
              <div className="p-1 rounded-lg bg-white/20 shrink-0 mt-0.5">
                <AlertTriangle className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 text-xs font-semibold leading-relaxed">
                {toastAlert.message}
              </div>
              <button
                onClick={() => setToastAlert(null)}
                className="p-1 text-white/80 hover:text-white rounded-lg hover:bg-white/20 transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Conditional Rendering: Capture Mode vs Search & View Catalog */}
        {viewMode === 'SEARCH_VIEW' ? (
          <div key="search-view-panel" className="w-full animate-page-transition">
            <SearchViewCatalog
              onSelectIsbnForCapture={(isbn) => {
                setViewMode('CAPTURE');
                handleProcessIsbn(isbn);
              }}
              onOpenExplorer={handleOpenExplorer}
              onDownloadZip={handleDownloadZip}
            />
          </div>
        ) : (
          /* Capture Workflow with smooth page transition and role transition */
          <div key={`capture-panel-${stationRole}`} className="w-full space-y-6 animate-page-transition">
            
            {/* Card 1: Receiving & Verification Setup */}
            <div className="white-card rounded-2xl p-6 space-y-4 transition-all duration-300">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start space-x-3.5">
                  <div className={`w-10 h-10 rounded-xl text-white flex items-center justify-center shadow-md shrink-0 mt-0.5 transition-all duration-300 ${
                    stationRole === 'box_level' 
                      ? 'bg-gradient-to-br from-blue-600 to-blue-700 shadow-blue-500/25' 
                      : stationRole === 'book_level'
                        ? 'bg-gradient-to-br from-indigo-600 to-indigo-700 shadow-indigo-500/25'
                        : 'bg-gradient-to-br from-emerald-600 to-teal-700 shadow-emerald-500/25'
                  }`}>
                    {stationRole === 'box_level' ? <Package className="w-5 h-5 animate-pulse" /> : stationRole === 'book_level' ? <Scan className="w-5 h-5 animate-pulse" /> : <Layers className="w-5 h-5 animate-pulse" />}
                  </div>
                  <div className="space-y-0.5">
                    <div className="flex items-center space-x-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-brand-700">
                        RECEIVING & VERIFICATION
                      </span>
                      <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border shadow-xs transition-all duration-300 ${
                        stationRole === 'box_level' 
                          ? 'bg-blue-50 text-blue-800 border-blue-300 ring-2 ring-blue-500/10'
                          : stationRole === 'book_level'
                            ? 'bg-indigo-50 text-indigo-800 border-indigo-300 ring-2 ring-indigo-500/10'
                            : 'bg-emerald-50 text-emerald-800 border-emerald-300 ring-2 ring-emerald-500/10'
                      }`}>
                        {stationRole === 'box_level' ? '📦 PC 1: Station 1 (Box Level)' : stationRole === 'book_level' ? '📖 PC 2: Station 2 (Book Level)' : '⚡ Full Station (Box + Books)'}
                      </span>
                    </div>
                    <h3 className="text-base font-extrabold text-slate-900 transition-all duration-300">
                      {stationRole === 'box_level' 
                        ? 'PC 1: Select or Scan Box to Photograph (Shots 1 & 2)' 
                        : stationRole === 'book_level'
                          ? 'PC 2: Scan Individual Journal (Shots 3 to 7)'
                          : 'Full Station: Complete Verification (Shots 1 to 7)'}
                    </h3>
                    <p className="text-xs text-slate-500 transition-all duration-300">
                      {stationRole === 'box_level'
                        ? 'Photograph the box and unboxed books once. All journals in this box will automatically inherit these photos on PC 2.'
                        : stationRole === 'book_level'
                          ? 'Box & Unbox photos from PC 1 are automatically attached. Proceed directly with Shots 3 to 7 for each journal.'
                          : 'Performs complete Box + Book verification (Shots 1 to 7). Running PC 1 and PC 2 simultaneously in this mode doubles total throughput!'}
                    </p>
                  </div>
                </div>

                {/* Manifest Status Indicator & Box Stats */}
                <div className="flex flex-wrap items-center gap-2">
                  {boxesList.length > 0 && (
                    <span className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-800 border border-blue-200 shadow-xs">
                      <Package className="w-3.5 h-3.5 text-blue-600" />
                      <span>{boxesList.length} Boxes Detected</span>
                    </span>
                  )}
                  {manifestCount > 0 && (
                    <button
                      onClick={() => setManifestModalOpen(true)}
                      className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold bg-gradient-to-r from-emerald-50 to-teal-50 text-emerald-700 border border-emerald-300 shadow-xs hover:bg-emerald-100 transition-colors cursor-pointer"
                      title="View Active Manifest"
                    >
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                      <span>Manifest Active ({manifestCount} items)</span>
                    </button>
                  )}
                </div>
              </div>

              {/* PC 1 Dedicated Box Selector Bar */}
              {stationRole === 'box_level' && boxesList.length > 0 && (
                <div className="p-3 bg-blue-50/70 border border-blue-200/80 rounded-2xl flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                  <div className="flex items-center space-x-2 text-xs font-bold text-brand-800 shrink-0">
                    <Package className="w-4 h-4 text-brand-600" />
                    <span>Quick Select Box:</span>
                  </div>
                  <select
                    value={boxNumber ? `${lotNumber}__${boxNumber}` : ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (!val) return;
                      const [l, b] = val.split('__');
                      handleSelectBox(l, b);
                    }}
                    className="flex-1 bg-white text-slate-800 font-medium text-xs rounded-xl px-3 py-2 border border-blue-300 outline-none focus:ring-2 focus:ring-brand-500 cursor-pointer shadow-xs"
                  >
                    <option value="">-- Choose a Box from Manifest ({boxesList.length} boxes available) --</option>
                    {boxesList.map((b) => (
                      <option key={b.boxKey} value={`${b.lotNumber}__${b.boxNumber}`}>
                        📦 Box {b.boxNumber} ({b.totalBooks} books {b.completedBooks > 0 ? `• ${b.completedBooks} verified` : ''}) - Lot: {b.lotNumber} {b.hasBoxShot && b.hasUnboxShot ? '✓ (Photos Done)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  isbnInputRef.current?.blur();
                  if (document.activeElement instanceof HTMLElement) {
                    document.activeElement.blur();
                  }
                  handleProcessIsbn(isbnInput);
                }}
                className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-1"
              >
                {/* Lot Number (Read-Only / Auto from Manifest) */}
                <div className="sm:w-44 shrink-0">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-600 mb-1 flex items-center justify-between">
                    <span>LOT NUMBER</span>
                    <span className="text-[9px] font-medium text-slate-400">Auto</span>
                  </label>
                  <div className="relative flex items-center">
                    <input
                      type="text"
                      value={lotNumber || ''}
                      readOnly
                      placeholder="Auto (Manifest)"
                      title="Lot Number is automatically loaded from your uploaded manifest"
                      className="w-full pl-4 pr-8 py-2.5 text-xs font-bold font-mono text-brand-900 bg-blue-50/50 border border-blue-200/70 rounded-full outline-none cursor-not-allowed placeholder:text-slate-400 placeholder:font-normal select-all shadow-inner"
                    />
                    <Lock className="w-3.5 h-3.5 text-brand-400 absolute right-3 pointer-events-none" />
                  </div>
                </div>

                {/* Box Number (Read-Only / Auto from Manifest) */}
                <div className="sm:w-44 shrink-0">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-600 mb-1 flex items-center justify-between">
                    <span>BOX NUMBER</span>
                    <span className="text-[9px] font-medium text-slate-400">Auto</span>
                  </label>
                  <div className="relative flex items-center">
                    <input
                      type="text"
                      value={boxNumber || ''}
                      readOnly
                      placeholder="Auto (Manifest)"
                      title="Box Number is automatically loaded from your uploaded manifest"
                      className="w-full pl-4 pr-8 py-2.5 text-xs font-bold font-mono text-indigo-900 bg-indigo-50/50 border border-indigo-200/70 rounded-full outline-none cursor-not-allowed placeholder:text-slate-400 placeholder:font-normal select-all shadow-inner"
                    />
                    <Lock className="w-3.5 h-3.5 text-indigo-400 absolute right-3 pointer-events-none" />
                  </div>
                </div>

                {/* ISBN Scan Input */}
                <div className="flex-1">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-600 mb-1">
                    {stationRole === 'box_level' ? 'SCAN ANY ISBN IN BOX OR TYPE BOX' : 'JOURNAL ISBN / BARCODE'}
                  </label>
                  <div className="relative">
                    <Barcode className="w-4 h-4 text-brand-500 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      ref={isbnInputRef}
                      type="text"
                      value={isbnInput}
                      onChange={(e) => {
                        const val = e.target.value;
                        setIsbnInput(val);
                        if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
                        if (val.trim().length >= 8) {
                          scanTimeoutRef.current = setTimeout(() => {
                            if (currentStep === 'SCAN_ISBN' && val.trim() === isbnInputRef.current?.value.trim()) {
                              isbnInputRef.current?.blur();
                              if (document.activeElement instanceof HTMLElement) {
                                document.activeElement.blur();
                              }
                              handleProcessIsbn(val.trim());
                            }
                          }, 120);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const hasAllBookShots = Boolean(shots[3] && shots[4] && shots[5] && shots[6] && shots[7]);
                          const hasBoxShots = Boolean(shots[1] && shots[2]);
                          const isReadyForNext = currentStep === 'COMPLETE' ||
                            (stationRole === 'box_level' && (currentStep === 'CAPTURE_SHOT_3' || hasBoxShots)) ||
                            (hasAllBookShots && !currentStep.startsWith('CAPTURE_SHOT_'));

                          if (activeIsbn && isReadyForNext) {
                            handleNextJournal();
                          } else if (isbnInput.trim()) {
                            isbnInputRef.current?.blur();
                            if (document.activeElement instanceof HTMLElement) {
                              document.activeElement.blur();
                            }
                            handleProcessIsbn(isbnInput.trim());
                          }
                        }
                      }}
                      placeholder={stationRole === 'box_level' ? "Scan any book barcode from box to auto-select box..." : "Scan barcode or type ISBN (e.g. 9780132350884)..."}
                      className="w-full pl-10 pr-24 py-2.5 text-xs font-mono text-slate-900 input-smooth rounded-full outline-none placeholder:text-slate-400"
                    />
                    {isbnInput && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsbnInput('');
                          isbnInputRef.current?.focus();
                        }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 rounded-md transition-colors cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Start Verification Button */}
                <div className="sm:self-end shrink-0">
                  <button
                    type="submit"
                    className="w-full sm:w-auto inline-flex items-center justify-center space-x-2 px-8 py-2.5 rounded-full font-bold text-xs text-white btn-primary-gradient cursor-pointer active:scale-95 shadow-md shadow-brand-500/20"
                  >
                    <Scan className="w-4 h-4" />
                    <span>Start Verification</span>
                  </button>
                </div>
              </form>

              {/* Bibliographic Info Row & Auto-Matched Lot/Box if ISBN is Active */}
              {activeIsbn && (
                <div className="pt-3 border-t border-blue-100 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {/* Auto-detected Lot and Box Badges */}
                    {lotNumber && (
                      <span className="inline-flex items-center gap-1 font-bold text-brand-800 bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded-lg shadow-xs font-mono">
                        {lotNumber}
                      </span>
                    )}
                    {boxNumber && (
                      <span className="inline-flex items-center gap-1 font-bold text-indigo-800 bg-indigo-50 border border-indigo-200 px-2.5 py-0.5 rounded-lg shadow-xs font-mono">
                        Box: {boxNumber}
                      </span>
                    )}

                    <div className="flex flex-wrap items-center gap-1.5 text-slate-700">
                      <BookOpen className="w-4 h-4 text-brand-700 shrink-0" />
                      {isLookingUpMeta ? (
                        <span className="text-slate-500 animate-pulse">Looking up journal details...</span>
                      ) : bookDetails?.title ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-bold text-slate-800">
                            {bookDetails.title} {bookDetails.authors ? `— ${bookDetails.authors}` : ''}
                          </span>
                          {bookDetails.volume && (
                            <span className="px-1.5 py-0.2 rounded bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-semibold">
                              Vol: {bookDetails.volume}
                            </span>
                          )}
                          {bookDetails.issues && (
                            <span className="px-1.5 py-0.2 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-semibold">
                              Issue: {bookDetails.issues}
                            </span>
                          )}
                          {bookDetails.publishYear && (
                            <span className="px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 border border-slate-200 text-[10px] font-semibold">
                              {bookDetails.publishYear}
                            </span>
                          )}
                          {bookDetails.printIssn && (
                            <span className="px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-mono font-semibold">
                              ISSN: {bookDetails.printIssn}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-500 font-mono">Target: {activeIsbn}</span>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={() => handleProcessIsbn(activeIsbn, true)}
                    className="text-[11px] font-bold text-brand-700 hover:underline flex items-center space-x-1 shrink-0 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Add Another Copy</span>
                  </button>
                </div>
              )}
            </div>

            {/* Step Progress Bar for 7 Shots */}
            <StepProgressBar
              currentStep={currentStep}
              isbn={activeIsbn}
              shotsCount={totalCapturedShots}
              stationRole={stationRole}
              boxShotsInherited={Boolean(shots[1] && shots[2] && (stationRole === 'book_level' || metadata?.shots?.[1]?.inheritedFromBox))}
            />

            {/* Viewfinder & Review Card Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              
              {/* Left Column: Viewfinder (7 cols) */}
              <div className="lg:col-span-7 flex flex-col gap-4">
                <CameraViewfinder
                  videoRef={videoRef}
                  isStreaming={isStreaming}
                  cameraError={cameraError}
                  devices={devices}
                  selectedDeviceId={selectedDeviceId}
                  boxCameraDeviceId={boxCameraDeviceId}
                  bookCameraDeviceId={bookCameraDeviceId}
                  autoSwitchCamera={autoSwitchCamera}
                  onSwitchCamera={switchCamera}
                  onQuickSwitchCamera={quickSwitchCamera}
                  onToggleAutoSwitch={() => setAutoSwitchCamera(!autoSwitchCamera)}
                  onCapture={handleCapturePhoto}
                  onRetakeShot={handleRetakeShot}
                  currentStep={currentStep}
                  resolution={resolution}
                  isCapturing={isCapturing}
                  stationRole={stationRole}
                  isBoxLevelDone={Boolean(shots[1] && shots[2])}
                  hasBoxShots={Boolean(shots[1] && shots[2])}
                  onNextJournal={handleNextJournal}
                  hasTorch={hasTorch}
                  isTorchOn={isTorchOn}
                  onToggleTorch={toggleTorch}
                  rotation={rotation}
                  flipHorizontal={flipHorizontal}
                  flipVertical={flipVertical}
                  onRotate={rotateCamera}
                  onToggleFlipH={toggleFlipHorizontal}
                  onToggleFlipV={toggleFlipVertical}
                  onResetOrientation={resetOrientation}
                />
              </div>

              {/* Right Column: 7-Shots Review Card (5 cols) */}
              <div className="lg:col-span-5 flex flex-col gap-4">
                {activeIsbn ? (
                  <ReviewCard
                    isbn={activeIsbn}
                    lotNumber={lotNumber}
                    boxNumber={boxNumber}
                    shots={shots}
                    metadata={metadata}
                    stationRole={stationRole}
                    boxSummary={activeBoxSummary}
                    onRetakeShot={handleRetakeShot}
                    onOpenExplorer={handleOpenExplorer}
                    onDownloadZip={handleDownloadZip}
                    onNextJournal={handleNextJournal}
                    onDiscardSession={handleDiscardSession}
                    onIncompleteWarning={handleIncompleteWarning}
                  />
                ) : (
                  <div className="white-card rounded-2xl p-8 flex flex-col items-center justify-center text-center text-slate-400 min-h-[380px]">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-100 text-brand-700 flex items-center justify-center mb-4 border border-blue-200/80 shadow-inner">
                      <ShieldCheck className="w-8 h-8 text-brand-600" />
                    </div>
                    <h3 className="font-extrabold text-base text-slate-800 mb-1">
                      Ready for Verification Capture
                    </h3>
                    <p className="text-xs text-slate-500 max-w-sm mb-4">
                      Scan an ISBN barcode to take all 7 required verification photos. Lot and Box numbers are automatically detected from the manifest.
                    </p>
                    <div className="space-y-1.5 text-left text-[11px] bg-gradient-to-b from-blue-50/60 to-indigo-50/40 p-3.5 rounded-xl border border-blue-100 font-medium text-slate-700 w-full max-w-sm shadow-sm">
                      <div className="font-bold text-brand-700 mb-1">7 Required Verification Shots:</div>
                      <div>1. 📦 Books in a Box (Box Level)</div>
                      <div>2. 📦 Unbox Books (Box Level)</div>
                      <div>3. 📖 Front Cover (Book Level)</div>
                      <div>4. 📖 Spine & Volume (Book Level)</div>
                      <div>5. 📖 Title Page & Authors (Book Level)</div>
                      <div>6. 📖 Front Matter (Edition / Copyright / ISSN)</div>
                      <div>7. 📖 Back of Journal (Back Cover / Barcode)</div>
                    </div>
                  </div>
                )}
              </div>

            </div>

          </div>
        )}

      </main>

      {/* Quick Search Modal (Ctrl+K) */}
      {quickSearchOpen && (
        <div 
          className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
          onClick={() => setQuickSearchOpen(false)}
        >
          <div 
            className="w-full max-w-xl modal-card rounded-2xl p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative">
              <Search className="w-4 h-4 text-brand-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                ref={quickSearchInputRef}
                type="text"
                value={quickSearchText}
                onChange={(e) => setQuickSearchText(e.target.value)}
                placeholder="Type ISBN or Lot to search or jump to capture..."
                className="w-full pl-10 pr-4 py-2.5 text-sm input-smooth rounded-xl outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && quickSearchText.trim()) {
                    setQuickSearchOpen(false);
                    setViewMode('CAPTURE');
                    handleProcessIsbn(quickSearchText.trim());
                  }
                }}
              />
            </div>

            <div className="flex items-center justify-between text-xs text-slate-400 px-1">
              <span>Press <kbd className="font-mono bg-white px-2 py-0.5 rounded-md border border-slate-200 text-slate-600 font-semibold shadow-xs">Enter</kbd> to start verification</span>
              <button
                onClick={() => {
                  setQuickSearchOpen(false);
                  setViewMode('SEARCH_VIEW');
                }}
                className="text-brand-700 font-bold hover:underline cursor-pointer"
              >
                Browse Lots & Boxes &rarr;
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Duplicate Copy Modal */}
      {duplicateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md rounded-2xl modal-card p-6 space-y-4">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 rounded-xl bg-purple-50 text-purple-700 border border-purple-200">
                <Layers className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-slate-900">
                  Existing Copy Detected
                </h3>
                <p className="text-xs text-slate-500">
                  ISBN: <span className="font-mono font-bold text-slate-800">{duplicateModal.baseIsbn}</span>
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-600">
              This ISBN already has <b>{duplicateModal.existingCopies.length}</b> verified record(s). How would you like to proceed?
            </p>

            <div className="space-y-2">
              <button
                onClick={() => handleProcessIsbn(duplicateModal.baseIsbn, true)}
                className="w-full p-3 rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50/70 to-indigo-50/50 hover:from-blue-100 hover:to-indigo-100 text-left flex items-center justify-between transition-colors cursor-pointer"
              >
                <div>
                  <div className="text-xs font-bold text-brand-700 flex items-center gap-1.5">
                    <Plus className="w-3.5 h-3.5" />
                    <span>Capture as New Copy (Copy #{duplicateModal.existingCopies.length + 1})</span>
                  </div>
                  <span className="text-[11px] text-slate-500">
                    Creates folder <code className="font-mono">{duplicateModal.baseIsbn}_Copy{duplicateModal.existingCopies.length + 1}</code>
                  </span>
                </div>
                <ArrowRight className="w-4 h-4 text-brand-700" />
              </button>

              <button
                onClick={() => {
                  const target = duplicateModal.existingCopies[0]?.identifier || duplicateModal.baseIsbn;
                  handleProcessIsbn(duplicateModal.baseIsbn, false, target);
                }}
                className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50/80 hover:bg-slate-100 text-left flex items-center justify-between transition-colors cursor-pointer"
              >
                <div>
                  <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <Eye className="w-3.5 h-3.5 text-slate-500" />
                    <span>Review / Inspect Existing (Copy #1)</span>
                  </div>
                  <span className="text-[11px] text-slate-500">
                    Open existing proof records
                  </span>
                </div>
                <ArrowRight className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setDuplicateModal(null)}
                className="px-4 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Blur Sharpness Warning */}
      {blurWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-lg rounded-2xl modal-card p-6 space-y-4">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 rounded-xl bg-amber-50 text-amber-600 border border-amber-200">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-slate-900">
                  Potential Blur / Low Sharpness
                </h3>
                <p className="text-xs text-slate-500">
                  Sharpness Score: {blurWarning.sharpnessScore.toFixed(1)} (Below recommended threshold)
                </p>
              </div>
            </div>

            <div className="aspect-[4/3] w-full rounded-xl overflow-hidden bg-black border border-slate-200 shadow-inner">
              <img src={blurWarning.base64Data} alt="Blur Preview" className="w-full h-full object-contain" />
            </div>

            <p className="text-xs text-slate-600">
              This photo may be blurry. Please ensure the book text is sharp and in focus before proceeding.
            </p>

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                onClick={() => setBlurWarning(null)}
                className="px-4 py-2 text-xs font-bold text-slate-700 btn-secondary-gradient rounded-xl cursor-pointer"
              >
                Retake Shot
              </button>
              <button
                onClick={() => commitSaveShot(blurWarning.shotNumber, blurWarning.base64Data, blurWarning.sharpnessScore)}
                className="px-5 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-500 rounded-xl transition-colors cursor-pointer shadow-sm"
              >
                Accept Anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manifest Import Modal */}
      <ManifestImportModal
        isOpen={manifestModalOpen}
        onClose={() => setManifestModalOpen(false)}
        onManifestUpdated={fetchStatus}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
        config={systemConfig}
        currentStationRole={stationRole}
        devices={devices}
        boxCameraDeviceId={boxCameraDeviceId}
        bookCameraDeviceId={bookCameraDeviceId}
        autoSwitchCamera={autoSwitchCamera}
        rotation={rotation}
        flipHorizontal={flipHorizontal}
        flipVertical={flipVertical}
        onRotationChange={setRotation}
        onFlipHorizontalChange={setFlipHorizontal}
        onFlipVerticalChange={setFlipVertical}
        onStationRoleChange={setStationRole}
        onBoxCameraChange={setBoxCameraDeviceId}
        onBookCameraChange={setBookCameraDeviceId}
        onAutoSwitchCameraChange={setAutoSwitchCamera}
        onConfigSaved={(newCfg) => setSystemConfig(newCfg)}
      />

      {/* Mobile Pairing Modal */}
      <MobilePairingModal
        isOpen={mobilePairingOpen}
        onClose={() => setMobilePairingOpen(false)}
        systemStatus={systemStatus}
      />

    </div>
  );
}
