export type CaptureStep = 'SCAN_ISBN' | 'CAPTURE_SHOT_1' | 'CAPTURE_SHOT_2' | 'COMPLETE';

export interface ShotInfo {
  filename: string;
  sizeBytes?: number;
  savedAt: string;
  type: string;
  previewDataUrl?: string;
}

export interface JournalMetadata {
  isbn: string;
  createdAt: string;
  updatedAt: string;
  operator: string;
  shots: Record<string, ShotInfo>;
}

export interface ProofItem {
  isbn: string;
  folderPath: string;
  hasShot1: boolean;
  hasShot2: boolean;
  shot1Url: string | null;
  shot2Url: string | null;
  isComplete: boolean;
  modifiedAt: string | null;
  metadata?: JournalMetadata | null;
}

export interface SystemStatus {
  status: string;
  hostname: string;
  platform: string;
  networkIps: Array<{ interface: string; address: string }>;
  port: number;
  storagePath: string;
  totalCapturedJournals: number;
}

export interface SystemConfig {
  storagePath: string;
  autoOpenExplorer: boolean;
  soundEnabled: boolean;
  imageQuality: number;
  cameraResolution: string;
}

export interface CameraDevice {
  deviceId: string;
  label: string;
}
