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

export type StationRole = 'box_level' | 'book_level' | 'all_in_one';

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
  volume?: string;
  issues?: string;
  printIssn?: string;
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
  inheritedFromBox?: boolean;
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
  s3Upload?: {
    uploadedAt: string;
    bucket: string;
    s3FolderUri: string;
    shareableLink?: string;
    fileCount: number;
  } | null;
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
  sNo?: string;
  isbn: string;
  lotNumber?: string;
  boxNumber?: string;
  title?: string;
  author?: string;
  publisher?: string;
  printIssn?: string;
  publicationYear?: string;
  volume?: string;
  issues?: string;
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

export interface BoxSummary {
  lotNumber: string;
  boxNumber: string;
  boxKey: string;
  totalBooks: number;
  completedBooks: number;
  hasBoxShot: boolean;
  hasUnboxShot: boolean;
  boxShotUrl?: string | null;
  unboxShotUrl?: string | null;
  sampleIsbn?: string;
  items?: ManifestItem[];
  books?: ManifestItem[];
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
  stationRole?: StationRole;
  enforceManifest?: boolean;
  boxCameraDeviceId?: string;
  bookCameraDeviceId?: string;
  autoSwitchCamera?: boolean;
  s3Enabled?: boolean;
  s3Bucket?: string;
  s3Region?: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  s3Prefix?: string;
  s3CustomEndpoint?: string;
}

export interface S3UploadFileResult {
  filename: string;
  s3Key: string;
  s3Url?: string;
  presignedUrl?: string;
  sizeBytes?: number;
}

export interface S3UploadResult {
  success: boolean;
  isbn: string;
  bucket: string;
  prefix: string;
  s3FolderUri: string;
  shareableLink?: string;
  uploadedAt: string;
  files: S3UploadFileResult[];
  error?: string;
}

export interface S3Config {
  s3Enabled?: boolean;
  s3Bucket?: string;
  s3Region?: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  s3Prefix?: string;
  s3CustomEndpoint?: string;
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
  type: 'CONNECTED' | 'ISBN_INITIALIZED' | 'SHOT_SAVED' | 'SESSION_RESET' | 'MANIFEST_UPDATED' | 'BOX_INITIALIZED' | 'BOX_SHOT_SAVED' | 'S3_AUTO_UPLOADED';
  session: CaptureSession;
  isbn?: string;
  lotNumber?: string;
  boxNumber?: string;
  shotNumber?: number;
  shotInfo?: ShotInfo;
  boxShots?: any;
  boxSummary?: BoxSummary;
  isComplete?: boolean;
  currentStep?: CaptureStep;
  s3Upload?: any;
  timestamp: number;
}

export const SHOT_DEFINITIONS: ShotConfig[] = [
  {
    shotNumber: 1,
    id: 'CAPTURE_SHOT_1',
    label: 'Box',
    scope: 'box_level',
    filename: 'isbn_box.jpg',
    description: 'Box level view with books packed inside',
    instructions: 'Photograph the whole box showing all packed books inside'
  },
  {
    shotNumber: 2,
    id: 'CAPTURE_SHOT_2',
    label: 'Unbox',
    scope: 'box_level',
    filename: 'isbn_unbox.jpg',
    description: 'Box level view of books unpacked',
    instructions: 'Photograph unboxed books neatly arrayed for processing'
  },
  {
    shotNumber: 3,
    id: 'CAPTURE_SHOT_3',
    label: 'Front Cover',
    scope: 'book_level',
    filename: 'isbn_front cover.jpg',
    description: 'Book level full front cover',
    instructions: 'Capture flat, clear shot of the journal front cover'
  },
  {
    shotNumber: 4,
    id: 'CAPTURE_SHOT_4',
    label: 'Spine',
    scope: 'book_level',
    filename: 'isbn_spine.jpg',
    description: 'Book level spine with volume & title',
    instructions: 'Capture spine showing title, volume, and book thickness'
  },
  {
    shotNumber: 5,
    id: 'CAPTURE_SHOT_5',
    label: 'Title Page',
    scope: 'book_level',
    filename: 'isbn_title page.jpg',
    description: 'Book level main title page',
    instructions: 'Open to title page showing author and journal title clearly'
  },
  {
    shotNumber: 6,
    id: 'CAPTURE_SHOT_6',
    label: 'Edition Notice',
    scope: 'book_level',
    filename: 'isbn_edition notice.jpg',
    description: 'Edition notice, copyright & metadata',
    instructions: 'Photograph copyright page, edition notice, and barcode/ISSN'
  },
  {
    shotNumber: 7,
    id: 'CAPTURE_SHOT_7',
    label: 'Back Cover',
    scope: 'book_level',
    filename: 'isbn_back cover.jpg',
    description: 'Back cover, barcode & summary',
    instructions: 'Capture flat, clear shot of the back of the journal showing barcodes and summary'
  }
];
