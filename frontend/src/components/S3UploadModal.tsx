import React, { useState, useEffect } from 'react';
import { 
  X, 
  CloudUpload, 
  CheckCircle2, 
  Copy, 
  Check, 
  ExternalLink, 
  AlertCircle, 
  Loader2, 
  Settings, 
  Folder, 
  ShieldCheck, 
  Layers,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { ProofItem, S3UploadResult, SystemConfig } from '../types';

interface S3UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  isbn: string;
  item?: ProofItem | null;
  systemConfig?: SystemConfig | null;
  onUploadSuccess?: (result: S3UploadResult) => void;
}

export const S3UploadModal: React.FC<S3UploadModalProps> = ({
  isOpen,
  onClose,
  isbn,
  item,
  systemConfig,
  onUploadSuccess
}) => {
  const [uploading, setUploading] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message?: string; error?: string } | null>(null);
  const [uploadResult, setUploadResult] = useState<S3UploadResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedUri, setCopiedUri] = useState(false);
  const [showConfigSettings, setShowConfigSettings] = useState(false);

  const [s3Bucket, setS3Bucket] = useState('');
  const [s3Region, setS3Region] = useState('us-east-1');
  const [s3Prefix, setS3Prefix] = useState('journal-proofs/');
  const [s3AccessKeyId, setS3AccessKeyId] = useState('');
  const [s3SecretAccessKey, setS3SecretAccessKey] = useState('');
  const [s3CustomEndpoint, setS3CustomEndpoint] = useState('');

  useEffect(() => {
    if (isOpen) {
      setUploadResult(null);
      setErrorMessage(null);
      setTestResult(null);
      setCopiedLink(false);
      setCopiedUri(false);

      // Load existing config
      fetch('/api/system/config')
        .then(r => r.json())
        .then(cfg => {
          if (cfg) {
            setS3Bucket(cfg.s3Bucket || '');
            setS3Region(cfg.s3Region || 'us-east-1');
            setS3Prefix(cfg.s3Prefix || 'journal-proofs/');
            setS3AccessKeyId(cfg.s3AccessKeyId || '');
            setS3SecretAccessKey(cfg.s3SecretAccessKey ? '••••••••••••••••' : '');
            setS3CustomEndpoint(cfg.s3CustomEndpoint || '');
            
            // Auto open settings if bucket is not configured yet
            if (!cfg.s3Bucket || !cfg.s3AccessKeyId) {
              setShowConfigSettings(true);
            } else {
              setShowConfigSettings(false);
            }
          }
        })
        .catch(e => console.error('Failed to load S3 config:', e));
    }
  }, [isOpen, isbn]);

  if (!isOpen) return null;

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setTestResult(null);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/s3/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          s3Bucket,
          s3Region,
          s3AccessKeyId,
          s3SecretAccessKey,
          s3CustomEndpoint
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setTestResult({ success: true, message: data.message });
      } else {
        setTestResult({ success: false, error: data.error || 'Connection failed' });
      }
    } catch (err: any) {
      setTestResult({ success: false, error: err.message || 'Network error' });
    } finally {
      setTestingConnection(false);
    }
  };

  const handleSaveAndUpload = async () => {
    if (!s3Bucket.trim()) {
      setErrorMessage('S3 Bucket name is required.');
      setShowConfigSettings(true);
      return;
    }

    setUploading(true);
    setErrorMessage(null);

    try {
      // 1. Save config first if modified
      await fetch('/api/system/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          s3Enabled: true,
          s3Bucket,
          s3Region,
          s3Prefix,
          s3AccessKeyId,
          s3SecretAccessKey,
          s3CustomEndpoint
        })
      });

      // 2. Perform upload
      const res = await fetch('/api/s3/upload-isbn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isbn,
          s3Bucket,
          s3Region,
          s3Prefix,
          s3AccessKeyId,
          s3SecretAccessKey,
          s3CustomEndpoint
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to upload verification proofs to S3');
      }

      setUploadResult(data);
      if (onUploadSuccess) onUploadSuccess(data);
    } catch (err: any) {
      console.error('S3 Upload Error:', err);
      setErrorMessage(err.message || 'Error occurred during S3 upload');
    } finally {
      setUploading(false);
    }
  };

  const handleCopyShareLink = () => {
    if (!uploadResult?.shareableLink) return;
    navigator.clipboard.writeText(uploadResult.shareableLink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const handleCopyS3Uri = () => {
    if (!uploadResult?.s3FolderUri) return;
    navigator.clipboard.writeText(uploadResult.s3FolderUri);
    setCopiedUri(true);
    setTimeout(() => setCopiedUri(false), 2500);
  };

  const title = item?.metadata?.bookDetails?.title || '';
  const authors = item?.metadata?.bookDetails?.authors || '';
  const lot = item?.lotNumber || item?.metadata?.lotNumber || 'Unassigned Lot';
  const box = item?.boxNumber || item?.metadata?.boxNumber || '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-xl rounded-2xl modal-card overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        
        {/* Modal Header */}
        <div className="p-5 border-b border-blue-100 flex items-center justify-between bg-gradient-to-r from-blue-50/70 to-indigo-50/50">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl btn-primary-gradient text-white shadow-md shadow-brand-500/20">
              <CloudUpload className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900 tracking-tight">
                Upload Proofs to AWS S3
              </h3>
              <p className="text-xs text-slate-500">
                Send verification photos to client cloud storage & generate share link
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

        {/* Modal Body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          
          {/* Target ISBN Record Summary Banner */}
          <div className="p-3.5 rounded-xl border border-blue-100 bg-blue-50/40 space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <span className="text-xs font-mono font-bold text-brand-800 bg-white px-2 py-0.5 rounded-md border border-blue-200">
                  {isbn}
                </span>
                <span className="text-[11px] font-bold text-slate-600 bg-white/80 px-2 py-0.5 rounded-md border border-slate-200">
                  {lot} {box ? `• Box ${box}` : ''}
                </span>
              </div>
              <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                {item?.shotsCount ?? 7}/7 Photos Ready
              </span>
            </div>
            {title && (
              <p className="text-xs font-semibold text-slate-800 truncate">
                {title} {authors ? `— ${authors}` : ''}
              </p>
            )}
          </div>

          {/* Error Banner if any */}
          {errorMessage && (
            <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start space-x-2.5 animate-fade-in">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <div className="flex-1 font-medium">{errorMessage}</div>
            </div>
          )}

          {/* Success Result View */}
          {uploadResult ? (
            <div className="space-y-4 animate-fade-in">
              <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/60 space-y-3">
                <div className="flex items-center space-x-2.5 text-emerald-800 font-extrabold text-sm">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  <span>Successfully Uploaded to Client S3 Bucket!</span>
                </div>
                <p className="text-xs text-slate-600">
                  All {uploadResult.files.length} verification images and metadata have been synchronized to AWS S3.
                </p>

                {/* S3 URI */}
                <div className="bg-white p-2.5 rounded-xl border border-emerald-100 flex items-center justify-between gap-2">
                  <div className="text-[11px] font-mono text-slate-700 truncate">
                    <span className="font-bold text-emerald-700">S3 URI: </span>
                    {uploadResult.s3FolderUri}
                  </div>
                  <button
                    onClick={handleCopyS3Uri}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 transition-colors shrink-0"
                    title="Copy S3 URI"
                  >
                    {copiedUri ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>

                {/* Shareable Client Link */}
                {uploadResult.shareableLink && (
                  <div className="space-y-1.5 pt-1">
                    <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block">
                      Client Shareable Download Link (Valid for 7 Days):
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={uploadResult.shareableLink}
                        className="flex-1 px-3 py-2 text-xs font-mono bg-white border border-emerald-200 rounded-xl outline-none select-all text-slate-800"
                      />
                      <button
                        onClick={handleCopyShareLink}
                        className="px-3.5 py-2 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 shadow-sm flex items-center space-x-1.5 shrink-0 transition-colors"
                      >
                        {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedLink ? 'Copied!' : 'Copy Link'}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Uploaded Files Manifest */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  Uploaded Files ({uploadResult.files.length})
                </span>
                <div className="max-h-36 overflow-y-auto space-y-1 bg-slate-50 p-2 rounded-xl border border-slate-200 text-xs font-mono">
                  {uploadResult.files.map((file, idx) => (
                    <div key={idx} className="flex items-center justify-between p-1.5 bg-white rounded-lg border border-slate-100">
                      <span className="truncate text-slate-700">{file.filename}</span>
                      {file.presignedUrl && (
                        <a
                          href={file.presignedUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-brand-600 hover:underline flex items-center space-x-1 text-[11px] shrink-0 ml-2"
                        >
                          <span>Open</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              
              {/* Destination Preview */}
              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                    <Folder className="w-4 h-4 text-brand-600" />
                    Target S3 Destination
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowConfigSettings(!showConfigSettings)}
                    className="text-xs font-bold text-brand-700 hover:text-brand-800 flex items-center space-x-1 cursor-pointer"
                  >
                    <Settings className="w-3.5 h-3.5" />
                    <span>{showConfigSettings ? 'Hide S3 Settings' : 'Configure S3'}</span>
                    {showConfigSettings ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                </div>

                <div className="text-xs font-mono bg-white p-2.5 rounded-lg border border-slate-200 text-slate-800 truncate">
                  {s3Bucket ? (
                    <span>s3://{s3Bucket}/{s3Prefix}{isbn}/</span>
                  ) : (
                    <span className="text-amber-600 italic">No S3 Bucket configured yet. Click 'Configure S3' below.</span>
                  )}
                </div>
              </div>

              {/* S3 Settings Form (Collapsible) */}
              {showConfigSettings && (
                <div className="p-4 rounded-xl border border-blue-200 bg-blue-50/30 space-y-3 animate-fade-in text-xs">
                  <div className="flex items-center justify-between pb-1 border-b border-blue-100">
                    <span className="font-bold text-slate-800">AWS S3 Credentials & Bucket Details</span>
                    <button
                      type="button"
                      onClick={handleTestConnection}
                      disabled={testingConnection || !s3Bucket || !s3AccessKeyId}
                      className="px-2.5 py-1 text-[11px] font-bold text-brand-700 bg-white border border-brand-200 rounded-lg hover:bg-blue-50 disabled:opacity-50 flex items-center space-x-1 transition-colors cursor-pointer"
                    >
                      {testingConnection ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
                      <span>Test Connection</span>
                    </button>
                  </div>

                  {testResult && (
                    <div className={`p-2.5 rounded-lg text-[11px] font-semibold flex items-center space-x-2 ${
                      testResult.success ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'
                    }`}>
                      {testResult.success ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />}
                      <span>{testResult.message || testResult.error}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">S3 Bucket Name *</label>
                      <input
                        type="text"
                        value={s3Bucket}
                        onChange={(e) => setS3Bucket(e.target.value)}
                        placeholder="e.g. client-journal-proofs"
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-mono text-xs outline-none focus:ring-1 focus:ring-brand-500"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">AWS Region</label>
                      <input
                        type="text"
                        value={s3Region}
                        onChange={(e) => setS3Region(e.target.value)}
                        placeholder="e.g. us-east-1"
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-mono text-xs outline-none focus:ring-1 focus:ring-brand-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">AWS Access Key ID *</label>
                      <input
                        type="text"
                        value={s3AccessKeyId}
                        onChange={(e) => setS3AccessKeyId(e.target.value)}
                        placeholder="AKIA..."
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-mono text-xs outline-none focus:ring-1 focus:ring-brand-500"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">AWS Secret Access Key *</label>
                      <input
                        type="password"
                        value={s3SecretAccessKey}
                        onChange={(e) => setS3SecretAccessKey(e.target.value)}
                        placeholder="••••••••"
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-mono text-xs outline-none focus:ring-1 focus:ring-brand-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Folder Prefix (Path)</label>
                      <input
                        type="text"
                        value={s3Prefix}
                        onChange={(e) => setS3Prefix(e.target.value)}
                        placeholder="journal-proofs/"
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-mono text-xs outline-none focus:ring-1 focus:ring-brand-500"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Custom S3 Endpoint (Optional)</label>
                      <input
                        type="text"
                        value={s3CustomEndpoint}
                        onChange={(e) => setS3CustomEndpoint(e.target.value)}
                        placeholder="e.g. MinIO / R2 URL"
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-mono text-xs outline-none focus:ring-1 focus:ring-brand-500"
                      />
                    </div>
                  </div>
                </div>
              )}

            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-200/60 rounded-xl transition-colors cursor-pointer"
          >
            {uploadResult ? 'Close' : 'Cancel'}
          </button>

          {!uploadResult && (
            <button
              type="button"
              onClick={handleSaveAndUpload}
              disabled={uploading || !s3Bucket}
              className="px-5 py-2.5 rounded-xl font-bold text-xs text-white btn-primary-gradient shadow-md shadow-brand-500/20 disabled:opacity-50 flex items-center space-x-2 transition-all cursor-pointer"
            >
              {uploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Uploading to AWS S3...</span>
                </>
              ) : (
                <>
                  <CloudUpload className="w-4 h-4" />
                  <span>Upload Proof to S3</span>
                </>
              )}
            </button>
          )}

          {uploadResult && (
            <button
              type="button"
              onClick={handleCopyShareLink}
              className="px-5 py-2.5 rounded-xl font-bold text-xs text-white bg-emerald-600 hover:bg-emerald-500 shadow-md shadow-emerald-600/20 flex items-center space-x-1.5 transition-all cursor-pointer"
            >
              {copiedLink ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              <span>{copiedLink ? 'Link Copied!' : 'Copy Client Share Link'}</span>
            </button>
          )}
        </div>

      </div>
    </div>
  );
};

