import React from 'react';
import { 
  Camera, 
  FolderOpen, 
  Settings, 
  Smartphone, 
  FileSpreadsheet, 
  Search, 
  Table
} from 'lucide-react';
import { SystemStatus, ViewMode } from '../types';

interface NavbarProps {
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
  systemStatus: SystemStatus | null;
  manifestItemCount: number;
  onOpenQuickSearch: () => void;
  onOpenManifestModal: () => void;
  onOpenSettings: () => void;
  onOpenStorageFolder: () => void;
  onOpenMobilePairing: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  viewMode,
  setViewMode,
  systemStatus,
  manifestItemCount,
  onOpenQuickSearch,
  onOpenManifestModal,
  onOpenSettings,
  onOpenStorageFolder,
  onOpenMobilePairing,
}) => {
  return (
    <header className="sticky top-0 z-30 w-full glass-panel border-b border-blue-100/90 transition-colors shadow-[0_4px_16px_rgba(24,62,142,0.03)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        
        {/* Left: Brand Title & Quick Search */}
        <div className="flex items-center space-x-3.5">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl btn-primary-gradient text-white flex items-center justify-center shadow-md shadow-brand-500/25">
              <Camera className="w-5 h-5" />
            </div>
            <span className="font-extrabold text-base sm:text-lg tracking-tight text-slate-900">
              Verification <span className="text-brand-700 bg-gradient-to-r from-brand-700 to-indigo-600 bg-clip-text text-transparent">Images</span>
            </span>
          </div>

          {/* Quick Search Pill (Ctrl K) */}
          <button
            onClick={onOpenQuickSearch}
            className="hidden md:flex items-center space-x-2 px-3.5 py-1.5 text-xs text-slate-500 bg-gradient-to-r from-white to-blue-50/50 hover:from-white hover:to-blue-100/60 border border-blue-200/80 rounded-full transition-all shadow-xs cursor-pointer"
          >
            <Search className="w-3.5 h-3.5 text-brand-500" />
            <span className="text-slate-400">Quick Search...</span>
            <kbd className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-white rounded-md border border-slate-200 text-slate-500 shadow-xs">
              Ctrl K
            </kbd>
          </button>
        </div>

        {/* Right: View Toggle, Manifest, Live Sync & Tools */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          
          {/* View Mode Toggle: Capture vs Search & View */}
          <div className="flex items-center bg-gradient-to-r from-blue-50/80 to-indigo-50/60 p-1 rounded-xl border border-blue-100 shadow-xs">
            <button
              onClick={() => setViewMode('CAPTURE')}
              className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                viewMode === 'CAPTURE'
                  ? 'btn-primary-gradient text-white shadow-sm'
                  : 'text-slate-600 hover:text-brand-700'
              }`}
            >
              <Camera className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Capture Mode</span>
            </button>
            <button
              onClick={() => setViewMode('SEARCH_VIEW')}
              className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                viewMode === 'SEARCH_VIEW'
                  ? 'btn-primary-gradient text-white shadow-sm'
                  : 'text-slate-600 hover:text-brand-700'
              }`}
            >
              <Table className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Search & View</span>
            </button>
          </div>

          {/* Manifest Manager Button */}
          <button
            onClick={onOpenManifestModal}
            title="Import or View Processing Manifest"
            className="flex items-center space-x-1.5 px-3.5 py-1.5 text-xs font-bold rounded-xl text-brand-700 btn-secondary-gradient transition-all cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-brand-600" />
            <span className="hidden sm:inline">Manifest</span>
            {manifestItemCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-brand-100 text-brand-700 border border-brand-200">
                {manifestItemCount}
              </span>
            )}
          </button>

          {/* Mobile Camera Pairing QR Button */}
          <button
            onClick={onOpenMobilePairing}
            title="Connect Phone Camera (Wireless)"
            className="p-2 text-slate-600 hover:text-brand-700 rounded-xl hover:bg-blue-50 border border-transparent hover:border-blue-100 transition-all"
          >
            <Smartphone className="w-4 h-4" />
          </button>

          {/* Open Storage Folder */}
          <button
            onClick={onOpenStorageFolder}
            title="Open C:\Journal_Proofs in Windows Explorer"
            className="p-2 text-slate-600 hover:text-brand-700 rounded-xl hover:bg-blue-50 border border-transparent hover:border-blue-100 transition-all"
          >
            <FolderOpen className="w-4 h-4 text-amber-500" />
          </button>

          {/* Settings */}
          <button
            onClick={onOpenSettings}
            title="System Settings"
            className="p-2 text-slate-600 hover:text-brand-700 rounded-xl hover:bg-blue-50 border border-transparent hover:border-blue-100 transition-all"
          >
            <Settings className="w-4 h-4" />
          </button>

        </div>

      </div>
    </header>
  );
};
