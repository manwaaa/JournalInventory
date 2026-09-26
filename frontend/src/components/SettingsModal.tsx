import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { 
  X, 
  Settings, 
  Folder, 
  Save, 
  Check, 
  CloudUpload, 
  ShieldCheck, 
  Loader2, 
  AlertCircle, 
  CheckCircle2, 
  Network, 
  Camera, 
  ArrowLeftRight,
  RotateCw,
  FlipHorizontal,
  FlipVertical
} from 'lucide-react';
import { CameraDevice, SystemConfig } from '../types';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config?: SystemConfig | null;
  devices?: CameraDevice[];
  boxCameraDeviceId?: string;
  bookCameraDeviceId?: string;
  autoSwitchCamera?: boolean;
  rotation?: number;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
  onRotationChange?: (deg: number) => void;
  onFlipHorizontalChange?: (flip: boolean) => void;
  onFlipVerticalChange?: (flip: boolean) => void;
  onBoxCameraChange?: (id: string) => void;
  onBookCameraChange?: (id: string) => void;
  onAutoSwitchCameraChange?: (enabled: boolean) => void;
  onConfigSaved?: (newCfg: SystemConfig) => void;
  onConfigUpdated?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  devices = [],
  boxCameraDeviceId = '',
  bookCameraDeviceId = '',
  autoSwitchCamera = true,
  rotation = 0,
  flipHorizontal = false,
  flipVertical = false,
  onRotationChange,
  onFlipHorizontalChange,
  onFlipVerticalChange,
  onBoxCameraChange,
  onBookCameraChange,
  onAutoSwitchCameraChange,
  onConfigSaved,
  onConfigUpdated
}) => {
  const [config, setConfig] = useState<SystemConfig>({
    storagePath: 'C:\\Journal_Proofs',
    autoOpenExplorer: false,
    soundEnabled: true,
    imageQuality: 0.95,
    cameraResolution: '1080p',
    enforceManifest: false,
    s3Enabled: false,
    s3Bucket: '',
    s3Region: 'us-east-1',
    s3AccessKeyId: '',
    s3SecretAccessKey: '',
    s3Prefix: 'journal-proofs/',
    s3CustomEndpoint: ''
  });
  const [selectedBoxCam, setSelectedBoxCam] = useState<string>(boxCameraDeviceId);
  const [selectedBookCam, setSelectedBookCam] = useState<string>(bookCameraDeviceId);
  const [selectedAutoSwitch, setSelectedAutoSwitch] = useState<boolean>(autoSwitchCamera);

  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [testingS3, setTestingS3] = useState(false);
  const [s3TestResult, setS3TestResult] = useState<{ success: boolean; message?: string; error?: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetch('/api/system/config')
        .then((res) => res.json())
        .then((data) => setConfig(data))
        .catch((err) => console.error('Error fetching config:', err));
      
      setSelectedBoxCam(boxCameraDeviceId || (devices[0]?.deviceId ?? ''));
      setSelectedBookCam(bookCameraDeviceId || (devices[1]?.deviceId ?? devices[0]?.deviceId ?? ''));
      setSelectedAutoSwitch(autoSwitchCamera);
    }
  }, [isOpen, boxCameraDeviceId, bookCameraDeviceId, autoSwitchCamera, devices]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/system/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...config,
          boxCameraDeviceId: selectedBoxCam,
          bookCameraDeviceId: selectedBookCam,
          autoSwitchCamera: selectedAutoSwitch
        })
      });

      if (onBoxCameraChange) onBoxCameraChange(selectedBoxCam);
      if (onBookCameraChange) onBookCameraChange(selectedBookCam);
      if (onAutoSwitchCameraChange) onAutoSwitchCameraChange(selectedAutoSwitch);

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

  const handleTestS3 = async () => {
    if (!config.s3Bucket || !config.s3AccessKeyId) {
      setS3TestResult({ success: false, error: 'S3 Bucket and Access Key ID are required to test connection.' });
      return;
    }

    setTestingS3(true);
    setS3TestResult(null);

    try {
      const res = await fetch('/api/s3/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          s3Bucket: config.s3Bucket,
          s3Region: config.s3Region || 'us-east-1',
          s3AccessKeyId: config.s3AccessKeyId,
          s3SecretAccessKey: config.s3SecretAccessKey,
          s3CustomEndpoint: config.s3CustomEndpoint
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setS3TestResult({ success: true, message: data.message });
      } else {
        setS3TestResult({ success: false, error: data.error || 'Connection failed' });
      }
    } catch (err: any) {
      setS3TestResult({ success: false, error: err.message || 'Network error' });
    } finally {
      setTestingS3(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-xl rounded-2xl modal-card overflow-hidden">
        
        {/* Modal Header */}
        <div className="p-5 border-b border-blue-100 flex items-center justify-between bg-gradient-to-r from-blue-50/70 to-indigo-50/50">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl btn-primary-gradient text-white shadow-md shadow-brand-500/20">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900 tracking-tight">
                Workstation & Camera Settings
              </h3>
              <p className="text-xs text-slate-500">
                Configure workstation roles, dual camera assignments, and storage
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



          {/* Multi-PC LAN Peer Synchronization Section */}
          <div className="p-4 rounded-xl border border-sky-200 bg-gradient-to-r from-sky-50/70 to-blue-50/40 space-y-3">
            <div className="flex items-center justify-between pb-1 border-b border-sky-100">
              <div className="flex items-center space-x-2">
                <Network className="w-4 h-4 text-sky-700" />
                <span className="font-bold text-slate-800 text-xs">Multi-PC LAN Peer Sync (PC 1 ↔ PC 2)</span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.peerSyncEnabled || false}
                  onChange={(e) => setConfig({ ...config, peerSyncEnabled: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-8 h-4 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-sky-600"></div>
                <span className="ml-2 text-xs font-bold text-slate-700">
                  {config.peerSyncEnabled ? 'Active' : 'Disabled'}
                </span>
              </label>
            </div>

            <p className="text-[11px] text-slate-600">
              When enabled, <b>Shot 1 (Box A)</b> and <b>Shot 2 (Box B)</b> captured on PC 1 are automatically synced to PC 2 across your local network so PC 2 will not picture them!
            </p>

            {config.peerSyncEnabled && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Other PC's IP Address (e.g. 192.168.1.50)
                  </label>
                  <input
                    type="text"
                    value={config.peerIp || ''}
                    onChange={(e) => setConfig({ ...config, peerIp: e.target.value })}
                    placeholder="e.g. 192.168.1.50"
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs outline-none font-mono focus:ring-2 focus:ring-brand-500"
                  />
                  <span className="text-[10px] text-slate-500 mt-0.5 block">
                    If this is PC 2, enter the IP address of PC 1.
                  </span>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Peer Port
                  </label>
                  <input
                    type="number"
                    value={config.peerPort || 3001}
                    onChange={(e) => setConfig({ ...config, peerPort: parseInt(e.target.value, 10) || 3001 })}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs outline-none font-mono focus:ring-2 focus:ring-brand-500"
                  />
                  <span className="text-[10px] text-slate-500 mt-0.5 block">
                    Default is 3001.
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Dual Camera Setup Section */}
          <div className="p-4 rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50/60 to-purple-50/40 space-y-3">
            <div className="flex items-center justify-between pb-1 border-b border-indigo-100">
              <div className="flex items-center space-x-2">
                <Camera className="w-4 h-4 text-indigo-700" />
                <span className="font-bold text-slate-800 text-xs">Dual Camera Configuration</span>
              </div>
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                devices.length >= 2 
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' 
                  : 'bg-blue-100 text-blue-800 border border-blue-300'
              }`}>
                {devices.length} Camera{devices.length !== 1 ? 's' : ''} Connected
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Primary Camera (Box Shots 1 & 2) */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  📦 Camera 1 (Box Shots: 1. Box A & 2. Box B)
                </label>
                <select
                  value={selectedBoxCam}
                  onChange={(e) => setSelectedBoxCam(e.target.value)}
                  className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 cursor-pointer"
                >
                  {devices.length > 0 ? (
                    devices.map((d) => (
                      <option key={`box-${d.deviceId}`} value={d.deviceId}>
                        {d.label}
                      </option>
                    ))
                  ) : (
                    <option value="">Default Camera</option>
                  )}
                </select>
                <p className="text-[10px] text-slate-500 mt-0.5">Overhead wide-angle / label camera</p>
              </div>

              {/* Secondary Camera (Book Shots 3 to 7) */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  📖 Camera 2 (Book Inspection: Shots 3–7)
                </label>
                <select
                  value={selectedBookCam}
                  onChange={(e) => setSelectedBookCam(e.target.value)}
                  className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 cursor-pointer"
                >
                  {devices.length > 0 ? (
                    devices.map((d) => (
                      <option key={`book-${d.deviceId}`} value={d.deviceId}>
                        {d.label}
                      </option>
                    ))
                  ) : (
                    <option value="">Default Camera</option>
                  )}
                </select>
                <p className="text-[10px] text-slate-500 mt-0.5">Macro / document stand camera</p>
              </div>
            </div>

            {/* Auto-Switch Toggle */}
            <label className="flex items-center space-x-3 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={selectedAutoSwitch}
                onChange={(e) => setSelectedAutoSwitch(e.target.checked)}
                className="w-4 h-4 rounded text-brand-700 focus:ring-brand-500 border-slate-300"
              />
              <div className="text-xs">
                <span className="font-bold text-slate-800 block">
                  Automatic Camera Switching by Step
                </span>
                <span className="text-slate-500 text-[11px]">
                  Automatically switches to Camera 1 for Shots 1–2, and switches to Camera 2 for Shots 3–7
                </span>
              </div>
            </label>

            {/* Camera Orientation & Mirroring */}
            <div className="pt-2 border-t border-indigo-100">
              <label className="block text-[11px] font-bold text-slate-700 mb-2">
                🔄 Camera Orientation & Mirroring (Per Station)
              </label>
              
              <div className="flex flex-wrap items-center gap-2">
                {/* 0° */}
                <button
                  type="button"
                  onClick={() => onRotationChange && onRotationChange(0)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    rotation === 0
                      ? 'bg-brand-600 text-white shadow-sm'
                      : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  0° (Normal)
                </button>

                {/* 90° */}
                <button
                  type="button"
                  onClick={() => onRotationChange && onRotationChange(90)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    rotation === 90
                      ? 'bg-brand-600 text-white shadow-sm'
                      : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  90° (Clockwise)
                </button>

                {/* 180° */}
                <button
                  type="button"
                  onClick={() => onRotationChange && onRotationChange(180)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    rotation === 180
                      ? 'bg-brand-600 text-white shadow-sm'
                      : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  180° (Inverted)
                </button>

                {/* 270° */}
                <button
                  type="button"
                  onClick={() => onRotationChange && onRotationChange(270)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    rotation === 270
                      ? 'bg-brand-600 text-white shadow-sm'
                      : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  270° (Counter-CW)
                </button>

                {/* Flip Horizontal */}
                <button
                  type="button"
                  onClick={() => onFlipHorizontalChange && onFlipHorizontalChange(!flipHorizontal)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-all cursor-pointer ${
                    flipHorizontal
                      ? 'bg-amber-600 text-white shadow-sm'
                      : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <FlipHorizontal className="w-3.5 h-3.5" />
                  <span>Flip Horizontal {flipHorizontal ? '(ON)' : ''}</span>
                </button>

                {/* Flip Vertical */}
                <button
                  type="button"
                  onClick={() => onFlipVerticalChange && onFlipVerticalChange(!flipVertical)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-all cursor-pointer ${
                    flipVertical
                      ? 'bg-amber-600 text-white shadow-sm'
                      : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <FlipVertical className="w-3.5 h-3.5" />
                  <span>Flip Vertical {flipVertical ? '(ON)' : ''}</span>
                </button>
              </div>
              <p className="text-[10px] text-slate-500 mt-1.5">
                Rotates & flips both the live viewfinder and the saved photo proof files on this PC.
              </p>
            </div>
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
                  Pop open folder in Explorer when verification photos are saved
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

            {/* AWS S3 Client Cloud Settings */}
            <div className="p-4 rounded-xl border border-blue-200 bg-blue-50/40 space-y-3">
              <div className="flex items-center justify-between pb-1 border-b border-blue-100">
                <div className="flex items-center space-x-2">
                  <CloudUpload className="w-4 h-4 text-brand-700" />
                  <span className="font-bold text-slate-800 text-xs">AWS S3 / Client Cloud Storage</span>
                </div>
                <button
                  type="button"
                  onClick={handleTestS3}
                  disabled={testingS3 || !config.s3Bucket || !config.s3AccessKeyId}
                  className="px-2.5 py-1 text-[11px] font-bold text-brand-700 bg-white border border-brand-200 rounded-lg hover:bg-blue-50 disabled:opacity-50 flex items-center space-x-1 transition-colors cursor-pointer"
                >
                  {testingS3 ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
                  <span>Test S3</span>
                </button>
              </div>

              {s3TestResult && (
                <div className={`p-2.5 rounded-lg text-[11px] font-semibold flex items-center space-x-2 ${
                  s3TestResult.success ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'
                }`}>
                  {s3TestResult.success ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />}
                  <span>{s3TestResult.message || s3TestResult.error}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">S3 Bucket Name</label>
                  <input
                    type="text"
                    value={config.s3Bucket || ''}
                    onChange={(e) => setConfig({ ...config, s3Bucket: e.target.value })}
                    placeholder="e.g. client-journal-proofs"
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-mono text-xs outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">AWS Region</label>
                  <input
                    type="text"
                    value={config.s3Region || 'us-east-1'}
                    onChange={(e) => setConfig({ ...config, s3Region: e.target.value })}
                    placeholder="us-east-1"
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-mono text-xs outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">AWS Access Key ID</label>
                  <input
                    type="text"
                    value={config.s3AccessKeyId || ''}
                    onChange={(e) => setConfig({ ...config, s3AccessKeyId: e.target.value })}
                    placeholder="AKIA..."
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-mono text-xs outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">AWS Secret Access Key</label>
                  <input
                    type="password"
                    value={config.s3SecretAccessKey || ''}
                    onChange={(e) => setConfig({ ...config, s3SecretAccessKey: e.target.value })}
                    placeholder="••••••••"
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-mono text-xs outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Folder Prefix (Path)</label>
                  <input
                    type="text"
                    value={config.s3Prefix || 'journal-proofs/'}
                    onChange={(e) => setConfig({ ...config, s3Prefix: e.target.value })}
                    placeholder="journal-proofs/"
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-mono text-xs outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Custom S3 Endpoint (Optional)</label>
                  <input
                    type="text"
                    value={config.s3CustomEndpoint || ''}
                    onChange={(e) => setConfig({ ...config, s3CustomEndpoint: e.target.value })}
                    placeholder="e.g. MinIO / R2 URL"
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-mono text-xs outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </div>
              </div>
            </div>

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
    </div>,
    document.body
  );
};
