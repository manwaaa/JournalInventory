import React, { useState, useEffect } from 'react';
import { 
  Search, 
  ChevronDown, 
  ChevronRight, 
  CheckCircle2, 
  FolderOpen, 
  Download, 
  Trash2, 
  FileSpreadsheet, 
  RefreshCw, 
  Eye, 
  Package,
  AlertCircle,
  Boxes,
  MoreVertical,
  Camera,
  CloudUpload
} from 'lucide-react';
import { ProofItem, SHOT_DEFINITIONS } from '../types';
import { S3UploadModal } from './S3UploadModal';

interface SearchViewCatalogProps {
  onSelectIsbnForCapture: (isbn: string) => void;
  onOpenExplorer: (isbn: string) => void;
  onDownloadZip: (isbn: string) => void;
}

export const SearchViewCatalog: React.FC<SearchViewCatalogProps> = ({
  onSelectIsbnForCapture,
  onOpenExplorer,
  onDownloadZip
}) => {
  const [items, setItems] = useState<ProofItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'in_progress' | 'completed'>('all');
  const [expandedLots, setExpandedLots] = useState<Record<string, boolean>>({ 'Unassigned Lot': true });
  const [activeActionMenu, setActiveActionMenu] = useState<string | null>(null);
  const [selectedPhotoModal, setSelectedPhotoModal] = useState<{
    isbn: string;
    shots: Record<string, string | null>;
    item: ProofItem;
  } | null>(null);
  const [activePreviewImage, setActivePreviewImage] = useState<string | null>(null);
  const [s3UploadTarget, setS3UploadTarget] = useState<{ isbn: string; item: ProofItem } | null>(null);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/gallery/list');
      const data = await res.json();
      setItems(data.items || []);
    } catch (err) {
      console.error('Error loading gallery items:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, []);

  useEffect(() => {
    const handleGlobalClick = () => setActiveActionMenu(null);
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveActionMenu(null);
    };
    window.addEventListener('click', handleGlobalClick);
    window.addEventListener('keydown', handleEsc);
    return () => {
      window.removeEventListener('click', handleGlobalClick);
      window.removeEventListener('keydown', handleEsc);
    };
  }, []);

  const handleExportCsv = async () => {
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
      alert('Failed to generate CSV export');
    }
  };

  const handleDeleteItem = async (isbn: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Delete verification proofs for ISBN ${isbn}?`)) return;
    try {
      await fetch(`/api/gallery/${encodeURIComponent(isbn)}`, { method: 'DELETE' });
      setItems(prev => prev.filter(i => i.isbn !== isbn));
    } catch (err) {
      console.error('Delete error:', err);
    }
  };

  const toggleLotExpand = (lot: string) => {
    setExpandedLots(prev => ({ ...prev, [lot]: !prev[lot] }));
  };

  const filteredItems = items.filter(item => {
    const q = searchQuery.toLowerCase().trim();
    const title = item.metadata?.bookDetails?.title?.toLowerCase() || '';
    const author = item.metadata?.bookDetails?.authors?.toLowerCase() || '';
    const lot = item.lotNumber?.toLowerCase() || '';
    const box = item.boxNumber?.toLowerCase() || '';
    
    const matchesSearch = item.isbn.toLowerCase().includes(q) || title.includes(q) || author.includes(q) || lot.includes(q) || box.includes(q);
    if (!matchesSearch) return false;

    if (activeTab === 'in_progress') return !item.isComplete;
    if (activeTab === 'completed') return item.isComplete;
    return true;
  });

  const lotsMap: Record<string, ProofItem[]> = {};
  for (const item of filteredItems) {
    const lot = item.lotNumber || item.metadata?.lotNumber || 'Unassigned Lot';
    if (!lotsMap[lot]) lotsMap[lot] = [];
    lotsMap[lot].push(item);
  }

  const lotKeys = Object.keys(lotsMap);
  if (lotKeys.length === 0 && !loading) {
    lotsMap['Unassigned Lot'] = [];
  }

  return (
    <div className="w-full space-y-6 animate-fade-in">
      
      {/* Search & View Mode Header Card */}
      <div className="white-card rounded-2xl p-6 shadow-sm">
        
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-blue-100">
          <div className="flex items-start space-x-3.5">
            <div className="w-10 h-10 rounded-xl btn-primary-gradient text-white flex items-center justify-center shadow-md shadow-brand-500/20 shrink-0 mt-0.5">
              <Boxes className="w-5 h-5" />
            </div>
            <div className="space-y-0.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-brand-700">
                INVENTORY OVERVIEW
              </span>
              <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">
                Lots & Boxes
              </h2>
              <p className="text-xs text-slate-500">
                Received inventory and verification session status with instant picture preview
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            <button
              onClick={handleExportCsv}
              className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold text-emerald-800 bg-gradient-to-b from-emerald-50 to-teal-50 hover:from-emerald-100 hover:to-teal-100 border border-emerald-200/80 transition-all shadow-sm"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
              <span>Export Excel (CSV)</span>
            </button>

            <button
              onClick={fetchItems}
              title="Refresh Records"
              className="p-2 rounded-xl text-slate-500 hover:text-brand-700 hover:bg-blue-50 border border-slate-200 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Filter Tabs & Search Bar Strip */}
        <div className="pt-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          
          {/* Filter Pills */}
          <div className="flex items-center space-x-1.5 bg-gradient-to-r from-blue-50 to-indigo-50/60 p-1 rounded-xl border border-blue-100 shadow-sm w-fit">
            <button
              onClick={() => setActiveTab('all')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'all'
                  ? 'btn-primary-gradient text-white shadow-sm'
                  : 'text-slate-600 hover:text-brand-700'
              }`}
            >
              All Lots
            </button>
            <button
              onClick={() => setActiveTab('in_progress')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'in_progress'
                  ? 'btn-primary-gradient text-white shadow-sm'
                  : 'text-slate-600 hover:text-brand-700'
              }`}
            >
              In Progress
            </button>
            <button
              onClick={() => setActiveTab('completed')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'completed'
                  ? 'btn-primary-gradient text-white shadow-sm'
                  : 'text-slate-600 hover:text-brand-700'
              }`}
            >
              Completed
            </button>
          </div>

          {/* Search Box */}
          <div className="flex items-center space-x-2">
            <div className="relative flex-1 sm:w-80">
              <Search className="w-3.5 h-3.5 text-brand-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search lots, boxes or ISBNs..."
                className="w-full pl-9 pr-16 py-2 text-xs input-smooth rounded-full outline-none"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-500 bg-white px-2 py-0.5 rounded-full border border-slate-200">
                {Object.keys(lotsMap).length} lots
              </span>
            </div>
          </div>

        </div>

      </div>

      {/* Lots & Boxes Grouped Table */}
      <div className="space-y-4">
        {Object.keys(lotsMap).map((lotName, lotIdx) => {
          const lotItems = lotsMap[lotName];
          const isExpanded = expandedLots[lotName] !== false;
          const totalBooks = lotItems.length;
          const completedCount = lotItems.filter(i => i.isComplete).length;

          return (
            <div key={lotName} className="white-card rounded-2xl shadow-sm">
              
              {/* Royal Blue Smooth Gradient Active Lot Bar */}
              <div
                onClick={() => toggleLotExpand(lotName)}
                className={`lot-header-gradient text-white px-5 py-3.5 flex items-center justify-between cursor-pointer transition-all select-none hover:opacity-95 ${
                  isExpanded ? 'rounded-t-2xl' : 'rounded-2xl'
                }`}
              >
                <div className="flex items-center space-x-4">
                  <span className="text-xs font-mono font-bold text-blue-200">#{lotIdx + 1}</span>
                  <span className="font-extrabold text-sm sm:text-base tracking-tight">{lotName}</span>
                </div>

                <div className="flex items-center space-x-3">
                  <span className="px-3 py-0.5 text-xs font-bold rounded-full bg-white/20 text-white backdrop-blur-sm border border-white/20">
                    {totalBooks} {totalBooks === 1 ? 'book' : 'books'} ({completedCount} verified)
                  </span>
                  
                  <div className="flex items-center space-x-1 text-xs font-semibold text-blue-100">
                    <span>{isExpanded ? 'Collapse' : 'Expand'}</span>
                    {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </div>
                </div>
              </div>

              {/* Nested Box & Book Table */}
              {isExpanded && (
                <div className="p-4 bg-white/70 rounded-b-2xl overflow-visible min-h-[140px]">
                  {lotItems.length === 0 ? (
                    <div className="py-8 text-center text-slate-400">
                      <Package className="w-8 h-8 opacity-30 mx-auto mb-1 text-slate-400" />
                      <p className="text-xs font-semibold text-slate-500">No verification records in this lot yet.</p>
                      <p className="text-[11px] text-slate-400">Switch to Capture Mode to start photographing journals for {lotName}.</p>
                    </div>
                  ) : (
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="text-slate-400 font-bold uppercase tracking-wider text-[10px] border-b border-slate-100 pb-2">
                          <th className="py-2.5 px-3">#</th>
                          <th className="py-2.5 px-3">BOX NUMBER</th>
                          <th className="py-2.5 px-3">ISBN & TITLE</th>
                          <th className="py-2.5 px-3">PICTURES (7 SHOTS)</th>
                          <th className="py-2.5 px-3">STATION / OPERATOR</th>
                          <th className="py-2.5 px-3">STATUS</th>
                          <th className="py-2.5 px-3 text-right">ACTIONS</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-sans">
                        {lotItems.map((item, itemIdx) => {
                          const book = item.metadata?.bookDetails;
                          const boxNum = item.boxNumber || item.metadata?.boxNumber || '102/468';
                          const station = item.metadata?.station || item.metadata?.operator || 'Station-01';

                          return (
                            <tr key={item.isbn} className="hover:bg-blue-50/30 transition-colors">
                              <td className="py-3 px-3 font-mono text-slate-400 text-xs">
                                {itemIdx + 1}
                              </td>

                              <td className="py-3 px-3 font-mono font-bold text-slate-800">
                                {boxNum}
                              </td>

                              <td className="py-3 px-3 min-w-[200px]">
                                <div className="font-mono font-bold text-slate-900">{item.isbn}</div>
                                {book?.title && (
                                  <div className="text-[11px] font-semibold text-slate-600 truncate max-w-xs">{book.title}</div>
                                )}
                              </td>

                              {/* 7 Shots Mini-Thumbnails Strip */}
                              <td className="py-3 px-3">
                                <div className="flex items-center space-x-1.5">
                                  {[1, 2, 3, 4, 5, 6, 7].map((s) => {
                                    const shotUrl = item.shots?.[s] || (s === 1 ? item.shot1Url : s === 2 ? item.shot2Url : s === 3 ? item.shot3Url : s === 4 ? item.shot4Url : s === 5 ? item.shot5Url : s === 6 ? item.shot6Url : item.shot7Url);
                                    
                                    return (
                                      <div
                                        key={s}
                                        onClick={() => {
                                          if (shotUrl) {
                                            setActivePreviewImage(shotUrl);
                                          }
                                        }}
                                        title={`Shot ${s}: ${SHOT_DEFINITIONS[s - 1]?.label || 'Shot ' + s}`}
                                        className={`w-7 h-7 rounded-md overflow-hidden flex items-center justify-center border cursor-pointer transition-transform hover:scale-110 ${
                                          shotUrl 
                                            ? 'bg-slate-900 border-blue-200' 
                                            : 'bg-slate-100 border-slate-200'
                                        }`}
                                      >
                                        {shotUrl ? (
                                          <img src={shotUrl} alt={`Shot ${s}`} className="w-full h-full object-cover" />
                                        ) : (
                                          <span className="text-[8px] font-bold text-slate-300 font-mono">{s}</span>
                                        )}
                                      </div>
                                    );
                                  })}

                                  <button
                                    onClick={() => setSelectedPhotoModal({ isbn: item.isbn, shots: item.shots, item })}
                                    title="View all 7 shots in detail"
                                    className="p-1 text-slate-400 hover:text-brand-700 rounded-md hover:bg-slate-100 transition-colors"
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>

                              <td className="py-3 px-3 text-slate-500 font-medium">
                                {station}
                              </td>

                              <td className="py-3 px-3">
                                {item.isComplete ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-white text-emerald-700 border border-emerald-400 shadow-sm">
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                    COMPLETED
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-300">
                                    <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                                    {item.shotsCount}/7 SHOTS
                                  </span>
                                )}
                              </td>

                              <td className={`py-3 px-3 text-right shrink-0 relative ${activeActionMenu === item.isbn ? 'z-40' : ''}`}>
                                <div className="flex items-center justify-end">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveActionMenu(activeActionMenu === item.isbn ? null : item.isbn);
                                    }}
                                    title="Actions"
                                    className={`p-1.5 rounded-xl border transition-all cursor-pointer ${
                                      activeActionMenu === item.isbn
                                        ? 'bg-blue-50 text-brand-700 border-brand-300 shadow-sm'
                                        : 'text-slate-500 hover:text-brand-700 hover:bg-blue-50/80 border-slate-200/80 shadow-xs'
                                    }`}
                                  >
                                    <MoreVertical className="w-4 h-4" />
                                  </button>

                                  {activeActionMenu === item.isbn && (() => {
                                    const isNearBottom = itemIdx >= lotItems.length - 2 && lotItems.length >= 2;
                                    return (
                                      <div 
                                        className={`absolute right-3 z-50 w-56 bg-white/98 backdrop-blur-md rounded-2xl shadow-2xl border border-blue-200/90 py-1.5 animate-fade-in text-left divide-y divide-slate-100 ring-1 ring-slate-900/10 ${
                                          isNearBottom ? 'bottom-full mb-2' : 'top-full mt-2'
                                        }`}
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <div className="py-1">
                                          <button
                                            onClick={() => {
                                              setActiveActionMenu(null);
                                              onSelectIsbnForCapture(item.isbn);
                                            }}
                                            className="w-full px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-blue-50 hover:text-brand-700 flex items-center space-x-2.5 transition-colors cursor-pointer"
                                          >
                                            <Camera className="w-4 h-4 text-brand-600 shrink-0" />
                                            <span>Inspect / Retake</span>
                                          </button>

                                          <button
                                            onClick={() => {
                                              setActiveActionMenu(null);
                                              setSelectedPhotoModal({ isbn: item.isbn, shots: item.shots, item });
                                            }}
                                            className="w-full px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-blue-50 hover:text-brand-700 flex items-center space-x-2.5 transition-colors cursor-pointer"
                                          >
                                            <Eye className="w-4 h-4 text-brand-600 shrink-0" />
                                            <span>View 7 Photos</span>
                                          </button>
                                        </div>

                                        <div className="py-1">
                                          <button
                                            onClick={() => {
                                              setActiveActionMenu(null);
                                              setS3UploadTarget({ isbn: item.isbn, item });
                                            }}
                                            className="w-full px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-blue-50 hover:text-brand-700 flex items-center space-x-2.5 transition-colors cursor-pointer"
                                          >
                                            <CloudUpload className="w-4 h-4 text-brand-600 shrink-0" />
                                            <span>Upload to S3 (Client Cloud)</span>
                                          </button>

                                          <button
                                            onClick={() => {
                                              setActiveActionMenu(null);
                                              onOpenExplorer(item.isbn);
                                            }}
                                            className="w-full px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-amber-50 hover:text-amber-800 flex items-center space-x-2.5 transition-colors cursor-pointer"
                                          >
                                            <FolderOpen className="w-4 h-4 text-amber-500 shrink-0" />
                                            <span>Open Folder</span>
                                          </button>

                                          <button
                                            onClick={() => {
                                              setActiveActionMenu(null);
                                              onDownloadZip(item.isbn);
                                            }}
                                            className="w-full px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-blue-50 hover:text-brand-700 flex items-center space-x-2.5 transition-colors cursor-pointer"
                                          >
                                            <Download className="w-4 h-4 text-brand-600 shrink-0" />
                                            <span>Download ZIP</span>
                                          </button>
                                        </div>

                                        <div className="py-1">
                                          <button
                                            onClick={(e) => {
                                              setActiveActionMenu(null);
                                              handleDeleteItem(item.isbn, e);
                                            }}
                                            className="w-full px-3.5 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 hover:text-rose-700 flex items-center space-x-2.5 transition-colors cursor-pointer"
                                          >
                                            <Trash2 className="w-4 h-4 shrink-0" />
                                            <span>Delete Record</span>
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })()}
                                </div>
                              </td>

                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

            </div>
          );
        })}
      </div>

      {/* 7 Shots Detailed Inspection Modal */}
      {selectedPhotoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl bg-white shadow-2xl border border-blue-100 overflow-hidden">
            <div className="p-4 border-b border-blue-100 flex items-center justify-between bg-blue-50/40">
              <div>
                <h3 className="text-base font-extrabold text-slate-900 font-mono">
                  {selectedPhotoModal.isbn} — 7 Verification Shots
                </h3>
                <p className="text-xs text-slate-500">
                  {selectedPhotoModal.item.metadata?.bookDetails?.title || 'Journal verification photos'}
                </p>
              </div>

              <button
                onClick={() => setSelectedPhotoModal(null)}
                className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="p-4 overflow-y-auto grid grid-cols-2 sm:grid-cols-4 gap-3">
              {SHOT_DEFINITIONS.map((def) => {
                const shotUrl = selectedPhotoModal.item.shots?.[def.shotNumber];

                return (
                  <div key={def.shotNumber} className="rounded-xl border border-blue-100 p-2.5 bg-slate-50 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-800">{def.label}</span>
                      <span className="text-[10px] font-semibold text-slate-400">{def.scope === 'box_level' ? 'Box' : 'Book'}</span>
                    </div>

                    <div className="relative aspect-[4/3] rounded-lg overflow-hidden bg-slate-950 flex items-center justify-center border border-slate-200">
                      {shotUrl ? (
                        <img
                          src={shotUrl}
                          alt={def.label}
                          className="w-full h-full object-contain cursor-pointer hover:opacity-90"
                          onClick={() => setActivePreviewImage(shotUrl)}
                        />
                      ) : (
                        <span className="text-xs text-slate-500">Missing</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Full Size High-Res Image Preview */}
      {activePreviewImage && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm cursor-pointer animate-fade-in"
          onClick={() => setActivePreviewImage(null)}
        >
          <div className="relative max-w-5xl max-h-[90vh] flex flex-col items-center">
            <img
              src={activePreviewImage}
              alt="Verification Photo Full"
              className="max-h-[85vh] max-w-full rounded-2xl object-contain shadow-2xl border border-white/20"
            />
            <p className="text-white/80 text-xs mt-3 font-medium">Click anywhere to close full preview</p>
          </div>
        </div>
      )}

      {/* S3 Upload Modal */}
      {s3UploadTarget && (
        <S3UploadModal
          isOpen={Boolean(s3UploadTarget)}
          onClose={() => setS3UploadTarget(null)}
          isbn={s3UploadTarget.isbn}
          item={s3UploadTarget.item}
          onUploadSuccess={() => fetchItems()}
        />
      )}

    </div>
  );
};
