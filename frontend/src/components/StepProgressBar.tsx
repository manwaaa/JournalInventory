import React from 'react';
import { 
  Package, 
  Layers, 
  BookOpen, 
  FileText, 
  CheckCircle2, 
  Bookmark,
  Scroll,
  BookCheck
} from 'lucide-react';
import { CaptureStep, StationRole } from '../types';

interface StepProgressBarProps {
  currentStep: CaptureStep;
  isbn?: string;
  shotsCount: number;
  stationRole?: StationRole;
  boxShotsInherited?: boolean;
}

export const StepProgressBar: React.FC<StepProgressBarProps> = ({ 
  currentStep, 
  shotsCount,
  stationRole = 'book_level',
  boxShotsInherited = false
}) => {
  const steps = [
    {
      id: 'CAPTURE_SHOT_1',
      shotNumber: 1,
      label: '1. Box',
      sublabel: '📦 PC 1 Box',
      icon: Package
    },
    {
      id: 'CAPTURE_SHOT_2',
      shotNumber: 2,
      label: '2. Unbox',
      sublabel: '📦 PC 1 Box',
      icon: Layers
    },
    {
      id: 'CAPTURE_SHOT_3',
      shotNumber: 3,
      label: '3. Front Cover',
      sublabel: '📖 PC 2 Book',
      icon: BookOpen
    },
    {
      id: 'CAPTURE_SHOT_4',
      shotNumber: 4,
      label: '4. Spine',
      sublabel: '📖 PC 2 Book',
      icon: Bookmark
    },
    {
      id: 'CAPTURE_SHOT_5',
      shotNumber: 5,
      label: '5. Title Page',
      sublabel: '📖 PC 2 Book',
      icon: FileText
    },
    {
      id: 'CAPTURE_SHOT_6',
      shotNumber: 6,
      label: '6. Edition Notice',
      sublabel: '📖 PC 2 Book',
      icon: Scroll
    },
    {
      id: 'CAPTURE_SHOT_7',
      shotNumber: 7,
      label: '7. Back Cover',
      sublabel: '📖 PC 2 Book',
      icon: BookCheck
    }
  ];

  const getStepStatus = (shotNumber: number, stepId: string) => {
    if (currentStep === 'COMPLETE') return 'completed';
    if (currentStep === stepId) return 'current';
    
    // Check if shot has already been passed
    const currentStepNum = currentStep.startsWith('CAPTURE_SHOT_') 
      ? parseInt(currentStep.replace('CAPTURE_SHOT_', ''), 10) 
      : 0;

    if (currentStepNum > shotNumber) return 'completed';
    return 'pending';
  };

  return (
    <div className="w-full white-card rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center space-x-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-brand-700 badge-soft-blue px-2.5 py-0.5 rounded-lg shadow-sm">
            Verification Sequence
          </span>
          <span className="text-xs font-semibold text-slate-600">
            7 Required Shots (2 Box Level &bull; 5 Book Level)
          </span>
        </div>
        
        <div className="text-xs font-bold font-mono">
          <span className={shotsCount >= 7 ? 'text-emerald-600 font-bold' : 'text-brand-700 font-bold'}>
            {shotsCount} of 7 Completed
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {steps.map((step) => {
          const status = getStepStatus(step.shotNumber, step.id);
          const Icon = step.icon;

          let badgeClasses = 'bg-slate-100 text-slate-400 border border-slate-200';
          let cardClasses = 'bg-gradient-to-b from-white to-slate-50/70 border-slate-200/80 text-slate-500';

          if (status === 'completed') {
            badgeClasses = 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm shadow-emerald-500/20';
            cardClasses = 'bg-gradient-to-b from-emerald-50/70 to-teal-50/30 border-emerald-200 text-emerald-900 shadow-sm';
          } else if (status === 'current') {
            badgeClasses = 'btn-primary-gradient text-white shadow-md shadow-brand-500/30';
            cardClasses = 'bg-gradient-to-b from-blue-50 to-indigo-50/60 border-brand-500 ring-2 ring-brand-500/20 text-brand-900 shadow-sm';
          }

          return (
            <div
              key={step.id}
              className={`flex items-center p-2.5 rounded-xl border transition-all duration-200 ${cardClasses}`}
            >
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mr-2.5 transition-all ${badgeClasses}`}>
                {status === 'completed' ? (
                  <CheckCircle2 className="w-4 h-4 text-white" />
                ) : (
                  <Icon className="w-3.5 h-3.5" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h5 className="text-[11px] font-bold truncate leading-tight">
                  {step.label}
                </h5>
                <p className="text-[9px] text-slate-400 truncate mt-0.5">
                  {step.shotNumber <= 2 && boxShotsInherited && status === 'completed'
                    ? '✓ Inherited (PC 1)'
                    : step.sublabel}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
