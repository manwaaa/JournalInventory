export type CaptureStep = 
  | 'SCAN_ISBN' 
  | 'CAPTURE_SHOT_1' 
  | 'CAPTURE_SHOT_2' 
  | 'CAPTURE_SHOT_3' 
  | 'CAPTURE_SHOT_4' 
  | 'CAPTURE_SHOT_5' 
  | 'CAPTURE_SHOT_6' 
  | 'CAPTURE_SHOT_7' 
  | 'COMPLETE';

export type ViewMode = 'CAPTURE' | 'SEARCH_VIEW';

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

export type ShotScope = 'box_level' | 'book_level';

export interface ShotConfig {
  shotNumber: number;
  id: string;
  label: string;
  scope: ShotScope;
  filename: string;
  description: string;
  instructions: string;
}

export interface ShotInfo {
  filename: string;
  sizeBytes?: number;
  savedAt: string;
  type: string;
  scope?: ShotScope;
  previewDataUrl?: string;
  blurScore?: number;
}

export interface JournalMetadata {
  identifier?: string;
  isbn: string;
  lotNumber?: string;
  boxNumber?: string;
  copyNumber?: number;
  createdAt: string;
  updatedAt: string;
  operator: string;
  station?: string;
  bookDetails?: BookDetails | null;
  manifestInfo?: ManifestItem | null;
  shots: Record<string, ShotInfo>;
  isComplete?: boolean;
}

export interface ExistingCopy {
  identifier: string;
  copyNumber: number;
  shotsCount: number;
  isComplete: boolean;
  metadata?: JournalMetadata | null;
}

export interface ProofItem {
  isbn: string;
  baseIsbn?: string;
  lotNumber?: string;
  boxNumber?: string;
  copyNumber?: number;
  folderPath: string;
  shotsCount: number;
  isComplete: boolean;
  shots: Record<string, string | null>;
  shot1Url: string | null;
  shot2Url: string | null;
  shot3Url?: string | null;
  shot4Url?: string | null;
  shot5Url?: string | null;
  shot6Url?: string | null;
  shot7Url?: string | null;
  modifiedAt: string | null;
  metadata?: JournalMetadata | null;
}

export interface ManifestItem {
  isbn: string;
  lotNumber?: string;
  boxNumber?: string;
  title?: string;
  author?: string;
  isProcessable: boolean;
  reason?: string;
  notes?: string;
  importedAt?: string;
}

export interface ManifestData {
  items: ManifestItem[];
  totalCount: number;
  processableCount: number;
  nonProcessableCount: number;
  lastUpdated: string | null;
  filename: string | null;
}

export interface CameraDevice {
  deviceId: string;
  label: string;
}

export interface SystemStatus {
  status: string;
  appName?: string;
  hostname: string;
  platform: string;
  networkIps: { address: string; interface: string; internal: boolean }[];
  port: number;
  httpsPort: number | null;
  mobileHttpsUrl: string | null;
  activeSession: CaptureSession;
  proofCount: number;
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
  peerSyncEnabled?: boolean;
  peerIp?: string;
  peerPort?: number;
  enforceManifest?: boolean;
}

export interface CaptureSession {
  activeIsbn: string;
  baseIsbn: string;
  lotNumber: string;
  boxNumber: string;
  currentStep: CaptureStep;
  shots: Record<number, ShotInfo | null>;
  metadata: JournalMetadata | null;
  bookDetails: BookDetails | null;
  copyNumber: number;
  isProcessable: boolean;
}

export interface SessionEvent {
  type: 'CONNECTED' | 'ISBN_INITIALIZED' | 'SHOT_SAVED' | 'SESSION_RESET' | 'MANIFEST_UPDATED';
  session: CaptureSession;
  isbn?: string;
  shotNumber?: number;
  shotInfo?: ShotInfo;
  isComplete?: boolean;
  currentStep?: CaptureStep;
  timestamp: number;
}

export const SHOT_DEFINITIONS: ShotConfig[] = [
  {
    shotNumber: 1,
    id: 'CAPTURE_SHOT_1',
    label: 'Books in a Box',
    scope: 'box_level',
    filename: '1_books_in_box.jpg',
    description: 'Box level view with books packed inside',
    instructions: 'Photograph the whole box showing all packed books inside'
  },
  {
    shotNumber: 2,
    id: 'CAPTURE_SHOT_2',
    label: 'Unbox Books',
    scope: 'box_level',
    filename: '2_unbox_books.jpg',
    description: 'Box level view of books unpacked',
    instructions: 'Photograph unboxed books neatly arrayed for processing'
  },
  {
    shotNumber: 3,
    id: 'CAPTURE_SHOT_3',
    label: 'Front Cover',
    scope: 'book_level',
    filename: '3_front_cover.jpg',
    description: 'Book level full front cover',
    instructions: 'Capture flat, clear shot of the journal front cover'
  },
  {
    shotNumber: 4,
    id: 'CAPTURE_SHOT_4',
    label: 'Spine',
    scope: 'book_level',
    filename: '4_spine.jpg',
    description: 'Book level spine with volume & title',
    instructions: 'Capture spine showing title, volume, and book thickness'
  },
  {
    shotNumber: 5,
    id: 'CAPTURE_SHOT_5',
    label: 'Title Page',
    scope: 'book_level',
    filename: '5_title_page.jpg',
    description: 'Book level main title page',
    instructions: 'Open to title page showing author and journal title clearly'
  },
  {
    shotNumber: 6,
    id: 'CAPTURE_SHOT_6',
    label: 'Front Matter',
    scope: 'book_level',
    filename: '6_front_matter.jpg',
    description: 'Edition notice, copyright & metadata',
    instructions: 'Photograph copyright page, edition notice, and barcode/ISSN'
  },
  {
    shotNumber: 7,
    id: 'CAPTURE_SHOT_7',
    label: 'Back of Journal',
    scope: 'book_level',
    filename: '7_back_cover.jpg',
    description: 'Back cover, barcode & summary',
    instructions: 'Capture flat, clear shot of the back of the journal showing barcodes and summary'
  }
];
