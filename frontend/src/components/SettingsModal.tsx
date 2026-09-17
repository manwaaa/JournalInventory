import React, { useState, useEffect } from 'react';
import { X, Settings, Folder, Save, Check } from 'lucide-react';
import { SystemConfig } from '../types';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config?: SystemConfig | null;
  onConfigSaved?: (newCfg: SystemConfig) => void;
  onConfigUpdated?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  onConfigSaved,
  onConfigUpdated
}) => {
  const [config, setConfig] = useState<SystemConfig>({
    storagePath: 'C:\\Journal_Proofs',
    autoOpenExplorer: false,
    soundEnabled: true,
    imageQuality: 0.95,
    cameraResolution: '1080p',
    enforceManifest: false
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
        const data = await res.json();
        setSavedSuccess(true);
        if (onConfigSaved) onConfigSaved(data.config || config);
        if (onConfigUpdated) onConfigUpdated();
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-lg rounded-2xl modal-card overflow-hidden">
        
        {/* Modal Header */}
        <div className="p-5 border-b border-blue-100 flex items-center justify-between bg-gradient-to-r from-blue-50/70 to-indigo-50/50">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl btn-primary-gradient text-white shadow-md shadow-brand-500/20">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900 tracking-tight">
                Tool Preferences & Workstation
              </h3>
              <p className="text-xs text-slate-500">
                Verification storage and system settings
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          
          {/* Storage Path */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Storage Root Directory (Windows)
            </label>
            <div className="relative">
              <Folder className="w-4 h-4 text-amber-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={config.storagePath}
                onChange={(e) => setConfig({ ...config, storagePath: e.target.value })}
                className="w-full pl-10 pr-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="C:\Journal_Proofs"
                required
              />
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Folders will be created under: <code className="text-brand-700 font-mono">C:\Journal_Proofs\&lt;ISBN&gt;\</code>
            </p>
          </div>

          {/* Manifest Enforcement Toggle */}
          <div className="p-3 rounded-xl border border-blue-200 bg-blue-50/50 space-y-1">
            <label className="flex items-center space-x-3 cursor-pointer">
              <input
                type="checkbox"
                checked={config.enforceManifest ?? false}
                onChange={(e) => setConfig({ ...config, enforceManifest: e.target.checked })}
                className="w-4 h-4 rounded text-brand-700 focus:ring-brand-500 border-slate-300"
              />
              <div className="text-xs">
                <span className="font-bold text-slate-800 block">
                  Strict Manifest Enforcement
                </span>
                <span className="text-slate-500 text-[11px]">
                  Block scanning for any ISBN not found or marked Not Processable in the manifest
                </span>
              </div>
            </label>
          </div>

          {/* Sound & UI Toggles */}
          <div className="space-y-3">
            <label className="flex items-center space-x-3 cursor-pointer p-3 rounded-xl border border-slate-200 bg-slate-50/60 hover:bg-slate-100 transition-colors">
              <input
                type="checkbox"
                checked={config.soundEnabled}
                onChange={(e) => setConfig({ ...config, soundEnabled: e.target.checked })}
                className="w-4 h-4 rounded text-brand-700 focus:ring-brand-500 border-slate-300"
              />
              <div className="text-xs">
                <span className="font-bold text-slate-800 block">
                  Audio Feedback & Shutter Chimes
                </span>
                <span className="text-slate-500 text-[11px]">
                  Play shutter sounds and scanner beeps
                </span>
              </div>
            </label>

            <label className="flex items-center space-x-3 cursor-pointer p-3 rounded-xl border border-slate-200 bg-slate-50/60 hover:bg-slate-100 transition-colors">
              <input
                type="checkbox"
                checked={config.autoOpenExplorer}
                onChange={(e) => setConfig({ ...config, autoOpenExplorer: e.target.checked })}
                className="w-4 h-4 rounded text-brand-700 focus:ring-brand-500 border-slate-300"
              />
              <div className="text-xs">
                <span className="font-bold text-slate-800 block">
                  Auto-Open Windows Explorer
                </span>
                <span className="text-slate-500 text-[11px]">
                  Pop open folder in Explorer when all 6 verification photos are saved
                </span>
              </div>
            </label>

            {/* Audit Watermark */}
            <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
              <label className="flex items-center space-x-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.watermarkEnabled ?? true}
                  onChange={(e) => setConfig({ ...config, watermarkEnabled: e.target.checked })}
                  className="w-4 h-4 rounded text-brand-700 focus:ring-brand-500 border-slate-300"
                />
                <div className="text-xs">
                  <span className="font-bold text-slate-800 block">
                    Embed Audit Watermark & Station Stamp
                  </span>
                  <span className="text-slate-500 text-[11px]">
                    Burn ISBN, timestamp, shot name, and workstation ID into verification photos
                  </span>
                </div>
              </label>

              {(config.watermarkEnabled ?? true) && (
                <div className="pl-7 pt-1">
                  <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
                    Workstation ID
                  </label>
                  <input
                    type="text"
                    value={config.watermarkStation || 'Station-01'}
                    onChange={(e) => setConfig({ ...config, watermarkStation: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-brand-500 font-mono"
                    placeholder="Station-01"
                  />
                </div>
              )}
            </div>

            {/* Blur Check */}
            <label className="flex items-center space-x-3 cursor-pointer p-3 rounded-xl border border-slate-200 bg-slate-50/60 hover:bg-slate-100 transition-colors">
              <input
                type="checkbox"
                checked={config.blurCheckEnabled ?? true}
                onChange={(e) => setConfig({ ...config, blurCheckEnabled: e.target.checked })}
                className="w-4 h-4 rounded text-brand-700 focus:ring-brand-500 border-slate-300"
              />
              <div className="text-xs">
                <span className="font-bold text-slate-800 block">
                  Blur & Motion Sharpness Detection
                </span>
                <span className="text-slate-500 text-[11px]">
                  Warn operator when captured image is out of focus
                </span>
              </div>
            </label>

          </div>

          {/* Save Button */}
          <div className="pt-3 border-t border-slate-200 flex justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold rounded-xl text-slate-600 hover:bg-slate-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center space-x-2 px-6 py-2 text-xs font-bold text-white btn-primary-gradient rounded-xl transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
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
