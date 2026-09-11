import React from 'react';
import { Camera, FolderOpen, History, Settings, Moon, Sun, ShieldCheck, Wifi } from 'lucide-react';
import { SystemStatus } from '../types';

interface NavbarProps {
  darkMode: boolean;
  setDarkMode: (val: boolean | ((prev: boolean) => boolean)) => void;
  systemStatus: SystemStatus | null;
  onOpenRecent: () => void;
  onOpenSettings: () => void;
  onOpenStorageFolder: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  darkMode,
  setDarkMode,
  systemStatus,
  onOpenRecent,
  onOpenSettings,
  onOpenStorageFolder,
}) => {
  return (
    <header className="sticky top-0 z-30 w-full glass-panel border-b border-slate-200/80 dark:border-slate-800/80 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        
        {/* Left: Brand / Title */}
        <div className="flex items-center space-x-3.5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-brand-600 to-indigo-600 text-white flex items-center justify-center shadow-md shadow-brand-500/20">
            <Camera className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-extrabold text-lg sm:text-xl tracking-tight text-slate-900 dark:text-white">
                Journal<span className="text-brand-600 dark:text-brand-400">Proof</span>
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-brand-50 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300 border border-brand-200 dark:border-brand-800/60">
                <ShieldCheck className="w-3 h-3 text-brand-600 dark:text-brand-400" />
                Anti-Plagiarism
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 hidden sm:block">
              Inventory Camera Verification Tool
            </p>
          </div>
        </div>

        {/* Center: Quick Server & LAN info */}
        {systemStatus && (
          <div className="hidden md:flex items-center space-x-2 bg-slate-100/80 dark:bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-mono text-slate-600 dark:text-slate-300">
            <Wifi className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
            <span>LAN:</span>
            <span className="font-semibold text-slate-800 dark:text-slate-100">
              {systemStatus.networkIps?.[0]?.address ? `http://${systemStatus.networkIps[0].address}:${systemStatus.port}` : `localhost:${systemStatus.port}`}
            </span>
          </div>
        )}

        {/* Right: Actions */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          
          {/* Open Storage Folder Button */}
          <button
            onClick={onOpenStorageFolder}
            title="Open Storage Folder in Windows Explorer"
            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-colors"
          >
            <FolderOpen className="w-3.5 h-3.5 text-amber-500" />
            <span className="hidden sm:inline">Proofs Folder</span>
          </button>

          {/* Recent Captures */}
          <button
            onClick={onOpenRecent}
            title="View Recent Proofs"
            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-colors relative"
          >
            <History className="w-3.5 h-3.5 text-brand-500" />
            <span className="hidden sm:inline">History</span>
            {systemStatus && systemStatus.totalCapturedJournals > 0 && (
              <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-brand-600 text-white">
                {systemStatus.totalCapturedJournals}
              </span>
            )}
          </button>

          {/* Settings */}
          <button
            onClick={onOpenSettings}
            title="System Settings"
            className="p-2 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <Settings className="w-4 h-4" />
          </button>

          {/* Dark mode switch */}
          <button
            onClick={() => setDarkMode(prev => !prev)}
            title={darkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
            className="p-2 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            {darkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-600" />}
          </button>
        </div>

      </div>
    </header>
  );
};
