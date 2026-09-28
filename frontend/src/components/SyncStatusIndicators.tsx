import React, { useState, useRef, useEffect } from 'react';
import { 
  Cloud, 
  CloudUpload, 
  CloudOff, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  ArrowRightLeft, 
  Wifi, 
  WifiOff, 
  Settings, 
  Layers, 
  Radio,
  ExternalLink,
  ChevronDown,
  X
} from 'lucide-react';
import { StationRole, SessionEvent, S3SyncStatus } from '../types';

interface SyncStatusIndicatorsProps {
  // LAN Peer Sync
  isPeerConnected: boolean;
  lastPeerEvent: SessionEvent | null;
  lastPeerHeartbeat: Date | null;
  stationRole: StationRole;
  onResetRemoteSession?: (opts?: { clearBoxContext?: boolean; lotNumber?: string; boxNumber?: string }) => Promise<any>;
  
  // S3 Cloud Sync
  s3Status: S3SyncStatus;
  isS3ManualSyncing: boolean;
  s3SyncFeedback: string | null;
  onTriggerS3Sync: (force?: boolean) => Promise<void>;
  onOpenSettings: () => void;
}

export const SyncStatusIndicators: React.FC<SyncStatusIndicatorsProps> = ({
  isPeerConnected,
  lastPeerEvent,
  lastPeerHeartbeat,
  stationRole,
  onResetRemoteSession,
  s3Status,
  isS3ManualSyncing,
  s3SyncFeedback,
  onTriggerS3Sync,
  onOpenSettings,
}) => {
  const [activePopover, setActivePopover] = useState<'peer' | 's3' | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close popover when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setActivePopover(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const formatTimeAgo = (date: Date | string | null | undefined) => {
    if (!date) return 'Never';
    const d = typeof date === 'string' ? new Date(date) : date;
    const diffSecs = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diffSecs < 5) return 'Just now';
    if (diffSecs < 60) return `${diffSecs}s ago`;
    const diffMins = Math.floor(diffSecs / 60);
    if (diffMins < 60) return `${diffMins}m ago`;
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getStationRoleLabel = (role: StationRole) => {
    switch (role) {
      case 'box_level': return 'PC 1 (Box Level)';
      case 'book_level': return 'PC 2 (Interior 3-7)';
      case 'all_in_one': return 'Standalone (Full 1-7)';
      case 'box_spine': return 'Box + Spine (1,2,4)';
      default: return role;
    }
  };

  const getPeerStationRoleLabel = (role: StationRole) => {
    switch (role) {
      case 'box_level': return 'PC 2 (Book Station)';
      case 'book_level': return 'PC 1 (Box Station)';
      default: return 'Peer Station';
    }
  };

  const isS3Active = s3Status.progress.isSyncing || s3Status.queueSize > 0 || isS3ManualSyncing;

  return (
    <div ref={containerRef} className="relative flex items-center space-x-1.5 sm:space-x-2">
      
      {/* ------------------------------------------------------------- */}
      {/* 1. Multi-PC LAN Peer Sync Indicator Pill */}
      {/* ------------------------------------------------------------- */}
      <div className="relative">
        <button
          onClick={() => setActivePopover(activePopover === 'peer' ? null : 'peer')}
          title="Multi-PC LAN Peer Synchronization Status"
          className={`flex items-center space-x-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-bold transition-all duration-200 border cursor-pointer select-none active:scale-95 ${
            isPeerConnected
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200/80 hover:bg-emerald-100/70 shadow-xs'
              : 'bg-amber-50 text-amber-800 border-amber-200/80 hover:bg-amber-100/70 animate-pulse'
          }`}
        >
          {isPeerConnected ? (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
          ) : (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
            </span>
          )}

          <ArrowRightLeft className={`w-3.5 h-3.5 ${isPeerConnected ? 'text-emerald-600' : 'text-amber-600'}`} />
          
          <span className="hidden md:inline font-mono tracking-tight">
            {isPeerConnected ? 'LAN Linked' : 'Peer Sync...'}
          </span>
          <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform duration-200 ${activePopover === 'peer' ? 'rotate-180' : ''}`} />
        </button>

        {/* Peer Popover Details */}
        {activePopover === 'peer' && (
          <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-2xl shadow-2xl border border-slate-200 p-4 z-50 animate-fade-in text-slate-800">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <div className={`p-1.5 rounded-lg ${isPeerConnected ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                  <Radio className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-900">Multi-PC LAN Sync</h4>
                  <p className="text-[11px] text-slate-500">Real-time cross-device session event stream</p>
                </div>
              </div>
              <button 
                onClick={() => setActivePopover(null)} 
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="py-3 space-y-2.5 text-xs">
              <div className="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-100">
                <span className="text-slate-500 font-medium">Link Status:</span>
                <span className="flex items-center space-x-1.5 font-bold">
                  {isPeerConnected ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="text-emerald-700">Online & Synchronized</span>
                    </>
                  ) : (
                    <>
                      <WifiOff className="w-3.5 h-3.5 text-amber-600 animate-pulse" />
                      <span className="text-amber-700">Connecting / Offline</span>
                    </>
                  )}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="p-2 rounded-xl bg-blue-50/60 border border-blue-100">
                  <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">This Station</span>
                  <span className="font-extrabold text-blue-900 block truncate mt-0.5">
                    {getStationRoleLabel(stationRole)}
                  </span>
                </div>
                <div className="p-2 rounded-xl bg-indigo-50/60 border border-indigo-100">
                  <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Target Peer</span>
                  <span className="font-extrabold text-indigo-900 block truncate mt-0.5">
                    {getPeerStationRoleLabel(stationRole)}
                  </span>
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 space-y-1">
                <div className="flex justify-between text-slate-500 text-[11px]">
                  <span>Last Heartbeat:</span>
                  <span className="font-mono font-medium text-slate-700">{formatTimeAgo(lastPeerHeartbeat)}</span>
                </div>
                {lastPeerEvent && (
                  <div className="flex justify-between text-slate-500 text-[11px]">
                    <span>Last Received Event:</span>
                    <span className="font-mono font-bold text-slate-800 truncate max-w-[170px]" title={lastPeerEvent.type}>
                      {lastPeerEvent.type}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
              {onResetRemoteSession && (
                <button
                  onClick={async () => {
                    await onResetRemoteSession();
                    setActivePopover(null);
                  }}
                  className="w-full py-1.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all cursor-pointer flex items-center justify-center space-x-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Resync / Clear Session</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------- */}
      {/* 2. AWS S3 Cloud Sync Indicator Pill */}
      {/* ------------------------------------------------------------- */}
      <div className="relative">
        <button
          onClick={() => setActivePopover(activePopover === 's3' ? null : 's3')}
          title="AWS S3 Cloud Backup Status"
          className={`flex items-center space-x-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-bold transition-all duration-200 border cursor-pointer select-none active:scale-95 ${
            isS3Active
              ? 'bg-blue-50 text-blue-800 border-blue-200/80 hover:bg-blue-100/70 shadow-xs'
              : s3Status.s3Configured
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200/80 hover:bg-emerald-100/70 shadow-xs'
              : 'bg-slate-100 text-slate-600 border-slate-200/80 hover:bg-slate-200/70'
          }`}
        >
          {isS3Active ? (
            <CloudUpload className="w-3.5 h-3.5 text-blue-600 animate-bounce" />
          ) : s3Status.s3Configured ? (
            <Cloud className="w-3.5 h-3.5 text-emerald-600" />
          ) : (
            <CloudOff className="w-3.5 h-3.5 text-slate-400" />
          )}

          <span className="hidden md:inline font-mono tracking-tight">
            {isS3Active ? (
              <span>S3 Syncing... {s3Status.queueSize > 0 ? `(${s3Status.queueSize})` : ''}</span>
            ) : s3Status.s3Configured ? (
              <span>S3 Synced</span>
            ) : (
              <span>S3 Off</span>
            )}
          </span>

          <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform duration-200 ${activePopover === 's3' ? 'rotate-180' : ''}`} />
        </button>

        {/* S3 Popover Details */}
        {activePopover === 's3' && (
          <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-2xl shadow-2xl border border-slate-200 p-4 z-50 animate-fade-in text-slate-800">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <div className={`p-1.5 rounded-lg ${s3Status.s3Configured ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
                  <Cloud className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-900">AWS S3 Cloud Storage</h4>
                  <p className="text-[11px] text-slate-500">Automated multi-device cloud backup & sync</p>
                </div>
              </div>
              <button 
                onClick={() => setActivePopover(null)} 
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="py-3 space-y-2.5 text-xs">
              {/* Feedback toast if any */}
              {s3SyncFeedback && (
                <div className="p-2.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-[11px] font-medium animate-fade-in flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
                  <span>{s3SyncFeedback}</span>
                </div>
              )}

              <div className="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-100">
                <span className="text-slate-500 font-medium">S3 Status:</span>
                <span className="flex items-center space-x-1.5 font-bold">
                  {s3Status.s3Configured ? (
                    isS3Active ? (
                      <>
                        <CloudUpload className="w-3.5 h-3.5 text-blue-600 animate-bounce" />
                        <span className="text-blue-700">Uploading in Background</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span className="text-emerald-700">Connected & Up to Date</span>
                      </>
                    )
                  ) : (
                    <>
                      <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                      <span className="text-amber-700">Credentials Not Configured</span>
                    </>
                  )}
                </span>
              </div>

              {/* Progress / Stats Grid */}
              <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                <div className="p-2 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="text-slate-400 block text-[10px] font-bold uppercase">Queue</span>
                  <span className="font-extrabold text-slate-900 text-sm font-mono">{s3Status.queueSize}</span>
                </div>
                <div className="p-2 rounded-xl bg-emerald-50/60 border border-emerald-100">
                  <span className="text-emerald-600 block text-[10px] font-bold uppercase">Uploaded</span>
                  <span className="font-extrabold text-emerald-800 text-sm font-mono">{s3Status.progress.completedCount}</span>
                </div>
                <div className="p-2 rounded-xl bg-amber-50/60 border border-amber-100">
                  <span className="text-amber-600 block text-[10px] font-bold uppercase">Failed</span>
                  <span className="font-extrabold text-amber-800 text-sm font-mono">{s3Status.progress.failedCount}</span>
                </div>
              </div>

              {s3Status.progress.currentIsbn && (
                <div className="p-2 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-between text-[11px]">
                  <span className="text-blue-700 font-medium">Uploading ISBN:</span>
                  <span className="font-mono font-extrabold text-blue-950">{s3Status.progress.currentIsbn}</span>
                </div>
              )}

              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 space-y-1 text-[11px]">
                <div className="flex justify-between text-slate-500">
                  <span>Last S3 Sync:</span>
                  <span className="font-mono font-medium text-slate-700">{formatTimeAgo(s3Status.progress.lastSyncAt)}</span>
                </div>
                {s3Status.progress.lastError && (
                  <div className="text-red-600 text-[10px] font-mono truncate pt-1 border-t border-slate-200" title={s3Status.progress.lastError}>
                    Error: {s3Status.progress.lastError}
                  </div>
                )}
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
              <button
                onClick={() => onTriggerS3Sync(false)}
                disabled={isS3ManualSyncing || !s3Status.s3Configured}
                className="flex-1 py-1.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-all cursor-pointer flex items-center justify-center space-x-1.5 shadow-md shadow-blue-500/20 disabled:opacity-50"
              >
                <CloudUpload className={`w-3.5 h-3.5 ${isS3ManualSyncing ? 'animate-bounce' : ''}`} />
                <span>{isS3ManualSyncing ? 'Scanning...' : 'Sync All Pending'}</span>
              </button>

              <button
                onClick={() => {
                  setActivePopover(null);
                  onOpenSettings();
                }}
                className="py-1.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all cursor-pointer flex items-center justify-center space-x-1"
                title="Configure AWS S3 Bucket, Keys & Region"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>Settings</span>
              </button>
            </div>
          </div>
        )}
      </div>

    </div>
  );
};
