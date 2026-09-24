import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { 
  FolderOpen, 
  Download, 
  Copy, 
  Check, 
  RotateCcw, 
  CheckCircle2, 
  ArrowRight, 
  Package,
  Layers, 
  BookOpen, 
  Bookmark,
  FileText,
  Scroll,
  BookCheck,
  Trash2,
  AlertTriangle,
  Lock,
  CloudUpload
} from 'lucide-react';
import { JournalMetadata, ShotInfo, SHOT_DEFINITIONS, StationRole, BoxSummary, CaptureStep } from '../types';

interface ReviewCardProps {
  isbn: string;
  lotNumber?: string;
  boxNumber?: string;
  shots: Record<number, ShotInfo | null>;
  metadata: JournalMetadata | null;
  stationRole?: StationRole;
  boxSummary?: BoxSummary | null;
  currentStep?: CaptureStep;
  onRetakeShot: (shotNumber: number) => void;
  onOpenExplorer: (isbn: string) => void;
  onDownloadZip: (isbn: string) => void;
  onNextJournal: () => void;
  onDiscardSession?: () => void;
  onIncompleteWarning?: () => void;
}

export const ReviewCard: React.FC<ReviewCardProps> = ({
  isbn,
  lotNumber,
  boxNumber,
  shots,
  metadata,
  stationRole = 'book_level',
  boxSummary,
  currentStep,
  onRetakeShot,
  onOpenExplorer,
  onDownloadZip,
  onNextJournal,
  onDiscardSession,
  onIncompleteWarning
}) => {
  const [copied, setCopied] = useState(false);
  const [copiedS3, setCopiedS3] = useState(false);
  const [selectedPreview, setSelectedPreview] = useState<string | null>(null);
  const [showBooksList, setShowBooksList] = useState(false);

  // Count captured shots
  let shotsCount = 0;
  for (let s = 1; s <= 7; s++) {
    if (shots[s]) shotsCount++;
  }

  const isComplete = shotsCount >= 7;
  const isBoxLevelDone = Boolean(shots[1] && shots[2]);
  const isBookLevelDone = Boolean(shots[3] && shots[4] && shots[5] && shots[6] && shots[7]);
  const isBoxSpineDone = Boolean(shots[1] && shots[2] && shots[4]);
  const canProceed = stationRole === 'box_level' 
    ? isBoxLevelDone 
    : stationRole === 'box_spine'
      ? isBoxSpineDone
      : (stationRole === 'book_level' ? isBookLevelDone : (isComplete || isBookLevelDone));
  const [isUploadingS3, setIsUploadingS3] = useState(false);

  const handleCopyPath = () => {
    if (!isbn) return;
    const path = `C:\\Journal_Proofs\\${isbn}`;
    navigator.clipboard.writeText(path);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyS3 = () => {
    const link = metadata?.s3Upload?.shareableLink || metadata?.s3Upload?.s3FolderUri;
    if (!link) return;
    navigator.clipboard.writeText(link);
    setCopiedS3(true);
    setTimeout(() => setCopiedS3(false), 2500);
  };

  const handleTriggerManualS3 = async () => {
    if (!isbn) return;
    setIsUploadingS3(true);
    try {
      const res = await fetch('/api/s3/upload-isbn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isbn })
      });
      const data = await res.json();
      if (!res.ok) {
        alert('S3 Upload Failed: ' + (data.error || 'Server error'));
      }
    } catch (err: any) {
      alert('S3 Upload Network Error: ' + err.message);
    } finally {
      setIsUploadingS3(false);
    }
  };

  const handleNextClick = () => {
    onNextJournal();
  };

  const getShotIcon = (shotNum: number) => {
    switch (shotNum) {
      case 1: return Package;
      case 2: return Layers;
      case 3: return BookOpen;
      case 4: return Bookmark;
      case 5: return FileText;
      case 6: return Scroll;
      case 7: return BookCheck;
      default: return BookOpen;
    }
  };

  const isBoxSession = isbn.startsWith('BOX_') || stationRole === 'box_level';

  return (
    <div className="w-full white-card rounded-2xl p-5 shadow-sm space-y-4 animate-fade-in">
      
      {/* Header Info */}
      <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-blue-100">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-brand-700 badge-soft-blue px-2.5 py-0.5 rounded-lg shadow-sm">
              {lotNumber || 'Unassigned Lot'} {boxNumber ? `• Box ${boxNumber}` : ''}
            </span>
            {boxSummary && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                📦 {boxSummary.totalBooks} Journals in Manifest
              </span>
            )}
            {metadata?.copyNumber && metadata.copyNumber > 1 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gradient-to-r from-purple-50 to-indigo-50 text-purple-800 border border-purple-200">
                Copy #{metadata.copyNumber}
              </span>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <h3 className="text-xl font-extrabold text-slate-900 font-mono tracking-tight">
              {isBoxSession ? `Box ${boxNumber || isbn}` : isbn}
            </h3>
            {isComplete ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-bold bg-gradient-to-r from-emerald-50 to-teal-50 text-emerald-700 border border-emerald-300/80 shadow-sm">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                Completed (7/7)
              </span>
            ) : stationRole === 'box_level' ? (
              isBoxLevelDone ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-bold bg-gradient-to-r from-blue-50 to-emerald-50 text-blue-800 border border-blue-300/80 shadow-sm">
                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" />
                  Box Level Done (2/2) • Ready for PC 2
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-bold bg-gradient-to-r from-amber-50 to-yellow-50 text-amber-800 border border-amber-300/80 shadow-sm">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                  Box Level ({shotsCount > 2 ? 2 : shotsCount}/2)
                </span>
              )
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-bold bg-gradient-to-r from-amber-50 to-yellow-50 text-amber-800 border border-amber-300/80 shadow-sm">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                Incomplete ({shotsCount}/7)
              </span>
            )}
          </div>

          {metadata?.bookDetails?.title && (
            <div className="space-y-1">
              <p className="text-xs font-bold text-slate-800">
                {metadata.bookDetails.title} {metadata.bookDetails.authors ? `— ${metadata.bookDetails.authors}` : ''}
              </p>
              <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                {metadata.bookDetails.volume && (
                  <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200 font-semibold">
                    Vol: {metadata.bookDetails.volume}
                  </span>
                )}
                {metadata.bookDetails.issues && (
                  <span className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 font-semibold">
                    Issue: {metadata.bookDetails.issues}
                  </span>
                )}
                {metadata.bookDetails.publishYear && (
                  <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200 font-semibold">
                    Year: {metadata.bookDetails.publishYear}
                  </span>
                )}
                {metadata.bookDetails.printIssn && (
                  <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono font-semibold">
                    ISSN: {metadata.bookDetails.printIssn}
                  </span>
                )}
                {metadata.bookDetails.publisher && (
                  <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-medium truncate max-w-xs">
                    {metadata.bookDetails.publisher}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Top Actions: Discard & Next Book */}
        <div className="flex items-center space-x-2">
          {onDiscardSession && (
            <button
              onClick={onDiscardSession}
              title="Discard this session"
              className="inline-flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-rose-700 bg-gradient-to-b from-rose-50 to-red-50/60 hover:from-rose-100 hover:to-rose-50 border border-rose-200/80 transition-all active:scale-95 shadow-sm"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Discard / Fix</span>
            </button>
          )}

          <button
            onClick={handleNextClick}
            className={`inline-flex items-center space-x-2 px-6 py-2 rounded-xl text-xs font-bold transition-all ${
              canProceed
                ? 'text-white btn-primary-gradient active:scale-95 cursor-pointer shadow-md'
                : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
            }`}
          >
            {!canProceed && <Lock className="w-3.5 h-3.5 mr-0.5 text-slate-400" />}
            <span>{stationRole === 'box_level' ? 'Proceed to Next Box (Enter ↵)' : 'Next Book (Enter ↵)'}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Box Books Counter / Drawer banner */}
      {boxSummary && boxSummary.totalBooks > 0 && (
        <div className="p-3 bg-gradient-to-r from-blue-50/80 to-indigo-50/50 rounded-xl border border-blue-200/80 text-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Package className="w-4 h-4 text-brand-600 shrink-0" />
              <span className="font-bold text-slate-800">
                Box {boxNumber} contains <span className="text-brand-700 font-extrabold">{boxSummary.totalBooks} Journals</span> in Manifest
              </span>
            </div>
            {boxSummary.books && boxSummary.books.length > 0 && (
              <button
                onClick={() => setShowBooksList(!showBooksList)}
                className="text-[11px] font-bold text-brand-700 hover:underline cursor-pointer"
              >
                {showBooksList ? 'Hide Journal List ▲' : `View ${boxSummary.totalBooks} Journals ▼`}
              </button>
            )}
          </div>

          {showBooksList && boxSummary.books && (
            <div className="mt-2.5 pt-2 border-t border-blue-200/60 max-h-48 overflow-y-auto space-y-1 pr-1">
              {boxSummary.books.map((b, idx) => (
                <div key={idx} className="flex items-center justify-between py-1 px-2 rounded-lg bg-white/80 border border-blue-100 text-[11px]">
                  <span className="font-mono font-bold text-slate-800">{b.isbn}</span>
                  <span className="text-slate-600 truncate max-w-xs">{b.title || 'Untitled Journal'}</span>
                  <span className="text-[10px] font-semibold text-slate-400">#{idx + 1}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 7 Shots Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {SHOT_DEFINITIONS.map((def) => {
          const shotInfo = shots[def.shotNumber];
          const Icon = getShotIcon(def.shotNumber);
          const hasImage = Boolean(shotInfo?.previewDataUrl || shotInfo?.filename);
          const isCurrentlyRetaking = currentStep === def.id && hasImage;
          const isCurrentPending = currentStep === def.id && !hasImage;

          return (
            <div 
              key={def.shotNumber} 
              className={`rounded-xl p-2.5 flex flex-col justify-between sub-card transition-all duration-300 ${
                isCurrentlyRetaking
                  ? 'border-2 border-amber-500 ring-4 ring-amber-400/50 bg-gradient-to-b from-amber-50/90 to-orange-50/50 shadow-xl shadow-amber-500/25 animate-pulse scale-[1.02]'
                  : hasImage 
                    ? 'border-blue-300/80' 
                    : isCurrentPending
                      ? 'border-2 border-brand-500 ring-2 ring-brand-500/20'
                      : def.scope === 'box_level'
                        ? 'border-blue-200/60'
                        : 'opacity-90'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center space-x-1.5 min-w-0">
                  <Icon className={`w-3.5 h-3.5 shrink-0 ${isCurrentlyRetaking ? 'text-amber-600 animate-spin' : 'text-brand-700'}`} />
                  <span className={`text-[11px] font-bold truncate ${isCurrentlyRetaking ? 'text-amber-950 font-black' : 'text-slate-800'}`}>
                    {def.label}
                  </span>
                </div>
                <div className="flex items-center space-x-1 shrink-0">
                  {isCurrentlyRetaking && (
                    <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md bg-amber-500 text-slate-950 border border-amber-300 shadow-sm animate-bounce">
                      RETAKING
                    </span>
                  )}
                  <span className={`text-[9px] font-semibold px-1.5 py-0.2 rounded-md border shadow-xs ${
                    isCurrentlyRetaking
                      ? 'bg-amber-100 text-amber-800 border-amber-300'
                      : stationRole === 'box_spine'
                        ? (def.shotNumber === 1 || def.shotNumber === 2 || def.shotNumber === 4)
                          ? 'bg-violet-50 text-violet-800 border-violet-200'
                          : 'bg-slate-50 text-slate-400 border-slate-200'
                        : def.scope === 'box_level'
                          ? 'bg-blue-50 text-blue-700 border-blue-200'
                          : 'bg-slate-50 text-slate-600 border-slate-200'
                  }`}>
                    {stationRole === 'box_spine'
                      ? (def.shotNumber === 1 || def.shotNumber === 2)
                        ? '📦 Box Level'
                        : def.shotNumber === 4
                          ? '🔖 Required Spine'
                          : '⚪ Skipped'
                      : def.scope === 'box_level' ? '📦 PC 1 Box' : '📖 PC 2 Book'}
                  </span>
                </div>
              </div>

              {/* Thumbnail Frame */}
              <div className={`relative aspect-[4/3] w-full rounded-lg overflow-hidden bg-slate-950 flex items-center justify-center border shadow-inner transition-all ${
                isCurrentlyRetaking 
                  ? 'border-2 border-amber-400 ring-2 ring-amber-400/60' 
                  : 'border-slate-200/90'
              }`}>
                {hasImage ? (
                  <>
                    <img
                      src={shotInfo?.previewDataUrl?.startsWith('/proofs') ? shotInfo.previewDataUrl : (shotInfo?.previewDataUrl || `/proofs/${encodeURIComponent(isbn)}/${encodeURIComponent(shotInfo?.filename || '')}?t=${Date.now()}`)}
                      alt={def.label}
                      className={`w-full h-full object-cover cursor-pointer transition-all ${isCurrentlyRetaking ? 'opacity-75 contrast-125' : 'hover:opacity-90'}`}
                      onClick={() => setSelectedPreview(shotInfo?.previewDataUrl || `/proofs/${encodeURIComponent(isbn)}/${encodeURIComponent(shotInfo?.filename || '')}`)}
                    />
                    {isCurrentlyRetaking && (
                      <div className="absolute inset-0 bg-amber-950/20 backdrop-blur-[1px] pointer-events-none flex items-center justify-center">
                        <div className="bg-amber-500/95 text-slate-950 text-[10px] font-black px-2 py-1 rounded-md shadow-lg border border-amber-300 flex items-center space-x-1">
                          <RotateCcw className="w-3 h-3 animate-spin" />
                          <span>RETAKE IN PROGRESS</span>
                        </div>
                      </div>
                    )}
                    <button
                      onClick={() => onRetakeShot(def.shotNumber)}
                      className={`absolute bottom-1.5 right-1.5 px-2.5 py-0.5 rounded-lg text-[10px] font-semibold backdrop-blur-md border flex items-center space-x-1 shadow transition-all hover:scale-105 cursor-pointer ${
                        isCurrentlyRetaking
                          ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 border-amber-300 ring-2 ring-amber-400 font-bold'
                          : 'bg-black/75 hover:bg-black text-white border-white/20'
                      }`}
                      title={isCurrentlyRetaking ? "Currently retaking this shot" : "Retake this shot"}
                    >
                      <RotateCcw className="w-2.5 h-2.5" />
                      <span>{isCurrentlyRetaking ? 'Retaking...' : 'Retake'}</span>
                    </button>
                  </>
                ) : (
                  <div className="text-center p-2 text-slate-500 flex flex-col items-center">
                    <Icon className="w-6 h-6 opacity-30 mb-1" />
                    <span className="text-[10px] font-medium">
                      {stationRole === 'box_level' && def.scope === 'book_level'
                        ? 'For PC 2 (Book Level)'
                        : `Awaiting Shot ${def.shotNumber}`}
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Quick Action Footer */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-blue-100 text-xs">
        <div className="flex items-center space-x-2">
          <button
            onClick={() => onOpenExplorer(isbn)}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl font-semibold text-slate-700 btn-secondary-gradient"
          >
            <FolderOpen className="w-3.5 h-3.5 text-amber-500" />
            <span>Open Folder</span>
          </button>

          <button
            onClick={() => onDownloadZip(isbn)}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl font-semibold text-slate-700 btn-secondary-gradient"
          >
            <Download className="w-3.5 h-3.5 text-brand-600" />
            <span>ZIP (7 Shots)</span>
          </button>

          {metadata?.s3Upload ? (
            <button
              onClick={handleCopyS3}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl font-semibold text-xs text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 shadow-xs cursor-pointer transition-colors"
              title={`Click to copy AWS S3 Location:\n${metadata.s3Upload.s3FolderUri}`}
            >
              <CloudUpload className="w-3.5 h-3.5 text-emerald-600" />
              <span>{copiedS3 ? '✓ S3 Link Copied!' : '✓ S3 Auto-Synced'}</span>
            </button>
          ) : (
            <button
              onClick={handleTriggerManualS3}
              disabled={isUploadingS3}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl font-semibold text-xs text-brand-700 bg-blue-50 hover:bg-blue-100 border border-blue-300 shadow-xs cursor-pointer transition-colors disabled:opacity-50"
              title="Click to immediately send proof photos to AWS S3"
            >
              <CloudUpload className={`w-3.5 h-3.5 text-brand-600 ${isUploadingS3 ? 'animate-bounce' : ''}`} />
              <span>{isUploadingS3 ? 'Sending to S3...' : 'Upload to S3 Now'}</span>
            </button>
          )}

          <button
            onClick={handleCopyPath}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl font-semibold text-slate-700 btn-secondary-gradient"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
            <span>{copied ? 'Copied!' : 'Copy Path'}</span>
          </button>
        </div>

        <div className="text-[11px] text-slate-400 font-mono">
          C:\Journal_Proofs\{isbn}
        </div>
      </div>

      {/* High-Res Fullscreen Modal Preview */}
      {selectedPreview && createPortal(
        <div
          className="fixed inset-0 z-[99999] bg-black/95 flex items-center justify-center p-4 backdrop-blur-sm cursor-pointer animate-fade-in select-none"
          onClick={() => setSelectedPreview(null)}
        >
          <div className="relative max-w-5xl max-h-[90vh] flex flex-col items-center">
            <img
              src={selectedPreview}
              alt="Verification Full View"
              className="max-h-[85vh] max-w-full rounded-xl object-contain shadow-2xl border border-white/20"
            />
            <p className="text-white/80 text-xs mt-2 font-medium">Click anywhere or press Esc to close preview</p>
          </div>
        </div>,
        document.body
      )}

    </div>
  );
};
