export type CaptureStep = 'SCAN_ISBN' | 'CAPTURE_SHOT_1' | 'CAPTURE_SHOT_2' | 'COMPLETE';

export interface BookDetails {
  title?: string;
  subtitle?: string;
  authors?: string;
  publisher?: string;
  publishDate?: string;
  publishYear?: string;
  numberOfPages?: number | null;
  subjects?: string[];
  coverUrl?: string | null;
  source?: string;
}

export interface ShotInfo {
  filename: string;
  sizeBytes?: number;
  savedAt: string;
  type: string;
  previewDataUrl?: string;
  blurScore?: number;
}

export interface JournalMetadata {
  identifier?: string;
  isbn: string;
  copyNumber?: number;
  createdAt: string;
  updatedAt: string;
  operator: string;
  station?: string;
  bookDetails?: BookDetails | null;
  shots: Record<string, ShotInfo>;
}

export interface ExistingCopy {
  identifier: string;
  copyNumber: number;
  hasShot1: boolean;
  hasShot2: boolean;
  isComplete: boolean;
  metadata?: JournalMetadata | null;
}

export interface ProofItem {
  isbn: string;
  baseIsbn?: string;
  copyNumber?: number;
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
  watermarkStation?: string;
}

export interface SystemConfig {
  storagePath: string;
  autoOpenExplorer: boolean;
  soundEnabled: boolean;
  imageQuality: number;
  cameraResolution: string;
  watermarkEnabled?: boolean;
  watermarkStation?: string;
  blurCheckEnabled?: boolean;
}

export interface CameraDevice {
  deviceId: string;
  label: string;
}

