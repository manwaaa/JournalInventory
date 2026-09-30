import React from 'react';
import { 
  Camera, 
  FolderOpen, 
  Settings, 
  Smartphone, 
  FileSpreadsheet, 
  Search, 
  Table,
  Package,
  BookOpen,
  Layers,
  Sun,
  Moon
} from 'lucide-react';
import { StationRole, SystemStatus, ViewMode } from '../types';

interface NavbarProps {
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
  stationRole: StationRole;
  setStationRole: (r: StationRole) => void;
  systemStatus: SystemStatus | null;
  manifestItemCount: number;
  darkMode?: boolean;
  onToggleDarkMode?: () => void;
  onOpenQuickSearch?: () => void;
  onOpenManifestModal: () => void;
  onOpenSettings: () => void;
  onOpenStorageFolder: () => void;
  onOpenMobilePairing: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  viewMode,
  setViewMode,
  stationRole,
  setStationRole,
  systemStatus,
  manifestItemCount,
  darkMode = false,
  onToggleDarkMode,
  onOpenManifestModal,
  onOpenSettings,
  onOpenStorageFolder,
  onOpenMobilePairing,
}) => {
  return (
    <header className="sticky top-0 z-30 w-full glass-panel border-b border-blue-100/90 dark:border-slate-800/90 transition-colors shadow-[0_4px_16px_rgba(24,62,142,0.03)] dark:shadow-[0_4px_16px_rgba(0,0,0,0.4)]">
      <div className="w-full px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4 relative">
        
        {/* Far Left: Brand Title */}
        <div className="flex items-center space-x-3 sm:space-x-4 shrink-0 z-10">
          <div className="flex items-center space-x-2.5 shrink-0">
            <div className="w-9 h-9 rounded-xl btn-primary-gradient text-white flex items-center justify-center shadow-md shadow-brand-500/25">
              <Camera className="w-5 h-5" />
            </div>
            <span className="font-extrabold text-base sm:text-lg tracking-tight text-slate-900 dark:text-white whitespace-nowrap">
              Verification <span className="text-brand-700 dark:text-blue-400 bg-gradient-to-r from-brand-700 to-indigo-600 dark:from-blue-400 dark:to-indigo-400 bg-clip-text text-transparent">Images</span>
            </span>
          </div>

          {/* Inline Role Selector for smaller screens */}
          {viewMode === 'CAPTURE' && (
            <div className="flex xl:hidden items-center bg-gradient-to-r from-slate-100 to-blue-50/70 dark:from-slate-800 dark:to-slate-800/80 p-1 rounded-xl border border-slate-200/80 dark:border-slate-700 shadow-xs relative shrink-0" title="Select Workstation Role">
              <button
                onClick={() => setStationRole('box_level')}
                className={`flex items-center space-x-1 px-2.5 sm:px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all duration-300 transform active:scale-95 cursor-pointer ${
                  stationRole === 'box_level'
                    ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-md shadow-blue-500/25 scale-[1.02]'
                    : 'text-slate-600 dark:text-slate-300 hover:text-blue-700 dark:hover:text-white hover:bg-white/60 dark:hover:bg-slate-700/60'
                }`}
                title="PC 1: Box Level (Takes Shot 1 & 2 only, then proceeds immediately to next box)"
              >
                <Package className={`w-3.5 h-3.5 ${stationRole === 'box_level' ? 'text-white animate-pulse' : 'text-blue-600 dark:text-blue-400'}`} />
                <span>PC 1 (Box 1-2)</span>
              </button>

              <button
                onClick={() => setStationRole('book_level')}
                className={`flex items-center space-x-1 px-2.5 sm:px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all duration-300 transform active:scale-95 cursor-pointer ${
                  stationRole === 'book_level'
                    ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-md shadow-indigo-500/25 scale-[1.02]'
                    : 'text-slate-600 dark:text-slate-300 hover:text-indigo-700 dark:hover:text-white hover:bg-white/60 dark:hover:bg-slate-700/60'
                }`}
                title="PC 2: Book Level (Loads Shots 1 & 2 from PC 1, captures Shots 3 to 7)"
              >
                <BookOpen className={`w-3.5 h-3.5 ${stationRole === 'book_level' ? 'text-white animate-pulse' : 'text-indigo-600 dark:text-indigo-400'}`} />
                <span>PC 2 (Book 3-7)</span>
              </button>

              <button
                onClick={() => setStationRole('all_in_one')}
                className={`flex items-center space-x-1 px-2.5 sm:px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all duration-300 transform active:scale-95 cursor-pointer ${
                  stationRole === 'all_in_one'
                    ? 'bg-gradient-to-r from-emerald-600 to-teal-700 text-white shadow-md shadow-emerald-500/25 scale-[1.02]'
                    : 'text-slate-600 dark:text-slate-300 hover:text-emerald-700 dark:hover:text-white hover:bg-white/60 dark:hover:bg-slate-700/60'
                }`}
                title="Full Station: Complete Verification (Captures both Box 1-2 and Book 3-7 on this PC)"
              >
                <Layers className={`w-3.5 h-3.5 ${stationRole === 'all_in_one' ? 'text-white animate-pulse' : 'text-emerald-600 dark:text-emerald-400'}`} />
                <span>Full (1-7)</span>
              </button>

              <button
                onClick={() => setStationRole('box_spine')}
                className={`flex items-center space-x-1 px-2.5 sm:px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all duration-300 transform active:scale-95 cursor-pointer ${
                  stationRole === 'box_spine'
                    ? 'bg-gradient-to-r from-violet-600 to-violet-700 text-white shadow-md shadow-violet-500/25 scale-[1.02]'
                    : 'text-slate-600 dark:text-slate-300 hover:text-violet-700 dark:hover:text-white hover:bg-white/60 dark:hover:bg-slate-700/60'
                }`}
                title="Box + Spine: Captures only Shot 1 (Box A), Shot 2 (Box B), and Shot 4 (Spine)"
              >
                <Package className={`w-3.5 h-3.5 ${stationRole === 'box_spine' ? 'text-white animate-pulse' : 'text-violet-600 dark:text-violet-400'}`} />
                <span>Box+Spine (1,2,4)</span>
              </button>
            </div>
          )}
        </div>

        {/* Aligned with max-w-7xl Card Container (RECEIVING & VERIFICATION) on desktop */}
        {viewMode === 'CAPTURE' && (
          <div className="hidden xl:flex absolute inset-0 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pointer-events-none items-center justify-start">
            <div className="pointer-events-auto flex items-center bg-gradient-to-r from-slate-100 to-blue-50/70 dark:from-slate-800 dark:to-slate-800/80 p-1 rounded-xl border border-slate-200/80 dark:border-slate-700 shadow-xs relative shrink-0" title="Select Workstation Role">
              <button
                onClick={() => setStationRole('box_level')}
                className={`flex items-center space-x-1 px-2.5 sm:px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all duration-300 transform active:scale-95 cursor-pointer ${
                  stationRole === 'box_level'
                    ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-md shadow-blue-500/25 scale-[1.02]'
                    : 'text-slate-600 dark:text-slate-300 hover:text-blue-700 dark:hover:text-white hover:bg-white/60 dark:hover:bg-slate-700/60'
                }`}
                title="PC 1: Box Level (Takes Shot 1 & 2 only, then proceeds immediately to next box)"
              >
                <Package className={`w-3.5 h-3.5 ${stationRole === 'box_level' ? 'text-white animate-pulse' : 'text-blue-600 dark:text-blue-400'}`} />
                <span>PC 1 (Box 1-2)</span>
              </button>

              <button
                onClick={() => setStationRole('book_level')}
                className={`flex items-center space-x-1 px-2.5 sm:px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all duration-300 transform active:scale-95 cursor-pointer ${
                  stationRole === 'book_level'
                    ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-md shadow-indigo-500/25 scale-[1.02]'
                    : 'text-slate-600 dark:text-slate-300 hover:text-indigo-700 dark:hover:text-white hover:bg-white/60 dark:hover:bg-slate-700/60'
                }`}
                title="PC 2: Book Level (Loads Shots 1 & 2 from PC 1, captures Shots 3 to 7)"
              >
                <BookOpen className={`w-3.5 h-3.5 ${stationRole === 'book_level' ? 'text-white animate-pulse' : 'text-indigo-600 dark:text-indigo-400'}`} />
                <span>PC 2 (Book 3-7)</span>
              </button>

              <button
                onClick={() => setStationRole('all_in_one')}
                className={`flex items-center space-x-1 px-2.5 sm:px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all duration-300 transform active:scale-95 cursor-pointer ${
                  stationRole === 'all_in_one'
                    ? 'bg-gradient-to-r from-emerald-600 to-teal-700 text-white shadow-md shadow-emerald-500/25 scale-[1.02]'
                    : 'text-slate-600 dark:text-slate-300 hover:text-emerald-700 dark:hover:text-white hover:bg-white/60 dark:hover:bg-slate-700/60'
                }`}
                title="Full Station: Complete Verification (Captures both Box 1-2 and Book 3-7 on this PC)"
              >
                <Layers className={`w-3.5 h-3.5 ${stationRole === 'all_in_one' ? 'text-white animate-pulse' : 'text-emerald-600 dark:text-emerald-400'}`} />
                <span>Full (1-7)</span>
              </button>

              <button
                onClick={() => setStationRole('box_spine')}
                className={`flex items-center space-x-1 px-2.5 sm:px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all duration-300 transform active:scale-95 cursor-pointer ${
                  stationRole === 'box_spine'
                    ? 'bg-gradient-to-r from-violet-600 to-violet-700 text-white shadow-md shadow-violet-500/25 scale-[1.02]'
                    : 'text-slate-600 dark:text-slate-300 hover:text-violet-700 dark:hover:text-white hover:bg-white/60 dark:hover:bg-slate-700/60'
                }`}
                title="Box + Spine: Captures only Shot 1 (Box A), Shot 2 (Box B), and Shot 4 (Spine)"
              >
                <Package className={`w-3.5 h-3.5 ${stationRole === 'box_spine' ? 'text-white animate-pulse' : 'text-violet-600 dark:text-violet-400'}`} />
                <span>Box+Spine (1,2,4)</span>
              </button>
            </div>
          </div>
        )}

        {/* Far Right: View Toggle, Manifest, Live Sync & Tools */}
        <div className="flex items-center space-x-2 sm:space-x-3 shrink-0 z-10">

          {/* View Mode Toggle: Capture vs Search & View */}
          <div className="flex items-center bg-gradient-to-r from-blue-50/80 to-indigo-50/60 dark:from-slate-800 dark:to-slate-800/80 p-1 rounded-xl border border-blue-100 dark:border-slate-700 shadow-xs">
            <button
              onClick={() => setViewMode('CAPTURE')}
              className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all duration-300 transform active:scale-95 cursor-pointer ${
                viewMode === 'CAPTURE'
                  ? 'btn-primary-gradient text-white shadow-md shadow-brand-500/25 scale-[1.02]'
                  : 'text-slate-600 dark:text-slate-300 hover:text-brand-700 dark:hover:text-white hover:bg-white/60 dark:hover:bg-slate-700/60'
              }`}
            >
              <Camera className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Capture Mode</span>
            </button>
            <button
              onClick={() => setViewMode('SEARCH_VIEW')}
              className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all duration-300 transform active:scale-95 cursor-pointer ${
                viewMode === 'SEARCH_VIEW'
                  ? 'btn-primary-gradient text-white shadow-md shadow-brand-500/25 scale-[1.02]'
                  : 'text-slate-600 dark:text-slate-300 hover:text-brand-700 dark:hover:text-white hover:bg-white/60 dark:hover:bg-slate-700/60'
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
            className="flex items-center space-x-1.5 px-3.5 py-1.5 text-xs font-bold rounded-xl text-brand-700 dark:text-blue-300 btn-secondary-gradient transition-all cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-brand-600 dark:text-blue-400" />
            <span className="hidden sm:inline">Manifest</span>
            {manifestItemCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-brand-100 dark:bg-blue-950/80 text-brand-700 dark:text-blue-300 border border-brand-200 dark:border-blue-800">
                {manifestItemCount}
              </span>
            )}
          </button>

          {/* Dark Mode Toggle */}
          {onToggleDarkMode && (
            <button
              onClick={onToggleDarkMode}
              title={darkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
              className="p-2 text-slate-600 dark:text-amber-300 hover:text-brand-700 dark:hover:text-amber-200 rounded-xl hover:bg-blue-50 dark:hover:bg-slate-800 border border-transparent hover:border-blue-100 dark:hover:border-slate-700 transition-all cursor-pointer"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          )}

          {/* Mobile Camera Pairing QR Button */}
          <button
            onClick={onOpenMobilePairing}
            title="Connect Phone Camera (Wireless)"
            className="p-2 text-slate-600 dark:text-slate-300 hover:text-brand-700 dark:hover:text-white rounded-xl hover:bg-blue-50 dark:hover:bg-slate-800 border border-transparent hover:border-blue-100 dark:hover:border-slate-700 transition-all cursor-pointer"
          >
            <Smartphone className="w-4 h-4" />
          </button>

          {/* Open Storage Folder */}
          <button
            onClick={onOpenStorageFolder}
            title="Open C:\Journal_Proofs in Windows Explorer"
            className="p-2 text-slate-600 dark:text-slate-300 hover:text-brand-700 dark:hover:text-white rounded-xl hover:bg-blue-50 dark:hover:bg-slate-800 border border-transparent hover:border-blue-100 dark:hover:border-slate-700 transition-all cursor-pointer"
          >
            <FolderOpen className="w-4 h-4 text-amber-500" />
          </button>

          {/* Settings */}
          <button
            onClick={onOpenSettings}
            title="System Settings"
            className="p-2 text-slate-600 dark:text-slate-300 hover:text-brand-700 dark:hover:text-white rounded-xl hover:bg-blue-50 dark:hover:bg-slate-800 border border-transparent hover:border-blue-100 dark:hover:border-slate-700 transition-all cursor-pointer"
          >
            <Settings className="w-4 h-4" />
          </button>

        </div>

      </div>
    </header>
  );
};
