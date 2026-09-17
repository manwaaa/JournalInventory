import React, { useState, useEffect } from 'react';
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
  RefreshCw
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

  // Parse CSV / TSV text into ManifestItem[]
  const parseCsvText = (text: string): ManifestItem[] => {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return [];

    const delimiter = lines[0].includes('\t') ? '\t' : ',';
    
    // Check if first row is header
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
      if (header.includes('isbn') || header.includes('barcode') || header.includes('code') || header.includes('issn')) {
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
      } else if (header.includes('reason') || header.includes('notes') || header.includes('comment')) {
        reasonIdx = idx;
        hasHeader = true;
      }
    });

    const dataRows = hasHeader ? lines.slice(1) : lines;
    const items: ManifestItem[] = [];

    for (const row of dataRows) {
      // Split with quotes handling
      const tokens: string[] = [];
      let inQuote = false;
      let cur = '';

      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === '"') {
          inQuote = !inQuote;
        } else if (ch === delimiter && !inQuote) {
          tokens.push(cur.trim());
          cur = '';
        } else {
          cur += ch;
        }
      }
      tokens.push(cur.trim());

      const isbn = (tokens[isbnIdx] || '').replace(/^["']|["']$/g, '').trim();
      if (!isbn) continue;

      const lotNumber = lotIdx >= 0 ? (tokens[lotIdx] || '').replace(/^["']|["']$/g, '').trim() : '';
      const boxNumber = boxIdx >= 0 ? (tokens[boxIdx] || '').replace(/^["']|["']$/g, '').trim() : '';
      const title = titleIdx >= 0 ? (tokens[titleIdx] || '').replace(/^["']|["']$/g, '').trim() : '';
      const author = authorIdx >= 0 ? (tokens[authorIdx] || '').replace(/^["']|["']$/g, '').trim() : '';
      
      let isProcessable = true;
      let reason = '';

      if (statusIdx >= 0) {
        const rawStatus = (tokens[statusIdx] || '').replace(/^["']|["']$/g, '').trim().toLowerCase();
        if (
          rawStatus === 'false' || 
          rawStatus === 'no' || 
          rawStatus === 'not processable' || 
          rawStatus === 'not_processable' || 
          rawStatus === 'rejected' || 
          rawStatus === 'hold' || 
          rawStatus === 'damaged' ||
          rawStatus === 'return'
        ) {
          isProcessable = false;
        }
      }

      if (reasonIdx >= 0) {
        reason = (tokens[reasonIdx] || '').replace(/^["']|["']$/g, '').trim();
      }

      items.push({
        isbn,
        lotNumber,
        boxNumber,
        title,
        author,
        isProcessable,
        reason,
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
      const text = await file.text();
      let items: ManifestItem[] = [];

      if (file.name.endsWith('.json')) {
        const parsed = JSON.parse(text);
        items = Array.isArray(parsed) ? parsed : (parsed.items || []);
      } else {
        items = parseCsvText(text);
      }

      if (items.length === 0) {
        alert('No valid items found in the uploaded file. Ensure column with ISBN exists.');
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
        body: JSON.stringify({ items, filename: 'Pasted_Manifest.csv' })
      });

      const data = await res.json();
      if (res.ok) {
        setManifest(data.manifestData);
        onManifestUpdated();
        setPastedText('');
        setShowPasteArea(false);
      }
    } catch (err: any) {
      alert('Error saving pasted manifest: ' + err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleClearManifest = async () => {
    if (!window.confirm('Are you sure you want to clear the active manifest records?')) return;
    try {
      await fetch('/api/manifest', { method: 'DELETE' });
      setManifest(null);
      onManifestUpdated();
    } catch (err) {
      console.error('Error clearing manifest:', err);
    }
  };

  const downloadSampleTemplate = () => {
    const sampleCsv = `ISBN,Lot Number,Box Number,Journal Title,Author,Processable,Reason
9780132350884,Lot-131,102/468,Clean Code: Handbook of Agile Software Craftsmanship,Robert C. Martin,TRUE,
9780201616224,Lot-131,102/468,The Pragmatic Programmer,Andrew Hunt & David Thomas,TRUE,
9780131103627,Lot-131,102/468,The C Programming Language,Brian W. Kernighan,TRUE,
9780134685991,Lot-131,102/468,Effective Java (3rd Edition),Joshua Bloch,TRUE,
9780596517748,Lot-131,102/468,JavaScript: The Good Parts,Douglas Crockford,FALSE,Damaged Spine / Excluded
9780321751041,Lot-116,101/400,The Art of Computer Programming,Donald E. Knuth,FALSE,Out of Scope for Mustang Lot`;

    const blob = new Blob([sampleCsv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Verification_Manifest_Template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (!isOpen) return null;

  const items = manifest?.items || [];
  const filteredItems = items.filter(i => {
    const matchesSearch = 
      i.isbn.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (i.title && i.title.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (i.lotNumber && i.lotNumber.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (i.boxNumber && i.boxNumber.toLowerCase().includes(searchQuery.toLowerCase()));

    if (!matchesSearch) return false;

    if (filterType === 'processable') return i.isProcessable;
    if (filterType === 'non_processable') return !i.isProcessable;
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl bg-white shadow-2xl border border-blue-100 overflow-hidden">
        
        {/* Header */}
        <div className="p-5 border-b border-blue-100 flex items-center justify-between bg-gradient-to-r from-blue-50/70 to-indigo-50/50">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl btn-primary-gradient text-white shadow-md shadow-brand-500/20">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-extrabold text-slate-900 tracking-tight">
                Import Processing Manifest
              </h3>
              <p className="text-xs text-slate-500">
                Upload warehouse manifest CSV to validate processable vs non-processable journals
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stats & Actions Bar */}
        <div className="p-4 border-b border-slate-200/80 bg-white grid grid-cols-1 sm:grid-cols-3 gap-3">
          
          <div className="p-3.5 rounded-xl bg-gradient-to-b from-blue-50/70 to-indigo-50/30 border border-blue-100 flex items-center justify-between shadow-xs">
            <div>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Total in Manifest</p>
              <h4 className="text-xl font-extrabold text-brand-700 font-mono">{manifest?.totalCount || 0}</h4>
            </div>
            <FileSpreadsheet className="w-6 h-6 text-brand-500 opacity-60" />
          </div>

          <div className="p-3.5 rounded-xl bg-gradient-to-b from-emerald-50/70 to-teal-50/30 border border-emerald-200/80 flex items-center justify-between shadow-xs">
            <div>
              <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Processable (Allowed)</p>
              <h4 className="text-xl font-extrabold text-emerald-700 font-mono">{manifest?.processableCount || 0}</h4>
            </div>
            <CheckCircle2 className="w-6 h-6 text-emerald-500 opacity-60" />
          </div>

          <div className="p-3.5 rounded-xl bg-gradient-to-b from-rose-50/70 to-red-50/30 border border-rose-200/80 flex items-center justify-between shadow-xs">
            <div>
              <p className="text-[10px] font-bold text-rose-700 uppercase tracking-wider">Not Processable (Blocked)</p>
              <h4 className="text-xl font-extrabold text-rose-700 font-mono">{manifest?.nonProcessableCount || 0}</h4>
            </div>
            <AlertCircle className="w-6 h-6 text-rose-500 opacity-60" />
          </div>

        </div>

        {/* Upload Action Strip */}
        <div className="p-4 border-b border-blue-100 bg-slate-50/60 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-2">
            <label className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white btn-primary-gradient cursor-pointer">
              <UploadCloud className="w-4 h-4" />
              <span>{uploading ? 'Importing...' : 'Upload Manifest CSV'}</span>
              <input
                type="file"
                accept=".csv,.tsv,.json,.txt"
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
              className="inline-flex items-center space-x-1 px-3 py-2 rounded-xl text-xs font-bold text-rose-700 bg-gradient-to-b from-rose-50 to-red-50/60 hover:from-rose-100 hover:to-rose-50 border border-rose-200/80 transition-colors shadow-xs"
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
              placeholder="Paste comma or tab-separated manifest data here (e.g. ISBN, Lot, Box, Title, Processable)..."
              className="w-full p-3 font-mono text-xs bg-white border border-blue-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500 shadow-inner"
            />
            <div className="flex justify-end">
              <button
                onClick={handlePasteSubmit}
                disabled={!pastedText.trim() || uploading}
                className="px-4 py-1.5 rounded-xl text-xs font-bold text-white bg-brand-700 hover:bg-brand-600 shadow-sm disabled:opacity-50"
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
              placeholder="Search manifest by ISBN, title, lot, or box..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div className="flex items-center space-x-1.5 shrink-0 text-xs">
            <button
              onClick={() => setFilterType('all')}
              className={`px-3 py-1 rounded-lg font-bold transition-all ${
                filterType === 'all' ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              All ({items.length})
            </button>
            <button
              onClick={() => setFilterType('processable')}
              className={`px-3 py-1 rounded-lg font-bold transition-all ${
                filterType === 'processable' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
              }`}
            >
              Processable ({manifest?.processableCount || 0})
            </button>
            <button
              onClick={() => setFilterType('non_processable')}
              className={`px-3 py-1 rounded-lg font-bold transition-all ${
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
              <p className="text-xs text-slate-400 mt-1">Upload a CSV manifest to begin validating processable journals.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">ISBN / Barcode</th>
                    <th className="py-2.5 px-3">Lot & Box</th>
                    <th className="py-2.5 px-3">Title / Details</th>
                    <th className="py-2.5 px-3">Reason / Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-sans">
                  {filteredItems.map((item, idx) => (
                    <tr key={idx} className="hover:bg-blue-50/40 transition-colors">
                      <td className="py-2.5 px-3 shrink-0">
                        {item.isProcessable ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-300">
                            <Check className="w-3 h-3" />
                            Processable
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-300">
                            <X className="w-3 h-3" />
                            Not Processable
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-mono font-bold text-slate-900">
                        {item.isbn}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600">
                        {item.lotNumber ? <span className="font-semibold text-brand-700">{item.lotNumber}</span> : '—'}
                        {item.boxNumber ? ` • ${item.boxNumber}` : ''}
                      </td>
                      <td className="py-2.5 px-3 text-slate-800">
                        <div className="font-semibold truncate max-w-xs">{item.title || '—'}</div>
                        {item.author && <div className="text-[10px] text-slate-400 truncate">{item.author}</div>}
                      </td>
                      <td className="py-2.5 px-3 text-slate-500">
                        {item.reason || item.notes || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

