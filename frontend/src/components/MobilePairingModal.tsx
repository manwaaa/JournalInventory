import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { 
  X, 
  Smartphone, 
  Copy, 
  Check, 
  ShieldCheck, 
  Wifi
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

  useEffect(() => {
    if (systemStatus?.networkIps && systemStatus.networkIps.length > 0) {
      setSelectedIp(systemStatus.networkIps[0].address);
    }
  }, [systemStatus]);

  // Check if app is running on a public cloud domain (Vercel, HTTPS, etc.)
  const isCloudHost = typeof window !== 'undefined' && 
    window.location.protocol === 'https:' && 
    !window.location.hostname.includes('localhost') && 
    !window.location.hostname.startsWith('127.') && 
    !window.location.hostname.startsWith('192.168.') && 
    !window.location.hostname.startsWith('10.');

  const httpsPort = systemStatus?.httpsPort || 3443;
  const currentMobileUrl = isCloudHost
    ? window.location.origin
    : (selectedIp 
        ? `https://${selectedIp}:${httpsPort}` 
        : (systemStatus?.mobileHttpsUrl || `https://localhost:${httpsPort}`));

  useEffect(() => {
    if (isOpen && currentMobileUrl) {
      QRCode.toDataURL(currentMobileUrl, {
        width: 320,
        margin: 2,
        color: {
          dark: '#1d4ed8',
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

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-lg rounded-2xl modal-card overflow-hidden flex flex-col">
        
        {/* Header */}
        <div className="p-5 border-b border-blue-100 flex items-center justify-between bg-gradient-to-r from-blue-50/70 to-indigo-50/50">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl btn-primary-gradient text-white shadow-md shadow-brand-500/20">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900 tracking-tight">
                Use Smartphone as Camera
              </h3>
              <p className="text-xs text-slate-500">
                Wireless 6-shot verification with direct PC storage
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

        {/* Content Body */}
        <div className="p-6 space-y-5 overflow-y-auto max-h-[75vh]">
          
          {/* Privacy Banner */}
          <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 flex items-start space-x-3 text-emerald-900">
            <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div className="text-xs">
              <span className="font-bold block text-emerald-800 mb-0.5">
                Zero Phone Storage & Direct PC Saving
              </span>
              <span>
                Verification photos stream straight into your Windows PC folder (<code className="font-mono text-[11px] font-bold">C:\Journal_Proofs</code>). No photos are saved to your phone's memory.
              </span>
            </div>
          </div>

          {/* QR Code Card */}
          <div className="flex flex-col items-center justify-center p-5 rounded-2xl bg-blue-50/50 border border-blue-100">
            {qrDataUrl ? (
              <div className="p-3 bg-white rounded-2xl shadow-md border border-blue-100">
                <img src={qrDataUrl} alt="Mobile Connect QR Code" className="w-48 h-48 sm:w-56 sm:h-56 object-contain" />
              </div>
            ) : (
              <div className="w-48 h-48 sm:w-56 sm:h-56 flex items-center justify-center text-xs text-slate-400">
                Generating QR code...
              </div>
            )}

            <p className="text-xs text-slate-600 mt-3 font-semibold text-center">
              Scan with your phone camera to open the wireless mobile capture lens
            </p>
          </div>

          {/* URL & Network IP Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-700 uppercase tracking-wider text-[10px]">
                {isCloudHost ? 'Public Cloud HTTPS URL' : 'Mobile HTTPS Address'}
              </span>
              {!isCloudHost && systemStatus?.networkIps && systemStatus.networkIps.length > 1 && (
                <select
                  value={selectedIp}
                  onChange={(e) => setSelectedIp(e.target.value)}
                  className="text-[11px] bg-slate-50 rounded-lg px-2 py-0.5 border border-slate-200 outline-none text-slate-700 font-mono"
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
              <div className="flex-1 px-3 py-2 bg-slate-50 rounded-xl border border-slate-200 font-mono text-xs text-slate-800 truncate select-all">
                {currentMobileUrl}
              </div>

              <button
                onClick={handleCopyLink}
                className="px-3.5 py-2 rounded-xl text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 transition-colors shrink-0 flex items-center space-x-1.5 shadow-sm"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          {/* Setup Instructions */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-xs text-slate-600">
            <h4 className="font-bold text-slate-800 flex items-center space-x-1.5">
              <Wifi className="w-3.5 h-3.5 text-brand-700" />
              <span>How to Connect:</span>
            </h4>
            {isCloudHost ? (
              <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-500 pl-1 font-medium">
                <li>Scan the QR code above using your smartphone camera or QR reader.</li>
                <li>Tap the link to open the wireless verification viewfinder instantly.</li>
                <li>Point and capture shots directly without installing any apps!</li>
              </ol>
            ) : (
              <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-500 pl-1 font-medium">
                <li>Connect your phone to the <b>same Wi-Fi</b> or warehouse network as this PC.</li>
                <li>Scan the QR code above to open the camera viewfinder.</li>
                <li>Tap <b>Advanced &rarr; Proceed / Continue</b> if prompted with local certificate warning.</li>
              </ol>
            )}
          </div>

        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 flex justify-end bg-slate-50/50">
          <button
            onClick={onClose}
            className="px-5 py-2 text-xs font-bold text-white bg-brand-700 hover:bg-brand-600 rounded-xl shadow-md transition-colors"
          >
            Done
          </button>
        </div>

      </div>
    </div>,
    document.body
  );
};
