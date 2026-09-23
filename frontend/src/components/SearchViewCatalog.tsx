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
  CloudUpload,
  Copy,
  Check,
  ExternalLink,
  ZoomIn,
  ZoomOut,
  RotateCw,
  ChevronLeft,
  X
} from 'lucide-react';
import { ProofItem, SHOT_DEFINITIONS } from '../types';

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
  const [expandedBoxes, setExpandedBoxes] = useState<Record<string, boolean>>({});
  const [uploadingS3Isbn, setUploadingS3Isbn] = useState<string | null>(null);
  const [activeActionMenu, setActiveActionMenu] = useState<string | null>(null);
  const [copiedS3Id, setCopiedS3Id] = useState<string | null>(null);
  const [selectedPhotoModal, setSelectedPhotoModal] = useState<{
    isbn: string;
    shots: Record<string, string | null>;
    item: ProofItem;
  } | null>(null);
  const [lightboxData, setLightboxData] = useState<{
    item: ProofItem;
    currentShotNumber: number;
    zoomLevel: number;
    rotation: number;
  } | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!lightboxData) return;
      if (e.key === 'Escape') {
        setLightboxData(null);
      } else if (e.key === 'ArrowLeft') {
        setLightboxData(prev => prev ? {
          ...prev,
          currentShotNumber: prev.currentShotNumber > 1 ? prev.currentShotNumber - 1 : 7,
          zoomLevel: 1,
          rotation: 0
        } : null);
      } else if (e.key === 'ArrowRight') {
        setLightboxData(prev => prev ? {
          ...prev,
          currentShotNumber: prev.currentShotNumber < 7 ? prev.currentShotNumber + 1 : 1,
          zoomLevel: 1,
          rotation: 0
        } : null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxData]);

  const toggleBoxExpand = (lotName: string, boxName: string) => {
    const boxKey = `${lotName}__${boxName}`;
    setExpandedBoxes(prev => ({ ...prev, [boxKey]: prev[boxKey] === false ? true : false }));
  };

  const isBoxExpanded = (lotName: string, boxName: string) => {
    const boxKey = `${lotName}__${boxName}`;
    return expandedBoxes[boxKey] !== false;
  };

  const handleCopyS3Link = (isbn: string, s3Link: string) => {
    navigator.clipboard.writeText(s3Link);
    setCopiedS3Id(isbn);
    setTimeout(() => setCopiedS3Id(null), 2500);
  };

  const handleManualS3Upload = async (isbn: string) => {
    setUploadingS3Isbn(isbn);
    try {
      const res = await fetch('/api/s3/upload-isbn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isbn })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        alert(`✓ Successfully uploaded ${isbn} to AWS S3!`);
        fetchItems();
      } else {
        alert(`S3 Upload Failed: ${data.error || 'Server error'}`);
      }
    } catch (err: any) {
      alert(`S3 Network Error: ${err.message}`);
    } finally {
      setUploadingS3Isbn(null);
    }
  };

  const [syncStatus, setSyncStatus] = useState<{
    isSyncing: boolean;
    totalPending: number;
    completedCount: number;
    failedCount: number;
    currentIsbn: string | null;
  } | null>(null);

  const checkSyncStatus = async () => {
    try {
      const res = await fetch('/api/s3/sync-status');
      if (res.ok) {
        const data = await res.json();
        setSyncStatus(data.progress);
      }
    } catch (e) {}
  };

  const handleSyncAllS3 = async () => {
    try {
      const res = await fetch('/api/s3/sync-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: false })
      });
      const data = await res.json();
      if (res.ok) {
        alert(`✓ Automatic S3 Sync active! Detected ${data.queued || 0} unuploaded journal(s). Uploading in the background.`);
        fetchItems();
        checkSyncStatus();
      }
    } catch (err: any) {
      alert(`Sync Error: ${err.message}`);
    }
  };

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
    checkSyncStatus();
    const interval = setInterval(() => {
      checkSyncStatus();
    }, 8000);
    return () => clearInterval(interval);
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

  // Structure data: Lot -> Box -> Items[]
  const lotGroups: Record<string, {
    boxes: Record<string, ProofItem[]>;
    totalBooks: number;
    completedCount: number;
  }> = {};

  for (const item of filteredItems) {
    const lot = item.lotNumber || item.metadata?.lotNumber || 'Unassigned Lot';
    const box = item.boxNumber || item.metadata?.boxNumber || 'Unassigned Box';

    if (!lotGroups[lot]) {
      lotGroups[lot] = {
        boxes: {},
        totalBooks: 0,
        completedCount: 0
      };
    }

    if (!lotGroups[lot].boxes[box]) {
      lotGroups[lot].boxes[box] = [];
    }

    lotGroups[lot].boxes[box].push(item);
    lotGroups[lot].totalBooks += 1;
    if (item.isComplete) {
      lotGroups[lot].completedCount += 1;
    }
  }

  const lotKeys = Object.keys(lotGroups);
  if (lotKeys.length === 0 && !loading) {
    lotGroups['Unassigned Lot'] = {
      boxes: {},
      totalBooks: 0,
      completedCount: 0
    };
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
            {/* Auto-Sync All to S3 Button */}
            <button
              onClick={handleSyncAllS3}
              disabled={syncStatus?.isSyncing}
              title="Automatically scan and upload all pending unuploaded journals to AWS S3"
              className={`inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border transition-all shadow-sm cursor-pointer ${
                syncStatus?.isSyncing
                  ? 'bg-amber-50 text-amber-900 border-amber-300 animate-pulse'
                  : 'text-brand-800 bg-gradient-to-b from-blue-50 to-indigo-50 hover:from-blue-100 hover:to-indigo-100 border-blue-200/80'
              }`}
            >
              <CloudUpload className={`w-4 h-4 ${syncStatus?.isSyncing ? 'animate-bounce text-amber-600' : 'text-brand-600'}`} />
              <span>
                {syncStatus?.isSyncing 
                  ? `Syncing S3 (${syncStatus.completedCount}/${syncStatus.totalPending})...` 
                  : 'Auto-Sync All to S3'}
              </span>
            </button>

            <button
              onClick={handleExportCsv}
              className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold text-emerald-800 bg-gradient-to-b from-emerald-50 to-teal-50 hover:from-emerald-100 hover:to-teal-100 border border-emerald-200/80 transition-all shadow-sm cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
              <span>Export Excel (CSV)</span>
            </button>

            <button
              onClick={() => { fetchItems(); checkSyncStatus(); }}
              title="Refresh Records"
              className="p-2 rounded-xl text-slate-500 hover:text-brand-700 hover:bg-blue-50 border border-slate-200 transition-colors cursor-pointer"
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
                {Object.keys(lotGroups).length} lots
              </span>
            </div>
          </div>

        </div>

      </div>

      {/* Lots & Boxes Grouped Table */}
      <div className="space-y-4">
        {Object.keys(lotGroups).map((lotName, lotIdx) => {
          const lotGroup = lotGroups[lotName];
          const isExpanded = expandedLots[lotName] !== false;
          const totalBooks = lotGroup.totalBooks;
          const completedCount = lotGroup.completedCount;
          const boxNames = Object.keys(lotGroup.boxes);

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
                    {boxNames.length} {boxNames.length === 1 ? 'box' : 'boxes'} • {totalBooks} {totalBooks === 1 ? 'book' : 'books'} ({completedCount} verified)
                  </span>
                  
                  <div className="flex items-center space-x-1 text-xs font-semibold text-blue-100">
                    <span>{isExpanded ? 'Collapse' : 'Expand'}</span>
                    {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </div>
                </div>
              </div>

              {/* Nested Box & Book Sub-Folders */}
              {isExpanded && (
                <div className="p-4 bg-white/70 rounded-b-2xl overflow-visible min-h-[140px] space-y-3.5">
                  {boxNames.length === 0 ? (
                    <div className="py-8 text-center text-slate-400">
                      <Package className="w-8 h-8 opacity-30 mx-auto mb-1 text-slate-400" />
                      <p className="text-xs font-semibold text-slate-500">No verification records in this lot yet.</p>
                      <p className="text-[11px] text-slate-400">Switch to Capture Mode to start photographing journals for {lotName}.</p>
                    </div>
                  ) : (
                    boxNames.map((boxName) => {
                      const boxItems = lotGroup.boxes[boxName];
                      const boxCompleted = boxItems.filter(i => i.isComplete).length;
                      const isExpandedBox = isBoxExpanded(lotName, boxName);

                      return (
                        <div
                          key={boxName}
                          className="border border-blue-200/70 rounded-xl overflow-hidden bg-white shadow-xs transition-all"
                        >
                          {/* Box Sub-Folder Header Bar */}
                          <div
                            onClick={() => toggleBoxExpand(lotName, boxName)}
                            className="px-4 py-2.5 bg-gradient-to-r from-blue-50/90 via-indigo-50/40 to-slate-50 border-b border-blue-100 flex items-center justify-between cursor-pointer hover:bg-blue-100/60 transition-colors select-none"
                          >
                            <div className="flex items-center space-x-3">
                              <div className="w-7 h-7 rounded-lg bg-white text-brand-700 flex items-center justify-center border border-blue-200 shadow-xs">
                                <Package className="w-4 h-4 text-brand-600" />
                              </div>
                              <div className="flex items-center space-x-2">
                                <span className="text-[10px] font-extrabold text-brand-700 tracking-wider uppercase">BOX</span>
                                <span className="font-mono font-extrabold text-xs sm:text-sm text-slate-900">{boxName}</span>
                              </div>
                              <span className="px-2.5 py-0.5 text-[11px] font-bold rounded-full bg-white text-brand-800 border border-blue-200/90 shadow-xs">
                                {boxItems.length} {boxItems.length === 1 ? 'journal' : 'journals'} ({boxCompleted} verified)
                              </span>
                            </div>

                            <div className="flex items-center space-x-1.5 text-xs font-bold text-brand-700">
                              <span className="text-[11px]">{isExpandedBox ? 'Collapse Box' : 'Expand Box'}</span>
                              {isExpandedBox ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                            </div>
                          </div>

                          {/* Table of Journals Inside This Box */}
                          {isExpandedBox && (
                            <div className="overflow-x-auto">
                              <table className="w-full text-left text-xs border-collapse">
                                <thead>
                                  <tr className="text-slate-400 font-bold uppercase tracking-wider text-[10px] border-b border-slate-100 bg-slate-50/50">
                                    <th className="py-2.5 px-3">#</th>
                                    <th className="py-2.5 px-3">ISBN & TITLE</th>
                                    <th className="py-2.5 px-3">PICTURES (7 SHOTS)</th>
                                    <th className="py-2.5 px-3">STATION / OPERATOR</th>
                                    <th className="py-2.5 px-3">STATUS</th>
                                    <th className="py-2.5 px-3 text-right">ACTIONS</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 font-sans">
                                  {boxItems.map((item, itemIdx) => {
                                    const book = item.metadata?.bookDetails;
                                    const station = item.metadata?.station || item.metadata?.operator || 'Station-01';

                                    return (
                                      <tr key={item.isbn} className="hover:bg-blue-50/30 transition-colors">
                                        <td className="py-3 px-3 font-mono text-slate-400 text-xs">
                                          {itemIdx + 1}
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
                                                      setLightboxData({
                                                        item,
                                                        currentShotNumber: s,
                                                        zoomLevel: 1,
                                                        rotation: 0
                                                      });
                                                    }
                                                  }}
                                                  title={`Shot ${s}: ${SHOT_DEFINITIONS[s - 1]?.label || 'Shot ' + s} (Click to inspect full size)`}
                                                  className={`w-7 h-7 rounded-md overflow-hidden flex items-center justify-center border cursor-pointer transition-transform hover:scale-110 active:scale-95 shadow-xs ${
                                                    shotUrl 
                                                      ? 'bg-slate-900 border-blue-200 ring-1 ring-blue-400/20' 
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
                                          <div className="flex flex-col gap-1 items-start">
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
                                            {item.metadata?.s3Upload ? (
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  const link = item.metadata?.s3Upload?.shareableLink || item.metadata?.s3Upload?.s3FolderUri;
                                                  if (link) handleCopyS3Link(item.isbn, link);
                                                }}
                                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-300 shadow-xs cursor-pointer transition-colors"
                                                title={`Uploaded to: ${item.metadata.s3Upload.s3FolderUri}\nClick to copy S3 link`}
                                              >
                                                <CloudUpload className="w-3 h-3 text-emerald-600" />
                                                <span>{copiedS3Id === item.isbn ? '✓ Link Copied' : 'S3 Synced'}</span>
                                              </button>
                                            ) : item.isComplete ? (
                                              <span
                                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200"
                                                title="Syncing to S3 in background..."
                                              >
                                                <CloudUpload className="w-3 h-3 text-blue-500 animate-pulse" />
                                                S3 Syncing...
                                              </span>
                                            ) : null}
                                          </div>
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
                                              const isNearBottom = itemIdx >= boxItems.length - 2 && boxItems.length >= 2;
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

                                                  {/* Manual AWS S3 Upload Option */}
                                                  <div className="py-1">
                                                    <button
                                                      onClick={() => {
                                                        setActiveActionMenu(null);
                                                        handleManualS3Upload(item.isbn);
                                                      }}
                                                      disabled={uploadingS3Isbn === item.isbn}
                                                      className="w-full px-3.5 py-2 text-xs font-bold text-blue-700 hover:bg-blue-50 flex items-center space-x-2.5 transition-colors cursor-pointer disabled:opacity-50"
                                                    >
                                                      <CloudUpload className={`w-4 h-4 text-blue-600 shrink-0 ${uploadingS3Isbn === item.isbn ? 'animate-bounce' : ''}`} />
                                                      <span>
                                                        {uploadingS3Isbn === item.isbn 
                                                          ? 'Uploading to S3...' 
                                                          : item.metadata?.s3Upload 
                                                            ? 'Re-upload to AWS S3' 
                                                            : 'Upload to AWS S3'}
                                                      </span>
                                                    </button>
                                                  </div>

                                                  {item.metadata?.s3Upload && (
                                                    <div className="py-1">
                                                      <button
                                                        onClick={() => {
                                                          setActiveActionMenu(null);
                                                          const link = item.metadata?.s3Upload?.shareableLink || item.metadata?.s3Upload?.s3FolderUri;
                                                          if (link) handleCopyS3Link(item.isbn, link);
                                                        }}
                                                        className="w-full px-3.5 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50 flex items-center space-x-2.5 transition-colors cursor-pointer"
                                                      >
                                                        <CloudUpload className="w-4 h-4 text-emerald-600 shrink-0" />
                                                        <span>{copiedS3Id === item.isbn ? '✓ Link Copied!' : 'Copy S3 Cloud Link'}</span>
                                                      </button>
                                                    </div>
                                                  )}

                                                  <div className="py-1">
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
                            </div>
                          )}
                        </div>
                      );
                    })
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

            {selectedPhotoModal.item.metadata?.s3Upload && (
              <div className="mx-4 mt-3 px-3.5 py-2.5 rounded-xl bg-emerald-50/90 border border-emerald-200 flex flex-wrap items-center justify-between gap-2 text-xs text-emerald-900 shadow-xs">
                <div className="flex items-center space-x-2.5">
                  <div className="p-1.5 rounded-lg bg-emerald-100 text-emerald-700">
                    <CloudUpload className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="font-bold block text-emerald-900 text-xs">
                      Saved to AWS S3 Cloud Storage
                    </span>
                    <span className="font-mono text-[11px] text-emerald-700 select-all block">
                      {selectedPhotoModal.item.metadata.s3Upload.s3FolderUri}
                    </span>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  {selectedPhotoModal.item.metadata.s3Upload.shareableLink && (
                    <a
                      href={selectedPhotoModal.item.metadata.s3Upload.shareableLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center space-x-1 px-2.5 py-1 text-[11px] font-bold bg-white text-emerald-800 border border-emerald-300 rounded-lg hover:bg-emerald-100 transition-colors"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>Open Link</span>
                    </a>
                  )}
                  <button
                    onClick={() => {
                      const link = selectedPhotoModal.item.metadata?.s3Upload?.shareableLink || selectedPhotoModal.item.metadata?.s3Upload?.s3FolderUri;
                      if (link) handleCopyS3Link(selectedPhotoModal.isbn, link);
                    }}
                    className="inline-flex items-center space-x-1 px-2.5 py-1 text-[11px] font-bold bg-emerald-700 text-white rounded-lg hover:bg-emerald-600 transition-colors cursor-pointer shadow-xs"
                  >
                    {copiedS3Id === selectedPhotoModal.isbn ? (
                      <>
                        <Check className="w-3 h-3" />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy S3 Link</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

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
                          className="w-full h-full object-contain cursor-pointer hover:opacity-90 transition-opacity"
                          onClick={() => setLightboxData({
                            item: selectedPhotoModal.item,
                            currentShotNumber: def.shotNumber,
                            zoomLevel: 1,
                            rotation: 0
                          })}
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

      {/* Crystal-Clear High-Resolution Photo Lightbox Inspector */}
      {lightboxData && (() => {
        const def = SHOT_DEFINITIONS.find(d => d.shotNumber === lightboxData.currentShotNumber) || SHOT_DEFINITIONS[0];
        const shotUrl = lightboxData.item.shots?.[lightboxData.currentShotNumber];

        const handlePrev = (e: React.MouseEvent) => {
          e.stopPropagation();
          const prevShot = lightboxData.currentShotNumber > 1 ? lightboxData.currentShotNumber - 1 : 7;
          setLightboxData(prev => prev ? { ...prev, currentShotNumber: prevShot, zoomLevel: 1, rotation: 0 } : null);
        };

        const handleNext = (e: React.MouseEvent) => {
          e.stopPropagation();
          const nextShot = lightboxData.currentShotNumber < 7 ? lightboxData.currentShotNumber + 1 : 1;
          setLightboxData(prev => prev ? { ...prev, currentShotNumber: nextShot, zoomLevel: 1, rotation: 0 } : null);
        };

        const handleZoomIn = (e: React.MouseEvent) => {
          e.stopPropagation();
          setLightboxData(prev => prev ? { ...prev, zoomLevel: Math.min(prev.zoomLevel + 0.5, 4) } : null);
        };

        const handleZoomOut = (e: React.MouseEvent) => {
          e.stopPropagation();
          setLightboxData(prev => prev ? { ...prev, zoomLevel: Math.max(prev.zoomLevel - 0.5, 0.5) } : null);
        };

        const handleResetZoom = (e: React.MouseEvent) => {
          e.stopPropagation();
          setLightboxData(prev => prev ? { ...prev, zoomLevel: 1, rotation: 0 } : null);
        };

        const handleRotate = (e: React.MouseEvent) => {
          e.stopPropagation();
          setLightboxData(prev => prev ? { ...prev, rotation: (prev.rotation + 90) % 360 } : null);
        };

        return (
          <div 
            className="fixed inset-0 z-[100] bg-slate-950/98 flex flex-col items-stretch justify-between animate-fade-in select-none"
            onClick={() => setLightboxData(null)}
          >
            {/* Top Controls Bar */}
            <div 
              className="p-3 sm:p-4 bg-slate-900/95 border-b border-white/10 flex flex-wrap items-center justify-between gap-3 text-white z-10"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center space-x-3">
                <span className="px-2.5 py-1 rounded-lg bg-brand-600 text-white font-bold text-xs">
                  Shot {def.shotNumber} of 7
                </span>
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <span>{def.label}</span>
                    <span className="text-xs font-normal text-slate-400 font-mono">({lightboxData.item.isbn})</span>
                  </h3>
                  <p className="text-[11px] text-slate-400 truncate max-w-md">
                    {lightboxData.item.metadata?.bookDetails?.title || `Lot: ${lightboxData.item.lotNumber} • Box: ${lightboxData.item.boxNumber}`}
                  </p>
                </div>
              </div>

              {/* Toolbar: Zoom, Rotate, Open Raw, Close */}
              <div className="flex items-center space-x-2">
                {/* Zoom Controls */}
                <div className="flex items-center bg-white/10 rounded-xl p-0.5 border border-white/15">
                  <button
                    onClick={handleZoomOut}
                    title="Zoom Out (-)"
                    className="p-1.5 hover:bg-white/20 rounded-lg text-slate-200 transition-colors cursor-pointer"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </button>
                  <span className="px-2 text-xs font-mono font-bold text-slate-300">
                    {Math.round(lightboxData.zoomLevel * 100)}%
                  </span>
                  <button
                    onClick={handleZoomIn}
                    title="Zoom In (+)"
                    className="p-1.5 hover:bg-white/20 rounded-lg text-slate-200 transition-colors cursor-pointer"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </button>
                </div>

                <button
                  onClick={handleResetZoom}
                  title="Reset Zoom to 100%"
                  className="px-2.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold text-slate-200 border border-white/15 transition-colors cursor-pointer"
                >
                  Fit
                </button>

                <button
                  onClick={handleRotate}
                  title="Rotate 90°"
                  className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-200 border border-white/15 transition-colors cursor-pointer"
                >
                  <RotateCw className="w-4 h-4" />
                </button>

                {shotUrl && (
                  <a
                    href={shotUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open full resolution in a new tab"
                    className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-200 border border-white/15 transition-colors flex items-center"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}

                <button
                  onClick={() => setLightboxData(null)}
                  title="Close Lightbox (Esc)"
                  className="p-2 rounded-xl bg-red-600/80 hover:bg-red-500 text-white font-bold transition-colors cursor-pointer ml-2"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Main Image Stage (with Pan / Zoom) */}
            <div 
              className="flex-1 relative flex items-center justify-center overflow-auto p-4 cursor-default"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Previous Button */}
              <button
                onClick={handlePrev}
                title="Previous Shot (Left Arrow)"
                className="absolute left-4 z-20 p-3 rounded-full bg-black/60 hover:bg-black/90 text-white border border-white/20 backdrop-blur-md transition-all active:scale-95 cursor-pointer shadow-xl"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>

              {shotUrl ? (
                <div 
                  className="transition-transform duration-200 ease-out flex items-center justify-center max-w-full max-h-full"
                  style={{
                    transform: `scale(${lightboxData.zoomLevel}) rotate(${lightboxData.rotation}deg)`,
                    transformOrigin: 'center center'
                  }}
                >
                  <img
                    src={shotUrl}
                    alt={def.label}
                    className="max-h-[72vh] max-w-[85vw] object-contain rounded-lg shadow-2xl border border-white/10"
                    style={{ imageRendering: 'auto' }}
                  />
                </div>
              ) : (
                <div className="text-center text-slate-400 p-12 bg-slate-900/60 rounded-2xl border border-white/10">
                  <AlertCircle className="w-12 h-12 mx-auto mb-3 text-slate-500" />
                  <h4 className="text-base font-bold text-white mb-1">Shot {def.shotNumber} Not Captured</h4>
                  <p className="text-xs text-slate-400">This shot is missing for ISBN {lightboxData.item.isbn}</p>
                </div>
              )}

              {/* Next Button */}
              <button
                onClick={handleNext}
                title="Next Shot (Right Arrow)"
                className="absolute right-4 z-20 p-3 rounded-full bg-black/60 hover:bg-black/90 text-white border border-white/20 backdrop-blur-md transition-all active:scale-95 cursor-pointer shadow-xl"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            </div>

            {/* Bottom 7-Shot Thumbnail Strip */}
            <div 
              className="p-3 bg-slate-900/95 border-t border-white/10 flex items-center justify-center gap-2 overflow-x-auto z-10"
              onClick={(e) => e.stopPropagation()}
            >
              {SHOT_DEFINITIONS.map((d) => {
                const thumbUrl = lightboxData.item.shots?.[d.shotNumber];
                const isSelected = d.shotNumber === lightboxData.currentShotNumber;

                return (
                  <button
                    key={d.shotNumber}
                    onClick={() => setLightboxData(prev => prev ? { ...prev, currentShotNumber: d.shotNumber, zoomLevel: 1, rotation: 0 } : null)}
                    className={`flex items-center space-x-2 px-3 py-1.5 rounded-xl border transition-all cursor-pointer shrink-0 ${
                      isSelected
                        ? 'bg-brand-600 text-white border-brand-400 shadow-md ring-2 ring-brand-400/40'
                        : 'bg-slate-800/80 hover:bg-slate-800 text-slate-300 border-white/10'
                    }`}
                  >
                    <div className="w-6 h-6 rounded bg-black overflow-hidden flex items-center justify-center shrink-0 border border-white/15">
                      {thumbUrl ? (
                        <img src={thumbUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-[9px] font-mono text-slate-500">{d.shotNumber}</span>
                      )}
                    </div>
                    <div className="text-left">
                      <span className="text-xs font-bold block leading-tight">{d.shotNumber}. {d.label}</span>
                      <span className="text-[10px] text-slate-400 block">{d.scope === 'box_level' ? 'Box' : 'Book'}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}

    </div>
  );
};
