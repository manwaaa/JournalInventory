import express from 'express';
import cors from 'cors';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import os from 'os';
import archiver from 'archiver';
import dotenv from 'dotenv';

import http from 'http';
import https from 'https';
import selfsigned from 'selfsigned';
import { S3Client, PutObjectCommand, HeadBucketCommand, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;

// Ensure SSL certificates directory and generate self-signed cert for LAN HTTPS
const CERTS_DIR = path.resolve(__dirname, 'certs');
fs.ensureDirSync(CERTS_DIR);
const CERT_FILE = path.join(CERTS_DIR, 'cert.pem');
const KEY_FILE = path.join(CERTS_DIR, 'key.pem');

let sslOptions = null;
try {
  if (fs.existsSync(CERT_FILE) && fs.existsSync(KEY_FILE)) {
    sslOptions = {
      cert: fs.readFileSync(CERT_FILE, 'utf8'),
      key: fs.readFileSync(KEY_FILE, 'utf8')
    };
  } else {
    console.log('[SSL] Generating local self-signed certificate for mobile HTTPS camera access...');
    const pems = await selfsigned.generate([
      { name: 'commonName', value: os.hostname() || 'localhost' },
      { name: 'organizationName', value: 'Verification Images' }
    ], { days: 730 });

    fs.writeFileSync(CERT_FILE, pems.cert, 'utf8');
    fs.writeFileSync(KEY_FILE, pems.private, 'utf8');
    sslOptions = { cert: pems.cert, key: pems.private };
    console.log('[SSL] Local SSL certificate generated and saved.');
  }
} catch (e) {
  console.warn('[SSL] Could not initialize SSL certificate:', e.message);
}

// Storage path configuration
const DEFAULT_STORAGE_PATH = process.env.STORAGE_PATH || (process.platform === 'win32' 
  ? 'C:\\Journal_Proofs' 
  : path.resolve(__dirname, 'storage/journal_proofs'));

const CONFIG_FILE = path.resolve(__dirname, 'config.json');
const MANIFEST_FILE = path.resolve(__dirname, 'manifest.json');

// Helper to sanitize ISBN for filesystem safely
function sanitizeIsbn(isbn) {
  if (!isbn || typeof isbn !== 'string') return '';
  return isbn.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
}

// Helper to extract base ISBN from copy names (e.g. 9780198826545_Copy2 -> 9780198826545)
function getBaseIsbn(identifier) {
  if (!identifier || typeof identifier !== 'string') return '';
  return identifier.replace(/_Copy\d+$/i, '');
}

// Helper to extract copy number from identifier (e.g. 9780198826545_Copy2 -> 2, otherwise 1)
function getCopyNumber(identifier) {
  if (!identifier || typeof identifier !== 'string') return 1;
  const match = identifier.match(/_Copy(\d+)$/i);
  return match ? parseInt(match[1], 10) : 1;
}

// 7 Shot definitions & filenames (isbn_<type>.jpg)
const SHOT_DEFINITIONS = {
  1: { suffix: '_box a.jpg', legacyNames: ['_box_a.jpg', 'shot_1_box_a.jpg', '_box.jpg', '1_books_in_box.jpg', '1_front_spine.jpg', '1_box.jpg', 'box.jpg', '1_box_a.jpg', 'shot_1_box.jpg'], type: 'Box A', scope: 'box_level' },
  2: { suffix: '_box b.jpg', legacyNames: ['_box_b.jpg', 'shot_2_box_b.jpg', '_unbox.jpg', '2_unbox_books.jpg', '2_author_title.jpg', '2_unbox.jpg', 'unbox.jpg', '2_box_b.jpg', 'shot_2_unbox.jpg'], type: 'Box B', scope: 'box_level' },
  3: { suffix: '_front cover.jpg', legacyNames: ['3_front_cover.jpg', '3_front cover.jpg', 'front_cover.jpg', 'front cover.jpg'], type: 'Front Cover', scope: 'book_level' },
  4: { suffix: '_spine.jpg', legacyNames: ['4_spine.jpg', 'spine.jpg'], type: 'Spine', scope: 'book_level' },
  5: { suffix: '_title page.jpg', legacyNames: ['5_title_page.jpg', '5_title page.jpg', 'title_page.jpg', 'title page.jpg'], type: 'Title Page', scope: 'book_level' },
  6: { suffix: '_edition notice.jpg', legacyNames: ['6_front_matter.jpg', '6_edition_notice.jpg', '6_edition notice.jpg', 'front_matter.jpg', 'edition_notice.jpg'], type: 'Edition Notice', scope: 'book_level' },
  7: { suffix: '_back cover.jpg', legacyNames: ['7_back_cover.jpg', '7_back cover.jpg', 'back_cover.jpg', 'back cover.jpg'], type: 'Back Cover', scope: 'book_level' }
};

function getShotFilename(shotNumber, identifier) {
  const def = SHOT_DEFINITIONS[shotNumber];
  if (!def) return `shot_${shotNumber}.jpg`;
  const cleanId = sanitizeIsbn(identifier || '');
  const prefix = cleanId || 'journal';
  return `${prefix}${def.suffix}`;
}

function isValidImageFile(filePath) {
  try {
    if (!filePath || typeof filePath !== 'string' || !fs.existsSync(filePath)) return false;
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size > 1024; // Must be at least 1 KB
  } catch (e) {
    return false;
  }
}

function findShotFileInFolder(folderPath, shotNumber, identifier) {
  const def = SHOT_DEFINITIONS[shotNumber];
  if (!def || !fs.existsSync(folderPath)) return null;

  // 1. Direct match with identifier prefix (e.g. 9780198826545_box a.jpg)
  const targetName = getShotFilename(shotNumber, identifier);
  const targetPath = path.join(folderPath, targetName);
  if (isValidImageFile(targetPath)) {
    return targetName;
  }

  // 1b. Check underscore variant (e.g. 9780198826545_box_a.jpg)
  if (targetName.includes(' ')) {
    const underscoreName = targetName.replace(/ /g, '_');
    const underscorePath = path.join(folderPath, underscoreName);
    if (isValidImageFile(underscorePath)) {
      return underscoreName;
    }
  }

  // 2. Scan directory for matching suffix or legacy names
  try {
    const files = fs.readdirSync(folderPath);
    const suffix = def.suffix.toLowerCase();
    const underscoreSuffix = suffix.replace(/ /g, '_');

    // Check files ending with this shot's suffix (e.g. any *_box a.jpg or *_box_a.jpg)
    for (const f of files) {
      const lower = f.toLowerCase();
      if (lower.endsWith(suffix) || (underscoreSuffix !== suffix && lower.endsWith(underscoreSuffix))) {
        const fullP = path.join(folderPath, f);
        if (isValidImageFile(fullP)) return f;
      }
    }

    // Check legacy names
    for (const leg of def.legacyNames) {
      const legMatch = files.find(f => f.toLowerCase() === leg.toLowerCase() || f.toLowerCase().endsWith(leg.toLowerCase()));
      if (legMatch) {
        const fullP = path.join(folderPath, legMatch);
        if (isValidImageFile(fullP)) return legMatch;
      }
    }
  } catch (e) {}

  return null;
}

// Load or initialize config
let config = {
  storagePath: DEFAULT_STORAGE_PATH,
  autoOpenExplorer: false,
  soundEnabled: true,
  imageQuality: 0.95,
  cameraResolution: '1080p',
  watermarkEnabled: true,
  watermarkStation: 'Station-01',
  blurCheckEnabled: true,
  peerSyncEnabled: false,
  peerIp: '',
  peerPort: 3001,
  enforceManifest: false,
  s3Enabled: true,
  s3Bucket: process.env.AWS_S3_BUCKET || 'innoscanmussgp1-s3',
  s3Region: process.env.AWS_REGION || 'ap-southeast-1',
  s3AccessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
  s3SecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  s3Prefix: 'innoscanmussgp1/JournalVerificationImages/',
  s3CustomEndpoint: process.env.AWS_S3_ENDPOINT || ''
};

if (fs.existsSync(CONFIG_FILE)) {
  try {
    const saved = fs.readJsonSync(CONFIG_FILE);
    config = { ...config, ...saved };
    // Ensure working S3 defaults if missing in existing config.json
    if (!config.s3Bucket) config.s3Bucket = process.env.AWS_S3_BUCKET || 'innoscanmussgp1-s3';
    if (!config.s3Region) config.s3Region = process.env.AWS_REGION || 'ap-southeast-1';
    if (!config.s3AccessKeyId && process.env.AWS_ACCESS_KEY_ID) config.s3AccessKeyId = process.env.AWS_ACCESS_KEY_ID;
    if (!config.s3SecretAccessKey && process.env.AWS_SECRET_ACCESS_KEY) config.s3SecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    if (!config.s3Prefix || config.s3Prefix === 'journal-proofs/') config.s3Prefix = 'innoscanmussgp1/JournalVerificationImages/';
    if (config.s3Enabled === undefined || config.s3Enabled === null) config.s3Enabled = true;
  } catch (err) {
    console.error('Failed to parse config.json, using defaults:', err);
  }
} else {
  fs.writeJsonSync(CONFIG_FILE, config, { spaces: 2 });
}

// Load or initialize Manifest database
let manifestData = {
  items: [],
  manifests: [],
  totalCount: 0,
  processableCount: 0,
  nonProcessableCount: 0,
  lastUpdated: null,
  filename: null
};

function rebuildManifestHistory(data) {
  if (!data || !Array.isArray(data.items) || data.items.length === 0) {
    if (data) data.manifests = [];
    return data;
  }

  const groups = new Map();
  for (let idx = 0; idx < data.items.length; idx++) {
    const item = data.items[idx];
    const filename = item.manifestFilename || data.filename || 'Imported Manifest';
    const sheet = item.sheetName ? String(item.sheetName).trim() : '';
    const lot = item.lotNumber ? String(item.lotNumber).trim() : '';
    // Group by filename + sheet + lot so each distinct lot/sheet is separated in dropdown
    const key = `${filename}||${sheet}||${lot}`;

    if (!groups.has(key)) {
      groups.set(key, {
        filename,
        sheetName: sheet || undefined,
        lotNumber: lot || undefined,
        lotNumbers: lot ? [lot] : [],
        importedAt: item.importedAt || data.lastUpdated || new Date().toISOString(),
        items: []
      });
    }
    groups.get(key).items.push(item);
  }

  const manifests = [];
  let gIdx = 0;
  for (const [key, grp] of groups.entries()) {
    gIdx++;
    const safeLot = (grp.lotNumber || grp.sheetName || `lot_${gIdx}`).replace(/[^a-zA-Z0-9_-]/g, '_');
    const id = `m_${safeLot}_${gIdx}`;
    const processableCount = grp.items.filter(i => i.isProcessable).length;
    const nonProcessableCount = grp.items.length - processableCount;

    for (const item of grp.items) {
      item.manifestId = id;
      item.manifestFilename = grp.filename;
    }

    manifests.push({
      id,
      filename: grp.filename,
      sheetName: grp.sheetName,
      lotNumber: grp.lotNumber,
      lotNumbers: grp.lotNumbers,
      importedAt: grp.importedAt,
      itemCount: grp.items.length,
      processableCount,
      nonProcessableCount
    });
  }

  data.manifests = manifests;
  data.totalCount = data.items.length;
  data.processableCount = data.items.filter(i => i.isProcessable).length;
  data.nonProcessableCount = data.totalCount - data.processableCount;
  return data;
}

if (fs.existsSync(MANIFEST_FILE)) {
  try {
    manifestData = fs.readJsonSync(MANIFEST_FILE);
    if (!Array.isArray(manifestData.items)) manifestData.items = [];
    const hasCombinedLots = Array.isArray(manifestData.manifests) && manifestData.manifests.some(m => m.lotNumbers && m.lotNumbers.length > 1);
    if (!Array.isArray(manifestData.manifests) || manifestData.manifests.length === 0 || hasCombinedLots) {
      rebuildManifestHistory(manifestData);
      try { fs.writeJsonSync(MANIFEST_FILE, manifestData, { spaces: 2 }); } catch (e) {}
    }
  } catch (err) {
    console.error('Failed to parse manifest.json:', err);
  }
}

function saveManifest() {
  try {
    fs.writeJsonSync(MANIFEST_FILE, manifestData, { spaces: 2 });
  } catch (err) {
    console.error('Failed to save manifest.json:', err);
  }
}

// Universal manifest lookup helper: handles ISBN, sanitized, digits-only, ISSN, and copy names
function findManifestItem(identifier) {
  if (!identifier || !manifestData.items || manifestData.items.length === 0) return null;
  const raw = String(identifier).trim();
  const clean = sanitizeIsbn(raw);
  const base = getBaseIsbn(clean);
  const digitsOnly = raw.replace(/[^0-9Xx]/g, '');

  return manifestData.items.find(item => {
    if (!item) return false;
    const itemIsbnRaw = String(item.isbn || '').trim();
    const itemClean = sanitizeIsbn(itemIsbnRaw);
    const itemDigits = itemIsbnRaw.replace(/[^0-9Xx]/g, '');

    // 1. Direct match (exact or case-insensitive)
    if (itemIsbnRaw.toLowerCase() === raw.toLowerCase()) return true;
    if (itemClean.toLowerCase() === clean.toLowerCase()) return true;
    if (itemClean.toLowerCase() === base.toLowerCase()) return true;

    // 2. Digits-only match (ignores dashes/spaces)
    if (digitsOnly.length > 0 && itemDigits.length > 0) {
      if (itemDigits === digitsOnly) return true;
      if (digitsOnly.length === 13 && digitsOnly.startsWith('978') && digitsOnly.slice(3, 12) === itemDigits.slice(0, 9)) return true;
      if (itemDigits.length === 13 && itemDigits.startsWith('978') && itemDigits.slice(3, 12) === digitsOnly.slice(0, 9)) return true;
    }

    // 3. Match against printIssn
    if (item.printIssn) {
      const issnRaw = String(item.printIssn).trim();
      const issnDigits = issnRaw.replace(/[^0-9Xx]/g, '');
      if (issnRaw.toLowerCase() === raw.toLowerCase()) return true;
      if (digitsOnly.length > 0 && issnDigits === digitsOnly) return true;
    }

    // 4. Match against sNo if scanned
    if (item.sNo && String(item.sNo).trim() === raw) return true;

    return false;
  }) || null;
}

// Automatically synchronizes and self-heals all metadata files with manifest Lot, Box, and Title info
async function selfHealAllMetadataWithManifest() {
  if (!manifestData.items || manifestData.items.length === 0 || !fs.existsSync(config.storagePath)) return;
  try {
    const metaDir = getMetadataDir();
    if (!fs.existsSync(metaDir)) return;
    const metaFiles = await fs.readdir(metaDir);
    let healedCount = 0;

    for (const f of metaFiles) {
      if (!f.endsWith('.json')) continue;
      const cleanIsbn = f.slice(0, -5);
      const metaPath = path.join(metaDir, f);
      let metadata = await fs.readJson(metaPath).catch(() => null);
      if (!metadata) continue;

      const baseIsbn = metadata.isbn || getBaseIsbn(cleanIsbn);
      const manifestMatch = findManifestItem(baseIsbn) || findManifestItem(cleanIsbn);

      if (manifestMatch) {
        let modified = false;

        // Self-heal Lot Number if missing or generic
        const isCurrentLotGeneric = !metadata.lotNumber || 
          metadata.lotNumber === 'Unassigned' || 
          metadata.lotNumber === 'Unassigned Lot' || 
          (metadata.lotNumber === 'Lot-1' && manifestMatch.lotNumber && manifestMatch.lotNumber !== 'Lot-1');

        if (isCurrentLotGeneric && manifestMatch.lotNumber) {
          metadata.lotNumber = manifestMatch.lotNumber;
          modified = true;
        }

        // Self-heal Box Number if missing or generic
        const isCurrentBoxGeneric = !metadata.boxNumber || 
          metadata.boxNumber === 'Unassigned' || 
          metadata.boxNumber === 'Unassigned Box';

        if (isCurrentBoxGeneric && manifestMatch.boxNumber) {
          metadata.boxNumber = manifestMatch.boxNumber;
          modified = true;
        }

        // Self-heal Book Details if missing
        if (!metadata.bookDetails && manifestMatch.title) {
          metadata.bookDetails = {
            title: manifestMatch.title,
            authors: manifestMatch.author || '',
            publisher: manifestMatch.publisher || '',
            publishYear: manifestMatch.publicationYear || '',
            printIssn: manifestMatch.printIssn || '',
            volume: manifestMatch.volume || '',
            issues: manifestMatch.issues || '',
            source: 'Manifest'
          };
          modified = true;
        }

        if (modified) {
          metadata.updatedAt = new Date().toISOString();
          await fs.writeJson(metaPath, metadata, { spaces: 2 });
          healedCount++;
        }
      }
    }

    if (healedCount > 0) {
      console.log(`[Manifest Self-Heal] Successfully synced Lot & Box info for ${healedCount} journal(s) from manifest!`);
    }
  } catch (err) {
    console.warn('[Manifest Self-Heal Warning]', err.message);
  }
}

// Ensure storage directory exists
try {
  fs.ensureDirSync(config.storagePath);
  console.log(`[Storage] Storage directory ready at: ${config.storagePath}`);
} catch (err) {
  console.error(`[Storage] Failed to create default storage path (${config.storagePath}), falling back to local storage.`, err);
  config.storagePath = path.resolve(__dirname, 'storage/journal_proofs');
  fs.ensureDirSync(config.storagePath);
}

// Clean up empty proof folders
async function cleanupEmptyProofFolders() {
  try {
    if (!fs.existsSync(config.storagePath)) return;
    const entries = await fs.readdir(config.storagePath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
        const folder = path.join(config.storagePath, entry.name);
        const files = await fs.readdir(folder);
        const imageFiles = files.filter(f => /\.(jpe?g|png|webp)$/i.test(f));
        if (imageFiles.length === 0) {
          await fs.remove(folder);
          console.log(`[Storage] Auto-cleaned empty/abandoned folder: ${entry.name}`);
        }
      }
    }
  } catch (err) {
    console.warn('[Storage] Cleanup empty folders warning:', err.message);
  }
}

cleanupEmptyProofFolders();

function saveConfig() {
  try {
    fs.writeJsonSync(CONFIG_FILE, config, { spaces: 2 });
  } catch (err) {
    console.error('Failed to save config:', err);
  }
}

// -------------------------------------------------------------
// Centralized Metadata Management (.metadata/ directory)
// Keeps photo folders clean so ONLY pictures are inside each folder
// -------------------------------------------------------------
function getMetadataDir() {
  const metaDir = path.join(config.storagePath, '.metadata');
  if (!fs.existsSync(metaDir)) {
    try { fs.mkdirpSync(metaDir); } catch (e) {}
  }
  return metaDir;
}

function getMetadataPath(cleanIsbn) {
  return path.join(getMetadataDir(), `${cleanIsbn}.json`);
}

function readIsbnMetadata(cleanIsbn) {
  if (!cleanIsbn) return null;
  const newPath = getMetadataPath(cleanIsbn);
  if (fs.existsSync(newPath)) {
    try { return fs.readJsonSync(newPath); } catch (e) {}
  }

  // Backwards-compatible check: legacy metadata.json inside photo folder
  const folderPath = path.join(config.storagePath, cleanIsbn);
  const legacyPath = path.join(folderPath, 'metadata.json');
  if (fs.existsSync(legacyPath)) {
    try {
      const data = fs.readJsonSync(legacyPath);
      // Auto-migrate legacy metadata.json out of the photo folder
      try {
        fs.writeJsonSync(newPath, data, { spaces: 2 });
        fs.removeSync(legacyPath);
        console.log(`[Metadata Migration] Migrated metadata.json for ${cleanIsbn} to .metadata/ directory`);
      } catch (migErr) {}
      return data;
    } catch (e) {}
  }
  return null;
}

async function saveIsbnMetadata(cleanIsbn, metadata) {
  if (!cleanIsbn || !metadata) return metadata;
  const newPath = getMetadataPath(cleanIsbn);
  await fs.writeJson(newPath, metadata, { spaces: 2 });

  // Clean up any legacy metadata.json from photo folder so only pictures remain
  const folderPath = path.join(config.storagePath, cleanIsbn);
  const legacyPath = path.join(folderPath, 'metadata.json');
  if (fs.existsSync(legacyPath)) {
    try { await fs.remove(legacyPath); } catch (e) {}
  }
  return metadata;
}

// Background cleanup: migrate all legacy metadata.json files out of photo folders
async function migrateAllLegacyMetadata() {
  try {
    if (!fs.existsSync(config.storagePath)) return;
    const entries = await fs.readdir(config.storagePath);
    let migratedCount = 0;
    for (const entry of entries) {
      if (entry.startsWith('.') || entry.startsWith('_')) continue;
      const folderPath = path.join(config.storagePath, entry);
      const stat = await fs.stat(folderPath).catch(() => null);
      if (!stat || !stat.isDirectory()) continue;

      const legacyMetaPath = path.join(folderPath, 'metadata.json');
      if (fs.existsSync(legacyMetaPath)) {
        try {
          const data = await fs.readJson(legacyMetaPath);
          const newPath = getMetadataPath(entry);
          await fs.writeJson(newPath, data, { spaces: 2 });
          await fs.remove(legacyMetaPath);
          migratedCount++;
        } catch (err) {
          console.warn(`[Metadata Cleanup] Failed for ${entry}:`, err.message);
        }
      }
    }
    if (migratedCount > 0) {
      console.log(`[Metadata Cleanup] Successfully removed metadata.json from ${migratedCount} photo folder(s)`);
    }
    await selfHealAllMetadataWithManifest();
  } catch (e) {
    console.error('[Metadata Migration Error]', e);
  }
}

// Global active capture session state (7 Shots)
let currentSession = {
  activeIsbn: '',
  baseIsbn: '',
  lotNumber: '',
  boxNumber: '',
  currentStep: 'SCAN_ISBN',
  shots: { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null, 7: null },
  metadata: null,
  bookDetails: null,
  copyNumber: 1,
  isProcessable: true
};

// Connected Server-Sent Events (SSE) clients
const sseClients = new Set();

function broadcastSession(type, extra = {}) {
  const payload = JSON.stringify({
    type,
    session: currentSession,
    ...extra,
    timestamp: Date.now()
  });

  for (const client of sseClients) {
    try {
      client.write(`data: ${payload}\n\n`);
    } catch (err) {
      sseClients.delete(client);
    }
  }
}

// Helper to get local network IPv4 addresses
function getNetworkIps() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push({ interface: name, address: net.address });
      }
    }
  }
  return addresses;
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ limit: '60mb', extended: true }));

// Serve saved shots statically with peer proxy/caching fallback
app.use('/proofs', (req, res, next) => {
  express.static(config.storagePath)(req, res, async () => {
    // If not found locally, attempt to fetch from peer PC (e.g. PC 1) over LAN
    if (config.peerIp) {
      try {
        const peerUrl = `http://${config.peerIp}:${config.peerPort || 3001}/proofs${req.url}`;
        const peerRes = await fetch(peerUrl, { signal: AbortSignal.timeout(3000) }).catch(() => null);
        if (peerRes && peerRes.ok) {
          const buffer = Buffer.from(await peerRes.arrayBuffer());
          if (buffer.length > 100) {
            // Save to local disk so future requests are instant
            try {
              const cleanPath = decodeURIComponent(req.path.split('?')[0]);
              const localFilePath = path.join(config.storagePath, cleanPath);
              fs.ensureDirSync(path.dirname(localFilePath));
              fs.writeFileSync(localFilePath, buffer);
            } catch (e) {}

            res.set('Content-Type', peerRes.headers.get('content-type') || 'image/jpeg');
            return res.send(buffer);
          }
        }
      } catch (err) {
        // Fall through to 404
      }
    }
    res.status(404).send('Proof image not found');
  });
});

// Cache for metadata lookups
const metadataCache = new Map();

// -------------------------------------------------------------
// Real-Time Cross-Device Session Endpoints (SSE)
// -------------------------------------------------------------
app.get('/api/session/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', session: currentSession, timestamp: Date.now() })}\n\n`);
  sseClients.add(res);

  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch (e) {
      clearInterval(heartbeat);
      sseClients.delete(res);
    }
  }, 20000);

  const cleanup = () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  };

  req.on('close', cleanup);
  req.on('error', cleanup);
  res.on('error', cleanup);
  res.on('close', cleanup);
});

app.get('/api/session/current', (req, res) => {
  res.json({ session: currentSession });
});

app.post('/api/session/reset', async (req, res) => {
  await cleanupEmptyProofFolders();
  const keepLot = req.body?.clearBoxContext ? '' : (req.body?.lotNumber || currentSession.lotNumber || '');
  const keepBox = req.body?.clearBoxContext ? '' : (req.body?.boxNumber || currentSession.boxNumber || '');
  currentSession = {
    activeIsbn: '',
    baseIsbn: '',
    lotNumber: keepLot,
    boxNumber: keepBox,
    currentStep: 'SCAN_ISBN',
    shots: { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null, 7: null },
    metadata: null,
    bookDetails: null,
    copyNumber: 1,
    isProcessable: true
  };
  broadcastSession('SESSION_RESET', { lotNumber: keepLot, boxNumber: keepBox });
  res.json({ success: true, session: currentSession });
});

app.post('/api/capture/discard', async (req, res) => {
  try {
    const targetIsbn = req.body?.isbn || currentSession.activeIsbn;
    if (targetIsbn) {
      const cleanIsbn = sanitizeIsbn(targetIsbn);
      const folderPath = path.join(config.storagePath, cleanIsbn);
      if (fs.existsSync(folderPath)) {
        await fs.remove(folderPath);
        console.log(`[Storage] Discarded proof folder: ${cleanIsbn}`);
      }
    }
    await cleanupEmptyProofFolders();
    currentSession = {
      activeIsbn: '',
      baseIsbn: '',
      lotNumber: '',
      boxNumber: '',
      currentStep: 'SCAN_ISBN',
      shots: { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null, 7: null },
      metadata: null,
      bookDetails: null,
      copyNumber: 1,
      isProcessable: true
    };
    broadcastSession('SESSION_RESET', { discarded: true, isbn: targetIsbn });
    res.json({ success: true, discarded: targetIsbn });
  } catch (err) {
    console.error('Error discarding session:', err);
    res.status(500).json({ error: 'Failed to discard session', details: err.message });
  }
});

// -------------------------------------------------------------
// Manifest Import & Validation Endpoints
// -------------------------------------------------------------
app.get('/api/manifest', (req, res) => {
  res.json(manifestData);
});

app.post('/api/manifest/import', async (req, res) => {
  try {
    const { items, filename, replaceAll } = req.body;
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'Items array is required' });
    }

    const importTimestamp = new Date().toISOString();
    const safeFilename = filename || `manifest_${new Date().toISOString().slice(0, 10)}.csv`;

    // Group incoming items by (sheetName, lotNumber) so each sheet and lot is a separate selectable manifest
    const groupsMap = new Map();
    for (let idx = 0; idx < items.length; idx++) {
      const rawItem = items[idx];
      const rawIsbn = String(rawItem.isbn || '').trim();
      if (!rawIsbn) continue;

      const rawSheet = rawItem.sheetName ? String(rawItem.sheetName).trim() : '';
      const rawLot = rawItem.lotNumber ? String(rawItem.lotNumber).trim() : '';
      const groupKey = `${rawSheet}||${rawLot}`;

      if (!groupsMap.has(groupKey)) {
        groupsMap.set(groupKey, {
          sheetName: rawSheet || undefined,
          lotNumber: rawLot || undefined,
          rawItems: []
        });
      }
      groupsMap.get(groupKey).rawItems.push({ item: rawItem, originalIdx: idx });
    }

    if (groupsMap.size === 0) {
      return res.status(400).json({ error: 'No valid journal items found.' });
    }

    const newManifestEntries = [];
    const allCleanNewItems = [];

    let groupCounter = 0;
    for (const [groupKey, grp] of groupsMap.entries()) {
      groupCounter++;
      const safeTag = (grp.lotNumber || grp.sheetName || `batch_${groupCounter}`).replace(/[^a-zA-Z0-9_-]/g, '_');
      const manifestId = `m_${Date.now()}_${groupCounter}_${safeTag}`;

      const cleanGroupItems = grp.rawItems.map(({ item, originalIdx }) => ({
        sNo: item.sNo ? String(item.sNo).trim() : String(originalIdx + 1),
        isbn: String(item.isbn || '').trim(),
        lotNumber: item.lotNumber ? String(item.lotNumber).trim() : '',
        boxNumber: item.boxNumber ? String(item.boxNumber).trim() : '',
        title: item.title ? String(item.title).trim() : '',
        author: item.author ? String(item.author).trim() : '',
        publisher: item.publisher ? String(item.publisher).trim() : '',
        printIssn: item.printIssn ? String(item.printIssn).trim() : '',
        publicationYear: item.publicationYear ? String(item.publicationYear).trim() : '',
        volume: item.volume ? String(item.volume).trim() : '',
        issues: item.issues ? String(item.issues).trim() : '',
        isProcessable: item.isProcessable !== false && String(item.isProcessable).toLowerCase() !== 'false' && String(item.isProcessable).toLowerCase() !== 'no',
        reason: item.reason ? String(item.reason).trim() : '',
        notes: item.notes ? String(item.notes).trim() : '',
        importedAt: importTimestamp,
        manifestId: manifestId,
        manifestFilename: safeFilename,
        sheetName: grp.sheetName
      }));

      const processableCount = cleanGroupItems.filter(i => i.isProcessable).length;
      const nonProcessableCount = cleanGroupItems.length - processableCount;
      const lotNumbers = grp.lotNumber ? [grp.lotNumber] : [];

      newManifestEntries.push({
        id: manifestId,
        filename: safeFilename,
        sheetName: grp.sheetName,
        lotNumber: grp.lotNumber,
        lotNumbers,
        importedAt: importTimestamp,
        itemCount: cleanGroupItems.length,
        processableCount,
        nonProcessableCount
      });

      allCleanNewItems.push(...cleanGroupItems);
    }

    if (replaceAll) {
      manifestData.items = allCleanNewItems;
      manifestData.manifests = newManifestEntries;
    } else {
      if (!Array.isArray(manifestData.items)) manifestData.items = [];
      if (!Array.isArray(manifestData.manifests)) manifestData.manifests = [];

      // Replace matching ISBNs with the latest details while keeping remaining previous items
      const newIsbnSet = new Set(allCleanNewItems.map(i => sanitizeIsbn(i.isbn)));
      const retainedOldItems = manifestData.items.filter(i => !newIsbnSet.has(sanitizeIsbn(i.isbn)));
      manifestData.items = [...retainedOldItems, ...allCleanNewItems];

      // Append new sheet / lot manifest entries
      manifestData.manifests = [...manifestData.manifests, ...newManifestEntries];
    }

    manifestData.totalCount = manifestData.items.length;
    manifestData.processableCount = manifestData.items.filter(i => i.isProcessable).length;
    manifestData.nonProcessableCount = manifestData.totalCount - manifestData.processableCount;
    manifestData.lastUpdated = importTimestamp;
    manifestData.filename = safeFilename;

    saveManifest();
    broadcastSession('MANIFEST_UPDATED', { manifestData });

    // Automatically synchronize and heal Lot/Box info across all existing journal proofs on disk
    await selfHealAllMetadataWithManifest();

    res.json({
      success: true,
      manifestData,
      importedCount: allCleanNewItems.length,
      sheetsCount: newManifestEntries.length
    });
  } catch (err) {
    console.error('Manifest import error:', err);
    res.status(500).json({ error: 'Failed to import manifest', details: err.message });
  }
});

app.get('/api/manifest/check/:isbn', (req, res) => {
  const rawIsbn = req.params.isbn;

  if (!manifestData.items || manifestData.items.length === 0) {
    return res.json({
      manifestActive: false,
      found: false,
      isProcessable: true
    });
  }

  const match = findManifestItem(rawIsbn);

  if (match) {
    return res.json({
      manifestActive: true,
      found: true,
      isProcessable: match.isProcessable,
      item: match,
      reason: match.reason || (!match.isProcessable ? 'Marked as Not Processable in Manifest' : '')
    });
  }

  return res.json({
    manifestActive: true,
    found: false,
    isProcessable: !config.enforceManifest, // if strict enforcement is on, missing = not processable
    reason: config.enforceManifest ? 'ISBN not found in imported manifest' : ''
  });
});

app.delete('/api/manifest/:id?', (req, res) => {
  const targetId = req.params.id || req.query.id;

  if (targetId) {
    if (Array.isArray(manifestData.items)) {
      manifestData.items = manifestData.items.filter(i => i.manifestId !== targetId);
    }
    if (Array.isArray(manifestData.manifests)) {
      manifestData.manifests = manifestData.manifests.filter(m => m.id !== targetId);
    }
    manifestData.totalCount = manifestData.items ? manifestData.items.length : 0;
    manifestData.processableCount = manifestData.items ? manifestData.items.filter(i => i.isProcessable).length : 0;
    manifestData.nonProcessableCount = manifestData.totalCount - manifestData.processableCount;
    manifestData.lastUpdated = new Date().toISOString();
    manifestData.filename = manifestData.manifests && manifestData.manifests.length > 0 
      ? manifestData.manifests[manifestData.manifests.length - 1]?.filename 
      : null;

    saveManifest();
    broadcastSession('MANIFEST_UPDATED', { manifestData });
    return res.json({ success: true, message: `Manifest '${targetId}' removed`, manifestData });
  }

  manifestData = {
    items: [],
    manifests: [],
    totalCount: 0,
    processableCount: 0,
    nonProcessableCount: 0,
    lastUpdated: null,
    filename: null
  };
  saveManifest();
  broadcastSession('MANIFEST_UPDATED', { manifestData });
  res.json({ success: true, message: 'All manifests cleared', manifestData });
});

// -------------------------------------------------------------
// System Endpoints
// -------------------------------------------------------------
// Health check endpoint for cloud monitoring, Render, and keep-alive services
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

app.get('/api/system/status', (req, res) => {
  let proofCount = 0;
  try {
    if (fs.existsSync(config.storagePath)) {
      const entries = fs.readdirSync(config.storagePath, { withFileTypes: true });
      proofCount = entries.filter(e => e.isDirectory()).length;
    }
  } catch (e) {}

  const ips = getNetworkIps();
  const primaryIp = ips[0]?.address || 'localhost';

  res.json({
    status: 'online',
    appName: 'Verification Images',
    hostname: os.hostname(),
    platform: process.platform,
    networkIps: getNetworkIps(),
    port: PORT,
    httpsPort: sslOptions ? HTTPS_PORT : null,
    mobileHttpsUrl: sslOptions ? `https://${primaryIp}:${HTTPS_PORT}` : `http://${primaryIp}:${PORT}`,
    mobileHttpUrl: `http://${primaryIp}:${PORT}`,
    storagePath: config.storagePath,
    totalCapturedJournals: proofCount,
    watermarkStation: config.watermarkStation || os.hostname(),
    peerSyncEnabled: Boolean(config.peerSyncEnabled),
    peerIp: config.peerIp || '',
    peerPort: config.peerPort || 3001,
    manifestItemCount: manifestData.totalCount || 0
  });
});

app.get('/api/system/config', (req, res) => {
  res.json(config);
});

app.post('/api/system/config', (req, res) => {
  const { 
    storagePath, 
    autoOpenExplorer, 
    soundEnabled, 
    imageQuality, 
    cameraResolution,
    watermarkEnabled,
    watermarkStation,
    blurCheckEnabled,
    peerSyncEnabled,
    peerIp,
    peerPort,
    enforceManifest
  } = req.body;
  
  if (storagePath && typeof storagePath === 'string') {
    try {
      fs.ensureDirSync(storagePath);
      config.storagePath = storagePath;
    } catch (err) {
      return res.status(400).json({ error: `Cannot access or create path: ${storagePath}` });
    }
  }

  if (autoOpenExplorer !== undefined) config.autoOpenExplorer = Boolean(autoOpenExplorer);
  if (soundEnabled !== undefined) config.soundEnabled = Boolean(soundEnabled);
  if (imageQuality !== undefined) config.imageQuality = Number(imageQuality);
  if (cameraResolution !== undefined) config.cameraResolution = cameraResolution;
  if (watermarkEnabled !== undefined) config.watermarkEnabled = Boolean(watermarkEnabled);
  if (watermarkStation !== undefined) config.watermarkStation = String(watermarkStation).trim();
  if (blurCheckEnabled !== undefined) config.blurCheckEnabled = Boolean(blurCheckEnabled);
  if (peerSyncEnabled !== undefined) config.peerSyncEnabled = Boolean(peerSyncEnabled);
  if (peerIp !== undefined) config.peerIp = String(peerIp).trim();
  if (peerPort !== undefined) config.peerPort = Number(peerPort);
  if (enforceManifest !== undefined) config.enforceManifest = Boolean(enforceManifest);
  if (req.body.s3Enabled !== undefined) config.s3Enabled = Boolean(req.body.s3Enabled);
  if (req.body.s3Bucket !== undefined) config.s3Bucket = String(req.body.s3Bucket).trim();
  if (req.body.s3Region !== undefined) config.s3Region = String(req.body.s3Region).trim();
  if (req.body.s3AccessKeyId !== undefined) config.s3AccessKeyId = String(req.body.s3AccessKeyId).trim();
  if (req.body.s3SecretAccessKey !== undefined && !req.body.s3SecretAccessKey.includes('••••')) {
    config.s3SecretAccessKey = String(req.body.s3SecretAccessKey).trim();
  }
  if (req.body.s3Prefix !== undefined) config.s3Prefix = String(req.body.s3Prefix).trim();
  if (req.body.s3CustomEndpoint !== undefined) config.s3CustomEndpoint = String(req.body.s3CustomEndpoint).trim();

  saveConfig();
  if (config.s3Enabled !== false && config.s3Bucket && config.s3AccessKeyId) {
    scanAllPendingJournalsForS3().catch(() => {});
  }
  res.json({ success: true, config });
});

// -------------------------------------------------------------
// AWS S3 Cloud Upload & Client Proof Sharing Endpoints
// -------------------------------------------------------------

// S3 Client factory helper
function getS3Client(customConfig = {}) {
  const region = (customConfig.s3Region || config.s3Region || 'us-east-1').trim();
  const accessKeyId = (customConfig.s3AccessKeyId || config.s3AccessKeyId || '').trim();
  const secretAccessKey = (customConfig.s3SecretAccessKey || config.s3SecretAccessKey || '').trim();
  const endpoint = (customConfig.s3CustomEndpoint || config.s3CustomEndpoint || '').trim();

  if (!accessKeyId || !secretAccessKey) {
    return null;
  }

  const clientOptions = {
    region,
    credentials: {
      accessKeyId,
      secretAccessKey
    }
  };

  if (endpoint) {
    clientOptions.endpoint = endpoint;
    clientOptions.forcePathStyle = true;
  }

  return new S3Client(clientOptions);
}

// S3 Test Connection
app.post('/api/s3/test-connection', async (req, res) => {
  try {
    const targetBucket = (req.body.s3Bucket || config.s3Bucket || '').trim();
    const targetRegion = (req.body.s3Region || config.s3Region || 'us-east-1').trim();
    const accessKeyId = (req.body.s3AccessKeyId || config.s3AccessKeyId || '').trim();
    const secretAccessKey = (req.body.s3SecretAccessKey || config.s3SecretAccessKey || '').trim();
    const customEndpoint = (req.body.s3CustomEndpoint || config.s3CustomEndpoint || '').trim();

    if (!accessKeyId || !secretAccessKey) {
      return res.status(400).json({ success: false, error: 'AWS Access Key ID and Secret Access Key are required' });
    }
    if (!targetBucket) {
      return res.status(400).json({ success: false, error: 'AWS S3 Bucket name is required' });
    }

    const s3 = getS3Client({
      s3Region: targetRegion,
      s3AccessKeyId: accessKeyId,
      s3SecretAccessKey: secretAccessKey,
      s3CustomEndpoint: customEndpoint
    });

    if (!s3) {
      return res.status(400).json({ success: false, error: 'Could not create S3 client with provided credentials' });
    }

    try {
      await s3.send(new HeadBucketCommand({ Bucket: targetBucket }));
    } catch (headErr) {
      await s3.send(new ListObjectsV2Command({ Bucket: targetBucket, MaxKeys: 1 }));
    }

    res.json({
      success: true,
      message: `Connected successfully to S3 Bucket '${targetBucket}' in region '${targetRegion}'`,
      bucket: targetBucket,
      region: targetRegion
    });
  } catch (err) {
    console.error('[S3] Connection test error:', err);
    res.status(400).json({
      success: false,
      error: `S3 Connection failed: ${err.message || 'Check Bucket Name, Region, and Access Keys'}`
    });
  }
});

// Core helper: Upload proof folder for a specific ISBN to S3 (Pictures ONLY, no metadata.json)
async function uploadIsbnToS3(cleanIsbn, customConfig = {}) {
  const folderPath = path.join(config.storagePath, cleanIsbn);
  if (!fs.existsSync(folderPath)) {
    throw new Error(`No local folder found for ISBN ${cleanIsbn}`);
  }

  const targetBucket = (customConfig.s3Bucket || config.s3Bucket || '').trim();
  const targetRegion = (customConfig.s3Region || config.s3Region || 'us-east-1').trim();
  let prefix = (customConfig.s3Prefix || config.s3Prefix || 'journal-proofs/').trim();
  if (prefix && !prefix.endsWith('/')) prefix += '/';

  const s3 = getS3Client({
    s3Region: targetRegion,
    s3AccessKeyId: customConfig.s3AccessKeyId || config.s3AccessKeyId,
    s3SecretAccessKey: customConfig.s3SecretAccessKey || config.s3SecretAccessKey,
    s3CustomEndpoint: customConfig.s3CustomEndpoint || config.s3CustomEndpoint
  });

  if (!s3 || !targetBucket) {
    throw new Error('S3 is not configured. Please enter your AWS Bucket and Access Keys in Settings.');
  }

  // Clean up any stray legacy metadata.json from photo folder
  const legacyMetaPath = path.join(folderPath, 'metadata.json');
  if (fs.existsSync(legacyMetaPath)) {
    try {
      const data = await fs.readJson(legacyMetaPath);
      await saveIsbnMetadata(cleanIsbn, data);
      await fs.remove(legacyMetaPath);
    } catch (e) {}
  }

  // Only upload valid photo image files (exclude json/zip/hidden files)
  const allFilesInFolder = await fs.readdir(folderPath);
  const imageFiles = allFilesInFolder.filter(filename => filename.match(/\.(jpg|jpeg|png)$/i));

  if (imageFiles.length === 0) {
    throw new Error(`Folder for ISBN ${cleanIsbn} contains no captured picture files.`);
  }

  const uploadedFiles = [];
  const s3BaseFolderKey = `${prefix}${cleanIsbn}`;

  for (const filename of imageFiles) {
    const filePath = path.join(folderPath, filename);
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) continue;

    const fileBuffer = await fs.readFile(filePath);
    const s3Key = `${s3BaseFolderKey}/${filename}`;

    let contentType = 'image/jpeg';
    if (filename.endsWith('.png')) contentType = 'image/png';

    await s3.send(new PutObjectCommand({
      Bucket: targetBucket,
      Key: s3Key,
      Body: fileBuffer,
      ContentType: contentType
    }));

    // Generate 7-day pre-signed download URL for client
    let presignedUrl = '';
    try {
      presignedUrl = await getSignedUrl(s3, new GetObjectCommand({
        Bucket: targetBucket,
        Key: s3Key
      }), { expiresIn: 604800 }); // 7 days
    } catch (e) {}

    const directUrl = `https://${targetBucket}.s3.${targetRegion}.amazonaws.com/${encodeURI(s3Key)}`;

    uploadedFiles.push({
      filename,
      s3Key,
      s3Url: directUrl,
      presignedUrl: presignedUrl || directUrl,
      sizeBytes: stat.size
    });
  }

  const s3FolderUri = `s3://${targetBucket}/${s3BaseFolderKey}/`;
  
  // Choose best shareable link
  const mainPhoto = uploadedFiles.find(f => f.filename.includes('front cover') || f.filename.includes('box') || f.filename.endsWith('.jpg'));
  const shareableLink = mainPhoto?.presignedUrl || `https://${targetBucket}.s3.${targetRegion}.amazonaws.com/${s3BaseFolderKey}/`;

  // Save S3 upload record into centralized .metadata/ directory
  let metadata = readIsbnMetadata(cleanIsbn) || {
    identifier: cleanIsbn,
    isbn: getBaseIsbn(cleanIsbn),
    shots: {}
  };
  metadata.s3Upload = {
    uploadedAt: new Date().toISOString(),
    bucket: targetBucket,
    region: targetRegion,
    s3FolderUri,
    shareableLink,
    fileCount: uploadedFiles.length
  };
  await saveIsbnMetadata(cleanIsbn, metadata);

  if (currentSession.activeIsbn === cleanIsbn && currentSession.metadata) {
    currentSession.metadata.s3Upload = metadata.s3Upload;
  }

  broadcastSession('S3_AUTO_UPLOADED', {
    isbn: cleanIsbn,
    s3Upload: metadata.s3Upload
  });

  console.log(`[S3 Auto-Upload] Successfully uploaded ${uploadedFiles.length} photo(s) for ${cleanIsbn} to ${s3FolderUri}`);

  return {
    success: true,
    isbn: cleanIsbn,
    bucket: targetBucket,
    region: targetRegion,
    prefix,
    s3FolderUri,
    shareableLink,
    uploadedAt: metadata.s3Upload.uploadedAt,
    files: uploadedFiles
  };
}

// -------------------------------------------------------------
// Background S3 Auto-Sync Queue & Periodic Scanner Engine
// -------------------------------------------------------------
let isSyncingS3 = false;
const s3SyncQueue = new Set();
let s3SyncProgress = {
  isSyncing: false,
  totalPending: 0,
  completedCount: 0,
  failedCount: 0,
  currentIsbn: null,
  lastSyncAt: null,
  lastError: null
};

function enqueueS3Upload(cleanIsbn) {
  if (!cleanIsbn || cleanIsbn.startsWith('.') || cleanIsbn.startsWith('_')) return;
  s3SyncQueue.add(cleanIsbn);
  processS3Queue().catch(err => console.error('[S3 Queue Error]', err));
}

async function processS3Queue() {
  if (isSyncingS3 || s3SyncQueue.size === 0) return;
  if (config.s3Enabled === false || !config.s3Bucket || !config.s3AccessKeyId || !config.s3SecretAccessKey) {
    return;
  }

  isSyncingS3 = true;
  s3SyncProgress.isSyncing = true;
  s3SyncProgress.totalPending = s3SyncQueue.size;

  try {
    while (s3SyncQueue.size > 0) {
      const nextIsbn = Array.from(s3SyncQueue)[0];
      s3SyncQueue.delete(nextIsbn);
      s3SyncProgress.currentIsbn = nextIsbn;

      try {
        await uploadIsbnToS3(nextIsbn);
        s3SyncProgress.completedCount++;
      } catch (err) {
        console.error(`[S3 Auto-Sync] Error uploading ${nextIsbn}:`, err.message);
        s3SyncProgress.failedCount++;
        s3SyncProgress.lastError = `${nextIsbn}: ${err.message}`;
      }
    }
  } finally {
    isSyncingS3 = false;
    s3SyncProgress.isSyncing = false;
    s3SyncProgress.currentIsbn = null;
    s3SyncProgress.lastSyncAt = new Date().toISOString();
  }
}

async function scanAllPendingJournalsForS3(forceAll = false) {
  try {
    if (config.s3Enabled === false || !config.s3Bucket || !config.s3AccessKeyId || !config.s3SecretAccessKey) {
      return { eligible: false, message: 'S3 credentials not configured' };
    }
    if (!fs.existsSync(config.storagePath)) {
      return { eligible: true, queued: 0 };
    }

    const entries = await fs.readdir(config.storagePath);
    let queuedCount = 0;

    for (const entry of entries) {
      if (entry.startsWith('.') || entry.startsWith('_')) continue;
      const folderPath = path.join(config.storagePath, entry);
      const stat = await fs.stat(folderPath).catch(() => null);
      if (!stat || !stat.isDirectory()) continue;

      const allFiles = await fs.readdir(folderPath).catch(() => []);
      const imageFiles = allFiles.filter(f => f.match(/\.(jpg|jpeg|png)$/i));
      if (imageFiles.length === 0) continue;

      // Clean up legacy metadata.json from photo folder
      const strayMeta = path.join(folderPath, 'metadata.json');
      if (fs.existsSync(strayMeta)) {
        try {
          const m = await fs.readJson(strayMeta);
          await saveIsbnMetadata(entry, m);
          await fs.remove(strayMeta);
        } catch (e) {}
      }

      const meta = readIsbnMetadata(entry);
      const hasUploaded = Boolean(meta?.s3Upload?.uploadedAt);
      const uploadedFileCount = meta?.s3Upload?.fileCount || 0;

      // Queue for auto-upload if never uploaded, if new photos were added, or if forced
      if (!hasUploaded || imageFiles.length > uploadedFileCount || forceAll) {
        s3SyncQueue.add(entry);
        queuedCount++;
      }
    }

    if (queuedCount > 0) {
      console.log(`[S3 Auto-Sync Daemon] Detected ${queuedCount} unuploaded journal(s). Automatically uploading in background...`);
      processS3Queue().catch(err => console.error('[S3 Queue Error]', err));
    }

    return { eligible: true, queued: queuedCount, totalQueueSize: s3SyncQueue.size };
  } catch (err) {
    console.error('[S3 Scanner Error]', err);
    return { eligible: false, error: err.message };
  }
}

// Endpoint: Trigger full scan & sync of all pending journals to S3
app.post('/api/s3/sync-all', async (req, res) => {
  try {
    const force = Boolean(req.body?.force);
    await migrateAllLegacyMetadata();
    const result = await scanAllPendingJournalsForS3(force);
    res.json({ success: true, ...result, progress: s3SyncProgress });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint: Get current S3 background auto-sync status
app.get('/api/s3/sync-status', (req, res) => {
  res.json({
    success: true,
    queueSize: s3SyncQueue.size,
    progress: s3SyncProgress,
    s3Configured: Boolean(config.s3Enabled !== false && config.s3Bucket && config.s3AccessKeyId)
  });
});

// Upload proof folder for a specific ISBN to S3
app.post('/api/s3/upload-isbn', async (req, res) => {
  try {
    const { isbn } = req.body;
    if (!isbn) {
      return res.status(400).json({ error: 'ISBN is required' });
    }

    const cleanIsbn = sanitizeIsbn(isbn);
    const result = await uploadIsbnToS3(cleanIsbn, req.body);
    res.json(result);
  } catch (err) {
    console.error('[S3] Upload error:', err);
    res.status(500).json({ error: `Failed to upload to S3: ${err.message}` });
  }
});

app.post('/api/system/open-folder', (req, res) => {
  const { isbn, targetPath } = req.body;
  let folderToOpen = targetPath || config.storagePath;

  if (isbn) {
    const cleanIsbn = sanitizeIsbn(isbn);
    const specificFolder = path.join(config.storagePath, cleanIsbn);
    if (fs.existsSync(specificFolder)) {
      folderToOpen = specificFolder;
    } else {
      folderToOpen = config.storagePath;
    }
  }

  if (!fs.existsSync(folderToOpen)) {
    fs.ensureDirSync(folderToOpen);
  }

  const normalizedPath = path.resolve(folderToOpen);

  if (process.platform === 'win32') {
    exec(`explorer.exe "${normalizedPath}"`, (err) => {
      if (err && err.code !== 1 && err.code !== 0) {
        console.warn('Explorer launch warning:', err.message);
      }
    });
    return res.json({ success: true, path: normalizedPath });
  } else if (process.platform === 'darwin') {
    exec(`open "${normalizedPath}"`, () => {});
    return res.json({ success: true, path: normalizedPath });
  } else {
    exec(`xdg-open "${normalizedPath}"`, () => {});
    return res.json({ success: true, path: normalizedPath });
  }
});

// -------------------------------------------------------------
// Metadata Automated Lookup
// -------------------------------------------------------------
app.get('/api/lookup/isbn/:isbn', async (req, res) => {
  try {
    const rawIsbn = req.params.isbn;
    const cleanIsbn = sanitizeIsbn(rawIsbn);
    const numericOnly = rawIsbn.replace(/[^0-9Xx]/g, '');

    if (!cleanIsbn) {
      return res.status(400).json({ error: 'ISBN is required' });
    }

    if (metadataCache.has(cleanIsbn)) {
      return res.json({ success: true, source: 'cache', data: metadataCache.get(cleanIsbn) });
    }

    let bookData = null;

    if (numericOnly.length >= 9) {
      try {
        const olUrl = `https://openlibrary.org/api/books?bibkeys=ISBN:${numericOnly}&format=json&jscmd=data`;
        const olRes = await fetch(olUrl, {
          headers: { 'User-Agent': 'VerificationImages/2.0' },
          signal: AbortSignal.timeout(3500)
        });
        if (olRes.ok) {
          const olJson = await olRes.json();
          const olKey = `ISBN:${numericOnly}`;
          if (olJson[olKey]) {
            const item = olJson[olKey];
            bookData = {
              title: item.title || '',
              subtitle: item.subtitle || '',
              authors: item.authors?.map(a => a.name).join(', ') || '',
              publisher: item.publishers?.map(p => p.name).join(', ') || '',
              publishDate: item.publish_date || '',
              publishYear: item.publish_date ? (item.publish_date.match(/\d{4}/)?.[0] || item.publish_date) : '',
              numberOfPages: item.number_of_pages || null,
              subjects: item.subjects?.slice(0, 4).map(s => s.name) || [],
              coverUrl: item.cover?.medium || item.cover?.small || null,
              source: 'OpenLibrary'
            };
          }
        }
      } catch (e) {}
    }

    if (!bookData && numericOnly.length >= 8) {
      try {
        const gbUrl = `https://www.googleapis.com/books/v1/volumes?q=isbn:${numericOnly}`;
        const gbRes = await fetch(gbUrl, {
          headers: { 'User-Agent': 'VerificationImages/2.0' },
          signal: AbortSignal.timeout(3500)
        });
        if (gbRes.ok) {
          const gbJson = await gbRes.json();
          if (gbJson.items && gbJson.items.length > 0) {
            const vol = gbJson.items[0].volumeInfo || {};
            bookData = {
              title: vol.title || '',
              subtitle: vol.subtitle || '',
              authors: vol.authors?.join(', ') || '',
              publisher: vol.publisher || '',
              publishDate: vol.publishedDate || '',
              publishYear: vol.publishedDate ? vol.publishedDate.substring(0, 4) : '',
              description: vol.description ? vol.description.substring(0, 180) + '...' : '',
              pageCount: vol.pageCount || null,
              categories: vol.categories || [],
              coverUrl: vol.imageLinks?.thumbnail || vol.imageLinks?.smallThumbnail || null,
              source: 'GoogleBooks'
            };
          }
        }
      } catch (e) {}
    }

    if (bookData) {
      metadataCache.set(cleanIsbn, bookData);
      return res.json({ success: true, found: true, data: bookData });
    }

    return res.json({ success: true, found: false, data: null });
  } catch (err) {
    console.error('Metadata lookup error:', err);
    res.json({ success: false, found: false, error: err.message });
  }
});

// -------------------------------------------------------------
// Capture & Storage Endpoints (7 Verification Shots)
// Box-Level Shared Storage & Inheritance Helpers
// -------------------------------------------------------------
function normalizeBoxString(boxNumber) {
  if (!boxNumber) return '';
  return String(boxNumber).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeLotString(lotNumber) {
  if (!lotNumber) return 'unassigned';
  return String(lotNumber).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getBoxKey(lotNumber, boxNumber) {
  if (!boxNumber) return null;
  const cleanLot = (lotNumber || 'Unassigned').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  const cleanBox = String(boxNumber).trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${cleanLot}__${cleanBox}`;
}

function dirHasBoxShots(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) return false;
  return isValidImageFile(path.join(dirPath, 'shot_1_box_a.jpg')) ||
         isValidImageFile(path.join(dirPath, 'shot_1_box.jpg')) ||
         isValidImageFile(path.join(dirPath, 'shot_2_box_b.jpg')) ||
         isValidImageFile(path.join(dirPath, 'shot_2_unbox.jpg')) ||
         Boolean(findShotFileInFolder(dirPath, 1, 'shot_1')) ||
         Boolean(findShotFileInFolder(dirPath, 2, 'shot_2'));
}

// Multi-tier resolver to locate the Box storage directory on disk across Lots and formats
function findBoxStorageDir(lotNumber, boxNumber) {
  if (!boxNumber) return null;
  const boxesBaseDir = path.join(config.storagePath, '_boxes');
  if (!fs.existsSync(boxesBaseDir)) return null;

  // 1. Direct match with exact key
  const directKey = getBoxKey(lotNumber, boxNumber);
  if (directKey) {
    const directPath = path.join(boxesBaseDir, directKey);
    if (fs.existsSync(directPath) && dirHasBoxShots(directPath)) {
      return directPath;
    }
  }

  // 2. Scan _boxes directory for matching folder that actively contains verified shots
  const normBox = normalizeBoxString(boxNumber);
  const normLot = normalizeLotString(lotNumber);

  try {
    const entries = fs.readdirSync(boxesBaseDir);

    // Look for matching lot + box
    for (const entry of entries) {
      const parts = entry.split('__');
      if (parts.length >= 2) {
        const entryLotNorm = normalizeLotString(parts[0]);
        const entryBoxNorm = normalizeBoxString(parts.slice(1).join('__'));
        if (entryBoxNorm === normBox && (entryLotNorm === normLot || normLot === 'unassigned' || entryLotNorm === 'unassigned')) {
          const candidate = path.join(boxesBaseDir, entry);
          if (dirHasBoxShots(candidate)) return candidate;
        }
      }
    }

    // Look for matching box number alone across any lot in _boxes ONLY IF it has shots
    for (const entry of entries) {
      const parts = entry.split('__');
      const entryBoxNorm = normalizeBoxString(parts.length >= 2 ? parts.slice(1).join('__') : entry);
      if (entryBoxNorm === normBox) {
        const candidate = path.join(boxesBaseDir, entry);
        if (dirHasBoxShots(candidate)) return candidate;
      }
    }
  } catch (err) {
    console.warn('[Box Storage] Error searching _boxes directory:', err.message);
  }

  return null;
}

function getBoxStorageDir(lotNumber, boxNumber) {
  const found = findBoxStorageDir(lotNumber, boxNumber);
  if (found) return found;
  const key = getBoxKey(lotNumber, boxNumber);
  if (!key) return null;
  return path.join(config.storagePath, '_boxes', key);
}

function getBoxShots(lotNumber, boxNumber) {
  const boxDir = findBoxStorageDir(lotNumber, boxNumber);
  if (!boxDir || !fs.existsSync(boxDir)) {
    return { hasBoxShot: false, hasUnboxShot: false, hasBoxAShot: false, hasBoxBShot: false, boxShotUrl: null, unboxShotUrl: null, boxMeta: null };
  }

  const shot1File = isValidImageFile(path.join(boxDir, 'shot_1_box_a.jpg')) ? 'shot_1_box_a.jpg' :
                    isValidImageFile(path.join(boxDir, 'shot_1_box.jpg')) ? 'shot_1_box.jpg' :
                    findShotFileInFolder(boxDir, 1, 'shot_1');
  const shot2File = isValidImageFile(path.join(boxDir, 'shot_2_box_b.jpg')) ? 'shot_2_box_b.jpg' :
                    isValidImageFile(path.join(boxDir, 'shot_2_unbox.jpg')) ? 'shot_2_unbox.jpg' :
                    findShotFileInFolder(boxDir, 2, 'shot_2');

  const hasBoxShot = Boolean(shot1File);
  const hasUnboxShot = Boolean(shot2File);

  let boxMeta = null;
  try {
    const metaFile = path.join(boxDir, 'box_meta.json');
    if (fs.existsSync(metaFile)) boxMeta = fs.readJsonSync(metaFile);
  } catch (e) {}

  const key = path.basename(boxDir);
  return {
    hasBoxShot,
    hasBoxAShot: hasBoxShot,
    hasUnboxShot,
    hasBoxBShot: hasUnboxShot,
    boxShotUrl: hasBoxShot ? `/proofs/_boxes/${encodeURIComponent(key)}/${encodeURIComponent(shot1File)}` : null,
    unboxShotUrl: hasUnboxShot ? `/proofs/_boxes/${encodeURIComponent(key)}/${encodeURIComponent(shot2File)}` : null,
    boxMeta
  };
}

async function saveBoxShotToFile(lotNumber, boxNumber, shotNumber, buffer, blurScore) {
  if (!buffer || buffer.length < 100) return null;
  const key = getBoxKey(lotNumber, boxNumber);
  if (!key) return null;
  const boxDir = path.join(config.storagePath, '_boxes', key);
  fs.ensureDirSync(boxDir);

  const filename = shotNumber === 1 ? 'shot_1_box_a.jpg' : 'shot_2_box_b.jpg';
  const filePath = path.join(boxDir, filename);
  await fs.writeFile(filePath, buffer);

  const metaPath = path.join(boxDir, 'box_meta.json');
  let meta = {
    lotNumber: lotNumber || 'Unassigned',
    boxNumber: boxNumber || '',
    updatedAt: new Date().toISOString(),
    shots: {}
  };
  if (fs.existsSync(metaPath)) {
    try { meta = fs.readJsonSync(metaPath); } catch (e) {}
  }
  meta.updatedAt = new Date().toISOString();
  meta.shots = meta.shots || {};
  meta.shots[shotNumber] = {
    filename,
    savedAt: new Date().toISOString(),
    type: SHOT_DEFINITIONS[shotNumber]?.type || (shotNumber === 1 ? 'Box A' : 'Box B'),
    blurScore: blurScore || null
  };
  await fs.writeJson(metaPath, meta, { spaces: 2 });

  return filename;
}

// Automatically inherit Shot 1 & 2 into an ISBN folder if captured for that box
async function applyBoxShotsToIsbn(cleanIsbn, lotNumber, boxNumber, folderPath) {
  // If boxNumber is missing, attempt to resolve from manifest
  if (!boxNumber && manifestData.items) {
    const numericOnly = cleanIsbn.replace(/[^0-9Xx]/g, '');
    const match = manifestData.items.find(i => {
      const itemNum = i.isbn.replace(/[^0-9Xx]/g, '');
      return sanitizeIsbn(i.isbn) === cleanIsbn || (numericOnly && itemNum === numericOnly);
    });
    if (match && match.boxNumber) {
      boxNumber = match.boxNumber;
      if (!lotNumber || lotNumber === 'Unassigned') lotNumber = match.lotNumber;
    }
  }

  if (!boxNumber || !folderPath) return { inherited1: false, inherited2: false };

  let boxDir = findBoxStorageDir(lotNumber, boxNumber);

  // Fallback 1: If no boxDir with shots in _boxes/, check sibling journals in config.storagePath
  if (!boxDir || !dirHasBoxShots(boxDir)) {
    try {
      const normBox = normalizeBoxString(boxNumber);
      if (fs.existsSync(config.storagePath)) {
        const allDirs = fs.readdirSync(config.storagePath);
        for (const dirName of allDirs) {
          if (dirName.startsWith('.') || dirName === '_boxes' || dirName === cleanIsbn) continue;
          const candidateFolder = path.join(config.storagePath, dirName);
          const m = readIsbnMetadata(dirName);
          let candidateBox = m?.boxNumber;
          if (!candidateBox && manifestData.items) {
            const mItem = manifestData.items.find(i => sanitizeIsbn(i.isbn) === dirName);
            if (mItem) candidateBox = mItem.boxNumber;
          }
          if (candidateBox && normalizeBoxString(candidateBox) === normBox) {
            const shot1File = findShotFileInFolder(candidateFolder, 1, dirName);
            const shot2File = findShotFileInFolder(candidateFolder, 2, dirName);
            if (shot1File || shot2File) {
              const fallbackBoxDir = path.join(config.storagePath, '_boxes', getBoxKey(m?.lotNumber || lotNumber, boxNumber));
              fs.ensureDirSync(fallbackBoxDir);
              if (shot1File && isValidImageFile(path.join(candidateFolder, shot1File)) && !isValidImageFile(path.join(fallbackBoxDir, 'shot_1_box_a.jpg')) && !isValidImageFile(path.join(fallbackBoxDir, 'shot_1_box.jpg'))) {
                fs.copySync(path.join(candidateFolder, shot1File), path.join(fallbackBoxDir, 'shot_1_box_a.jpg'));
              }
              if (shot2File && isValidImageFile(path.join(candidateFolder, shot2File)) && !isValidImageFile(path.join(fallbackBoxDir, 'shot_2_box_b.jpg')) && !isValidImageFile(path.join(fallbackBoxDir, 'shot_2_unbox.jpg'))) {
                fs.copySync(path.join(candidateFolder, shot2File), path.join(fallbackBoxDir, 'shot_2_box_b.jpg'));
              }
              if (dirHasBoxShots(fallbackBoxDir)) {
                boxDir = fallbackBoxDir;
                break;
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn('[applyBoxShotsToIsbn] Fallback book scan error:', err.message);
    }
  }

  // Fallback 2: If still missing shots, try pulling from peer PC over LAN (always attempt if peerIp is set)
  if ((!boxDir || !dirHasBoxShots(boxDir)) && config.peerIp) {
    try {
      const peerBoxKey = getBoxKey(lotNumber, boxNumber);
      if (peerBoxKey) {
        const destBoxDir = boxDir || path.join(config.storagePath, '_boxes', peerBoxKey);
        // Try shot_1_box_a.jpg then shot_1_box.jpg
        let p1Res = await fetch(`http://${config.peerIp}:${config.peerPort || 3001}/proofs/_boxes/${encodeURIComponent(peerBoxKey)}/shot_1_box_a.jpg`, { signal: AbortSignal.timeout(2500) }).catch(() => null);
        if (!p1Res || !p1Res.ok) {
          p1Res = await fetch(`http://${config.peerIp}:${config.peerPort || 3001}/proofs/_boxes/${encodeURIComponent(peerBoxKey)}/shot_1_box.jpg`, { signal: AbortSignal.timeout(2500) }).catch(() => null);
        }
        if (p1Res && p1Res.ok) {
          const buf1 = Buffer.from(await p1Res.arrayBuffer());
          if (buf1.length > 1024) {
            fs.ensureDirSync(destBoxDir);
            await fs.writeFile(path.join(destBoxDir, 'shot_1_box_a.jpg'), buf1);
            boxDir = destBoxDir;
          }
        }

        // Try shot_2_box_b.jpg then shot_2_unbox.jpg
        let p2Res = await fetch(`http://${config.peerIp}:${config.peerPort || 3001}/proofs/_boxes/${encodeURIComponent(peerBoxKey)}/shot_2_box_b.jpg`, { signal: AbortSignal.timeout(2500) }).catch(() => null);
        if (!p2Res || !p2Res.ok) {
          p2Res = await fetch(`http://${config.peerIp}:${config.peerPort || 3001}/proofs/_boxes/${encodeURIComponent(peerBoxKey)}/shot_2_unbox.jpg`, { signal: AbortSignal.timeout(2500) }).catch(() => null);
        }
        if (p2Res && p2Res.ok) {
          const buf2 = Buffer.from(await p2Res.arrayBuffer());
          if (buf2.length > 1024) {
            fs.ensureDirSync(destBoxDir);
            await fs.writeFile(path.join(destBoxDir, 'shot_2_box_b.jpg'), buf2);
            boxDir = destBoxDir;
          }
        }
      }
    } catch (peerErr) {}
  }

  if (!boxDir || !fs.existsSync(boxDir)) return { inherited1: false, inherited2: false };

  let inherited1 = false;
  let inherited2 = false;

  const targetShot1 = getShotFilename(1, cleanIsbn);
  const targetShot2 = getShotFilename(2, cleanIsbn);
  const targetPath1 = path.join(folderPath, targetShot1);
  const targetPath2 = path.join(folderPath, targetShot2);

  const sourceFile1 = isValidImageFile(path.join(boxDir, 'shot_1_box_a.jpg')) ? 'shot_1_box_a.jpg' :
                      isValidImageFile(path.join(boxDir, 'shot_1_box.jpg')) ? 'shot_1_box.jpg' :
                      findShotFileInFolder(boxDir, 1, 'shot_1');
  const sourceFile2 = isValidImageFile(path.join(boxDir, 'shot_2_box_b.jpg')) ? 'shot_2_box_b.jpg' :
                      isValidImageFile(path.join(boxDir, 'shot_2_unbox.jpg')) ? 'shot_2_unbox.jpg' :
                      findShotFileInFolder(boxDir, 2, 'shot_2');

  const sourcePath1 = sourceFile1 ? path.join(boxDir, sourceFile1) : null;
  const sourcePath2 = sourceFile2 ? path.join(boxDir, sourceFile2) : null;

  if (sourcePath1 && isValidImageFile(sourcePath1) && (!isValidImageFile(targetPath1) || fs.statSync(targetPath1).size < 1024)) {
    try {
      fs.ensureDirSync(folderPath);
      fs.copySync(sourcePath1, targetPath1);
      inherited1 = true;
    } catch (e) {
      console.warn('[applyBoxShotsToIsbn] Error copying Shot 1:', e.message);
    }
  } else if (isValidImageFile(targetPath1)) {
    inherited1 = true;
  }

  if (sourcePath2 && isValidImageFile(sourcePath2) && (!isValidImageFile(targetPath2) || fs.statSync(targetPath2).size < 1024)) {
    try {
      fs.ensureDirSync(folderPath);
      fs.copySync(sourcePath2, targetPath2);
      inherited2 = true;
    } catch (e) {
      console.warn('[applyBoxShotsToIsbn] Error copying Shot 2:', e.message);
    }
  } else if (isValidImageFile(targetPath2)) {
    inherited2 = true;
  }

  if (inherited1 || inherited2) {
    let metadata = readIsbnMetadata(cleanIsbn) || {
      identifier: cleanIsbn,
      isbn: getBaseIsbn(cleanIsbn),
      lotNumber: lotNumber || 'Unassigned',
      boxNumber: boxNumber || '',
      updatedAt: new Date().toISOString(),
      shots: {}
    };
    metadata.shots = metadata.shots || {};
    if (inherited1) {
      metadata.shots[1] = {
        filename: targetShot1,
        savedAt: new Date().toISOString(),
        type: SHOT_DEFINITIONS[1].type,
        scope: SHOT_DEFINITIONS[1].scope,
        inheritedFromBox: true
      };
    }
    if (inherited2) {
      metadata.shots[2] = {
        filename: targetShot2,
        savedAt: new Date().toISOString(),
        type: SHOT_DEFINITIONS[2].type,
        scope: SHOT_DEFINITIONS[2].scope,
        inheritedFromBox: true
      };
    }
    metadata.updatedAt = new Date().toISOString();
    await saveIsbnMetadata(cleanIsbn, metadata);
  }

  return { inherited1, inherited2 };
}

async function findExistingCopies(baseIsbn) {
  if (!fs.existsSync(config.storagePath)) return [];

  const entries = await fs.readdir(config.storagePath, { withFileTypes: true });
  const matchingDirs = entries
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .filter(name => name === baseIsbn || name.startsWith(`${baseIsbn}_Copy`));

  const copies = [];
  for (const name of matchingDirs) {
    const folderPath = path.join(config.storagePath, name);
    let shotsCount = 0;
    for (let s = 1; s <= 7; s++) {
      const foundFile = findShotFileInFolder(folderPath, s, name);
      if (foundFile) shotsCount++;
    }

    const meta = readIsbnMetadata(name);
    const copyMatch = name.match(/_Copy(\d+)$/i);
    const copyNumber = copyMatch ? parseInt(copyMatch[1], 10) : 1;

    copies.push({
      identifier: name,
      copyNumber,
      shotsCount,
      isComplete: shotsCount >= 7,
      metadata: meta
    });
  }

  copies.sort((a, b) => a.copyNumber - b.copyNumber);
  return copies;
}

// Initialize ISBN verification session
app.post('/api/capture/init-isbn', async (req, res) => {
  try {
    const { isbn, forceNewCopy, targetIdentifier, lotNumber, boxNumber } = req.body;
    if (!isbn || !isbn.trim()) {
      return res.status(400).json({ error: 'ISBN is required' });
    }

    const cleanBaseIsbn = sanitizeIsbn(isbn);
    const baseIsbnOnly = getBaseIsbn(cleanBaseIsbn);

    // Universal manifest matching
    const manifestMatch = findManifestItem(cleanBaseIsbn) || findManifestItem(isbn) || findManifestItem(baseIsbnOnly);
    let isProcessable = true;
    let nonProcessableReason = '';

    if (manifestMatch) {
      isProcessable = manifestMatch.isProcessable;
      if (!isProcessable) {
        nonProcessableReason = manifestMatch.reason || 'Journal is marked as Not Processable in the imported manifest.';
      }
    } else if (config.enforceManifest && manifestData.items && manifestData.items.length > 0) {
      isProcessable = false;
      nonProcessableReason = 'ISBN is not listed in the imported manifest (Strict Mode Active).';
    }

    const existingCopies = await findExistingCopies(baseIsbnOnly);

    let activeIdentifier = cleanBaseIsbn;
    let copyNumber = 1;

    if (forceNewCopy) {
      const maxCopy = existingCopies.reduce((max, c) => Math.max(max, c.copyNumber), 0);
      const nextCopyNum = Math.max(maxCopy + 1, 2);
      activeIdentifier = `${baseIsbnOnly}_Copy${nextCopyNum}`;
      copyNumber = nextCopyNum;
    } else if (targetIdentifier) {
      activeIdentifier = sanitizeIsbn(targetIdentifier);
      const match = activeIdentifier.match(/_Copy(\d+)$/i);
      copyNumber = match ? parseInt(match[1], 10) : 1;
    }

    await cleanupEmptyProofFolders();

    const folderPath = path.join(config.storagePath, activeIdentifier);
    const initialLot = manifestMatch?.lotNumber || lotNumber || currentSession.lotNumber || 'Lot-1';
    const initialBox = manifestMatch?.boxNumber || boxNumber || currentSession.boxNumber || '';

    // Automatically inherit Shot 1 (Box) & Shot 2 (Unbox) if captured for this Box (e.g. by PC 1)
    await applyBoxShotsToIsbn(activeIdentifier, initialLot, initialBox, folderPath);

    const alreadyExists = fs.existsSync(folderPath);

    const existingShots = {};
    let shotsFoundCount = 0;

    for (let s = 1; s <= 7; s++) {
      const foundFile = findShotFileInFolder(folderPath, s, activeIdentifier);
      if (alreadyExists && foundFile) {
        existingShots[s] = foundFile;
        shotsFoundCount++;
      }
    }

    const resolvedLot = (lotNumber && lotNumber !== 'Unassigned' && lotNumber !== 'Unassigned Lot' && lotNumber !== 'Lot-1')
      ? lotNumber
      : (manifestMatch?.lotNumber || metadata?.lotNumber || currentSession.lotNumber || lotNumber || 'Unassigned Lot');

    const resolvedBox = (boxNumber && boxNumber !== 'Unassigned' && boxNumber !== 'Unassigned Box')
      ? boxNumber
      : (manifestMatch?.boxNumber || metadata?.boxNumber || currentSession.boxNumber || boxNumber || '');

    const boxShots = getBoxShots(resolvedLot, resolvedBox);

    // Fallback: If Shot 1 or Shot 2 were not yet in book folder, but box has them in _boxes/
    if (!existingShots[1] && boxShots.hasBoxShot) {
      existingShots[1] = 'shot_1_box_a.jpg';
      shotsFoundCount++;
    }
    if (!existingShots[2] && boxShots.hasUnboxShot) {
      existingShots[2] = 'shot_2_box_b.jpg';
      shotsFoundCount++;
    }

    let metadata = alreadyExists ? readIsbnMetadata(activeIdentifier) : null;

    // Determine initial capture step (first missing shot)
    let initialStep = 'CAPTURE_SHOT_1';
    for (let s = 1; s <= 7; s++) {
      if (!existingShots[s]) {
        initialStep = `CAPTURE_SHOT_${s}`;
        break;
      }
    }
    if (shotsFoundCount >= 7) {
      initialStep = 'COMPLETE';
    }

    const shotsState = {};
    for (let s = 1; s <= 7; s++) {
      if (existingShots[s]) {
        const isBoxFallback = existingShots[s].startsWith('shot_') && !alreadyExists;
        shotsState[s] = {
          filename: existingShots[s],
          savedAt: metadata?.shots?.[s]?.savedAt || new Date().toISOString(),
          type: SHOT_DEFINITIONS[s].type,
          scope: SHOT_DEFINITIONS[s].scope,
          previewDataUrl: isBoxFallback && s === 1 && boxShots.boxShotUrl ? boxShots.boxShotUrl :
                          isBoxFallback && s === 2 && boxShots.unboxShotUrl ? boxShots.unboxShotUrl :
                          `/proofs/${encodeURIComponent(activeIdentifier)}/${encodeURIComponent(existingShots[s])}`,
          blurScore: metadata?.shots?.[s]?.blurScore
        };
      } else {
        shotsState[s] = null;
      }
    }

    currentSession = {
      activeIsbn: activeIdentifier,
      baseIsbn: baseIsbnOnly,
      lotNumber: resolvedLot,
      boxNumber: resolvedBox,
      currentStep: initialStep,
      shots: shotsState,
      metadata,
      bookDetails: metadata?.bookDetails || (manifestMatch?.title ? { 
        title: manifestMatch.title, 
        authors: manifestMatch.author || '',
        publisher: manifestMatch.publisher || '',
        publishYear: manifestMatch.publicationYear || '',
        printIssn: manifestMatch.printIssn || '',
        volume: manifestMatch.volume || '',
        issues: manifestMatch.issues || '',
        source: 'Manifest'
      } : null),
      copyNumber,
      isProcessable
    };

    broadcastSession('ISBN_INITIALIZED', {
      isbn: activeIdentifier,
      baseIsbn: baseIsbnOnly,
      lotNumber: resolvedLot,
      boxNumber: resolvedBox,
      currentStep: initialStep,
      copyNumber,
      isProcessable,
      nonProcessableReason,
      manifestMatch,
      boxShots
    });

    res.json({
      success: true,
      isbn: activeIdentifier,
      baseIsbn: baseIsbnOnly,
      lotNumber: resolvedLot,
      boxNumber: resolvedBox,
      currentStep: initialStep,
      copyNumber,
      folderPath,
      exists: alreadyExists,
      shotsCount: shotsFoundCount,
      existingShots,
      boxShots,
      metadata,
      bookDetails: currentSession.bookDetails,
      isProcessable,
      nonProcessableReason,
      manifestMatch
    });
  } catch (err) {
    console.error('Error initializing ISBN folder:', err);
    res.status(500).json({ error: 'Failed to initialize ISBN folder', details: err.message });
  }
});

// Save a captured shot (1 through 7)
app.post('/api/capture/save-shot', async (req, res) => {
  try {
    const { 
      isbn, 
      shotNumber, 
      imageBase64, 
      operatorName, 
      bookDetails,
      lotNumber,
      boxNumber,
      blurScore
    } = req.body;

    if (!isbn || !shotNumber || !imageBase64) {
      return res.status(400).json({ error: 'Missing required parameters (isbn, shotNumber, imageBase64)' });
    }

    const sNum = parseInt(shotNumber, 10);
    if (sNum < 1 || sNum > 7) {
      return res.status(400).json({ error: 'Shot number must be between 1 and 7' });
    }

    const cleanIsbn = sanitizeIsbn(isbn);
    const baseIsbnOnly = getBaseIsbn(cleanIsbn);
    const copyNumber = getCopyNumber(cleanIsbn);
    const folderPath = path.join(config.storagePath, cleanIsbn);
    await fs.ensureDir(folderPath);

    const shotDef = SHOT_DEFINITIONS[sNum];
    const filename = getShotFilename(sNum, cleanIsbn);
    const filePath = path.join(folderPath, filename);

    // Save image buffer to disk
    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
    await fs.writeFile(filePath, buffer);

    // Universal manifest lookup for lot & box
    const manifestMatchForShot = findManifestItem(baseIsbnOnly) || findManifestItem(cleanIsbn) || findManifestItem(isbn);
    const resolvedLot = (lotNumber && lotNumber !== 'Unassigned' && lotNumber !== 'Unassigned Lot' && lotNumber !== 'Lot-1')
      ? lotNumber
      : (manifestMatchForShot?.lotNumber || currentSession.lotNumber || lotNumber || 'Unassigned Lot');

    const resolvedBox = (boxNumber && boxNumber !== 'Unassigned' && boxNumber !== 'Unassigned Box')
      ? boxNumber
      : (manifestMatchForShot?.boxNumber || currentSession.boxNumber || boxNumber || '');

    let metadata = readIsbnMetadata(cleanIsbn) || {
      identifier: cleanIsbn,
      isbn: baseIsbnOnly,
      copyNumber,
      lotNumber: resolvedLot,
      boxNumber: resolvedBox,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      operator: operatorName || 'Inventory Operator',
      station: config.watermarkStation || os.hostname(),
      bookDetails: bookDetails || null,
      shots: {}
    };

    metadata.lotNumber = resolvedLot;
    metadata.boxNumber = resolvedBox;
    metadata.updatedAt = new Date().toISOString();
    if (bookDetails) {
      metadata.bookDetails = { ...(metadata.bookDetails || {}), ...bookDetails };
    }

    metadata.shots = metadata.shots || {};
    metadata.shots[sNum] = {
      filename,
      sizeBytes: buffer.length,
      savedAt: new Date().toISOString(),
      type: shotDef.type,
      scope: shotDef.scope,
      blurScore: blurScore !== undefined ? blurScore : null
    };

    const totalShots = Object.keys(metadata.shots).length;
    metadata.isComplete = totalShots >= 7;

    await saveIsbnMetadata(cleanIsbn, metadata);

    const newShotInfo = {
      filename,
      savedAt: new Date().toISOString(),
      type: shotDef.type,
      scope: shotDef.scope,
      previewDataUrl: imageBase64,
      blurScore
    };

    currentSession.shots[sNum] = newShotInfo;
    currentSession.metadata = metadata;
    if (bookDetails) currentSession.bookDetails = bookDetails;

    // Calculate next step
    let nextStep = 'COMPLETE';
    for (let s = 1; s <= 7; s++) {
      if (!currentSession.shots[s]) {
        nextStep = `CAPTURE_SHOT_${s}`;
        break;
      }
    }
    currentSession.currentStep = nextStep;

    const boxShotsData = (resolvedBox) ? getBoxShots(resolvedLot, resolvedBox) : null;

    broadcastSession('SHOT_SAVED', {
      isbn: cleanIsbn,
      shotNumber: sNum,
      shotInfo: newShotInfo,
      isComplete: totalShots >= 7,
      currentStep: nextStep,
      session: currentSession,
      lotNumber: resolvedLot,
      boxNumber: resolvedBox,
      boxShots: boxShotsData
    });

    if (sNum === 1 || sNum === 2) {
      broadcastSession('BOX_SHOT_SAVED', {
        lotNumber: resolvedLot,
        boxNumber: resolvedBox,
        shotNumber: sNum,
        boxShots: boxShotsData,
        session: currentSession
      });
    }

    if (config.autoOpenExplorer && totalShots >= 7) {
      if (process.platform === 'win32') {
        exec(`explorer.exe "${path.resolve(folderPath)}"`, () => {});
      }
    }

    // Automatic S3 Upload upon completion:
    // - All 7 shots completed (Full station), OR
    // - Shots 3-7 completed (Book-level station), OR
    // - Shots 1, 2, and 4 completed (Box + Spine station)
    const isBoxSpineComplete = Boolean(
      metadata.shots[1] && 
      metadata.shots[2] && 
      metadata.shots[4]
    );
    const isBookComplete = Boolean(
      metadata.shots[3] && 
      metadata.shots[4] && 
      metadata.shots[5] && 
      metadata.shots[6] && 
      metadata.shots[7]
    );
    const isReadyForS3 = (totalShots >= 7) || isBookComplete || isBoxSpineComplete;

    if (isReadyForS3 && config.s3Enabled !== false && config.s3Bucket && config.s3AccessKeyId) {
      console.log(`[S3 Auto-Upload] Verification capture complete for ${cleanIsbn} (${totalShots} shots saved). Enqueuing background upload...`);
      enqueueS3Upload(cleanIsbn);
    }

    // If Shot 1 (Box) or Shot 2 (Unbox), save to box-level storage and replicate to peer PC
    if (sNum === 1 || sNum === 2) {
      if (resolvedBox) {
        await saveBoxShotToFile(resolvedLot, resolvedBox, sNum, buffer, blurScore);

        if (!req.body.isReplication && config.peerSyncEnabled && config.peerIp) {
          replicateBoxShotToPeer({
            lotNumber: resolvedLot,
            boxNumber: resolvedBox,
            shotNumber: sNum,
            imageBase64,
            blurScore
          });
        }

        // Propagate to any other books in this box that are already scanned or in manifest
        if (manifestData.items && manifestData.items.length > 0) {
          const normResolvedBox = normalizeBoxString(resolvedBox);
          const matchingItems = manifestData.items.filter(i => 
            normalizeBoxString(i.boxNumber) === normResolvedBox
          );
          for (const item of matchingItems) {
            const itemClean = sanitizeIsbn(item.isbn);
            const itemFolder = path.join(config.storagePath, itemClean);
            if (fs.existsSync(itemFolder) && itemClean !== cleanIsbn) {
              await applyBoxShotsToIsbn(itemClean, resolvedLot, resolvedBox, itemFolder);
            }
          }
        }
      }
    }

    res.json({
      success: true,
      isbn: cleanIsbn,
      shotNumber: sNum,
      filename,
      filePath,
      relativeUrl: `/proofs/${encodeURIComponent(cleanIsbn)}/${filename}`,
      totalShotsSaved: totalShots,
      isComplete: totalShots >= 7,
      currentStep: nextStep,
      metadata
    });
  } catch (err) {
    console.error('Error saving shot:', err);
    res.status(500).json({ error: 'Failed to save photo to disk', details: err.message });
  }
});

// Get all Boxes from manifest with Box & Unbox status and completion stats
app.get('/api/boxes/list', async (req, res) => {
  try {
    const boxesMap = new Map();

    if (manifestData.items && manifestData.items.length > 0) {
      for (const item of manifestData.items) {
        const lot = item.lotNumber || 'Unassigned';
        const box = item.boxNumber || 'Unassigned';
        const key = getBoxKey(lot, box);
        if (!key) continue;

        if (!boxesMap.has(key)) {
          const boxShots = getBoxShots(lot, box);
          boxesMap.set(key, {
            lotNumber: lot,
            boxNumber: box,
            boxKey: key,
            totalBooks: 0,
            completedBooks: 0,
            hasBoxShot: boxShots.hasBoxShot,
            hasUnboxShot: boxShots.hasUnboxShot,
            boxShotUrl: boxShots.boxShotUrl,
            unboxShotUrl: boxShots.unboxShotUrl,
            sampleIsbn: item.isbn,
            items: []
          });
        }

        const b = boxesMap.get(key);
        b.totalBooks++;
        b.items.push(item);
      }
    }

    const boxes = Array.from(boxesMap.values());

    // Calculate completed books for each box
    for (const b of boxes) {
      let completed = 0;
      for (const item of b.items) {
        const clean = sanitizeIsbn(item.isbn);
        const itemDir = path.join(config.storagePath, clean);
        if (fs.existsSync(itemDir)) {
          let shotsCount = 0;
          for (let s = 1; s <= 7; s++) {
            if (findShotFileInFolder(itemDir, s, clean)) shotsCount++;
          }
          if (shotsCount >= 7) completed++;
        }
      }
      b.completedBooks = completed;
    }

    res.json({ success: true, totalBoxes: boxes.length, boxes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Initialize a Box session (PC 1: Receiving / Box Level)
app.post('/api/capture/init-box', async (req, res) => {
  try {
    const { lotNumber, boxNumber } = req.body;
    if (!boxNumber) {
      return res.status(400).json({ error: 'Box number is required' });
    }

    const resolvedLot = lotNumber || 'Unassigned';
    const boxShots = getBoxShots(resolvedLot, boxNumber);
    const boxBooks = (manifestData.items || []).filter(item => 
      (item.lotNumber || 'Unassigned').toLowerCase() === (resolvedLot || 'Unassigned').toLowerCase() &&
      (item.boxNumber || '').toLowerCase() === String(boxNumber).toLowerCase()
    );

    const sampleIsbn = boxBooks.length > 0 ? boxBooks[0].isbn : `BOX_${sanitizeIsbn(boxNumber)}`;

    const shotsState = {
      1: boxShots.hasBoxShot ? {
        filename: 'shot_1_box_a.jpg',
        savedAt: boxShots.boxMeta?.shots?.[1]?.savedAt || new Date().toISOString(),
        type: SHOT_DEFINITIONS[1].type,
        scope: SHOT_DEFINITIONS[1].scope,
        previewDataUrl: boxShots.boxShotUrl
      } : null,
      2: boxShots.hasUnboxShot ? {
        filename: 'shot_2_box_b.jpg',
        savedAt: boxShots.boxMeta?.shots?.[2]?.savedAt || new Date().toISOString(),
        type: SHOT_DEFINITIONS[2].type,
        scope: SHOT_DEFINITIONS[2].scope,
        previewDataUrl: boxShots.unboxShotUrl
      } : null,
      3: null, 4: null, 5: null, 6: null, 7: null
    };

    let initialStep = 'CAPTURE_SHOT_1';
    if (boxShots.hasBoxShot && !boxShots.hasUnboxShot) {
      initialStep = 'CAPTURE_SHOT_2';
    } else if (boxShots.hasBoxShot && boxShots.hasUnboxShot) {
      initialStep = 'CAPTURE_SHOT_3';
    }

    const boxSummary = {
      lotNumber: resolvedLot,
      boxNumber: String(boxNumber),
      totalBooks: boxBooks.length,
      hasBoxShot: boxShots.hasBoxShot,
      hasUnboxShot: boxShots.hasUnboxShot,
      boxShotUrl: boxShots.boxShotUrl,
      unboxShotUrl: boxShots.unboxShotUrl,
      books: boxBooks
    };

    currentSession = {
      activeIsbn: sampleIsbn,
      baseIsbn: sampleIsbn,
      lotNumber: resolvedLot,
      boxNumber: String(boxNumber),
      currentStep: initialStep,
      shots: shotsState,
      metadata: {
        lotNumber: resolvedLot,
        boxNumber: String(boxNumber),
        shots: boxShots.boxMeta?.shots || {}
      },
      bookDetails: boxBooks.length > 0 ? {
        title: `Box ${boxNumber} (${boxBooks.length} Journals in Manifest)`,
        authors: `Lot: ${resolvedLot}`
      } : {
        title: `Box ${boxNumber}`,
        authors: `Lot: ${resolvedLot}`
      },
      copyNumber: 1,
      isProcessable: true,
      boxSummary
    };

    broadcastSession('BOX_INITIALIZED', {
      lotNumber: resolvedLot,
      boxNumber: String(boxNumber),
      currentStep: initialStep,
      boxSummary
    });

    res.json({
      success: true,
      lotNumber: resolvedLot,
      boxNumber: String(boxNumber),
      sampleIsbn,
      currentStep: initialStep,
      shots: shotsState,
      boxSummary
    });
  } catch (err) {
    console.error('Error in init-box:', err);
    res.status(500).json({ error: 'Failed to initialize box session', details: err.message });
  }
});

// Save Shot 1 (Box) or Shot 2 (Unbox) directly for a specific Box (PC 1 Box Mode)
app.post('/api/boxes/save-shot', async (req, res) => {
  try {
    const { lotNumber, boxNumber, shotNumber, imageBase64, blurScore } = req.body;
    const sNum = parseInt(shotNumber, 10);
    if (!boxNumber || !imageBase64 || (sNum !== 1 && sNum !== 2)) {
      return res.status(400).json({ error: 'Valid boxNumber, shotNumber (1 or 2), and base64 image required' });
    }

    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');

    const filename = await saveBoxShotToFile(lotNumber, boxNumber, sNum, buffer, blurScore);
    const boxShots = getBoxShots(lotNumber, boxNumber);

    // Propagate to any existing book folders belonging to this box
    if (manifestData.items && manifestData.items.length > 0) {
      const normResolvedBox = normalizeBoxString(boxNumber);
      const matchingItems = manifestData.items.filter(i => 
        normalizeBoxString(i.boxNumber) === normResolvedBox
      );
      for (const item of matchingItems) {
        const itemClean = sanitizeIsbn(item.isbn);
        const itemFolder = path.join(config.storagePath, itemClean);
        if (fs.existsSync(itemFolder)) {
          await applyBoxShotsToIsbn(itemClean, lotNumber, boxNumber, itemFolder);
        }
      }
    }

    if (!req.body.isReplication && config.peerSyncEnabled && config.peerIp) {
      replicateBoxShotToPeer({
        lotNumber,
        boxNumber,
        shotNumber: sNum,
        imageBase64,
        blurScore
      });
    }

    broadcastSession('BOX_SHOT_SAVED', {
      lotNumber,
      boxNumber,
      shotNumber: sNum,
      boxShots
    });

    res.json({
      success: true,
      lotNumber,
      boxNumber,
      shotNumber: sNum,
      filename,
      boxShots
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Asynchronous 2-way peer replication helper
async function replicateToPeer(shotData) {
  if (!config.peerSyncEnabled || !config.peerIp) return;
  try {
    const peerUrl = `http://${config.peerIp}:${config.peerPort || 3001}/api/sync/receive-shot`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(peerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...shotData, isReplication: true }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!res.ok) {
      console.warn(`[PeerSync] Replicating to ${peerUrl} status: ${res.status}`);
    }
  } catch (err) {
    console.warn(`[PeerSync] Could not replicate shot to peer ${config.peerIp}:`, err.message);
  }
}

async function replicateBoxShotToPeer(boxShotData) {
  if (!config.peerSyncEnabled || !config.peerIp) return;
  try {
    const peerUrl = `http://${config.peerIp}:${config.peerPort || 3001}/api/sync/receive-box-shot`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(peerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...boxShotData, isReplication: true }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!res.ok) {
      console.warn(`[PeerSync] Replicating box shot to ${peerUrl} status: ${res.status}`);
    }
  } catch (err) {
    console.warn(`[PeerSync] Could not replicate box shot to peer ${config.peerIp}:`, err.message);
  }
}

// -------------------------------------------------------------
// Multi-PC Peer Synchronization Endpoints
// -------------------------------------------------------------
app.post('/api/sync/receive-box-shot', async (req, res) => {
  try {
    const { lotNumber, boxNumber, shotNumber, imageBase64, blurScore } = req.body;
    const sNum = parseInt(shotNumber, 10);
    if (!boxNumber || !imageBase64 || (sNum !== 1 && sNum !== 2)) {
      return res.status(400).json({ error: 'Valid boxNumber and shotNumber required' });
    }
    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
    await saveBoxShotToFile(lotNumber, boxNumber, sNum, buffer, blurScore);
    const boxShots = getBoxShots(lotNumber, boxNumber);

    // Propagate to any existing book folders belonging to this box on peer PC
    if (manifestData.items && manifestData.items.length > 0) {
      const normResolvedBox = normalizeBoxString(boxNumber);
      const matchingItems = manifestData.items.filter(i => 
        normalizeBoxString(i.boxNumber) === normResolvedBox
      );
      for (const item of matchingItems) {
        const itemClean = sanitizeIsbn(item.isbn);
        const itemFolder = path.join(config.storagePath, itemClean);
        if (fs.existsSync(itemFolder)) {
          await applyBoxShotsToIsbn(itemClean, lotNumber, boxNumber, itemFolder);
        }
      }
    }

    broadcastSession('BOX_SHOT_SAVED', {
      lotNumber,
      boxNumber,
      shotNumber: sNum,
      boxShots
    });

    res.json({ success: true, replicated: true, lotNumber, boxNumber, shotNumber: sNum });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post('/api/sync/receive-shot', async (req, res) => {
  try {
    const { isbn, shotNumber, imageBase64, operatorName, bookDetails, blurScore, metadata: incomingMeta } = req.body;
    const sNum = parseInt(shotNumber, 10);
    if (!isbn || !imageBase64 || sNum < 1 || sNum > 7) {
      return res.status(400).json({ error: 'Valid ISBN, shotNumber, and base64 image required' });
    }

    const cleanIsbn = sanitizeIsbn(isbn);
    const folderPath = path.join(config.storagePath, cleanIsbn);
    fs.ensureDirSync(folderPath);

    const shotDef = SHOT_DEFINITIONS[sNum];
    const filename = getShotFilename(sNum, cleanIsbn);
    const filePath = path.join(folderPath, filename);

    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    await fs.writeFile(filePath, Buffer.from(cleanBase64, 'base64'));

    let metadata = incomingMeta || readIsbnMetadata(cleanIsbn) || {
      identifier: cleanIsbn,
      isbn: getBaseIsbn(cleanIsbn),
      operator: operatorName || 'Peer Station',
      station: 'Peer Station',
      shots: {}
    };

    if (incomingMeta) {
      metadata = { ...metadata, ...incomingMeta, updatedAt: new Date().toISOString() };
    }

    metadata.shots = metadata.shots || {};
    metadata.shots[sNum] = {
      filename,
      savedAt: new Date().toISOString(),
      type: shotDef.type,
      scope: shotDef.scope,
      blurScore
    };

    const totalShots = Object.keys(metadata.shots).length;
    metadata.isComplete = totalShots >= 7;

    await saveIsbnMetadata(cleanIsbn, metadata);

    // If received shot is Shot 1 or 2, ensure it is also saved into _boxes storage on this PC
    if (sNum === 1 || sNum === 2) {
      let peerLot = incomingMeta?.lotNumber || '';
      let peerBox = incomingMeta?.boxNumber || '';
      if (!peerBox && manifestData.items) {
        const match = manifestData.items.find(i => sanitizeIsbn(i.isbn) === cleanIsbn);
        if (match) {
          peerBox = match.boxNumber || '';
          peerLot = match.lotNumber || peerLot;
        }
      }
      if (peerBox) {
        await saveBoxShotToFile(peerLot, peerBox, sNum, Buffer.from(cleanBase64, 'base64'), blurScore);
      }
    }

    // If active session matches this ISBN on peer PC, update live state & broadcast
    if (currentSession.activeIsbn === cleanIsbn) {
      currentSession.shots[sNum] = {
        filename,
        savedAt: new Date().toISOString(),
        type: shotDef.type,
        scope: shotDef.scope,
        previewDataUrl: imageBase64,
        blurScore
      };
      currentSession.metadata = metadata;
      
      let nextStep = 'COMPLETE';
      for (let s = 1; s <= 7; s++) {
        if (!currentSession.shots[s]) {
          nextStep = `CAPTURE_SHOT_${s}`;
          break;
        }
      }
      currentSession.currentStep = nextStep;

      broadcastSession('SHOT_SAVED', {
        isbn: cleanIsbn,
        shotNumber: sNum,
        shotInfo: currentSession.shots[sNum],
        isComplete: totalShots >= 7,
        currentStep: nextStep
      });

      const isBoxSpineComplete = Boolean(
        metadata.shots[1] && 
        metadata.shots[2] && 
        metadata.shots[4]
      );
      const isBookComplete = Boolean(
        metadata.shots[3] && 
        metadata.shots[4] && 
        metadata.shots[5] && 
        metadata.shots[6] && 
        metadata.shots[7]
      );
      const isReadyForS3 = (totalShots >= 7) || isBookComplete || isBoxSpineComplete;

      if (isReadyForS3 && config.s3Enabled !== false && config.s3Bucket && config.s3AccessKeyId) {
        enqueueS3Upload(cleanIsbn);
      }
    }

    res.json({ success: true, replicated: true, isbn: cleanIsbn, shotNumber: sNum, isComplete: totalShots >= 7 });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save replicated photo', details: err.message });
  }
});

// Download ZIP of proof package (Pictures ONLY, no metadata.json)
app.get('/api/capture/zip/:isbn', async (req, res) => {
  const cleanIsbn = sanitizeIsbn(req.params.isbn);
  const folderPath = path.join(config.storagePath, cleanIsbn);

  if (!fs.existsSync(folderPath)) {
    return res.status(404).json({ error: 'Folder not found for this ISBN' });
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="Verification_${cleanIsbn}.zip"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => {
    res.status(500).send({ error: err.message });
  });

  archive.pipe(res);
  try {
    const allFiles = await fs.readdir(folderPath);
    const imageFiles = allFiles.filter(f => f.match(/\.(jpg|jpeg|png)$/i));
    for (const file of imageFiles) {
      archive.file(path.join(folderPath, file), { name: file });
    }
    archive.finalize();
  } catch (err) {
    archive.finalize();
  }
});

// -------------------------------------------------------------
// Gallery, History & CSV Export Endpoints (7 Shots)
// -------------------------------------------------------------
function escapeCsv(val) {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

app.get('/api/gallery/export-csv', async (req, res) => {
  try {
    if (!fs.existsSync(config.storagePath)) {
      return res.status(400).send('No storage directory found');
    }

    const entries = await fs.readdir(config.storagePath, { withFileTypes: true });
    const dirEntries = entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_'));

    const rows = [];
    const headers = [
      'Folder Identifier',
      'Lot Number',
      'Box Number',
      'ISBN / ISSN',
      'Copy #',
      'Journal / Book Title',
      'Authors',
      'Publisher',
      'Publication Year',
      'Processable Status',
      'Shot 1 (Box A)',
      'Shot 2 (Box B)',
      'Shot 3 (Front Cover)',
      'Shot 4 (Spine)',
      'Shot 5 (Title Page)',
      'Shot 6 (Edition Notice)',
      'Shot 7 (Back Cover)',
      'Verification Status',
      'Operator',
      'Workstation',
      'Date Created',
      'Date Modified',
      'Local Storage Path'
    ];
    rows.push(headers.map(escapeCsv).join(','));

    for (const dir of dirEntries) {
      const folderPath = path.join(config.storagePath, dir.name);
      let meta = readIsbnMetadata(dir.name);

      let stat = null;
      try {
        stat = await fs.stat(folderPath);
      } catch (e) {}

      const shotsStatus = {};
      let shotsCount = 0;
      for (let s = 1; s <= 7; s++) {
        const foundFile = findShotFileInFolder(folderPath, s, dir.name);
        if (foundFile) {
          shotsStatus[s] = foundFile;
          shotsCount++;
        } else {
          shotsStatus[s] = 'Missing';
        }
      }

      const copyMatch = dir.name.match(/_Copy(\d+)$/i);
      const copyNum = meta?.copyNumber || (copyMatch ? copyMatch[1] : '1');
      const baseIsbn = meta?.isbn || getBaseIsbn(dir.name);
      const manifestMatch = findManifestItem(baseIsbn) || findManifestItem(dir.name);

      // Robust Lot Resolution
      let lotNum = meta?.lotNumber;
      if (!lotNum || lotNum === 'Unassigned' || lotNum === 'Unassigned Lot' || (lotNum === 'Lot-1' && manifestMatch?.lotNumber && manifestMatch.lotNumber !== 'Lot-1')) {
        if (manifestMatch?.lotNumber) lotNum = manifestMatch.lotNumber;
      }
      if (!lotNum) lotNum = 'Unassigned Lot';

      // Robust Box Resolution
      let boxNum = meta?.boxNumber;
      if (!boxNum || boxNum === 'Unassigned' || boxNum === 'Unassigned Box') {
        if (manifestMatch?.boxNumber) boxNum = manifestMatch.boxNumber;
      }
      if (!boxNum) boxNum = '';

      const title = meta?.bookDetails?.title || manifestMatch?.title || '';
      const authors = meta?.bookDetails?.authors || manifestMatch?.author || '';
      const publisher = meta?.bookDetails?.publisher || manifestMatch?.publisher || '';
      const year = meta?.bookDetails?.publishYear || manifestMatch?.publicationYear || '';
      const operator = meta?.operator || 'Inventory Operator';
      const station = meta?.station || config.watermarkStation || '';
      const createdAt = meta?.createdAt ? new Date(meta.createdAt).toLocaleString() : '';
      const modifiedAt = stat?.mtime ? new Date(stat.mtime).toLocaleString() : '';

      const row = [
        dir.name,
        lotNum,
        boxNum,
        baseIsbn,
        copyNum,
        title,
        authors,
        publisher,
        year,
        'Processable',
        shotsStatus[1],
        shotsStatus[2],
        shotsStatus[3],
        shotsStatus[4],
        shotsStatus[5],
        shotsStatus[6],
        shotsStatus[7],
        shotsCount >= 7 ? 'Complete (7/7)' : `Partial (${shotsCount}/7)`,
        operator,
        station,
        createdAt,
        modifiedAt,
        folderPath
      ];

      rows.push(row.map(escapeCsv).join(','));
    }

    const csvContent = '\uFEFF' + rows.join('\r\n');
    const filename = `Verification_Images_Report_${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvContent);
  } catch (err) {
    console.error('Error generating CSV export:', err);
    res.status(500).send('Failed to generate CSV export');
  }
});

app.get('/api/gallery/list', async (req, res) => {
  try {
    if (!fs.existsSync(config.storagePath)) {
      return res.json({ items: [] });
    }

    const entries = await fs.readdir(config.storagePath, { withFileTypes: true });
    const dirEntries = entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_'));

    const items = [];
    for (const dir of dirEntries) {
      const folderPath = path.join(config.storagePath, dir.name);
      let metadata = readIsbnMetadata(dir.name);

      let stat = null;
      try {
        stat = await fs.stat(folderPath);
      } catch (e) {}

      const shots = {};
      let shotsCount = 0;
      for (let s = 1; s <= 7; s++) {
        const foundFile = findShotFileInFolder(folderPath, s, dir.name);
        if (foundFile) {
          shots[s] = `/proofs/${encodeURIComponent(dir.name)}/${encodeURIComponent(foundFile)}`;
          shotsCount++;
        } else {
          shots[s] = null;
        }
      }

      const copyMatch = dir.name.match(/_Copy(\d+)$/i);
      const copyNumber = metadata?.copyNumber || (copyMatch ? parseInt(copyMatch[1], 10) : 1);
      const baseIsbn = metadata?.isbn || getBaseIsbn(dir.name);
      const manifestMatch = findManifestItem(baseIsbn) || findManifestItem(dir.name);

      // Robust Lot Resolution:
      let lotNumber = metadata?.lotNumber;
      if (!lotNumber || lotNumber === 'Unassigned' || lotNumber === 'Unassigned Lot' || (lotNumber === 'Lot-1' && manifestMatch?.lotNumber && manifestMatch.lotNumber !== 'Lot-1')) {
        if (manifestMatch?.lotNumber) {
          lotNumber = manifestMatch.lotNumber;
        }
      }
      if (!lotNumber) lotNumber = 'Unassigned Lot';

      // Robust Box Resolution:
      let boxNumber = metadata?.boxNumber;
      if (!boxNumber || boxNumber === 'Unassigned' || boxNumber === 'Unassigned Box') {
        if (manifestMatch?.boxNumber) {
          boxNumber = manifestMatch.boxNumber;
        }
      }
      if (!boxNumber) boxNumber = '';

      // Auto self-heal metadata on disk if it was missing Lot or Box
      if (metadata && (metadata.lotNumber !== lotNumber || metadata.boxNumber !== boxNumber || (!metadata.bookDetails && manifestMatch?.title))) {
        metadata.lotNumber = lotNumber;
        metadata.boxNumber = boxNumber;
        if (!metadata.bookDetails && manifestMatch?.title) {
          metadata.bookDetails = {
            title: manifestMatch.title,
            authors: manifestMatch.author || '',
            publisher: manifestMatch.publisher || '',
            publishYear: manifestMatch.publicationYear || '',
            printIssn: manifestMatch.printIssn || '',
            volume: manifestMatch.volume || '',
            issues: manifestMatch.issues || '',
            source: 'Manifest'
          };
        }
        saveIsbnMetadata(dir.name, metadata).catch(() => {});
      }

      items.push({
        isbn: dir.name,
        baseIsbn,
        lotNumber,
        boxNumber,
        copyNumber,
        folderPath,
        shotsCount,
        isComplete: shotsCount >= 7,
        shots,
        shot1Url: shots[1],
        shot2Url: shots[2],
        shot3Url: shots[3],
        shot4Url: shots[4],
        shot5Url: shots[5],
        shot6Url: shots[6],
        shot7Url: shots[7],
        modifiedAt: stat ? stat.mtime : null,
        metadata
      });
    }

    items.sort((a, b) => new Date(b.modifiedAt || 0) - new Date(a.modifiedAt || 0));
    res.json({ items, total: items.length });
  } catch (err) {
    console.error('Error fetching gallery:', err);
    res.status(500).json({ error: 'Failed to read verification proofs directory' });
  }
});

app.delete('/api/gallery/:isbn', async (req, res) => {
  try {
    const cleanIsbn = sanitizeIsbn(req.params.isbn);
    const folderPath = path.join(config.storagePath, cleanIsbn);

    if (fs.existsSync(folderPath)) {
      await fs.remove(folderPath);
    }

    res.json({ success: true, isbn: cleanIsbn });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete proof folder' });
  }
});

// Serve frontend in production
const FRONTEND_DIST = path.resolve(__dirname, '../frontend/dist');
if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  app.get('*', (req, res) => {
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  });
}

// Start HTTP server
const httpServer = http.createServer(app);
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`  VERIFICATION IMAGES SERVER`);
  console.log(`  HTTP (PC Local):  http://localhost:${PORT}`);
  const ips = getNetworkIps();
  ips.forEach(ip => console.log(`  LAN HTTP:         http://${ip.address}:${PORT} (${ip.interface})`));
  console.log(`  Storage Root:     ${config.storagePath}`);
  console.log(`====================================================`);
});

// Start HTTPS server for Mobile Devices (LAN local environments)
if (sslOptions && !process.env.RENDER) {
  try {
    const httpsServer = https.createServer(sslOptions, app);
    httpsServer.on('error', (err) => {
      console.warn('[HTTPS Server] LAN HTTPS listener warning (cloud/restricted port mode):', err.message);
    });
    httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
      const ips = getNetworkIps();
      console.log(`  HTTPS (Mobile):   https://localhost:${HTTPS_PORT}`);
      ips.forEach(ip => console.log(`  Mobile HTTPS:     https://${ip.address}:${HTTPS_PORT}`));
      console.log(`====================================================`);
    });
  } catch (e) {
    console.warn('Could not start local HTTPS server:', e.message);
  }
}

// -------------------------------------------------------------
// Auto-Startup Daemon: Cleanup Metadata & Auto-Upload Pending Journals
// -------------------------------------------------------------
setTimeout(async () => {
  console.log('[System Daemon] Running initial metadata migration & cleanup...');
  await migrateAllLegacyMetadata();
  console.log('[System Daemon] Scanning for unuploaded journals on disk to automatically upload to S3...');
  await scanAllPendingJournalsForS3();
}, 3000);

// Recurring background S3 sync daemon every 30 seconds
setInterval(async () => {
  await scanAllPendingJournalsForS3();
}, 30000);

