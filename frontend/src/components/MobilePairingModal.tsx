import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { 
  X, 
  Smartphone, 
  Copy, 
  Check, 
  ShieldCheck, 
  Wifi, 
  Camera, 
  ExternalLink,
  Lock
} from 'lucide-react';
import { SystemStatus } from '../types';

interface MobilePairingModalProps {
  isOpen: boolean;
  onClose: () => void;
  systemStatus: SystemStatus | null;
}

export const MobilePairingModal: React.FC<MobilePairingModalProps> = ({
  isOpen,
  onClose,
  systemStatus
}) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [selectedIp, setSelectedIp] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);

  // Set default IP from status
  useEffect(() => {
    if (systemStatus?.networkIps && systemStatus.networkIps.length > 0) {
      setSelectedIp(systemStatus.networkIps[0].address);
    }
  }, [systemStatus]);

  // Construct Mobile HTTPS URL
  const httpsPort = systemStatus?.httpsPort || 3443;
  const currentMobileUrl = selectedIp 
    ? `https://${selectedIp}:${httpsPort}` 
    : (systemStatus?.mobileHttpsUrl || `https://localhost:${httpsPort}`);

  // Generate QR Code
  useEffect(() => {
    if (isOpen && currentMobileUrl) {
      QRCode.toDataURL(currentMobileUrl, {
        width: 320,
        margin: 2,
        color: {
          dark: '#0f172a',
          light: '#ffffff'
        }
      })
        .then((url) => setQrDataUrl(url))
        .catch((err) => console.error('QR generation error:', err));
    }
  }, [isOpen, currentMobileUrl]);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(currentMobileUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-overlay-in">
      <div className="w-full max-w-lg rounded-2xl glass-panel shadow-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden flex flex-col">
        
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-400">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                Use Smartphone as Camera
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Wireless capture with direct PC file storage
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

        {/* Content Body */}
        <div className="p-5 sm:p-6 space-y-5 overflow-y-auto max-h-[75vh]">
          
          {/* Privacy Guarantee Banner */}
          <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex items-start space-x-3 text-emerald-900 dark:text-emerald-200">
            <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div className="text-xs">
              <span className="font-bold block text-emerald-800 dark:text-emerald-300 mb-0.5">
                100% Privacy & Zero Phone Storage
              </span>
              <span>
                Photos are streamed directly into your PC storage (<code className="font-mono text-[11px] font-bold">C:\Journal_Proofs</code>). <b>No photos are saved to your phone's gallery or camera roll.</b>
              </span>
            </div>
          </div>

          {/* QR Code Card */}
          <div className="flex flex-col items-center justify-center p-5 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
            {qrDataUrl ? (
              <div className="p-3 bg-white rounded-2xl shadow-md border border-slate-200">
                <img src={qrDataUrl} alt="Mobile Connect QR Code" className="w-48 h-48 sm:w-56 sm:h-56 object-contain" />
              </div>
            ) : (
              <div className="w-48 h-48 sm:w-56 sm:h-56 flex items-center justify-center text-xs text-slate-400">
                Generating QR code...
              </div>
            )}

            <p className="text-xs text-slate-500 dark:text-slate-400 mt-3 font-medium text-center">
              Scan with your phone's native Camera or QR reader
            </p>
          </div>

          {/* URL & Network IP Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider text-[11px]">
                Mobile HTTPS Address
              </span>
              {systemStatus?.networkIps && systemStatus.networkIps.length > 1 && (
                <select
                  value={selectedIp}
                  onChange={(e) => setSelectedIp(e.target.value)}
                  className="text-[11px] bg-slate-100 dark:bg-slate-800 rounded px-2 py-0.5 border border-slate-300 dark:border-slate-700 outline-none text-slate-700 dark:text-slate-300 font-mono"
                >
                  {systemStatus.networkIps.map((ip) => (
                    <option key={ip.address} value={ip.address}>
                      {ip.address} ({ip.interface})
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="flex items-center space-x-2">
              <div className="flex-1 px-3 py-2 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 font-mono text-xs text-slate-800 dark:text-slate-200 truncate select-all">
                {currentMobileUrl}
              </div>

              <button
                onClick={handleCopyLink}
                title="Copy Mobile URL"
                className="px-3 py-2 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-colors shrink-0 flex items-center space-x-1.5"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          {/* 3-Step Setup Instructions */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 space-y-2 text-xs text-slate-600 dark:text-slate-300">
            <h4 className="font-bold text-slate-800 dark:text-slate-100 flex items-center space-x-1.5">
              <Wifi className="w-3.5 h-3.5 text-brand-500" />
              <span>How to Connect:</span>
            </h4>
            <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-500 dark:text-slate-400 pl-1">
              <li>Connect your phone to the <b>same Wi-Fi</b> or office network as this PC.</li>
              <li>Scan the QR code above to open the secure camera app.</li>
              <li>If your browser shows a security notice, tap <b>Advanced &rarr; Proceed / Continue</b> to grant camera permissions.</li>
            </ol>
          </div>

        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 text-xs font-bold text-white bg-brand-600 hover:bg-brand-500 rounded-xl shadow-md transition-colors"
          >
            Got It
          </button>
        </div>

      </div>
    </div>
  );
};

