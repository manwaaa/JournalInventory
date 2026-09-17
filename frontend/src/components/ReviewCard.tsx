import React, { useState } from 'react';
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
import { JournalMetadata, ShotInfo, SHOT_DEFINITIONS, StationRole } from '../types';

interface ReviewCardProps {
  isbn: string;
  lotNumber?: string;
  boxNumber?: string;
  shots: Record<number, ShotInfo | null>;
  metadata: JournalMetadata | null;
  stationRole?: StationRole;
  onRetakeShot: (shotNumber: number) => void;
  onOpenExplorer: (isbn: string) => void;
  onDownloadZip: (isbn: string) => void;
  onNextJournal: () => void;
  onDiscardSession?: () => void;
  onIncompleteWarning?: () => void;
  onUploadS3?: (isbn: string) => void;
}

export const ReviewCard: React.FC<ReviewCardProps> = ({
  isbn,
  lotNumber,
  boxNumber,
  shots,
  metadata,
  stationRole = 'all',
  onRetakeShot,
  onOpenExplorer,
  onDownloadZip,
  onNextJournal,
  onDiscardSession,
  onIncompleteWarning,
  onUploadS3
}) => {
  const [copied, setCopied] = useState(false);
  const [selectedPreview, setSelectedPreview] = useState<string | null>(null);

  // Count captured shots
  let shotsCount = 0;
  for (let s = 1; s <= 7; s++) {
    if (shots[s]) shotsCount++;
  }

  const isComplete = shotsCount >= 7;
  const isBoxLevelDone = Boolean(shots[1] && shots[2]);
  const canProceed = stationRole === 'box_level' ? isBoxLevelDone : isComplete;

  const handleCopyPath = () => {
    if (!isbn) return;
    const path = `C:\\Journal_Proofs\\${isbn}`;
    navigator.clipboard.writeText(path);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleNextClick = () => {
    if (!canProceed) {
      if (onIncompleteWarning) {
        onIncompleteWarning();
      }
      return;
    }
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

  return (
    <div className="w-full white-card rounded-2xl p-5 shadow-sm space-y-4 animate-fade-in">
      
      {/* Header Info */}
      <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-blue-100">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-brand-700 badge-soft-blue px-2.5 py-0.5 rounded-lg shadow-sm">
              {lotNumber || 'Unassigned Lot'} {boxNumber ? `• Box ${boxNumber}` : ''}
            </span>
            {metadata?.copyNumber && metadata.copyNumber > 1 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gradient-to-r from-purple-50 to-indigo-50 text-purple-800 border border-purple-200">
                Copy #{metadata.copyNumber}
              </span>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <h3 className="text-xl font-extrabold text-slate-900 font-mono tracking-tight">
              {isbn}
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
            <p className="text-xs font-semibold text-slate-700">
              {metadata.bookDetails.title} {metadata.bookDetails.authors ? `— ${metadata.bookDetails.authors}` : ''}
            </p>
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
                ? 'text-white btn-primary-gradient active:scale-95'
                : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
            }`}
          >
            {!canProceed && <Lock className="w-3.5 h-3.5 mr-0.5 text-slate-400" />}
            <span>{stationRole === 'box_level' ? 'Next Journal (Box Done)' : 'Next Book'}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 7 Shots Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {SHOT_DEFINITIONS.map((def) => {
          const shotInfo = shots[def.shotNumber];
          const Icon = getShotIcon(def.shotNumber);
          const hasImage = Boolean(shotInfo?.previewDataUrl || shotInfo?.filename);

          return (
            <div 
              key={def.shotNumber} 
              className={`rounded-xl p-2.5 flex flex-col justify-between sub-card ${
                hasImage 
                  ? 'border-blue-300/80' 
                  : def.scope === 'box_level'
                    ? 'border-blue-200/60'
                    : 'opacity-90'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center space-x-1.5 min-w-0">
                  <Icon className="w-3.5 h-3.5 text-brand-700 shrink-0" />
                  <span className="text-[11px] font-bold text-slate-800 truncate">
                    {def.label}
                  </span>
                </div>
                <span className={`text-[9px] font-semibold px-1.5 py-0.2 rounded-md border shadow-xs shrink-0 ${
                  def.scope === 'box_level'
                    ? 'bg-blue-50 text-blue-700 border-blue-200'
                    : 'bg-slate-50 text-slate-600 border-slate-200'
                }`}>
                  {def.scope === 'box_level' ? '📦 PC 1 Box' : '📖 PC 2 Book'}
                </span>
              </div>

              {/* Thumbnail Frame */}
              <div className="relative aspect-[4/3] w-full rounded-lg overflow-hidden bg-slate-950 flex items-center justify-center border border-slate-200/90 shadow-inner">
                {hasImage ? (
                  <>
                    <img
                      src={shotInfo?.previewDataUrl || `/proofs/${encodeURIComponent(isbn)}/${encodeURIComponent(shotInfo?.filename || '')}?t=${Date.now()}`}
                      alt={def.label}
                      className="w-full h-full object-cover cursor-pointer hover:opacity-90 transition-opacity"
                      onClick={() => setSelectedPreview(shotInfo?.previewDataUrl || `/proofs/${encodeURIComponent(isbn)}/${encodeURIComponent(shotInfo?.filename || '')}`)}
                    />
                    <button
                      onClick={() => onRetakeShot(def.shotNumber)}
                      className="absolute bottom-1.5 right-1.5 px-2.5 py-0.5 rounded-lg bg-black/75 hover:bg-black text-white text-[10px] font-semibold backdrop-blur-md border border-white/20 flex items-center space-x-1 shadow transition-all hover:scale-105"
                      title="Retake this shot"
                    >
                      <RotateCcw className="w-2.5 h-2.5" />
                      <span>Retake</span>
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

          {onUploadS3 && (
            <button
              onClick={() => onUploadS3(isbn)}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl font-semibold text-brand-700 bg-blue-50/80 hover:bg-blue-100/80 border border-blue-200/80 shadow-xs transition-colors cursor-pointer"
            >
              <CloudUpload className="w-3.5 h-3.5 text-brand-600" />
              <span>Upload to S3</span>
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
      {selectedPreview && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm cursor-pointer"
          onClick={() => setSelectedPreview(null)}
        >
          <div className="relative max-w-5xl max-h-[90vh] flex flex-col items-center">
            <img
              src={selectedPreview}
              alt="Verification Full View"
              className="max-h-[85vh] max-w-full rounded-xl object-contain shadow-2xl border border-white/20"
            />
            <p className="text-white/80 text-xs mt-2 font-medium">Click anywhere to close preview</p>
          </div>
        </div>
      )}

    </div>
  );
};
