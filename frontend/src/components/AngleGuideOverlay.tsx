import React from 'react';
import { Layers, BookOpen } from 'lucide-react';
import { CaptureStep } from '../types';

interface AngleGuideOverlayProps {
  currentStep: CaptureStep;
  visible: boolean;
}

export const AngleGuideOverlay: React.FC<AngleGuideOverlayProps> = ({ currentStep, visible }) => {
  if (!visible) return null;
  if (currentStep !== 'CAPTURE_SHOT_1' && currentStep !== 'CAPTURE_SHOT_2') return null;

  const isShot1 = currentStep === 'CAPTURE_SHOT_1';

  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-between p-6 z-10 select-none">
      
      {/* Top Banner Guide */}
      <div className="bg-black/75 backdrop-blur-md text-white px-4 py-2 rounded-full border border-white/20 shadow-lg flex items-center space-x-2 animate-fade-in">
        {isShot1 ? (
          <>
            <Layers className="w-4 h-4 text-brand-400" />
            <span className="text-xs font-semibold">
              Align Front Cover <span className="text-brand-300 font-bold">tilted 30°</span> to expose Spine & Side
            </span>
          </>
        ) : (
          <>
            <BookOpen className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-semibold">
              Open to Title Page — Ensure <span className="text-emerald-300 font-bold">Author Name</span> is crystal clear
            </span>
          </>
        )}
      </div>

      {/* Center 3D Framing Wireframe */}
      <div className="relative w-full max-w-md h-64 sm:h-72 flex items-center justify-center">
        {isShot1 ? (
          /* Shot 1: 3D Slanted/Tilted Box showing spine + cover */
          <svg className="w-full h-full text-brand-400/70" viewBox="0 0 400 300" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* Spine left facet */}
            <path
              d="M90 60 L140 30 L140 240 L90 270 Z"
              fill="rgba(59, 130, 246, 0.12)"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeDasharray="6 4"
            />
            {/* Front Cover slanted face */}
            <path
              d="M140 30 L320 70 L320 280 L140 240 Z"
              fill="rgba(59, 130, 246, 0.08)"
              stroke="currentColor"
              strokeWidth="2.5"
            />
            {/* Angle Indicator Tag */}
            <text x="105" y="160" fill="#93c5fd" fontSize="11" fontWeight="bold" transform="rotate(-75 105 160)">
              SPINE / THICKNESS
            </text>
            <text x="210" y="150" fill="#ffffff" fontSize="13" fontWeight="bold">
              FRONT COVER
            </text>
            <path d="M70 40 L90 60" stroke="#60a5fa" strokeWidth="2" />
            <path d="M340 50 L320 70" stroke="#60a5fa" strokeWidth="2" />
          </svg>
        ) : (
          /* Shot 2: Open Book / Title Page Layout */
          <svg className="w-full h-full text-emerald-400/70" viewBox="0 0 400 300" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* Left Page (Flipped) */}
            <path
              d="M80 50 L190 60 L190 260 L80 250 Z"
              fill="rgba(16, 185, 129, 0.08)"
              stroke="currentColor"
              strokeWidth="2.5"
            />
            {/* Right Page (Title & Author) */}
            <path
              d="M200 60 L310 50 L310 250 L200 260 Z"
              fill="rgba(16, 185, 129, 0.15)"
              stroke="currentColor"
              strokeWidth="2.5"
            />
            {/* Center Spine Line */}
            <line x1="195" y1="55" x2="195" y2="265" stroke="#34d399" strokeWidth="3" strokeDasharray="4 2" />
            
            {/* Highlight for Author Area */}
            <rect x="215" y="120" width="80" height="35" rx="4" fill="rgba(16, 185, 129, 0.3)" stroke="#10b981" strokeWidth="2" strokeDasharray="4 2" />
            <text x="220" y="142" fill="#ffffff" fontSize="11" fontWeight="bold">
              AUTHOR NAME
            </text>
          </svg>
        )}

        {/* Viewfinder Target Reticles */}
        <div className="absolute top-2 left-2 w-6 h-6 border-t-2 border-l-2 border-white/60 rounded-tl"></div>
        <div className="absolute top-2 right-2 w-6 h-6 border-t-2 border-r-2 border-white/60 rounded-tr"></div>
        <div className="absolute bottom-2 left-2 w-6 h-6 border-b-2 border-l-2 border-white/60 rounded-bl"></div>
        <div className="absolute bottom-2 right-2 w-6 h-6 border-b-2 border-r-2 border-white/60 rounded-br"></div>
      </div>

      {/* Bottom Hint */}
      <div className="bg-black/60 backdrop-blur-sm text-white/90 text-[11px] px-3 py-1.5 rounded-lg border border-white/10">
        Press <kbd className="bg-white/20 px-1.5 py-0.5 rounded font-mono font-bold">Space</kbd> or click <b>Capture</b>
      </div>

    </div>
  );
};
