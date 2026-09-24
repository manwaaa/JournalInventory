import React from 'react';
import { 
  Package, 
  Layers, 
  BookOpen, 
  Bookmark, 
  FileText, 
  Scroll,
  BookCheck
} from 'lucide-react';
import { CaptureStep } from '../types';

interface AngleGuideOverlayProps {
  currentStep: CaptureStep;
  visible: boolean;
}

export const AngleGuideOverlay: React.FC<AngleGuideOverlayProps> = ({ currentStep, visible }) => {
  if (!visible) return null;
  if (!currentStep.startsWith('CAPTURE_SHOT_')) return null;

  const shotNum = parseInt(currentStep.replace('CAPTURE_SHOT_', ''), 10);

  const guideConfigs: Record<number, {
    title: string;
    scope: string;
    description: string;
    color: string;
    icon: any;
  }> = {
    1: {
      title: 'Shot 1: Box A',
      scope: 'Box Level',
      description: 'Align camera directly above or angled into Box A showing packed items',
      color: 'text-blue-400',
      icon: Package
    },
    2: {
      title: 'Shot 2: Box B',
      scope: 'Box Level',
      description: 'Show Box B view with books arranged neatly on table/counter before processing',
      color: 'text-indigo-400',
      icon: Layers
    },
    3: {
      title: 'Shot 3: Front Cover',
      scope: 'Book Level',
      description: 'Position book flat in frame — ensure full journal title & artwork is clear',
      color: 'text-emerald-400',
      icon: BookOpen
    },
    4: {
      title: 'Shot 4: Spine',
      scope: 'Book Level',
      description: 'Angle journal to capture spine volume, publication title, and thickness',
      color: 'text-amber-400',
      icon: Bookmark
    },
    5: {
      title: 'Shot 5: Title Page',
      scope: 'Book Level',
      description: 'Open journal to main title page showing author names and journal details',
      color: 'text-cyan-400',
      icon: FileText
    },
    6: {
      title: 'Shot 6: Edition Notice',
      scope: 'Book Level',
      description: 'Capture edition notice, copyright, publisher imprint, and ISSN barcode',
      color: 'text-purple-400',
      icon: Scroll
    },
    7: {
      title: 'Shot 7: Back Cover',
      scope: 'Book Level',
      description: 'Position back cover flat — ensure back barcode, ISBN, and summary are in focus',
      color: 'text-rose-400',
      icon: BookCheck
    }
  };

  const currentGuide = guideConfigs[shotNum] || guideConfigs[1];
  const Icon = currentGuide.icon;

  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-between p-4 sm:p-6 z-10 select-none">
      
      {/* Top Banner Guide */}
      <div className="bg-black/80 backdrop-blur-md text-white px-4 py-2 rounded-full border border-white/20 shadow-lg flex items-center space-x-2 animate-fade-in max-w-lg text-center">
        <Icon className={`w-4 h-4 ${currentGuide.color} shrink-0`} />
        <div className="text-xs">
          <span className="font-bold text-white mr-1.5">{currentGuide.title}</span>
          <span className="text-white/80 font-medium">{currentGuide.description}</span>
        </div>
      </div>

      {/* Center Framing Wireframe */}
      <div className="relative w-full max-w-md h-56 sm:h-64 flex items-center justify-center">
        {shotNum === 1 && (
          /* Shot 1: Box A wireframe */
          <svg className="w-full h-full text-blue-400/80" viewBox="0 0 400 300" fill="none">
            {/* Box Outer */}
            <polygon points="100,80 300,80 340,140 140,140" fill="rgba(59, 130, 246, 0.12)" stroke="currentColor" strokeWidth="2.5" />
            <polygon points="60,140 140,140 140,260 60,260" fill="rgba(59, 130, 246, 0.15)" stroke="currentColor" strokeWidth="2.5" />
            <polygon points="140,140 340,140 340,260 140,260" fill="rgba(59, 130, 246, 0.08)" stroke="currentColor" strokeWidth="2.5" />
            {/* Books inside */}
            <line x1="170" y1="140" x2="170" y2="260" stroke="#93c5fd" strokeWidth="2" strokeDasharray="4 2" />
            <line x1="210" y1="140" x2="210" y2="260" stroke="#93c5fd" strokeWidth="2" strokeDasharray="4 2" />
            <line x1="250" y1="140" x2="250" y2="260" stroke="#93c5fd" strokeWidth="2" strokeDasharray="4 2" />
            <line x1="290" y1="140" x2="290" y2="260" stroke="#93c5fd" strokeWidth="2" strokeDasharray="4 2" />
            <text x="180" y="115" fill="#ffffff" fontSize="12" fontWeight="bold">BOX A VIEW</text>
          </svg>
        )}

        {shotNum === 2 && (
          /* Shot 2: Box B stacks */
          <svg className="w-full h-full text-indigo-400/80" viewBox="0 0 400 300" fill="none">
            <rect x="70" y="100" width="110" height="150" rx="4" fill="rgba(99, 102, 241, 0.15)" stroke="currentColor" strokeWidth="2.5" />
            <rect x="150" y="90" width="110" height="150" rx="4" fill="rgba(99, 102, 241, 0.2)" stroke="currentColor" strokeWidth="2.5" />
            <rect x="230" y="80" width="110" height="150" rx="4" fill="rgba(99, 102, 241, 0.25)" stroke="currentColor" strokeWidth="2.5" />
            <text x="130" y="60" fill="#ffffff" fontSize="12" fontWeight="bold">BOX B VIEW</text>
          </svg>
        )}

        {shotNum === 3 && (
          /* Shot 3: Front Cover */
          <svg className="w-full h-full text-emerald-400/80" viewBox="0 0 400 300" fill="none">
            <rect x="110" y="40" width="180" height="220" rx="8" fill="rgba(16, 185, 129, 0.12)" stroke="currentColor" strokeWidth="2.5" />
            <line x1="130" y1="90" x2="270" y2="90" stroke="#6ee7b7" strokeWidth="3" />
            <line x1="130" y1="120" x2="240" y2="120" stroke="#6ee7b7" strokeWidth="2" />
            <rect x="130" y="150" width="140" height="80" rx="4" fill="rgba(16, 185, 129, 0.2)" stroke="#10b981" strokeWidth="1.5" />
            <text x="140" y="195" fill="#ffffff" fontSize="12" fontWeight="bold">FRONT COVER</text>
          </svg>
        )}

        {shotNum === 4 && (
          /* Shot 4: Spine angle */
          <svg className="w-full h-full text-amber-400/80" viewBox="0 0 400 300" fill="none">
            {/* Spine facet */}
            <polygon points="90,60 140,30 140,240 90,270" fill="rgba(245, 158, 11, 0.2)" stroke="currentColor" strokeWidth="2.5" />
            {/* Front cover slanted */}
            <polygon points="140,30 320,70 320,280 140,240" fill="rgba(245, 158, 11, 0.08)" stroke="currentColor" strokeWidth="2.5" strokeDasharray="6 4" />
            <text x="105" y="160" fill="#fbbf24" fontSize="11" fontWeight="bold" transform="rotate(-75 105 160)">
              SPINE & VOLUME
            </text>
            <text x="190" y="150" fill="#ffffff" fontSize="12" fontWeight="bold">SIDE ANGLE</text>
          </svg>
        )}

        {shotNum === 5 && (
          /* Shot 5: Title Page (Open book) */
          <svg className="w-full h-full text-cyan-400/80" viewBox="0 0 400 300" fill="none">
            <polygon points="80,50 190,60 190,250 80,240" fill="rgba(6, 182, 212, 0.08)" stroke="currentColor" strokeWidth="2.5" />
            <polygon points="200,60 310,50 310,240 200,250" fill="rgba(6, 182, 212, 0.18)" stroke="currentColor" strokeWidth="2.5" />
            <line x1="195" y1="55" x2="195" y2="255" stroke="#22d3ee" strokeWidth="3" strokeDasharray="4 2" />
            <rect x="215" y="110" width="80" height="35" rx="4" fill="rgba(6, 182, 212, 0.3)" stroke="#06b6d4" strokeWidth="2" strokeDasharray="4 2" />
            <text x="220" y="132" fill="#ffffff" fontSize="10" fontWeight="bold">TITLE & AUTHOR</text>
          </svg>
        )}

        {shotNum === 6 && (
          /* Shot 6: Front matter / Copyright */
          <svg className="w-full h-full text-purple-400/80" viewBox="0 0 400 300" fill="none">
            <rect x="100" y="45" width="200" height="210" rx="6" fill="rgba(168, 85, 247, 0.12)" stroke="currentColor" strokeWidth="2.5" />
            <rect x="120" y="70" width="160" height="60" rx="4" fill="rgba(168, 85, 247, 0.25)" stroke="#c084fc" strokeWidth="1.5" />
            <text x="135" y="95" fill="#ffffff" fontSize="10" fontWeight="bold">COPYRIGHT & EDITION</text>
            <text x="145" y="115" fill="#e9d5ff" fontSize="9">ISSN / ISBN NOTICE</text>
            <line x1="120" y1="160" x2="280" y2="160" stroke="#c084fc" strokeWidth="1.5" />
            <line x1="120" y1="180" x2="260" y2="180" stroke="#c084fc" strokeWidth="1.5" />
            <line x1="120" y1="200" x2="230" y2="200" stroke="#c084fc" strokeWidth="1.5" />
          </svg>
        )}

        {shotNum === 7 && (
          /* Shot 7: Back of Journal / Back Cover */
          <svg className="w-full h-full text-rose-400/80" viewBox="0 0 400 300" fill="none">
            {/* Flat back cover outline */}
            <rect x="110" y="40" width="180" height="220" rx="8" fill="rgba(244, 63, 94, 0.12)" stroke="currentColor" strokeWidth="2.5" />
            {/* Blurb / Summary lines */}
            <line x1="130" y1="75" x2="270" y2="75" stroke="#fda4af" strokeWidth="2" />
            <line x1="130" y1="95" x2="270" y2="95" stroke="#fda4af" strokeWidth="1.5" strokeDasharray="4 2" />
            <line x1="130" y1="115" x2="250" y2="115" stroke="#fda4af" strokeWidth="1.5" strokeDasharray="4 2" />
            <line x1="130" y1="135" x2="260" y2="135" stroke="#fda4af" strokeWidth="1.5" strokeDasharray="4 2" />
            {/* Back Barcode / ISBN block */}
            <rect x="130" y="165" width="140" height="65" rx="4" fill="rgba(244, 63, 94, 0.22)" stroke="#f43f5e" strokeWidth="1.5" />
            <line x1="145" y1="175" x2="145" y2="205" stroke="#ffffff" strokeWidth="2" />
            <line x1="152" y1="175" x2="152" y2="205" stroke="#ffffff" strokeWidth="1.5" />
            <line x1="160" y1="175" x2="160" y2="205" stroke="#ffffff" strokeWidth="3" />
            <line x1="170" y1="175" x2="170" y2="205" stroke="#ffffff" strokeWidth="1" />
            <line x1="177" y1="175" x2="177" y2="205" stroke="#ffffff" strokeWidth="2.5" />
            <line x1="187" y1="175" x2="187" y2="205" stroke="#ffffff" strokeWidth="1.5" />
            <line x1="195" y1="175" x2="195" y2="205" stroke="#ffffff" strokeWidth="2" />
            <line x1="205" y1="175" x2="205" y2="205" stroke="#ffffff" strokeWidth="3" />
            <text x="145" y="222" fill="#ffffff" fontSize="9" fontWeight="bold" letterSpacing="1">BARCODE / ISBN</text>
            <text x="148" y="55" fill="#fecdd3" fontSize="10" fontWeight="bold">BACK COVER</text>
          </svg>
        )}

        {/* Viewfinder Target Reticles */}
        <div className="absolute top-2 left-2 w-6 h-6 border-t-2 border-l-2 border-white/70 rounded-tl"></div>
        <div className="absolute top-2 right-2 w-6 h-6 border-t-2 border-r-2 border-white/70 rounded-tr"></div>
        <div className="absolute bottom-2 left-2 w-6 h-6 border-b-2 border-l-2 border-white/70 rounded-bl"></div>
        <div className="absolute bottom-2 right-2 w-6 h-6 border-b-2 border-r-2 border-white/70 rounded-br"></div>
      </div>

      {/* Bottom Hint */}
      <div className="bg-black/70 backdrop-blur-sm text-white/90 text-[11px] px-3 py-1.5 rounded-lg border border-white/10">
        Press <kbd className="bg-white/20 px-1.5 py-0.5 rounded font-mono font-bold">Space</kbd> or tap <b>Capture Shot {shotNum}</b>
      </div>

    </div>
  );
};
