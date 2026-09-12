import React, { useState } from 'react';
import { 
  FolderOpen, 
  Download, 
  Copy, 
  Check, 
  RotateCcw, 
  CheckCircle2, 
  ArrowRight, 
  Layers, 
  BookOpen, 
  ExternalLink,
  Trash2
} from 'lucide-react';
import { JournalMetadata, ShotInfo } from '../types';

interface ReviewCardProps {
  isbn: string;
  shot1: ShotInfo | null;
  shot2: ShotInfo | null;
  metadata: JournalMetadata | null;
  onRetakeShot: (shotNumber: 1 | 2) => void;
  onOpenExplorer: (isbn: string) => void;
  onDownloadZip: (isbn: string) => void;
  onNextJournal: () => void;
  onDiscardSession?: () => void;
}

export const ReviewCard: React.FC<ReviewCardProps> = ({
  isbn,
  shot1,
  shot2,
  metadata,
  onRetakeShot,
  onOpenExplorer,
  onDownloadZip,
  onNextJournal,
  onDiscardSession
}) => {
  const [copied, setCopied] = useState(false);
  const [selectedPreview, setSelectedPreview] = useState<string | null>(null);

  const isComplete = Boolean(shot1 && shot2);

  const handleCopyPath = () => {
    if (!isbn) return;
    const path = `C:\\Journal_Proofs\\${isbn}`;
    navigator.clipboard.writeText(path);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes) return '';
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  return (
    <div className="w-full glass-panel rounded-2xl p-5 shadow-xl border border-slate-200 dark:border-slate-800 transition-all">
      
      {/* Header Info */}
      <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Journal Verification Record
            </span>
            {metadata?.copyNumber && metadata.copyNumber > 1 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 border border-purple-300 dark:border-purple-800">
                Copy #{metadata.copyNumber}
              </span>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <h3 className="text-xl font-extrabold text-slate-900 dark:text-white font-mono">
              {isbn}
            </h3>
            {isComplete && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Proof Complete
              </span>
            )}
          </div>

          {/* Book / Journal Details */}
          {metadata?.bookDetails?.title && (
            <div className="pt-1">
              <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                {metadata.bookDetails.title}
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {metadata.bookDetails.authors && <span>{metadata.bookDetails.authors} </span>}
                {metadata.bookDetails.publisher && <span>&bull; {metadata.bookDetails.publisher} </span>}
                {metadata.bookDetails.publishYear && <span>({metadata.bookDetails.publishYear})</span>}
              </p>
            </div>
          )}
        </div>

        {/* Action Buttons: Discard / Next Journal */}
        <div className="flex items-center space-x-2">
          {onDiscardSession && (
            <button
              onClick={onDiscardSession}
              title="Discard this session and remove any empty or partial folder"
              className="inline-flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/60 border border-rose-200 dark:border-rose-900/40 transition-all active:scale-95"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Discard / Fix ISBN</span>
            </button>
          )}

          <button
            onClick={onNextJournal}
            className="inline-flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold text-white bg-slate-900 dark:bg-slate-100 dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white shadow-md transition-all active:scale-95"
          >
            <span>Next Journal</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Proof Shots Side-by-Side Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-5">
        
        {/* Shot 1 Box */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-2">
              <Layers className="w-4 h-4 text-brand-500" />
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                Shot 1: Front & Spine Angle
              </span>
            </div>
            {shot1 && (
              <span className="text-[10px] text-slate-400 font-mono">
                {formatBytes(shot1.sizeBytes)}
              </span>
            )}
          </div>

          <div className="relative aspect-[4/3] w-full rounded-lg overflow-hidden bg-slate-950 flex items-center justify-center border border-slate-200 dark:border-slate-800">
            {shot1?.previewDataUrl || shot1?.filename ? (
              <>
                <img
                  src={shot1.previewDataUrl || `/proofs/${encodeURIComponent(isbn)}/${shot1.filename}?t=${Date.now()}`}
                  alt="Front Cover & Spine"
                  className="w-full h-full object-contain cursor-pointer hover:opacity-95 transition-opacity"
                  onClick={() => setSelectedPreview(shot1.previewDataUrl || `/proofs/${encodeURIComponent(isbn)}/${shot1.filename}`)}
                />
                <button
                  onClick={() => onRetakeShot(1)}
                  className="absolute bottom-2 right-2 px-2.5 py-1 rounded-lg bg-black/70 hover:bg-black/90 text-white text-[11px] font-semibold backdrop-blur-sm border border-white/20 flex items-center space-x-1 shadow-md transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Retake</span>
                </button>
              </>
            ) : (
              <div className="text-center p-4 text-slate-500">
                <Layers className="w-8 h-8 mx-auto mb-1 opacity-40" />
                <p className="text-xs">Awaiting Shot 1</p>
              </div>
            )}
          </div>
        </div>

        {/* Shot 2 Box */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-2">
              <BookOpen className="w-4 h-4 text-emerald-500" />
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                Shot 2: Author & Title Page
              </span>
            </div>
            {shot2 && (
              <span className="text-[10px] text-slate-400 font-mono">
                {formatBytes(shot2.sizeBytes)}
              </span>
            )}
          </div>

          <div className="relative aspect-[4/3] w-full rounded-lg overflow-hidden bg-slate-950 flex items-center justify-center border border-slate-200 dark:border-slate-800">
            {shot2?.previewDataUrl || shot2?.filename ? (
              <>
                <img
                  src={shot2.previewDataUrl || `/proofs/${encodeURIComponent(isbn)}/${shot2.filename}?t=${Date.now()}`}
                  alt="Author & Title Page"
                  className="w-full h-full object-contain cursor-pointer hover:opacity-95 transition-opacity"
                  onClick={() => setSelectedPreview(shot2.previewDataUrl || `/proofs/${encodeURIComponent(isbn)}/${shot2.filename}`)}
                />
                <button
                  onClick={() => onRetakeShot(2)}
                  className="absolute bottom-2 right-2 px-2.5 py-1 rounded-lg bg-black/70 hover:bg-black/90 text-white text-[11px] font-semibold backdrop-blur-sm border border-white/20 flex items-center space-x-1 shadow-md transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Retake</span>
                </button>
              </>
            ) : (
              <div className="text-center p-4 text-slate-500">
                <BookOpen className="w-8 h-8 mx-auto mb-1 opacity-40" />
                <p className="text-xs">Awaiting Shot 2</p>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Quick Action Footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200 dark:border-slate-800 text-xs">
        <div className="flex items-center space-x-2">
          
          <button
            onClick={() => onOpenExplorer(isbn)}
            className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            <FolderOpen className="w-4 h-4 text-amber-500" />
            <span>Open in Explorer</span>
          </button>

          <button
            onClick={() => onDownloadZip(isbn)}
            className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            <Download className="w-4 h-4 text-brand-500" />
            <span>Download ZIP</span>
          </button>

          <button
            onClick={handleCopyPath}
            className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4 text-slate-400" />}
            <span>{copied ? 'Copied!' : 'Copy Path'}</span>
          </button>
        </div>

        <div className="text-[11px] text-slate-400 font-mono">
          Folder: C:\Journal_Proofs\{isbn}
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
              alt="Proof Full View"
              className="max-h-[85vh] max-w-full rounded-xl object-contain shadow-2xl border border-white/20"
            />
            <p className="text-white/70 text-xs mt-2">Click anywhere to close full preview</p>
          </div>
        </div>
      )}

    </div>
  );
};
