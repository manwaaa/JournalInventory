import React, { useState, useEffect } from 'react';
import { X, Settings, Folder, Volume2, Save, Wifi, Check, Laptop } from 'lucide-react';
import { SystemConfig, SystemStatus } from '../types';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  systemStatus: SystemStatus | null;
  onConfigUpdated: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  systemStatus,
  onConfigUpdated
}) => {
  const [config, setConfig] = useState<SystemConfig>({
    storagePath: 'C:\\Journal_Proofs',
    autoOpenExplorer: false,
    soundEnabled: true,
    imageQuality: 0.95,
    cameraResolution: '1080p'
  });
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetch('/api/system/config')
        .then((res) => res.json())
        .then((data) => setConfig(data))
        .catch((err) => console.error('Error fetching config:', err));
    }
  }, [isOpen]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/system/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      if (res.ok) {
        setSavedSuccess(true);
        onConfigUpdated();
        setTimeout(() => {
          setSavedSuccess(false);
          onClose();
        }, 800);
      }
    } catch (err) {
      console.error('Save config error:', err);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-overlay-in">
      <div className="w-full max-w-lg rounded-2xl glass-panel shadow-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                Tool Preferences & Storage
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                System and capture behavior settings
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="p-5 space-y-4">
          
          {/* Storage Path */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
              Storage Root Directory (Windows)
            </label>
            <div className="relative">
              <Folder className="w-4 h-4 text-amber-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={config.storagePath}
                onChange={(e) => setConfig({ ...config, storagePath: e.target.value })}
                className="w-full pl-10 pr-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="C:\Journal_Proofs"
                required
              />
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Folders will be created automatically under this root: <code className="text-brand-500 font-mono">C:\Journal_Proofs\&lt;ISBN&gt;\</code>
            </p>
          </div>

          {/* Sound & UI Toggles */}
          <div className="space-y-3 pt-2">
            <label className="flex items-center space-x-3 cursor-pointer p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 hover:bg-slate-100/50 dark:hover:bg-slate-800/60 transition-colors">
              <input
                type="checkbox"
                checked={config.soundEnabled}
                onChange={(e) => setConfig({ ...config, soundEnabled: e.target.checked })}
                className="w-4 h-4 rounded text-brand-600 focus:ring-brand-500 border-slate-300"
              />
              <div className="text-xs">
                <span className="font-semibold text-slate-800 dark:text-slate-200 block">
                  Audio Feedback & Shutter Chimes
                </span>
                <span className="text-slate-400 text-[11px]">
                  Play camera shutter sounds and barcode scanner beeps
                </span>
              </div>
            </label>

            <label className="flex items-center space-x-3 cursor-pointer p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 hover:bg-slate-100/50 dark:hover:bg-slate-800/60 transition-colors">
              <input
                type="checkbox"
                checked={config.autoOpenExplorer}
                onChange={(e) => setConfig({ ...config, autoOpenExplorer: e.target.checked })}
                className="w-4 h-4 rounded text-brand-600 focus:ring-brand-500 border-slate-300"
              />
              <div className="text-xs">
                <span className="font-semibold text-slate-800 dark:text-slate-200 block">
                  Auto-Open Windows Explorer
                </span>
                <span className="text-slate-400 text-[11px]">
                  Pop open folder automatically in Explorer when 2nd photo is saved
                </span>
              </div>
            </label>

            {/* Audit Watermark & Stamp */}
            <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 space-y-2.5">
              <label className="flex items-center space-x-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.watermarkEnabled ?? true}
                  onChange={(e) => setConfig({ ...config, watermarkEnabled: e.target.checked })}
                  className="w-4 h-4 rounded text-brand-600 focus:ring-brand-500 border-slate-300"
                />
                <div className="text-xs">
                  <span className="font-semibold text-slate-800 dark:text-slate-200 block">
                    Embed Audit Watermark & Timestamp
                  </span>
                  <span className="text-slate-400 text-[11px]">
                    Burn ISBN, timestamp, and workstation ID into the corner of proof photos
                  </span>
                </div>
              </label>

              {(config.watermarkEnabled ?? true) && (
                <div className="pl-7 pt-1">
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1">
                    Workstation ID / Station Label
                  </label>
                  <input
                    type="text"
                    value={config.watermarkStation || 'Station-01'}
                    onChange={(e) => setConfig({ ...config, watermarkStation: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-brand-500 font-mono"
                    placeholder="Station-01"
                  />
                </div>
              )}
            </div>

            {/* Blur & Quality Warning */}
            <label className="flex items-center space-x-3 cursor-pointer p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 hover:bg-slate-100/50 dark:hover:bg-slate-800/60 transition-colors">
              <input
                type="checkbox"
                checked={config.blurCheckEnabled ?? true}
                onChange={(e) => setConfig({ ...config, blurCheckEnabled: e.target.checked })}
                className="w-4 h-4 rounded text-brand-600 focus:ring-brand-500 border-slate-300"
              />
              <div className="text-xs">
                <span className="font-semibold text-slate-800 dark:text-slate-200 block">
                  Instant Blur & Motion Sharpness Detection
                </span>
                <span className="text-slate-400 text-[11px]">
                  Alert operator when captured photo is out of focus or motion-blurred
                </span>
              </div>
            </label>
          </div>

          {/* LAN Connection helper info */}
          {systemStatus && (
            <div className="p-3 rounded-xl bg-brand-50/50 dark:bg-brand-950/20 border border-brand-200 dark:border-brand-900/50">
              <div className="flex items-center space-x-2 text-xs font-bold text-brand-800 dark:text-brand-300 mb-1">
                <Laptop className="w-4 h-4 text-brand-600" />
                <span>Inventory PC Network Access (LAN)</span>
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 mb-1.5">
                Other inventory computers on the same network can access this tool at:
              </p>
              <div className="space-y-1">
                {systemStatus.networkIps.map((ip) => (
                  <div key={ip.address} className="flex items-center justify-between text-xs font-mono bg-white dark:bg-slate-900 p-1.5 rounded-lg border border-brand-100 dark:border-slate-800">
                    <span className="text-slate-500">{ip.interface}</span>
                    <span className="font-bold text-brand-600 dark:text-brand-400">http://{ip.address}:{systemStatus.port}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Save Button */}
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center space-x-2 px-5 py-2 text-xs font-bold text-white bg-brand-600 hover:bg-brand-500 rounded-xl shadow-md shadow-brand-500/20 transition-all active:scale-95 disabled:opacity-50"
            >
              {savedSuccess ? (
                <>
                  <Check className="w-4 h-4 text-white" />
                  <span>Saved!</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>{saving ? 'Saving...' : 'Save Settings'}</span>
                </>
              )}
            </button>
          </div>

        </form>

      </div>
    </div>
  );
};
