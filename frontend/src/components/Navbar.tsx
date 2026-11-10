import React, { useState, useEffect } from 'react';
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
  Moon,
  Network,
  RefreshCw
} from 'lucide-react';
import { StationRole, SystemStatus, ViewMode } from '../types';

interface NavbarProps {
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
  stationRole: StationRole;
  setStationRole: (r: StationRole) => void;
  systemStatus: SystemStatus | null;
  manifestItemCount: number;
  activeClient?: string;
  onSelectClient?: (client: string) => void;
  darkMode?: boolean;
  onToggleDarkMode?: () => void;
  onOpenQuickSearch?: () => void;
  onOpenManifestModal: () => void;
  onOpenSettings: () => void;
  onOpenStorageFolder: () => void;
  onOpenMobilePairing: () => void;
}

interface PeerSyncState {
  peerSyncEnabled: boolean;
  peerIp: string;
  peerPort: number;
  isReachable: boolean;
  discoveredPeers: string[];
  localIps: Array<{ interface: string; address: string }>;
}

export const Navbar: React.FC<NavbarProps> = ({
  viewMode,
  setViewMode,
  stationRole,
  setStationRole,
  systemStatus,
  manifestItemCount,
  activeClient = 'Mustang',
  onSelectClient,
  darkMode = false,
  onToggleDarkMode,
  onOpenManifestModal,
  onOpenSettings,
  onOpenStorageFolder,
  onOpenMobilePairing,
}) => {
  const [peerState, setPeerState] = useState<PeerSyncState | null>(null);
  const [peerModalOpen, setPeerModalOpen] = useState(false);
  const [customPeerIp, setCustomPeerIp] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isTogglingSync, setIsTogglingSync] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const fetchPeerStatus = async () => {
    try {
      const res = await fetch('/api/sync/status');
      if (res.ok) {
        const data = await res.json();
        setPeerState(data);
        if (data.peerIp && !customPeerIp) setCustomPeerIp(data.peerIp);
      }
    } catch (e) {}
  };

  useEffect(() => {
    fetchPeerStatus();
    const interval = setInterval(fetchPeerStatus, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleTogglePeerSync = async (enabled: boolean) => {
    setIsTogglingSync(true);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/sync/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      const data = await res.json();
      if (data.success) {
        setPeerState(prev => prev ? { ...prev, peerSyncEnabled: data.peerSyncEnabled, isReachable: data.isReachable } : null);
        setSyncMessage(data.peerSyncEnabled ? 'LAN sync turned ON.' : 'LAN sync turned OFF.');
      }
      fetchPeerStatus();
    } catch (e: any) {
      setSyncMessage(`Toggle failed: ${e.message}`);
    } finally {
      setIsTogglingSync(false);
    }
  };

  const handleConnectPeer = async () => {
    if (!customPeerIp.trim()) return;
    setIsSyncing(true);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/sync/set-peer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peerIp: customPeerIp.trim() })
      });
      const data = await res.json();
      if (data.reachable) {
        setSyncMessage('Connected! 2-way sync active between both PCs.');
      } else {
        setSyncMessage('Saved IP! Looking for peer PC...');
      }
      fetchPeerStatus();
    } catch (e: any) {
      setSyncMessage(`Error: ${e.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSyncAll = async () => {
    setIsSyncing(true);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/sync/pull-all', { method: 'POST' });
      const data = await res.json();
      setSyncMessage(`Synced ${data.count || 0} pictures & box shots from peer PC!`);
      fetchPeerStatus();
    } catch (e: any) {
      setSyncMessage(`Sync failed: ${e.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleScanSubnet = async () => {
    setIsScanning(true);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/sync/scan-peers', { method: 'POST' });
      const data = await res.json();
      if (data.count > 0) {
        setSyncMessage(`Auto-connected to ${data.count} peer PC(s)!`);
      } else {
        setSyncMessage('No other PCs found on local network subnet.');
      }
      fetchPeerStatus();
    } catch (e: any) {
      setSyncMessage(`Scan failed: ${e.message}`);
    } finally {
      setIsScanning(false);
    }
  };
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

          {/* Client Profile Switcher */}
          {onSelectClient && (
            <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xs shrink-0" title="Active Client Profile">
              <button
                type="button"
                onClick={() => onSelectClient('Mustang')}
                className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 cursor-pointer ${
                  (activeClient || 'Mustang').toLowerCase() === 'mustang'
                    ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-white shadow-sm shadow-amber-500/30'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white dark:hover:bg-slate-700/60'
                }`}
                title="Client: Mustang (Folder: C:\Journal_Proofs\Mustang | S3: innoscanmussgp1-s3)"
              >
                <span>🐎</span>
                <span className="hidden sm:inline">Mustang</span>
              </button>
              <button
                type="button"
                onClick={() => onSelectClient('Jaguar')}
                className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 cursor-pointer ${
                  (activeClient || '').toLowerCase() === 'jaguar'
                    ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-sm shadow-indigo-500/30'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white dark:hover:bg-slate-700/60'
                }`}
                title="Client: Jaguar (Folder: C:\Journal_Proofs\Jaguar | S3 uploads disabled pending approval)"
              >
                <span>🐆</span>
                <span className="hidden sm:inline">Jaguar</span>
              </button>
            </div>
          )}

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

          {/* PC 1 ↔ PC 2 LAN Peer Sync Status Pill */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setPeerModalOpen(!peerModalOpen)}
              title={
                !peerState?.peerSyncEnabled
                  ? 'PC LAN Sync is OFF (click to configure)'
                  : peerState?.isReachable
                  ? `Connected to PC (${peerState.peerIp})`
                  : 'Searching for peer PC...'
              }
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                !peerState?.peerSyncEnabled
                  ? 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700'
                  : peerState?.isReachable
                  ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 shadow-xs'
                  : 'bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800'
              }`}
            >
              <Network
                className={`w-3.5 h-3.5 ${
                  !peerState?.peerSyncEnabled
                    ? 'text-slate-400 dark:text-slate-500'
                    : peerState?.isReachable
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-amber-600 dark:text-amber-400 animate-pulse'
                }`}
              />
              <span className="hidden md:inline">
                {!peerState?.peerSyncEnabled
                  ? 'PC Sync: OFF'
                  : peerState?.isReachable
                  ? `PC Sync (${peerState.peerIp})`
                  : 'PC Sync: Searching...'}
              </span>
            </button>

            {peerModalOpen && (
              <div className="absolute right-0 top-full mt-2 w-80 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-4 z-50 text-xs space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center space-x-2">
                    <Network className="w-4 h-4 text-brand-600 dark:text-blue-400" />
                    <span className="font-extrabold text-slate-800 dark:text-white">PC-to-PC LAN Sync</span>
                  </div>
                  <button onClick={() => setPeerModalOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-white font-bold cursor-pointer">✕</button>
                </div>

                {/* ON / OFF Switch */}
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60">
                  <div>
                    <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center space-x-1.5">
                      <span>Sync Status</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold uppercase ${
                        peerState?.peerSyncEnabled
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                          : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                      }`}>
                        {peerState?.peerSyncEnabled ? 'ON' : 'OFF'}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">
                      {peerState?.peerSyncEnabled
                        ? 'Mirroring pictures across workstations'
                        : 'Sync paused (local workstation only)'}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={isTogglingSync}
                    onClick={() => handleTogglePeerSync(!peerState?.peerSyncEnabled)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      peerState?.peerSyncEnabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
                    } ${isTogglingSync ? 'opacity-50 cursor-wait' : ''}`}
                    role="switch"
                    aria-checked={Boolean(peerState?.peerSyncEnabled)}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                        peerState?.peerSyncEnabled ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {peerState?.peerSyncEnabled ? (
                  <>
                    <div className={`p-2.5 rounded-xl flex items-center space-x-2 ${
                      peerState?.isReachable ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                    }`}>
                      <div className={`w-2.5 h-2.5 rounded-full ${peerState?.isReachable ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500 animate-ping'}`} />
                      <span className="font-bold">
                        {peerState?.isReachable ? `Connected to ${peerState.peerIp}` : 'Looking for other PC on network...'}
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-500 dark:text-slate-400 space-y-1">
                      <div>This PC IP: <span className="font-mono font-bold text-slate-700 dark:text-slate-200">{peerState?.localIps?.[0]?.address || '127.0.0.1'}</span></div>
                      <div>Captured pictures replicate across both PCs so all journals can be verified 100%.</div>
                    </div>

                    <div className="space-y-1.5 pt-1">
                      <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase">Other PC IP Address</label>
                      <div className="flex space-x-1.5">
                        <input
                          type="text"
                          value={customPeerIp}
                          onChange={(e) => setCustomPeerIp(e.target.value)}
                          placeholder="e.g. 192.168.1.50"
                          className="flex-1 px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg font-mono outline-none focus:ring-1 focus:ring-brand-500 text-slate-900 dark:text-white"
                        />
                        <button
                          onClick={handleConnectPeer}
                          disabled={isSyncing}
                          className="px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg transition-all cursor-pointer disabled:opacity-50"
                        >
                          Connect
                        </button>
                      </div>
                    </div>

                    {syncMessage && (
                      <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-300 text-[11px] font-medium">
                        {syncMessage}
                      </div>
                    )}

                    <div className="flex items-center space-x-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                      <button
                        onClick={handleSyncAll}
                        disabled={isSyncing}
                        className="flex-1 py-1.5 px-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg font-bold flex items-center justify-center space-x-1 transition-all cursor-pointer"
                      >
                        <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
                        <span>Sync All</span>
                      </button>
                      <button
                        onClick={handleScanSubnet}
                        disabled={isScanning}
                        className="py-1.5 px-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg font-bold transition-all cursor-pointer"
                        title="Scan local WiFi/LAN for other PC"
                      >
                        <span>{isScanning ? 'Scanning...' : 'Scan LAN'}</span>
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="space-y-2">
                    <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed border border-slate-200 dark:border-slate-700">
                      <div className="font-bold text-slate-700 dark:text-slate-200 mb-1">LAN Sync is Paused</div>
                      Captured pictures are saved locally on this PC only. Toggle the switch <strong>ON</strong> whenever you want to automatically mirror captures with PC 2 and run 100% lot verification.
                    </div>
                    {syncMessage && (
                      <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-300 text-[11px] font-medium">
                        {syncMessage}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

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
