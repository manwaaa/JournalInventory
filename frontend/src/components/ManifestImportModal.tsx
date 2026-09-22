import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { 
  X, 
  UploadCloud, 
  FileSpreadsheet, 
  CheckCircle2, 
  AlertCircle, 
  Trash2, 
  Download, 
  Search, 
  Check, 
  RefreshCw,
  BookOpen,
  Maximize2,
  Minimize2
} from 'lucide-react';
import { ManifestData, ManifestItem } from '../types';

interface ManifestImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onManifestUpdated: () => void;
}

export const ManifestImportModal: React.FC<ManifestImportModalProps> = ({
  isOpen,
  onClose,
  onManifestUpdated
}) => {
  const [manifest, setManifest] = useState<ManifestData | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'processable' | 'non_processable'>('all');
  const [pastedText, setPastedText] = useState('');
  const [showPasteArea, setShowPasteArea] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  const fetchManifest = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/manifest');
      const data = await res.json();
      setManifest(data);
    } catch (err) {
      console.error('Error fetching manifest:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchManifest();
    }
  }, [isOpen]);

  // Robust SheetJS Workbook parser for Excel (.xlsx, .xls) and CSV
  const parseWorkbook = (wb: XLSX.WorkBook): ManifestItem[] => {
    const allItems: ManifestItem[] = [];

    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      const rawRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      if (!rawRows || rawRows.length === 0) continue;

      let headerRow: string[] = [];
      let headerIdx = -1;

      for (let r = 0; r < Math.min(10, rawRows.length); r++) {
        const row = rawRows[r].map(c => String(c).trim());
        if (row.some(cell => /isbn|barcode/i.test(cell)) || row.some(cell => /lot/i.test(cell))) {
          headerRow = row;
          headerIdx = r;
          break;
        }
      }

      if (!headerRow.length) {
        headerRow = rawRows[0]?.map(c => String(c).trim()) || [];
        headerIdx = 0;
      }

      const getIdx = (patterns: string[]) => {
        return headerRow.findIndex(h => {
          const clean = h.toLowerCase().replace(/[^a-z0-9]/g, '');
          return patterns.some(p => clean.includes(p.toLowerCase().replace(/[^a-z0-9]/g, '')));
        });
      };

      const sNoIdx = getIdx(['sno', 'serial', 's.no']);
      const lotIdx = getIdx(['lotno', 'lot']);
      const boxIdx = getIdx(['boxno', 'box']);
      const isbnIdx = getIdx(['isbn', 'barcode']);
      const titleIdx = getIdx(['title', 'journaltitle', 'journal']);
      const authorIdx = getIdx(['author']);
      const publisherIdx = getIdx(['publisher']);
      const issnIdx = getIdx(['issn', 'printissn']);
      const yearIdx = getIdx(['year', 'publicationyear']);
      const volIdx = getIdx(['volume', 'vol']);
      const issuesIdx = getIdx(['issues', 'issue']);
      const statusIdx = getIdx(['status', 'processable', 'eligible', 'allowed']);
      const reasonIdx = getIdx(['reason', 'remarks', 'noidateamremarks', 'notes']);

      for (let r = headerIdx + 1; r < rawRows.length; r++) {
        const row = rawRows[r];
        if (!row || row.length === 0) continue;

        const isbn = isbnIdx !== -1 ? String(row[isbnIdx] || '').trim() : '';
        if (!isbn || isbn.toLowerCase() === 'isbn') continue;

        const lotNumber = lotIdx !== -1 ? String(row[lotIdx] || '').trim() : '';
        const boxNumber = boxIdx !== -1 ? String(row[boxIdx] || '').trim() : '';
        const title = titleIdx !== -1 ? String(row[titleIdx] || '').trim() : '';
        const author = authorIdx !== -1 ? String(row[authorIdx] || '').trim() : '';
        const publisher = publisherIdx !== -1 ? String(row[publisherIdx] || '').trim() : '';
        const printIssn = issnIdx !== -1 ? String(row[issnIdx] || '').trim() : '';
        const publicationYear = yearIdx !== -1 ? String(row[yearIdx] || '').trim() : '';
        const volume = volIdx !== -1 ? String(row[volIdx] || '').trim() : '';
        const issues = issuesIdx !== -1 ? String(row[issuesIdx] || '').trim() : '';
        const sNo = sNoIdx !== -1 ? String(row[sNoIdx] || '').trim() : '';

        let isProcessable = true;
        let reason = '';

        if (statusIdx !== -1) {
          const rawStatus = String(row[statusIdx] || '').trim().toLowerCase();
          if (
            rawStatus === 'false' ||
            rawStatus === 'no' ||
            rawStatus === '0' ||
            rawStatus === 'blocked' ||
            rawStatus.includes('not processable') ||
            rawStatus === 'reject' ||
            rawStatus === 'damaged' ||
            rawStatus === 'return'
          ) {
            isProcessable = false;
          }
        }

        if (reasonIdx !== -1) {
          reason = String(row[reasonIdx] || '').trim();
        }

        allItems.push({
          sNo: sNo || String(allItems.length + 1),
          isbn,
          lotNumber: lotNumber || (sheetName.toLowerCase().includes('lot') ? sheetName : ''),
          boxNumber,
          title,
          author,
          publisher,
          printIssn,
          publicationYear,
          volume,
          issues,
          isProcessable,
          reason,
          notes: reason,
          importedAt: new Date().toISOString()
        });
      }
    }

    return allItems;
  };

  // Fallback plain CSV/TSV text parser
  const parseCsvText = (text: string): ManifestItem[] => {
    try {
      const wb = XLSX.read(text, { type: 'string' });
      const items = parseWorkbook(wb);
      if (items.length > 0) return items;
    } catch (e) {}

    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return [];

    const delimiter = lines[0].includes('\t') ? '\t' : ',';
    const firstRowTokens = lines[0].split(delimiter).map(t => t.replace(/^["']|["']$/g, '').trim().toLowerCase());
    
    let hasHeader = false;
    let isbnIdx = 0;
    let lotIdx = -1;
    let boxIdx = -1;
    let titleIdx = -1;
    let authorIdx = -1;
    let statusIdx = -1;
    let reasonIdx = -1;

    firstRowTokens.forEach((header, idx) => {
      if (header.includes('isbn') || header.includes('barcode') || header.includes('code')) {
        isbnIdx = idx;
        hasHeader = true;
      } else if (header.includes('lot')) {
        lotIdx = idx;
        hasHeader = true;
      } else if (header.includes('box')) {
        boxIdx = idx;
        hasHeader = true;
      } else if (header.includes('title') || header.includes('journal') || header.includes('book')) {
        titleIdx = idx;
        hasHeader = true;
      } else if (header.includes('author') || header.includes('creator')) {
        authorIdx = idx;
        hasHeader = true;
      } else if (header.includes('status') || header.includes('processable') || header.includes('eligible') || header.includes('allowed')) {
        statusIdx = idx;
        hasHeader = true;
      } else if (header.includes('reason') || header.includes('notes') || header.includes('comment') || header.includes('remarks')) {
        reasonIdx = idx;
        hasHeader = true;
      }
    });

    const dataRows = hasHeader ? lines.slice(1) : lines;
    const items: ManifestItem[] = [];

    for (const line of dataRows) {
      const tokens = line.split(delimiter).map(t => t.replace(/^["']|["']$/g, '').trim());
      const isbn = (tokens[isbnIdx] || '').replace(/[^0-9A-Za-z_-]/g, '').trim();
      if (!isbn || isbn.toLowerCase() === 'isbn') continue;

      const lotNumber = lotIdx >= 0 ? (tokens[lotIdx] || '').trim() : '';
      const boxNumber = boxIdx >= 0 ? (tokens[boxIdx] || '').trim() : '';
      const title = titleIdx >= 0 ? (tokens[titleIdx] || '').trim() : '';
      const author = authorIdx >= 0 ? (tokens[authorIdx] || '').trim() : '';

      let isProcessable = true;
      let reason = '';

      if (statusIdx >= 0) {
        const rawStatus = (tokens[statusIdx] || '').toLowerCase().trim();
        if (
          rawStatus === 'false' ||
          rawStatus === 'no' ||
          rawStatus === '0' ||
          rawStatus === 'blocked' ||
          rawStatus.includes('not processable')
        ) {
          isProcessable = false;
        }
      }

      if (reasonIdx >= 0) {
        reason = (tokens[reasonIdx] || '').trim();
      }

      items.push({
        isbn,
        lotNumber,
        boxNumber,
        title,
        author,
        isProcessable,
        reason,
        notes: reason,
        importedAt: new Date().toISOString()
      });
    }

    return items;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      let items: ManifestItem[] = [];

      if (file.name.endsWith('.json')) {
        const text = await file.text();
        const parsed = JSON.parse(text);
        items = Array.isArray(parsed) ? parsed : (parsed.items || []);
      } else {
        // Binary Excel (.xlsx, .xls, .ods) or text CSV/TSV
        const buffer = await file.arrayBuffer();
        try {
          const wb = XLSX.read(buffer, { type: 'array' });
          items = parseWorkbook(wb);
        } catch (wbErr) {
          const text = await file.text();
          items = parseCsvText(text);
        }
      }

      if (items.length === 0) {
        alert('No valid journal items found. Please check that an ISBN column is present.');
        return;
      }

      const res = await fetch('/api/manifest/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, filename: file.name })
      });

      const data = await res.json();
      if (res.ok) {
        setManifest(data.manifestData);
        onManifestUpdated();
        setShowPasteArea(false);
      } else {
        alert(data.error || 'Failed to save manifest');
      }
    } catch (err: any) {
      alert('Error parsing manifest file: ' + err.message);
    } finally {
      setUploading(false);
      if (e.target) e.target.value = '';
    }
  };

  const handlePasteSubmit = async () => {
    if (!pastedText.trim()) return;
    setUploading(true);
    try {
      const items = parseCsvText(pastedText);
      if (items.length === 0) {
        alert('Could not parse any ISBN rows from the pasted text.');
        return;
      }

      const res = await fetch('/api/manifest/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, filename: 'pasted_manifest.csv' })
      });

      const data = await res.json();
      if (res.ok) {
        setManifest(data.manifestData);
        onManifestUpdated();
        setShowPasteArea(false);
        setPastedText('');
      } else {
        alert(data.error || 'Failed to save manifest');
      }
    } catch (err: any) {
      alert('Error importing pasted manifest: ' + err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleClearManifest = async () => {
    if (!confirm('Are you sure you want to clear the active manifest database?')) return;
    try {
      const res = await fetch('/api/manifest', { method: 'DELETE' });
      if (res.ok) {
        setManifest(null);
        onManifestUpdated();
      }
    } catch (err) {
      console.error('Error clearing manifest:', err);
    }
  };

  const downloadSampleTemplate = () => {
    const csvContent = 
      "S NO.,Lot No.,Box No.,ISBN,Qty,Order,Title,Author,Publisher,Print ISSN,Publication Year,Volume,Issues,Noida Team Remarks\n" +
      "1,Lot 140,147/287,1310264987,1,Journals,Acta Mechanica,,,0001-5970,2021,232,10,Mustang Journals\n" +
      "2,Lot 140,148/287,1073702788,1,Journals,Journal of Infrared Millimeter and Terahertz Waves,,,1866-6892,2021,42,3,Mustang Journals\n" +
      "3,Lot-141,228/275,2862322945,1,Journal,Computational Mechanics,,,0178-7675,2022,69,1,Mustang Journals";
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = "Journal_Manifest_Template.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!isOpen) return null;

  const items = manifest?.items || [];
  const filteredItems = items.filter(item => {
    if (filterType === 'processable' && !item.isProcessable) return false;
    if (filterType === 'non_processable' && item.isProcessable) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        item.isbn.toLowerCase().includes(q) ||
        (item.title && item.title.toLowerCase().includes(q)) ||
        (item.lotNumber && item.lotNumber.toLowerCase().includes(q)) ||
        (item.boxNumber && item.boxNumber.toLowerCase().includes(q)) ||
        (item.author && item.author.toLowerCase().includes(q)) ||
        (item.printIssn && item.printIssn.toLowerCase().includes(q))
      );
    }
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className={`w-full transition-all duration-200 rounded-2xl modal-card overflow-hidden flex flex-col shadow-2xl ${
        isMaximized 
          ? 'max-w-[98vw] h-[96vh]' 
          : 'max-w-6xl xl:max-w-7xl 2xl:max-w-[1500px] max-h-[92vh]'
      }`}>
        
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-blue-100 flex items-center justify-between bg-gradient-to-r from-blue-50/70 to-indigo-50/50">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl btn-primary-gradient text-white shadow-md shadow-brand-500/20">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900 tracking-tight">
                Import Processing Manifest (Excel &bull; CSV)
              </h3>
              <p className="text-xs text-slate-500">
                Upload Excel (.xlsx, .xls) or CSV manifests with auto Lot & Box detection
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-1.5">
            <button
              onClick={() => setIsMaximized(!isMaximized)}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white transition-colors cursor-pointer"
              title={isMaximized ? "Restore default width" : "Maximize to full screen"}
            >
              {isMaximized ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Stats Strip */}
        <div className="p-4 border-b border-slate-200 bg-white grid grid-cols-1 sm:grid-cols-3 gap-3">
          
          <div className="p-3 rounded-xl bg-blue-50/60 border border-blue-100 flex items-center justify-between">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">Total in Manifest</span>
              <span className="text-xl font-extrabold text-brand-700 font-mono">{manifest?.totalCount || 0}</span>
            </div>
            <FileSpreadsheet className="w-6 h-6 text-brand-400" />
          </div>

          <div className="p-3 rounded-xl bg-emerald-50/60 border border-emerald-100 flex items-center justify-between">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 block">Processable (Allowed)</span>
              <span className="text-xl font-extrabold text-emerald-700 font-mono">{manifest?.processableCount || 0}</span>
            </div>
            <CheckCircle2 className="w-6 h-6 text-emerald-500" />
          </div>

          <div className="p-3 rounded-xl bg-rose-50/60 border border-rose-100 flex items-center justify-between">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700 block">Not Processable (Blocked)</span>
              <span className="text-xl font-extrabold text-rose-700 font-mono">{manifest?.nonProcessableCount || 0}</span>
            </div>
            <AlertCircle className="w-6 h-6 text-rose-500" />
          </div>

        </div>

        {/* Upload Action Strip */}
        <div className="p-4 border-b border-blue-100 bg-slate-50/60 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-2">
            <label className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white btn-primary-gradient cursor-pointer shadow-md shadow-brand-500/20 active:scale-95 transition-all">
              <UploadCloud className="w-4 h-4" />
              <span>{uploading ? 'Importing Excel/CSV...' : 'Upload Manifest (Excel .xlsx / CSV)'}</span>
              <input
                type="file"
                accept=".xlsx,.xls,.csv,.tsv,.json,.txt,.ods"
                onChange={handleFileUpload}
                disabled={uploading}
                className="hidden"
              />
            </label>

            <button
              onClick={() => setShowPasteArea(!showPasteArea)}
              className="px-3 py-2 rounded-xl text-xs font-bold text-slate-700 btn-secondary-gradient cursor-pointer"
            >
              {showPasteArea ? 'Hide Text Area' : 'Paste CSV Text'}
            </button>

            <button
              onClick={downloadSampleTemplate}
              className="inline-flex items-center space-x-1 px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 btn-secondary-gradient cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>Sample Template</span>
            </button>
          </div>

          {manifest && manifest.totalCount > 0 && (
            <button
              onClick={handleClearManifest}
              className="inline-flex items-center space-x-1 px-3 py-2 rounded-xl text-xs font-bold text-rose-700 bg-gradient-to-b from-rose-50 to-red-50/60 hover:from-rose-100 hover:to-rose-50 border border-rose-200/80 transition-colors shadow-xs cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear Manifest</span>
            </button>
          )}
        </div>

        {/* Paste Area (Collapsible) */}
        {showPasteArea && (
          <div className="p-4 bg-blue-50/30 border-b border-blue-100 space-y-2">
            <textarea
              rows={4}
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              placeholder="Paste comma or tab-separated manifest data here (e.g. S NO, Lot No, Box No, ISBN, Title, Issues...)..."
              className="w-full p-3 font-mono text-xs bg-white border border-blue-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500 shadow-inner"
            />
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => setShowPasteArea(false)}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-200/70"
              >
                Cancel
              </button>
              <button
                onClick={handlePasteSubmit}
                disabled={!pastedText.trim() || uploading}
                className="px-4 py-1.5 rounded-xl text-xs font-bold text-white bg-brand-700 hover:bg-brand-600 shadow-sm disabled:opacity-50 cursor-pointer"
              >
                Import Pasted Text
              </button>
            </div>
          </div>
        )}

        {/* Search & Filter Strip */}
        <div className="p-3 border-b border-slate-200 bg-white flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search manifest by ISBN, title, lot, box, or ISSN..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div className="flex items-center space-x-1.5 shrink-0 text-xs">
            <button
              onClick={() => setFilterType('all')}
              className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                filterType === 'all' ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              All ({items.length})
            </button>
            <button
              onClick={() => setFilterType('processable')}
              className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                filterType === 'processable' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
              }`}
            >
              Processable ({manifest?.processableCount || 0})
            </button>
            <button
              onClick={() => setFilterType('non_processable')}
              className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                filterType === 'non_processable' ? 'bg-rose-600 text-white' : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
              }`}
            >
              Blocked ({manifest?.nonProcessableCount || 0})
            </button>
          </div>
        </div>

        {/* Manifest Table */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="py-12 text-center text-slate-400">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-brand-600" />
              <p className="text-xs">Loading manifest data...</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="py-12 text-center text-slate-400">
              <FileSpreadsheet className="w-10 h-10 opacity-30 mx-auto mb-2 text-slate-400" />
              <p className="text-sm font-semibold text-slate-600">No manifest items loaded.</p>
              <p className="text-xs text-slate-400 mt-1">Upload an Excel (.xlsx) or CSV manifest to begin verifying journals.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 overflow-x-auto shadow-inner bg-white">
              <table className="w-full min-w-[980px] text-left text-xs border-collapse table-fixed">
                <colgroup>
                  <col style={{ width: '4%' }} />   {/* # */}
                  <col style={{ width: '13%' }} />  {/* ISBN / Barcode */}
                  <col style={{ width: '8%' }} />   {/* Lot No. */}
                  <col style={{ width: '8%' }} />   {/* Box No. */}
                  <col style={{ width: '26%' }} />  {/* Journal Title */}
                  <col style={{ width: '13%' }} />  {/* Vol • Issue • Year */}
                  <col style={{ width: '8%' }} />   {/* Print ISSN */}
                  <col style={{ width: '11%' }} />  {/* Publisher / Remarks */}
                  <col style={{ width: '9%' }} />   {/* Status */}
                </colgroup>
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                    <th className="py-2.5 px-3 text-center">#</th>
                    <th className="py-2.5 px-3">ISBN / Barcode</th>
                    <th className="py-2.5 px-3 text-center">Lot No.</th>
                    <th className="py-2.5 px-3 text-center">Box No.</th>
                    <th className="py-2.5 px-3">Journal Title</th>
                    <th className="py-2.5 px-3">Vol &bull; Issue &bull; Year</th>
                    <th className="py-2.5 px-3">Print ISSN</th>
                    <th className="py-2.5 px-3">Publisher / Remarks</th>
                    <th className="py-2.5 px-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-sans">
                  {filteredItems.slice(0, 300).map((item, idx) => (
                    <tr key={idx} className="hover:bg-blue-50/50 transition-colors h-11">
                      <td className="py-2 px-3 text-slate-400 text-[11px] font-mono text-center">
                        {item.sNo || idx + 1}
                      </td>
                      <td className="py-2 px-3 font-mono font-bold text-slate-900 select-all whitespace-nowrap">
                        {item.isbn}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <span className="inline-block px-2 py-0.5 rounded bg-blue-50 text-brand-700 border border-blue-200/80 font-mono text-[11px] whitespace-nowrap font-bold">
                          {item.lotNumber || '—'}
                        </span>
                      </td>
                      <td className="py-2 px-3 font-mono text-indigo-700 font-bold text-center whitespace-nowrap">
                        {item.boxNumber || '—'}
                      </td>
                      <td className="py-2 px-3 text-slate-900 font-bold">
                        <div className="truncate" title={item.title}>
                          {item.title || '—'}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-slate-600">
                        <div className="flex items-center gap-1 text-[10px] whitespace-nowrap">
                          {item.volume && <span className="px-1.5 py-0.5 rounded bg-slate-100 font-semibold text-slate-700 whitespace-nowrap">V.{item.volume}</span>}
                          {item.issues && <span className="px-1.5 py-0.5 rounded bg-slate-100 font-semibold text-slate-700 whitespace-nowrap">Iss.{item.issues}</span>}
                          {item.publicationYear && <span className="px-1.5 py-0.5 rounded bg-slate-100 font-semibold text-slate-600 whitespace-nowrap">{item.publicationYear}</span>}
                          {!item.volume && !item.issues && !item.publicationYear && <span className="text-slate-400">—</span>}
                        </div>
                      </td>
                      <td className="py-2 px-3 font-mono text-[11px] text-emerald-700 font-semibold whitespace-nowrap">
                        {item.printIssn || '—'}
                      </td>
                      <td className="py-2 px-3 text-slate-500 text-[11px]">
                        <div className="truncate" title={item.publisher || item.notes}>
                          {item.publisher || item.notes || '—'}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-center shrink-0">
                        {item.isProcessable ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-300 whitespace-nowrap">
                            <Check className="w-3 h-3" />
                            Processable
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-300 whitespace-nowrap">
                            <X className="w-3 h-3" />
                            Blocked
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredItems.length > 300 && (
                <div className="p-2.5 text-center text-xs text-slate-500 bg-slate-50 border-t border-slate-200 font-semibold">
                  Showing first 300 of {filteredItems.length} journals. Use search to filter specific records.
                </div>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
