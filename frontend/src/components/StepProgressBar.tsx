import React from 'react';
import { Barcode, BookOpen, Layers, CheckCircle2 } from 'lucide-react';
import { CaptureStep } from '../types';

interface StepProgressBarProps {
  currentStep: CaptureStep;
  isbn: string;
}

export const StepProgressBar: React.FC<StepProgressBarProps> = ({ currentStep, isbn }) => {
  const steps = [
    {
      id: 'SCAN_ISBN',
      label: 'Scan ISBN',
      desc: isbn ? `ISBN: ${isbn}` : 'Ready for barcode scan',
      icon: Barcode,
      stepNumber: 1
    },
    {
      id: 'CAPTURE_SHOT_1',
      label: 'Shot 1: Front & Spine',
      desc: 'Tilted 30° angle to capture spine',
      icon: Layers,
      stepNumber: 2
    },
    {
      id: 'CAPTURE_SHOT_2',
      label: 'Shot 2: Author & Title Page',
      desc: 'Open page showing author name',
      icon: BookOpen,
      stepNumber: 3
    }
  ];

  const getStepStatus = (stepId: string) => {
    if (currentStep === 'COMPLETE') return 'completed';
    if (currentStep === stepId) return 'current';

    if (stepId === 'SCAN_ISBN') {
      return (currentStep === 'CAPTURE_SHOT_1' || currentStep === 'CAPTURE_SHOT_2') ? 'completed' : 'pending';
    }
    if (stepId === 'CAPTURE_SHOT_1') {
      return currentStep === 'CAPTURE_SHOT_2' ? 'completed' : 'pending';
    }
    return 'pending';
  };

  return (
    <div className="w-full glass-panel rounded-2xl p-3 sm:p-4 shadow-sm">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
        {steps.map((step) => {
          const status = getStepStatus(step.id);
          const Icon = step.icon;

          let badgeClasses = 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border-slate-200 dark:border-slate-700';
          let borderClasses = 'border-slate-200 dark:border-slate-800/80';
          let bgCardClasses = 'bg-white/50 dark:bg-slate-900/40';

          if (status === 'completed') {
            badgeClasses = 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/20';
            borderClasses = 'border-emerald-200 dark:border-emerald-900/50';
            bgCardClasses = 'bg-emerald-50/40 dark:bg-emerald-950/20';
          } else if (status === 'current') {
            badgeClasses = 'bg-brand-600 text-white shadow-md shadow-brand-500/30 animate-pulse';
            borderClasses = 'border-brand-500 ring-2 ring-brand-500/20 dark:border-brand-500';
            bgCardClasses = 'bg-brand-50/50 dark:bg-brand-950/30';
          }

          return (
            <div
              key={step.id}
              className={`flex items-center p-3 rounded-xl border transition-all duration-300 ${borderClasses} ${bgCardClasses}`}
            >
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mr-3 transition-colors ${badgeClasses}`}>
                {status === 'completed' ? (
                  <CheckCircle2 className="w-5 h-5 text-white" />
                ) : (
                  <Icon className="w-4 h-4" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    Step {step.stepNumber}
                  </span>
                  {status === 'completed' && (
                    <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-100/60 dark:bg-emerald-950 px-1.5 py-0.5 rounded">
                      Done
                    </span>
                  )}
                  {status === 'current' && (
                    <span className="text-[10px] font-semibold text-brand-600 dark:text-brand-400 bg-brand-100/60 dark:bg-brand-950 px-1.5 py-0.5 rounded">
                      Active
                    </span>
                  )}
                </div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                  {step.label}
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {step.desc}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
