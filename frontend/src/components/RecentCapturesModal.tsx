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
  Layers,
  AlertCircle
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
      a.download = `Verification_Images_Report_${new Date().toISOString().slice(0, 10)}.csv`;
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
    if (!window.confirm(`Are you sure you want to delete verification proofs for ISBN ${isbn}?`)) return;

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-4xl max-h-[85vh] flex flex-col rounded-2xl modal-card overflow-hidden">
        
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-blue-100 flex items-center justify-between bg-gradient-to-r from-blue-50/70 to-indigo-50/50">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl btn-primary-gradient text-white shadow-md shadow-brand-500/20">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">
                Verification Image Records
              </h3>
              <p className="text-xs text-slate-500">
                {items.length} total verification records stored
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleExportCsv}
              disabled={exporting || items.length === 0}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 transition-colors shadow-sm disabled:opacity-50"
            >
              <FileSpreadsheet className={`w-3.5 h-3.5 ${exporting ? 'animate-spin' : 'text-emerald-600'}`} />
              <span>{exporting ? 'Exporting...' : 'Export Excel (CSV)'}</span>
            </button>

            <button
              onClick={fetchList}
              title="Refresh List"
              className="p-2 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="p-4 border-b border-slate-200 bg-slate-50/50">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by ISBN, title, or author..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-xs bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
        </div>

        {/* List Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="py-12 text-center text-slate-400 flex flex-col items-center">
              <RefreshCw className="w-6 h-6 animate-spin mb-2 text-brand-700" />
              <p className="text-xs">Loading records...</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="py-12 text-center text-slate-400">
              <p className="text-sm">No verification proofs found.</p>
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
                  className="p-3.5 rounded-xl border border-slate-200 bg-white hover:border-brand-500 hover:bg-blue-50/30 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer group"
                >
                  <div className="flex items-start sm:items-center space-x-3.5 min-w-0">
                    {/* Thumbnails strip */}
                    <div className="flex items-center space-x-1 shrink-0">
                      {[1, 2, 3].map((s) => {
                        const url = item.shots?.[s] || (s === 1 ? item.shot1Url : s === 2 ? item.shot2Url : item.shot3Url);
                        return (
                          <div key={s} className="w-9 h-9 rounded-lg bg-slate-950 overflow-hidden border border-slate-200 flex items-center justify-center">
                            {url ? (
                              <img src={url} alt={`Shot ${s}`} className="w-full h-full object-cover" />
                            ) : (
                              <span className="text-[8px] text-slate-500 font-mono">{s}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono font-bold text-sm text-slate-900 group-hover:text-brand-700 transition-colors">
                          {item.isbn}
                        </span>

                        {copyNum > 1 && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 border border-purple-300">
                            <Layers className="w-2.5 h-2.5" />
                            Copy {copyNum}
                          </span>
                        )}

                        {item.isComplete ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-300">
                            <CheckCircle2 className="w-3 h-3" />
                            Complete (6/6)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-300">
                            <AlertCircle className="w-3 h-3 text-amber-500" />
                            Partial ({item.shotsCount || 0}/6)
                          </span>
                        )}
                      </div>

                      {book?.title && (
                        <p className="text-xs font-semibold text-slate-700 truncate max-w-md mt-0.5">
                          {book.title}
                        </p>
                      )}

                      <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-slate-400 mt-0.5">
                        {book?.authors && (
                          <span className="truncate max-w-xs text-slate-500">
                            {book.authors}
                          </span>
                        )}
                        <span>
                          &bull; {item.modifiedAt ? new Date(item.modifiedAt).toLocaleDateString() : ''}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-1.5 self-end sm:self-center shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenExplorer(item.isbn);
                      }}
                      title="Open in Explorer"
                      className="p-2 rounded-lg text-slate-500 hover:text-amber-600 hover:bg-slate-100 transition-colors"
                    >
                      <FolderOpen className="w-4 h-4" />
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDownloadZip(item.isbn);
                      }}
                      title="Download ZIP"
                      className="p-2 rounded-lg text-slate-500 hover:text-brand-700 hover:bg-slate-100 transition-colors"
                    >
                      <Download className="w-4 h-4" />
                    </button>

                    <button
                      onClick={(e) => handleDelete(item.isbn, e)}
                      title="Delete"
                      className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-slate-100 transition-colors"
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
