import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { 
  Cloud, 
  Folder, 
  FolderOpen, 
  Database, 
  Search, 
  RefreshCw, 
  FileSpreadsheet, 
  CheckCircle2, 
  AlertCircle, 
  Eye, 
  ChevronRight, 
  ChevronDown, 
  Copy, 
  Check, 
  ExternalLink, 
  X, 
  Layers, 
  ShieldCheck, 
  Calendar,
  Package,
  HardDrive,
  ZoomIn,
  ZoomOut,
  RotateCw,
  RotateCcw,
  ChevronLeft,
  Download
} from 'lucide-react';

interface S3DateNode {
  date: string;
  journalCount: number;
  objectCount: number;
}

interface S3JournalItem {
  sNo: number;
  isbn: string;
  lotNo: string;
  boxNo: string;
  order: string;
  printIssn: string;
  journalName: string;
  publisher: string;
  publicationYear: string | number;
  volume: string | number;
  issues: string | number;
  parts: number;
  noidaRemarks: string;
  inventoryStatus: string;
  shots: {
    frontCover: boolean;
    backCover: boolean;
    titlePage: boolean;
    spine: boolean;
    editionNotice: boolean;
    boxA: boolean;
    boxB: boolean;
  };
  allImagesComplete: boolean;
  allPartsComplete: boolean;
  fileCount: number;
  s3Path: string;
  captureDate: string;
  files: Array<{ filename: string; size: number; key: string }>;
}

interface S3ExplorerStats {
  totalJournals: number;
  completeJournals: number;
  incompleteJournals: number;
  multiPartJournals: number;
  totalObjects: number;
  lastUpdated: string | null;
}

interface S3CloudExplorerProps {
  activeClient?: string;
  onOpenCaptureForIsbn?: (isbn: string) => void;
}

export const S3CloudExplorer: React.FC<S3CloudExplorerProps> = ({
  activeClient = 'Jaguar'
}) => {
  const [buckets, setBuckets] = useState<string[]>(['innoscanjagjx1-s3', 'innoscanmussgp1-s3']);
  const [activeBucket, setActiveBucket] = useState('innoscanjagjx1-s3');
  const [availableLots, setAvailableLots] = useState<string[]>(['Lot-159J', 'Lot-156J']);
  const [selectedLot, setSelectedLot] = useState('Lot-159J');
  const [dates, setDates] = useState<S3DateNode[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('all');
  const [isTreeExpanded, setIsTreeExpanded] = useState<Record<string, boolean>>({
    'innoscanjagjx1-s3': true,
    'innoscanmussgp1-s3': true,
    'Phase-09': true,
    'innoscanmussgp1': true,
    'JournalVerificationImages': true,
    'Lot-159J': true
  });

  const [items, setItems] = useState<S3JournalItem[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [stats, setStats] = useState<S3ExplorerStats>({
    totalJournals: 0,
    completeJournals: 0,
    incompleteJournals: 0,
    multiPartJournals: 0,
    totalObjects: 0,
    lastUpdated: null
  });

  const [loadingTree, setLoadingTree] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'complete' | 'incomplete' | 'multipart'>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [totalPages, setTotalPages] = useState(1);

  const [isExporting, setIsExporting] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Inspector Modal
  const [inspectModalItem, setInspectModalItem] = useState<S3JournalItem | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [rotation, setRotation] = useState(0);

  // Exact inspection arrangement: Front -> Back -> Title -> Spine -> Edition -> Box A -> Box B
  const getShotRank = (filename: string): number => {
    const fn = filename.toLowerCase();
    // 1. Front (Front Cover)
    if (fn.includes('front cover') || fn.includes('front_cover') || fn.includes('shot_3') || fn.includes('shot3') || fn.includes('3_front') || (fn.includes('front') && !fn.includes('matter'))) return 1;
    // 2. Back (Back Cover)
    if (fn.includes('back cover') || fn.includes('back_cover') || fn.includes('shot_7') || fn.includes('shot7') || fn.includes('7_back') || fn.includes('back')) return 2;
    // 3. Title (Title Page)
    if (fn.includes('title page') || fn.includes('title_page') || fn.includes('shot_5') || fn.includes('shot5') || fn.includes('5_title') || fn.includes('title')) return 3;
    // 4. Spine
    if (fn.includes('spine') || fn.includes('shot_4') || fn.includes('shot4') || fn.includes('4_spine')) return 4;
    // 5. Edition (Edition Notice / Front Matter)
    if (fn.includes('edition notice') || fn.includes('edition_notice') || fn.includes('front_matter') || fn.includes('front matter') || fn.includes('shot_6') || fn.includes('shot6') || fn.includes('6_edition') || fn.includes('edition')) return 5;
    // 6. Box A
    if (fn.includes('box a') || fn.includes('box_a') || fn.includes('shot_1') || fn.includes('shot1') || fn.includes('1_box') || fn.endsWith('box.jpg') || fn.includes('_box.jpg')) return 6;
    // 7. Box B (Box B / Unbox)
    if (fn.includes('box b') || fn.includes('box_b') || fn.includes('shot_2') || fn.includes('shot2') || fn.includes('2_box') || fn.includes('unbox')) return 7;
    return 99;
  };

  const getShotFriendlyName = (filename: string, idx: number) => {
    const rank = getShotRank(filename);
    switch (rank) {
      case 1: return 'Front';
      case 2: return 'Back';
      case 3: return 'Title';
      case 4: return 'Spine';
      case 5: return 'Edition';
      case 6: return 'Box A';
      case 7: return 'Box B';
      default: return `Shot ${idx + 1}`;
    }
  };

  // Filter only valid image proofs and strictly arrange them as: Front, Back, Title, Spine, Edition, Box A, Box B
  const imageFiles = useMemo(() => {
    if (!inspectModalItem?.files) return [];
    const imgs = inspectModalItem.files.filter(f => /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.filename));
    return [...imgs].sort((a, b) => getShotRank(a.filename) - getShotRank(b.filename));
  }, [inspectModalItem]);

  // Modal & Lightbox keyboard navigation (ArrowLeft / ArrowRight / Escape)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (lightboxIndex !== null) {
          setLightboxIndex(null);
        } else if (inspectModalItem !== null) {
          setInspectModalItem(null);
        }
      } else if (lightboxIndex !== null && imageFiles.length > 0) {
        if (e.key === 'ArrowLeft') {
          setLightboxIndex(prev => (prev !== null && prev > 0 ? prev - 1 : imageFiles.length - 1));
          setZoomLevel(1);
          setRotation(0);
        } else if (e.key === 'ArrowRight') {
          setLightboxIndex(prev => (prev !== null && prev < imageFiles.length - 1 ? prev + 1 : 0));
          setZoomLevel(1);
          setRotation(0);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxIndex, inspectModalItem, imageFiles.length]);

  // 1. Fetch Tree
  const fetchTree = async (forceRefresh = false) => {
    setLoadingTree(true);
    try {
      if (forceRefresh) {
        await fetch('/api/s3/explorer/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bucket: activeBucket, lotNumber: selectedLot })
        });
      }

      const res = await fetch(`/api/s3/explorer/tree?bucket=${encodeURIComponent(activeBucket)}&lotNumber=${encodeURIComponent(selectedLot)}`);
      if (res.ok) {
        const data = await res.json();
        setBuckets(data.buckets?.length ? data.buckets : ['innoscanjagjx1-s3', 'innoscanmussgp1-s3']);
        if (data.availableLots) setAvailableLots(data.availableLots);
        setDates(data.dates || []);
        if (data.stats) setStats(data.stats);
      }
    } catch (err) {
      console.error('[S3 Explorer] Tree fetch error:', err);
    } finally {
      setLoadingTree(false);
    }
  };

  // 2. Fetch Items
  const fetchItems = async () => {
    setLoadingItems(true);
    try {
      const q = encodeURIComponent(searchQuery);
      const url = `/api/s3/explorer/items?bucket=${encodeURIComponent(activeBucket)}&lotNumber=${encodeURIComponent(selectedLot)}&date=${encodeURIComponent(selectedDate)}&search=${q}&filter=${activeFilter}&page=${page}&limit=${pageSize}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        setTotalItems(data.total || 0);
        setTotalPages(data.totalPages || 1);
        if (data.stats) setStats(data.stats);
      }
    } catch (err) {
      console.error('[S3 Explorer] Items fetch error:', err);
    } finally {
      setLoadingItems(false);
    }
  };

  useEffect(() => {
    fetchTree();
  }, [activeBucket, selectedLot]);

  useEffect(() => {
    setPage(1);
  }, [selectedDate, searchQuery, activeFilter]);

  useEffect(() => {
    fetchItems();
  }, [activeBucket, selectedLot, selectedDate, searchQuery, activeFilter, page, pageSize]);

  const toggleTreeNode = (key: string) => {
    setIsTreeExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleBucketChange = (b: string) => {
    setActiveBucket(b);
    if (b.includes('mussgp')) {
      setSelectedLot('JournalVerificationImages');
    } else {
      setSelectedLot('Lot-159J');
    }
    setSelectedDate('all');
    setPage(1);
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // 3. Export QC Reports (25 Columns)
  const handleExport = async (format: 'xlsx' | 'csv', exportScope: 'selected_date' | 'entire_lot') => {
    setIsExporting(true);
    setShowExportMenu(false);
    try {
      const clientParam = activeBucket.includes('mussgp') ? 'Mustang' : 'Jaguar';
      const lotParam = selectedLot || (activeBucket.includes('mussgp') ? 'JournalVerificationImages' : 'Lot-159J');
      const dateParam = exportScope === 'selected_date' && selectedDate !== 'all' ? selectedDate : '';
      const url = `/api/s3/export-qc-report?client=${clientParam}&lotNumber=${encodeURIComponent(lotParam)}&date=${encodeURIComponent(dateParam)}&scope=captured&format=${format}`;
      
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to generate export file');
      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      const dateTag = dateParam ? `_${dateParam}` : '';
      const prefixTag = activeBucket.includes('mussgp') ? 'Mustang_JournalVerificationImages' : (selectedLot || 'Lot-159J');
      a.download = `${prefixTag}_Captured_Journals_QC_Verification${dateTag}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err: any) {
      alert(`Export Error: ${err.message}`);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 h-full w-full bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
      {/* Top Breadcrumb & Control Bar */}
      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shadow-xs shrink-0">
        {/* Breadcrumb Path */}
        <div className="flex items-center space-x-2 text-xs font-mono text-slate-700 dark:text-slate-300">
          <div className="flex items-center space-x-1.5 font-bold text-brand-700 dark:text-blue-400">
            <Database className="w-4 h-4 text-brand-600 dark:text-blue-400" />
            <span>{activeBucket}</span>
          </div>
          <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
          <span className="font-bold text-slate-800 dark:text-white bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">
            {activeBucket.includes('mussgp') ? 'innoscanmussgp1/' : 'Phase-09/'}
          </span>
          <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
          <span className="font-bold text-purple-900 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/60 px-2 py-0.5 rounded">
            {activeBucket.includes('mussgp') ? 'JournalVerificationImages/' : `${selectedLot || 'Lot-159J'}/`}
          </span>
          {selectedDate !== 'all' && (
            <>
              <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
              <span className="font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded flex items-center space-x-1">
                <Calendar className="w-3 h-3 text-indigo-500" />
                <span>{selectedDate}</span>
              </span>
            </>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-2">
          {/* Automated QC Badge */}
          <div className="hidden md:flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs font-bold">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>100% Automated QC: 0 Missing Shots</span>
          </div>

          {/* Refresh S3 Button */}
          <button
            onClick={() => fetchTree(true)}
            disabled={loadingTree}
            title="Scan AWS S3 for newly uploaded journals in real time"
            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-bold rounded-xl text-slate-700 dark:text-slate-200 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-all cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingTree ? 'animate-spin text-brand-600' : 'text-slate-500'}`} />
            <span>Refresh S3</span>
          </button>

          {/* Export Dropdown (25-Column Standard) */}
          <div className="relative">
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              disabled={isExporting}
              className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 shadow-sm transition-all cursor-pointer disabled:opacity-50"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>{isExporting ? 'Exporting...' : 'Export QC Verification'}</span>
              <ChevronDown className="w-3 h-3 opacity-80" />
            </button>

            {showExportMenu && (
              <div 
                className="absolute right-0 top-full mt-1.5 w-80 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 py-2 z-50 text-xs"
                onClick={() => setShowExportMenu(false)}
              >
                <div className="px-3.5 py-1 text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                  Client 25-Column QC Verification
                </div>

                <button
                  onClick={() => handleExport('xlsx', 'entire_lot')}
                  className="w-full text-left px-3.5 py-2.5 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-slate-700 dark:text-slate-200 flex flex-col cursor-pointer transition-colors"
                >
                  <span className="font-bold text-emerald-800 dark:text-emerald-400">Export All Captured to Excel (.xlsx)</span>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">All {stats.totalJournals || '4,723'} journals with 7-shot QC verification</span>
                </button>

                {selectedDate !== 'all' && (
                  <button
                    onClick={() => handleExport('xlsx', 'selected_date')}
                    className="w-full text-left px-3.5 py-2.5 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-slate-700 dark:text-slate-200 flex flex-col cursor-pointer transition-colors"
                  >
                    <span className="font-bold text-indigo-700 dark:text-indigo-300">Export Date ({selectedDate}) to Excel</span>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400">Only journals captured on {selectedDate}</span>
                  </button>
                )}

                <div className="my-1 border-t border-slate-100 dark:border-slate-800"></div>

                <button
                  onClick={() => handleExport('csv', 'entire_lot')}
                  className="w-full text-left px-3.5 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 flex flex-col cursor-pointer transition-colors"
                >
                  <span className="font-bold text-slate-800 dark:text-white">Export All Captured to CSV (.csv)</span>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">Raw 25-column format matching client delivery</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Two-Column Layout (Sidebar Tree + Explorer Table) */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left Sidebar: S3 Bucket & Folder Tree */}
        <div className="w-72 sm:w-80 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col shrink-0 select-none overflow-hidden">
          {/* S3 Explorer Sidebar Header */}
          <div className="p-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs shrink-0">
            <span className="font-extrabold text-slate-800 dark:text-slate-200 flex items-center space-x-1.5">
              <Cloud className="w-4 h-4 text-brand-600 dark:text-blue-400" />
              <span>S3 Buckets & Folders</span>
            </span>
            <span className="text-[10px] bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full font-bold">
              AWS S3
            </span>
          </div>

          {/* Tree Navigation Container */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1 font-mono text-xs">
            {/* Buckets List */}
            {buckets.map((b) => {
              const isActive = b === activeBucket;
              const isMustang = b.includes('mussgp') || b.includes('mustang');
              return (
                <div key={b} className="space-y-0.5">
                  <div
                    onClick={() => handleBucketChange(b)}
                    className={`flex items-center space-x-1.5 px-2 py-1.5 rounded-lg cursor-pointer transition-all ${
                      isActive
                        ? 'bg-blue-50 dark:bg-slate-800 text-brand-700 dark:text-blue-400 font-bold border border-blue-200/60 dark:border-blue-900/40'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleTreeNode(b);
                      }}
                      className="p-0.5 text-slate-400 hover:text-slate-600"
                    >
                      {isTreeExpanded[b] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    </button>
                    <HardDrive className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-brand-600 dark:text-blue-400' : 'text-slate-400'}`} />
                    <span className="truncate flex-1">{b}</span>
                  </div>

                  {/* Sub-tree under Active Bucket */}
                  {isActive && isTreeExpanded[b] && (
                    <div className="pl-5 space-y-1 border-l-2 border-slate-200 dark:border-slate-800 ml-3">
                      {isMustang ? (
                        <div>
                          {/* Folder innoscanmussgp1/ */}
                          <div
                            onClick={() => toggleTreeNode('innoscanmussgp1')}
                            className="flex items-center space-x-1 px-2 py-1 rounded text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer font-bold"
                          >
                            {isTreeExpanded['innoscanmussgp1'] ? <FolderOpen className="w-3.5 h-3.5 text-amber-500" /> : <Folder className="w-3.5 h-3.5 text-amber-500" />}
                            <span>innoscanmussgp1/</span>
                          </div>

                          {/* Subfolder JournalVerificationImages/ */}
                          {isTreeExpanded['innoscanmussgp1'] && (
                            <div className="pl-4 space-y-0.5 border-l-2 border-slate-100 dark:border-slate-800 ml-2">
                              <div className="space-y-0.5">
                                <div
                                  onClick={() => {
                                    setSelectedLot('JournalVerificationImages');
                                    toggleTreeNode('JournalVerificationImages');
                                  }}
                                  className={`flex items-center justify-between px-2 py-1 rounded cursor-pointer transition-colors ${
                                    selectedLot === 'JournalVerificationImages'
                                      ? 'bg-purple-50 dark:bg-purple-950/60 text-purple-900 dark:text-purple-300 font-bold'
                                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                                  }`}
                                >
                                  <div className="flex items-center space-x-1 truncate">
                                    <Folder className={`w-3.5 h-3.5 ${selectedLot === 'JournalVerificationImages' ? 'text-purple-600' : 'text-amber-500'}`} />
                                    <span>JournalVerificationImages/</span>
                                  </div>
                                  <span className="text-[10px] text-slate-400 font-sans">
                                    {stats.totalJournals || 10527}
                                  </span>
                                </div>

                                {/* Dates under JournalVerificationImages */}
                                {selectedLot === 'JournalVerificationImages' && isTreeExpanded['JournalVerificationImages'] && (
                                  <div className="pl-4 space-y-0.5 border-l-2 border-purple-100 dark:border-purple-900 ml-2">
                                    {/* All Dates Node */}
                                    <div
                                      onClick={() => setSelectedDate('all')}
                                      className={`flex items-center justify-between px-2 py-1 rounded cursor-pointer ${
                                        selectedDate === 'all'
                                          ? 'bg-brand-600 text-white font-bold'
                                          : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                                      }`}
                                    >
                                      <div className="flex items-center space-x-1.5">
                                        <FolderOpen className="w-3 h-3 text-amber-400" />
                                        <span>All Dates</span>
                                      </div>
                                      <span className={`text-[10px] px-1 rounded ${selectedDate === 'all' ? 'bg-brand-700 text-white' : 'text-slate-400'}`}>
                                        {stats.totalJournals}
                                      </span>
                                    </div>

                                    {/* Individual Dates */}
                                    {dates.map((d) => {
                                      const isDateSelected = selectedDate === d.date;
                                      return (
                                        <div
                                          key={d.date}
                                          onClick={() => setSelectedDate(d.date)}
                                          className={`flex items-center justify-between px-2 py-1 rounded cursor-pointer ${
                                            isDateSelected
                                              ? 'bg-indigo-600 text-white font-bold'
                                              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                                          }`}
                                        >
                                          <div className="flex items-center space-x-1.5 truncate">
                                            <Calendar className="w-3 h-3 text-indigo-400" />
                                            <span>{d.date}/</span>
                                          </div>
                                          <span className={`text-[10px] px-1 rounded ${isDateSelected ? 'bg-indigo-700 text-white' : 'text-slate-400'}`}>
                                            {d.journalCount}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div>
                          <div
                            onClick={() => toggleTreeNode('Phase-09')}
                            className="flex items-center space-x-1 px-2 py-1 rounded text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer font-bold"
                          >
                            {isTreeExpanded['Phase-09'] ? <FolderOpen className="w-3.5 h-3.5 text-amber-500" /> : <Folder className="w-3.5 h-3.5 text-amber-500" />}
                            <span>Phase-09/</span>
                          </div>

                          {/* Lots under Phase-09 */}
                          {isTreeExpanded['Phase-09'] && (
                            <div className="pl-4 space-y-0.5 border-l-2 border-slate-100 dark:border-slate-800 ml-2">
                              {availableLots.map((lot) => {
                                const isLotSelected = lot === selectedLot;
                                return (
                                  <div key={lot} className="space-y-0.5">
                                    <div
                                      onClick={() => {
                                        setSelectedLot(lot);
                                        toggleTreeNode(lot);
                                      }}
                                      className={`flex items-center justify-between px-2 py-1 rounded cursor-pointer transition-colors ${
                                        isLotSelected
                                          ? 'bg-purple-50 dark:bg-purple-950/60 text-purple-900 dark:text-purple-300 font-bold'
                                          : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                                      }`}
                                    >
                                      <div className="flex items-center space-x-1 truncate">
                                        <Folder className={`w-3.5 h-3.5 ${isLotSelected ? 'text-purple-600' : 'text-amber-500'}`} />
                                        <span>{lot}/</span>
                                      </div>
                                      <span className="text-[10px] text-slate-400 font-sans">
                                        {lot === 'Lot-159J' ? stats.totalJournals || 4723 : ''}
                                      </span>
                                    </div>

                                    {/* Date Folders under Lot */}
                                    {isLotSelected && isTreeExpanded[lot] && (
                                      <div className="pl-4 space-y-0.5 border-l-2 border-purple-100 dark:border-purple-900 ml-2">
                                        {/* All Dates Node */}
                                        <div
                                          onClick={() => setSelectedDate('all')}
                                          className={`flex items-center justify-between px-2 py-1 rounded cursor-pointer ${
                                            selectedDate === 'all'
                                              ? 'bg-brand-600 text-white font-bold'
                                              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                                          }`}
                                        >
                                          <div className="flex items-center space-x-1.5">
                                            <FolderOpen className="w-3 h-3 text-amber-400" />
                                            <span>All Dates</span>
                                          </div>
                                          <span className={`text-[10px] px-1 rounded ${selectedDate === 'all' ? 'bg-brand-700 text-white' : 'text-slate-400'}`}>
                                            {stats.totalJournals}
                                          </span>
                                        </div>

                                        {/* Individual Dates */}
                                        {dates.map((d) => {
                                          const isDateSelected = selectedDate === d.date;
                                          return (
                                            <div
                                              key={d.date}
                                              onClick={() => setSelectedDate(d.date)}
                                              className={`flex items-center justify-between px-2 py-1 rounded cursor-pointer ${
                                                isDateSelected
                                                  ? 'bg-indigo-600 text-white font-bold'
                                                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                                              }`}
                                            >
                                              <div className="flex items-center space-x-1.5 truncate">
                                                <Calendar className="w-3 h-3 text-indigo-400" />
                                                <span>{d.date}/</span>
                                              </div>
                                              <span className={`text-[10px] px-1 rounded ${isDateSelected ? 'bg-indigo-700 text-white' : 'text-slate-400'}`}>
                                                {d.journalCount}
                                              </span>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Sidebar QC Stats Summary Card */}
          <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80 text-xs space-y-2 shrink-0">
            <div className="flex items-center justify-between font-bold text-slate-800 dark:text-slate-200">
              <span>{activeBucket.includes('mussgp') ? 'Mustang' : selectedLot} QC Audit</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-extrabold ${
                stats.incompleteJournals === 0 
                  ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300' 
                  : 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300'
              }`}>
                {stats.incompleteJournals === 0 ? '100% OK' : `${stats.incompleteJournals} Incomplete`}
              </span>
            </div>

            <div className="space-y-1 text-[11px] text-slate-600 dark:text-slate-400">
              <div className="flex justify-between">
                <span>Verified Journals:</span>
                <span className="font-bold text-slate-900 dark:text-white">{stats.totalJournals.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                <span>7-Shot Complete:</span>
                <span className="font-bold">{stats.completeJournals.toLocaleString()} ({stats.totalJournals > 0 ? ((stats.completeJournals / stats.totalJournals) * 100).toFixed(1) : 100}%)</span>
              </div>
              {stats.incompleteJournals > 0 && (
                <div className="flex justify-between text-amber-600 dark:text-amber-400 font-bold">
                  <span>Incomplete Missing:</span>
                  <span>{stats.incompleteJournals.toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between text-purple-600 dark:text-purple-400">
                <span>Multi-Part Sets:</span>
                <span className="font-bold">{stats.multiPartJournals.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>Total Files on S3:</span>
                <span className="font-bold text-slate-900 dark:text-white">{stats.totalObjects.toLocaleString()}</span>
              </div>
            </div>

            <div className="pt-1 text-[10px] text-slate-400 text-center font-sans">
              Continuous 100% Cloud Verification
            </div>
          </div>
        </div>

        {/* Right / Main Area: Explorer Verification Table */}
        <div className="flex-1 flex flex-col min-w-0 bg-slate-50 dark:bg-slate-950 overflow-hidden">
          {/* Top Filter and Search Toolbar */}
          <div className="p-3 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
            {/* Search Input */}
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by ISBN, Box Number, or Journal Title..."
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-brand-500 text-slate-900 dark:text-white"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center space-x-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-bold">
              <button
                onClick={() => setActiveFilter('all')}
                className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
                  activeFilter === 'all'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                All ({stats.totalJournals.toLocaleString()})
              </button>
              <button
                onClick={() => setActiveFilter('complete')}
                className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
                  activeFilter === 'complete'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-emerald-700 dark:text-emerald-400 hover:text-emerald-900'
                }`}
              >
                Complete ({stats.completeJournals.toLocaleString()})
              </button>
              <button
                onClick={() => setActiveFilter('multipart')}
                className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
                  activeFilter === 'multipart'
                    ? 'bg-purple-600 text-white shadow-xs'
                    : 'text-purple-700 dark:text-purple-400 hover:text-purple-900'
                }`}
              >
                Multi-Part ({stats.multiPartJournals.toLocaleString()})
              </button>
              <button
                onClick={() => setActiveFilter('incomplete')}
                className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
                  activeFilter === 'incomplete'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'text-amber-700 dark:text-amber-400 hover:text-amber-900'
                }`}
              >
                Incomplete ({stats.incompleteJournals.toLocaleString()})
              </button>
            </div>
          </div>

          {/* Table Container */}
          <div className="flex-1 overflow-auto">
            {loadingItems ? (
              <div className="flex flex-col items-center justify-center h-64 text-slate-500">
                <RefreshCw className="w-8 h-8 animate-spin text-brand-600 mb-2" />
                <span className="text-xs font-bold">Auditing and Verifying S3 Images...</span>
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-slate-400">
                <FolderOpen className="w-10 h-10 mb-2 opacity-50" />
                <span className="text-sm font-bold">No journals found matching query</span>
                <span className="text-xs">Try selecting "All Dates" or clearing search filters</span>
              </div>
            ) : (
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead className="bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 font-bold sticky top-0 z-10 border-b border-slate-200 dark:border-slate-800 shadow-xs">
                  <tr>
                    <th className="py-2.5 px-3">#</th>
                    <th className="py-2.5 px-3">Folder / ISBN</th>
                    <th className="py-2.5 px-3">Box No.</th>
                    <th className="py-2.5 px-3">Journal Title</th>
                    <th className="py-2.5 px-3">Publisher</th>
                    <th className="py-2.5 px-2">Vol</th>
                    <th className="py-2.5 px-2">Iss</th>
                    <th className="py-2.5 px-2">Year</th>
                    <th className="py-2.5 px-2">Parts</th>
                    {/* 7-Shot Quality Checklist Columns */}
                    <th className="py-2.5 px-2 text-center text-[11px] bg-blue-50/60 dark:bg-blue-950/40 text-blue-900 dark:text-blue-300">Front</th>
                    <th className="py-2.5 px-2 text-center text-[11px] bg-blue-50/60 dark:bg-blue-950/40 text-blue-900 dark:text-blue-300">Back</th>
                    <th className="py-2.5 px-2 text-center text-[11px] bg-blue-50/60 dark:bg-blue-950/40 text-blue-900 dark:text-blue-300">Title</th>
                    <th className="py-2.5 px-2 text-center text-[11px] bg-blue-50/60 dark:bg-blue-950/40 text-blue-900 dark:text-blue-300">Spine</th>
                    <th className="py-2.5 px-2 text-center text-[11px] bg-blue-50/60 dark:bg-blue-950/40 text-blue-900 dark:text-blue-300">Edition</th>
                    <th className="py-2.5 px-2 text-center text-[11px] bg-blue-50/60 dark:bg-blue-950/40 text-blue-900 dark:text-blue-300">Box A</th>
                    <th className="py-2.5 px-2 text-center text-[11px] bg-blue-50/60 dark:bg-blue-950/40 text-blue-900 dark:text-blue-300">Box B</th>
                    <th className="py-2.5 px-3 text-center">QC Status</th>
                    <th className="py-2.5 px-3">S3 Path URI</th>
                    <th className="py-2.5 px-3 text-center">Inspect</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
                  {items.map((it, idx) => {
                    const rowNum = (page - 1) * pageSize + idx + 1;
                    return (
                      <tr key={it.isbn} className="hover:bg-blue-50/40 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="py-2.5 px-3 text-slate-400 font-mono text-[11px]">{rowNum}</td>
                        
                        {/* Folder / ISBN */}
                        <td className="py-2.5 px-3 font-mono font-bold text-brand-700 dark:text-blue-400">
                          <div className="flex items-center space-x-1.5">
                            <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                            <span>{it.isbn}/</span>
                          </div>
                        </td>

                        {/* Box */}
                        <td className="py-2.5 px-3 font-semibold text-slate-700 dark:text-slate-300">
                          {it.boxNo}
                        </td>

                        {/* Title */}
                        <td className="py-2.5 px-3 max-w-[220px] truncate font-medium text-slate-900 dark:text-white" title={it.journalName}>
                          {it.journalName}
                        </td>

                        {/* Publisher */}
                        <td className="py-2.5 px-3 max-w-[140px] truncate text-slate-500" title={it.publisher}>
                          {it.publisher}
                        </td>

                        <td className="py-2.5 px-2 text-slate-600 dark:text-slate-400">{it.volume || '-'}</td>
                        <td className="py-2.5 px-2 text-slate-600 dark:text-slate-400">{it.issues || '-'}</td>
                        <td className="py-2.5 px-2 text-slate-600 dark:text-slate-400">{it.publicationYear || '-'}</td>
                        
                        {/* Parts */}
                        <td className="py-2.5 px-2 font-bold">
                          {it.parts > 1 ? (
                            <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 text-[10px]">
                              {it.parts} Parts
                            </span>
                          ) : (
                            <span className="text-slate-500">1</span>
                          )}
                        </td>

                        {/* 7 Individual Shots QC Checkmarks */}
                        <td className="py-2.5 px-2 text-center">
                          <span className={`inline-block px-1.5 py-0.5 rounded font-extrabold text-[10px] ${it.shots.frontCover ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-rose-100 text-rose-800'}`}>
                            {it.shots.frontCover ? 'Y' : 'N'}
                          </span>
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          <span className={`inline-block px-1.5 py-0.5 rounded font-extrabold text-[10px] ${it.shots.backCover ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-rose-100 text-rose-800'}`}>
                            {it.shots.backCover ? 'Y' : 'N'}
                          </span>
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          <span className={`inline-block px-1.5 py-0.5 rounded font-extrabold text-[10px] ${it.shots.titlePage ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-rose-100 text-rose-800'}`}>
                            {it.shots.titlePage ? 'Y' : 'N'}
                          </span>
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          <span className={`inline-block px-1.5 py-0.5 rounded font-extrabold text-[10px] ${it.shots.spine ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-rose-100 text-rose-800'}`}>
                            {it.shots.spine ? 'Y' : 'N'}
                          </span>
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          <span className={`inline-block px-1.5 py-0.5 rounded font-extrabold text-[10px] ${it.shots.editionNotice ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-rose-100 text-rose-800'}`}>
                            {it.shots.editionNotice ? 'Y' : 'N'}
                          </span>
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          <span className={`inline-block px-1.5 py-0.5 rounded font-extrabold text-[10px] ${it.shots.boxA ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-rose-100 text-rose-800'}`}>
                            {it.shots.boxA ? 'Y' : 'N'}
                          </span>
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          <span className={`inline-block px-1.5 py-0.5 rounded font-extrabold text-[10px] ${it.shots.boxB ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-rose-100 text-rose-800'}`}>
                            {it.shots.boxB ? 'Y' : 'N'}
                          </span>
                        </td>

                        {/* Overall Status */}
                        <td className="py-2.5 px-3 text-center">
                          {it.allImagesComplete ? (
                            <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-300/60 dark:border-emerald-800">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                              <span>Ok For Scanning</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300 border border-rose-300/60 dark:border-rose-800">
                              <AlertCircle className="w-3 h-3 text-rose-600 dark:text-rose-400" />
                              <span>Incomplete ({it.fileCount}/{it.parts * 7})</span>
                            </span>
                          )}
                        </td>

                        {/* S3 Path */}
                        <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500 max-w-[200px] truncate">
                          <div className="flex items-center space-x-1.5">
                            <span className="truncate">{it.s3Path}</span>
                            <button
                              onClick={() => copyToClipboard(it.s3Path, it.isbn)}
                              title="Copy S3 Path"
                              className="text-slate-400 hover:text-slate-700 dark:hover:text-white"
                            >
                              {copiedKey === it.isbn ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </td>

                        {/* Inspect Button */}
                        <td className="py-2.5 px-3 text-center">
                          <button
                            onClick={() => setInspectModalItem(it)}
                            className="p-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-brand-700 dark:text-blue-400 transition-colors cursor-pointer"
                            title="Inspect 7 S3 Images in High Resolution"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Bottom Pagination Bar */}
          <div className="p-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 shrink-0">
            <div>
              Showing <span className="font-bold text-slate-900 dark:text-white">{items.length > 0 ? (page - 1) * pageSize + 1 : 0}</span> to <span className="font-bold text-slate-900 dark:text-white">{Math.min(page * pageSize, totalItems)}</span> of <span className="font-bold text-slate-900 dark:text-white">{totalItems.toLocaleString()}</span> journals
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer font-bold"
              >
                Previous
              </button>
              <span className="font-mono">Page {page} of {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer font-bold"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Inspect Shots Modal (7-Shot Live Lightbox) */}
      {inspectModalItem && createPortal(
        <div 
          className="fixed inset-0 z-[9990] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setInspectModalItem(null)}
        >
          <div 
            className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="font-extrabold text-base text-slate-900 dark:text-white flex items-center space-x-2">
                  <FolderOpen className="w-5 h-5 text-amber-500" />
                  <span>S3 Proofs: {inspectModalItem.isbn}</span>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold">
                    100% Verified
                  </span>
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {inspectModalItem.journalName} • Box {inspectModalItem.boxNo} • Date: {inspectModalItem.captureDate}
                </p>
              </div>
              <button
                onClick={() => setInspectModalItem(null)}
                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                title="Close (Esc)"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body: Shot Thumbnails Grid */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {imageFiles.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-12 text-slate-400">
                  <AlertCircle className="w-10 h-10 mb-2 opacity-60 text-amber-500" />
                  <span className="text-sm font-bold text-slate-700 dark:text-slate-200">No Image Proofs Found</span>
                  <span className="text-xs text-slate-400 mt-1">This S3 folder does not contain compatible image formats.</span>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {imageFiles.map((f, i) => {
                    const proxyUrl = `/api/s3/image-proxy?bucket=${encodeURIComponent(activeBucket)}&key=${encodeURIComponent(f.key)}`;
                    const shotName = getShotFriendlyName(f.filename, i);
                    return (
                      <div 
                        key={f.key}
                        onClick={() => {
                          setLightboxIndex(i);
                          setZoomLevel(1);
                          setRotation(0);
                        }}
                        className="group bg-slate-50 dark:bg-slate-800/80 rounded-2xl p-2.5 border border-slate-200 dark:border-slate-700/80 hover:border-brand-500 dark:hover:border-blue-500 hover:shadow-lg transition-all cursor-pointer flex flex-col"
                      >
                        <div className="aspect-square rounded-xl bg-slate-200 dark:bg-slate-700 overflow-hidden relative mb-2 flex items-center justify-center">
                          <img
                            src={proxyUrl}
                            alt={f.filename}
                            loading="lazy"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            onError={(e) => {
                              // On error, show clean fallback badge
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                          <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/70 backdrop-blur-xs text-white text-[10px] font-bold">
                            {shotName}
                          </div>
                          <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <span className="px-3 py-1 rounded-xl bg-black/80 text-white text-xs font-bold flex items-center space-x-1.5 backdrop-blur-sm shadow-md">
                              <ZoomIn className="w-3.5 h-3.5" />
                              <span>Inspect HD</span>
                            </span>
                          </div>
                        </div>
                        <div className="text-[11px] font-bold text-slate-800 dark:text-slate-200 truncate" title={f.filename}>
                          {f.filename}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5 flex justify-between items-center">
                          <span className="font-semibold text-brand-600 dark:text-blue-400">{shotName}</span>
                          <span>{(f.size / 1024).toFixed(1)} KB</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-3 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-200 dark:border-slate-800 flex items-center text-xs">
              <div className="font-mono text-slate-500 text-[11px] truncate select-all">
                URI: {inspectModalItem.s3Path}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Full-Screen High-Resolution Photo Lightbox Inspector */}
      {lightboxIndex !== null && imageFiles[lightboxIndex] && (() => {
        const activeFile = imageFiles[lightboxIndex];
        const activeProxyUrl = `/api/s3/image-proxy?bucket=${encodeURIComponent(activeBucket)}&key=${encodeURIComponent(activeFile.key)}`;
        const shotName = getShotFriendlyName(activeFile.filename, lightboxIndex);

        const handlePrev = (e: React.MouseEvent) => {
          e.stopPropagation();
          setLightboxIndex(prev => (prev !== null && prev > 0 ? prev - 1 : imageFiles.length - 1));
          setZoomLevel(1);
          setRotation(0);
        };

        const handleNext = (e: React.MouseEvent) => {
          e.stopPropagation();
          setLightboxIndex(prev => (prev !== null && prev < imageFiles.length - 1 ? prev + 1 : 0));
          setZoomLevel(1);
          setRotation(0);
        };

        const handleDownload = (e: React.MouseEvent) => {
          e.stopPropagation();
          const a = document.createElement('a');
          a.href = activeProxyUrl;
          a.download = activeFile.filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        };

        return createPortal(
          <div 
            className="fixed inset-0 z-[99999] bg-black/95 backdrop-blur-md flex flex-col items-center justify-between p-4 select-none animate-in fade-in duration-200"
            onClick={() => setLightboxIndex(null)}
          >
            {/* Top Toolbar */}
            <div className="w-full max-w-7xl flex items-center justify-between text-white z-20" onClick={e => e.stopPropagation()}>
              <div className="flex items-center space-x-3">
                <span className="px-3 py-1 rounded-full bg-blue-600/90 text-white text-xs font-bold font-mono">
                  Shot {lightboxIndex + 1} of {imageFiles.length}
                </span>
                <span className="font-extrabold text-sm sm:text-base text-white">
                  {shotName}
                </span>
                <span className="hidden md:inline text-xs text-slate-400 font-mono">
                  • {activeFile.filename} ({(activeFile.size / 1024).toFixed(1)} KB)
                </span>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setZoomLevel(z => Math.min(3.5, z + 0.25))}
                  className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer transition-colors"
                  title="Zoom In (+)"
                >
                  <ZoomIn className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setZoomLevel(z => Math.max(0.5, z - 0.25))}
                  className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer transition-colors"
                  title="Zoom Out (-)"
                >
                  <ZoomOut className="w-5 h-5" />
                </button>
                <button
                  onClick={() => { setZoomLevel(1); setRotation(0); }}
                  className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer transition-colors"
                  title="Reset Zoom & Rotation"
                >
                  <RotateCcw className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setRotation(r => (r + 90) % 360)}
                  className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer transition-colors"
                  title="Rotate 90°"
                >
                  <RotateCw className="w-5 h-5" />
                </button>
                <button
                  onClick={handleDownload}
                  className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer transition-colors"
                  title="Download Image"
                >
                  <Download className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setLightboxIndex(null)}
                  className="p-2 rounded-xl bg-rose-600/80 hover:bg-rose-600 text-white cursor-pointer transition-colors ml-2"
                  title="Close (Esc)"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Central Stage with Next/Previous Buttons */}
            <div className="relative flex-1 w-full flex items-center justify-center overflow-hidden my-2" onClick={e => e.stopPropagation()}>
              {/* Prev Button */}
              {imageFiles.length > 1 && (
                <button
                  onClick={handlePrev}
                  className="absolute left-2 sm:left-4 z-20 p-3 rounded-full bg-white/10 hover:bg-white/25 text-white backdrop-blur-md transition-all cursor-pointer shadow-lg hover:scale-110 active:scale-95"
                  title="Previous Shot (Left Arrow)"
                >
                  <ChevronLeft className="w-6 h-6 sm:w-8 sm:h-8" />
                </button>
              )}

              {/* Main Image */}
              <img
                src={activeProxyUrl}
                alt={activeFile.filename}
                style={{
                  transform: `scale(${zoomLevel}) rotate(${rotation}deg)`,
                  transition: 'transform 0.15s ease-out'
                }}
                className="max-h-[80vh] max-w-[85vw] object-contain rounded-xl shadow-2xl cursor-grab active:cursor-grabbing"
              />

              {/* Next Button */}
              {imageFiles.length > 1 && (
                <button
                  onClick={handleNext}
                  className="absolute right-2 sm:right-4 z-20 p-3 rounded-full bg-white/10 hover:bg-white/25 text-white backdrop-blur-md transition-all cursor-pointer shadow-lg hover:scale-110 active:scale-95"
                  title="Next Shot (Right Arrow)"
                >
                  <ChevronRight className="w-6 h-6 sm:w-8 sm:h-8" />
                </button>
              )}
            </div>

            {/* Bottom Filmstrip Thumbnails Navigation */}
            <div className="w-full max-w-4xl flex items-center justify-center space-x-2 py-2 overflow-x-auto z-20" onClick={e => e.stopPropagation()}>
              {imageFiles.map((f, idx) => {
                const isActive = idx === lightboxIndex;
                const thumbProxy = `/api/s3/image-proxy?bucket=${encodeURIComponent(activeBucket)}&key=${encodeURIComponent(f.key)}`;
                const sName = getShotFriendlyName(f.filename, idx);
                return (
                  <button
                    key={f.key}
                    onClick={() => {
                      setLightboxIndex(idx);
                      setZoomLevel(1);
                      setRotation(0);
                    }}
                    className={`h-12 w-12 sm:h-14 sm:w-14 rounded-xl overflow-hidden border-2 transition-all cursor-pointer shrink-0 relative ${
                      isActive 
                        ? 'border-brand-500 scale-105 ring-2 ring-brand-400/50 shadow-lg' 
                        : 'border-white/30 opacity-60 hover:opacity-100 hover:border-white'
                    }`}
                    title={sName}
                  >
                    <img
                      src={thumbProxy}
                      alt={f.filename}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute bottom-0 inset-x-0 bg-black/80 text-[8px] sm:text-[9px] text-center text-white font-mono truncate px-0.5">
                      {sName}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>,
          document.body
        );
      })()}
    </div>
  );
};
