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
  FileSpreadsheet,
  Book,
  Layers
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
  const [exporting, setExporting] = useState(false);
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

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const res = await fetch('/api/gallery/export-csv');
      if (!res.ok) throw new Error('Export failed');
      
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Journal_Inventory_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error('Failed to export CSV:', err);
      alert('Failed to generate CSV export.');
    } finally {
      setExporting(false);
    }
  };

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

  const filteredItems = items.filter(i => {
    const query = searchQuery.toLowerCase().trim();
    const title = i.metadata?.bookDetails?.title?.toLowerCase() || '';
    const author = i.metadata?.bookDetails?.authors?.toLowerCase() || '';
    return i.isbn.toLowerCase().includes(query) || title.includes(query) || author.includes(query);
  });

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
                {items.length} total proof records stored
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {/* Export CSV Button */}
            <button
              onClick={handleExportCsv}
              disabled={exporting || items.length === 0}
              title="Export all inventory records to Excel / CSV"
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900 transition-colors shadow-sm disabled:opacity-50"
            >
              <FileSpreadsheet className={`w-3.5 h-3.5 ${exporting ? 'animate-spin' : 'text-emerald-600'}`} />
              <span>{exporting ? 'Exporting...' : 'Export Excel (CSV)'}</span>
            </button>

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
              placeholder="Search by ISBN, journal title, or author..."
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
            filteredItems.map((item) => {
              const book = item.metadata?.bookDetails;
              const copyNum = item.copyNumber || item.metadata?.copyNumber || 1;

              return (
                <div
                  key={item.isbn}
                  onClick={() => {
                    onSelectIsbn(item.isbn);
                    onClose();
                  }}
                  className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/60 hover:border-brand-500 dark:hover:border-brand-500 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer group"
                >
                  {/* Left: Info & Thumbnails */}
                  <div className="flex items-start sm:items-center space-x-3.5 min-w-0">
                    {/* Thumbnails */}
                    <div className="flex items-center space-x-1 shrink-0 pt-0.5 sm:pt-0">
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

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono font-bold text-sm text-slate-900 dark:text-white group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
                          {item.isbn}
                        </span>

                        {copyNum > 1 && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 border border-purple-300 dark:border-purple-800">
                            <Layers className="w-2.5 h-2.5" />
                            Copy {copyNum}
                          </span>
                        )}

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

                      {/* Enriched Book / Journal Title */}
                      {book?.title && (
                        <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate max-w-md mt-0.5">
                          {book.title}
                        </p>
                      )}

                      <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-slate-400 mt-0.5">
                        {book?.authors && (
                          <span className="truncate max-w-xs text-slate-500 dark:text-slate-400">
                            {book.authors}
                          </span>
                        )}
                        {book?.publisher && (
                          <span className="text-slate-400">
                            &bull; {book.publisher}
                          </span>
                        )}
                        <span>
                          &bull; {item.modifiedAt ? new Date(item.modifiedAt).toLocaleDateString() : ''}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Quick Action Buttons */}
                  <div className="flex items-center space-x-1.5 self-end sm:self-center shrink-0">
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
              );
            })
          )}
        </div>

      </div>
    </div>
  );
};
