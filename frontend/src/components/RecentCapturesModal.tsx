import React, { useState, useEffect } from 'react';
import { 
  X, 
  Search, 
  FolderOpen, 
  Download, 
  Trash2, 
  CheckCircle2, 
  Clock, 
  RefreshCw,
  ExternalLink 
} from 'lucide-react';
import { ProofItem } from '../types';

interface RecentCapturesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectIsbn: (isbn: string) => void;
  onOpenExplorer: (isbn: string) => void;
  onDownloadZip: (isbn: string) => void;
}

export const RecentCapturesModal: React.FC<RecentCapturesModalProps> = ({
  isOpen,
  onClose,
  onSelectIsbn,
  onOpenExplorer,
  onDownloadZip
}) => {
  const [items, setItems] = useState<ProofItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchList = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/gallery/list');
      const data = await res.json();
      setItems(data.items || []);
    } catch (err) {
      console.error('Failed to load captures:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchList();
    }
  }, [isOpen]);

  const handleDelete = async (isbn: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Are you sure you want to delete proof folder for ISBN ${isbn}?`)) return;

    try {
      await fetch(`/api/gallery/${encodeURIComponent(isbn)}`, { method: 'DELETE' });
      setItems(prev => prev.filter(item => item.isbn !== isbn));
    } catch (err) {
      console.error('Delete error:', err);
    }
  };

  if (!isOpen) return null;

  const filteredItems = items.filter(i => 
    i.isbn.toLowerCase().includes(searchQuery.toLowerCase().trim())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-overlay-in">
      <div className="w-full max-w-4xl max-h-[85vh] flex flex-col rounded-2xl glass-panel shadow-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-400">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                Recent Journal Proofs
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {items.length} total proof folders stored
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={fetchList}
              title="Refresh List"
              className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by ISBN..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
        </div>

        {/* List Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="py-12 text-center text-slate-400 flex flex-col items-center">
              <RefreshCw className="w-6 h-6 animate-spin mb-2" />
              <p className="text-xs">Loading captured proof logs...</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="py-12 text-center text-slate-400">
              <p className="text-sm">No journal proofs found.</p>
            </div>
          ) : (
            filteredItems.map((item) => (
              <div
                key={item.isbn}
                onClick={() => {
                  onSelectIsbn(item.isbn);
                  onClose();
                }}
                className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/60 hover:border-brand-500 dark:hover:border-brand-500 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer group"
              >
                {/* Left: Info & Thumbnails */}
                <div className="flex items-center space-x-3.5">
                  {/* Thumbnails */}
                  <div className="flex items-center space-x-1 shrink-0">
                    <div className="w-12 h-12 rounded-lg bg-slate-950 overflow-hidden border border-slate-200 dark:border-slate-700 flex items-center justify-center">
                      {item.shot1Url ? (
                        <img src={item.shot1Url} alt="Shot 1" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-[9px] text-slate-500">No 1</span>
                      )}
                    </div>
                    <div className="w-12 h-12 rounded-lg bg-slate-950 overflow-hidden border border-slate-200 dark:border-slate-700 flex items-center justify-center">
                      {item.shot2Url ? (
                        <img src={item.shot2Url} alt="Shot 2" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-[9px] text-slate-500">No 2</span>
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-mono font-bold text-sm text-slate-900 dark:text-white group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
                        {item.isbn}
                      </span>
                      {item.isComplete ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                          <CheckCircle2 className="w-3 h-3" />
                          Complete (2/2)
                        </span>
                      ) : (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                          Partial ({item.hasShot1 ? '1' : item.hasShot2 ? '1' : '0'}/2)
                        </span>
                      )}
                    </div>

                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {item.modifiedAt ? new Date(item.modifiedAt).toLocaleString() : 'Date unknown'}
                    </p>
                  </div>
                </div>

                {/* Right: Quick Action Buttons */}
                <div className="flex items-center space-x-1.5 self-end sm:self-center">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenExplorer(item.isbn);
                    }}
                    title="Open Folder in Windows Explorer"
                    className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                  >
                    <FolderOpen className="w-4 h-4" />
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDownloadZip(item.isbn);
                    }}
                    title="Download ZIP"
                    className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                  >
                    <Download className="w-4 h-4" />
                  </button>

                  <button
                    onClick={(e) => handleDelete(item.isbn, e)}
                    title="Delete Entry"
                    className="p-2 rounded-lg text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

              </div>
            ))
          )}
        </div>

      </div>
    </div>
  );
};
