import express from 'express';
import cors from 'cors';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import os from 'os';
import archiver from 'archiver';
import dotenv from 'dotenv';
import sharp from 'sharp';

import http from 'http';
import https from 'https';
import selfsigned from 'selfsigned';
import { S3Client, PutObjectCommand, HeadBucketCommand, ListObjectsV2Command, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
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
  return identifier.replace(/(_Copy\d+|_Part\d+)+$/i, '');
}

// Helper to extract part number from identifier (e.g. 9788120309869_Part1 -> 1, 9788120309869_Part2 -> 2)
function getPartNumber(identifier) {
  if (!identifier || typeof identifier !== 'string') return null;
  const match = identifier.match(/_Part(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

// Determines whether a lot number, project or client denotes client Jaguar
// Key rule: Lot number with letter 'J' or 'j' (e.g. Lot-156J, 156J) = Jaguar
function isJaguarLot(lotNumber, project, client) {
  if (client) {
    if (client.toLowerCase() === 'jaguar') return true;
    if (client.toLowerCase() === 'mustang') return false;
  }
  if (project) {
    if (/jaguar/i.test(project)) return true;
    if (/mustang/i.test(project)) return false;
  }
  if (!lotNumber) return false;
  const clean = String(lotNumber).trim().toLowerCase();
  return clean.includes('j');
}

// Helper to get folder for identifier (supports storing all parts in 1 base ISBN folder)
function getFolderForIdentifier(identifier) {
  const cleanId = sanitizeIsbn(identifier);
  if (!cleanId) return config.storagePath;

  const base = getBaseIsbn(cleanId);
  const partNum = getPartNumber(cleanId);

  // If this identifier has a Part number, ALWAYS use base ISBN folder so all parts stay together in 1 single folder
  if (partNum !== null) {
    let targetBaseFolder = null;

    if (config.storagePath) {
      const basePath = path.join(config.storagePath, base);
      if (fs.existsSync(basePath)) targetBaseFolder = basePath;
    }

    if (!targetBaseFolder && config.clientProfiles) {
      for (const p of Object.values(config.clientProfiles)) {
        if (p.storagePath) {
          const baseAlt = path.join(p.storagePath, base);
          if (fs.existsSync(baseAlt)) {
            targetBaseFolder = baseAlt;
            break;
          }
        }
      }
    }

    if (!targetBaseFolder && config.storagePath) {
      const parentStorage = path.dirname(config.storagePath);
      if (fs.existsSync(parentStorage)) {
        const legacyBasePath = path.join(parentStorage, base);
        if (fs.existsSync(legacyBasePath)) targetBaseFolder = legacyBasePath;
      }
    }

    if (!targetBaseFolder) {
      const manifestMatch = findManifestItem ? (findManifestItem(base) || findManifestItem(cleanId)) : null;
      const isJag = manifestMatch ? isJaguarLot(manifestMatch.lotNumber, manifestMatch.project, manifestMatch.client) : false;
      const targetClient = isJag ? 'Jaguar' : (config.activeClient || 'Mustang');
      const targetStorage = config.clientProfiles?.[targetClient]?.storagePath || config.storagePath;
      targetBaseFolder = path.join(targetStorage, base);
    }

    // Auto-migrate any stray legacy separated part folders into the single base ISBN folder
    if (config.storagePath) {
      const separatedPath = path.join(config.storagePath, cleanId);
      if (fs.existsSync(separatedPath) && separatedPath !== targetBaseFolder) {
        try {
          fs.ensureDirSync(targetBaseFolder);
          const strayFiles = fs.readdirSync(separatedPath);
          for (const sf of strayFiles) {
            fs.moveSync(path.join(separatedPath, sf), path.join(targetBaseFolder, sf), { overwrite: true });
          }
          fs.removeSync(separatedPath);
          console.log(`[Storage] Auto-merged separated part folder into single base folder: ${cleanId} -> ${base}`);
        } catch (e) {}
      }
    }

    return targetBaseFolder;
  }

  // Normal non-part single book identifier:
  // 1. Check active storagePath
  if (config.storagePath) {
    const dedicatedPath = path.join(config.storagePath, cleanId);
    if (fs.existsSync(dedicatedPath)) return dedicatedPath;
    const basePath = path.join(config.storagePath, base);
    if (fs.existsSync(basePath)) return basePath;
  }

  // 2. Check all client profiles storage paths (e.g. Jaguar and Mustang)
  if (config.clientProfiles) {
    for (const p of Object.values(config.clientProfiles)) {
      if (p.storagePath && p.storagePath !== config.storagePath) {
        const dedicatedAlt = path.join(p.storagePath, cleanId);
        if (fs.existsSync(dedicatedAlt)) return dedicatedAlt;
        const baseAlt = path.join(p.storagePath, base);
        if (fs.existsSync(baseAlt)) return baseAlt;
      }
    }
  }

  // 3. Backward compatibility: check legacy root C:\Journal_Proofs
  if (config.storagePath) {
    const parentStorage = path.dirname(config.storagePath);
    if (fs.existsSync(parentStorage)) {
      const legacyPath = path.join(parentStorage, cleanId);
      if (fs.existsSync(legacyPath)) return legacyPath;
      const legacyBasePath = path.join(parentStorage, base);
      if (fs.existsSync(legacyBasePath)) return legacyBasePath;
    }
  }

  // 4. Default target: route to client storage if identifier/manifest matches Jaguar or Mustang
  const manifestMatch = findManifestItem ? (findManifestItem(base) || findManifestItem(cleanId)) : null;
  const isJag = manifestMatch ? isJaguarLot(manifestMatch.lotNumber, manifestMatch.project, manifestMatch.client) : false;
  const targetClient = isJag ? 'Jaguar' : (config.activeClient || 'Mustang');
  const targetStorage = config.clientProfiles?.[targetClient]?.storagePath || config.storagePath;

  return path.join(targetStorage, cleanId);
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
  if (!cleanId) return `journal${def.suffix}`;

  const partNum = getPartNumber(cleanId);
  if (partNum !== null) {
    // Client naming format for parts: ISBN_front cover_Part1.jpg
    const prefixWithoutPart = cleanId.replace(/_Part\d+/i, '');
    const ext = path.extname(def.suffix) || '.jpg';
    const shotBase = def.suffix.replace(/\.[^.]+$/, '');
    return `${prefixWithoutPart}${shotBase}_Part${partNum}${ext}`;
  }

  return `${cleanId}${def.suffix}`;
}

function isValidImageFile(filePath) {
  try {
    if (!filePath || typeof filePath !== 'string') return false;
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size > 1024; // Must be at least 1 KB
  } catch (e) {
    return false;
  }
}

function findShotFileInFolder(folderPath, shotNumber, identifier, preloadedFiles = null) {
  const def = SHOT_DEFINITIONS[shotNumber];
  if (!def || !folderPath) return null;

  let files = Array.isArray(preloadedFiles) ? preloadedFiles : null;
  if (!files) {
    if (!fs.existsSync(folderPath)) return null;
  } else if (files.length === 0) {
    return null;
  }

  const fileSetLower = files ? new Map(files.map(f => [f.toLowerCase(), f])) : null;
  const checkCandidateName = (candidateName) => {
    if (fileSetLower) {
      const actual = fileSetLower.get(candidateName.toLowerCase());
      if (!actual) return null;
      return isValidImageFile(path.join(folderPath, actual)) ? actual : null;
    }
    const candidatePath = path.join(folderPath, candidateName);
    return isValidImageFile(candidatePath) ? candidateName : null;
  };

  // 1. Direct match with identifier prefix (e.g. 2006348420_front cover_Part1.jpg or 2006348420_front cover.jpg)
  const targetName = getShotFilename(shotNumber, identifier);
  const directHit = checkCandidateName(targetName);
  if (directHit) return directHit;

  // 1b. Check underscore variant (e.g. 2006348420_front_cover_Part1.jpg)
  if (targetName.includes(' ')) {
    const underscoreHit = checkCandidateName(targetName.replace(/ /g, '_'));
    if (underscoreHit) return underscoreHit;
  }

  // 1c. Check legacy part format for backward compatibility (e.g. 2006348420_Part1_front cover.jpg)
  const partNum = getPartNumber(identifier);
  if (partNum !== null) {
    const cleanId = sanitizeIsbn(identifier || '');
    const legacyPartName = `${cleanId}${def.suffix}`;
    const legacyHit = checkCandidateName(legacyPartName);
    if (legacyHit) return legacyHit;
    if (legacyPartName.includes(' ')) {
      const legacyUnderscoreHit = checkCandidateName(legacyPartName.replace(/ /g, '_'));
      if (legacyUnderscoreHit) return legacyUnderscoreHit;
    }
  }

  // 2. Scan directory for matching suffix or legacy names
  try {
    if (!files) {
      files = fs.readdirSync(folderPath);
    }
    const suffix = def.suffix.toLowerCase();
    const underscoreSuffix = suffix.replace(/ /g, '_');
    const shotBase = def.suffix.replace(/\.[^.]+$/, '').toLowerCase();
    const shotBaseUnderscore = shotBase.replace(/ /g, '_');

    const partTag = partNum !== null ? `_part${partNum}`.toLowerCase() : null;

    for (const f of files) {
      const lower = f.toLowerCase();
      if (partTag) {
        if (!lower.includes(partTag)) continue;
        if (lower.includes(shotBase) || lower.includes(shotBaseUnderscore)) {
          const fullP = path.join(folderPath, f);
          if (isValidImageFile(fullP)) return f;
        }
      } else {
        if (/_part\d+/i.test(lower)) continue;
        if (lower.endsWith(suffix) || (underscoreSuffix !== suffix && lower.endsWith(underscoreSuffix))) {
          const fullP = path.join(folderPath, f);
          if (isValidImageFile(fullP)) return f;
        }
      }
    }

    // Check legacy names (only if not searching for a specific part)
    if (!partTag) {
      for (const leg of def.legacyNames) {
        const legMatch = files.find(f => !/_part\d+/i.test(f) && (f.toLowerCase() === leg.toLowerCase() || f.toLowerCase().endsWith(leg.toLowerCase())));
        if (legMatch) {
          const fullP = path.join(folderPath, legMatch);
          if (isValidImageFile(fullP)) return legMatch;
        }
      }
    }
  } catch (e) {}

  return null;
}

// Multi-client default profiles
const DEFAULT_CLIENT_PROFILES = {
  Mustang: {
    name: 'Mustang',
    storagePath: process.platform === 'win32' ? 'C:\\Journal_Proofs\\Mustang' : path.resolve(__dirname, 'storage/journal_proofs/Mustang'),
    s3Enabled: true,
    s3Bucket: process.env.AWS_S3_BUCKET || 'innoscanmussgp1-s3',
    s3Region: process.env.AWS_REGION || 'ap-southeast-1',
    s3AccessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    s3SecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    s3Prefix: 'innoscanmussgp1/JournalVerificationImages/',
    s3CustomEndpoint: process.env.AWS_S3_ENDPOINT || ''
  },
  Jaguar: {
    name: 'Jaguar',
    storagePath: process.platform === 'win32' ? 'C:\\Journal_Proofs\\Jaguar' : path.resolve(__dirname, 'storage/journal_proofs/Jaguar'),
    s3Enabled: true,
    s3Bucket: process.env.AWS_S3_BUCKET || 'innoscanjagjx1-s3',
    s3Region: process.env.AWS_REGION || 'ap-southeast-1',
    s3AccessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    s3SecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    s3Prefix: 'Phase-09/Lot-156J/',
    s3CustomEndpoint: process.env.AWS_S3_ENDPOINT || ''
  }
};

// Load or initialize config
let config = {
  activeClient: 'Mustang',
  clientProfiles: JSON.parse(JSON.stringify(DEFAULT_CLIENT_PROFILES)),
  storagePath: DEFAULT_CLIENT_PROFILES.Mustang.storagePath,
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

function syncConfigWithActiveClient(targetClient) {
  if (!config.clientProfiles) {
    config.clientProfiles = JSON.parse(JSON.stringify(DEFAULT_CLIENT_PROFILES));
  }
  const clientKey = targetClient || config.activeClient || 'Mustang';
  if (!config.clientProfiles[clientKey]) {
    config.clientProfiles[clientKey] = {
      name: clientKey,
      storagePath: path.join(process.platform === 'win32' ? 'C:\\Journal_Proofs' : path.resolve(__dirname, 'storage/journal_proofs'), clientKey),
      s3Enabled: false,
      s3Bucket: '',
      s3Region: 'ap-southeast-1',
      s3AccessKeyId: '',
      s3SecretAccessKey: '',
      s3Prefix: `innoscan${clientKey.toLowerCase()}sgp1/JournalVerificationImages/`,
      s3CustomEndpoint: ''
    };
  }

  const profile = config.clientProfiles[clientKey];
  const mustangProfile = config.clientProfiles?.Mustang || {};
  config.activeClient = clientKey;
  config.storagePath = profile.storagePath;
  config.s3Enabled = profile.s3Enabled !== undefined ? profile.s3Enabled : (config.s3Enabled !== false);
  config.s3Bucket = profile.s3Bucket || mustangProfile.s3Bucket || config.s3Bucket || 'innoscanmussgp1-s3';
  config.s3Region = profile.s3Region || mustangProfile.s3Region || config.s3Region || 'ap-southeast-1';
  config.s3AccessKeyId = profile.s3AccessKeyId || mustangProfile.s3AccessKeyId || config.s3AccessKeyId || '';
  config.s3SecretAccessKey = profile.s3SecretAccessKey || mustangProfile.s3SecretAccessKey || config.s3SecretAccessKey || '';
  config.s3Prefix = profile.s3Prefix || `innoscan${clientKey.toLowerCase()}sgp1/JournalVerificationImages/`;
  config.s3CustomEndpoint = profile.s3CustomEndpoint || '';

  try {
    fs.ensureDirSync(config.storagePath);
  } catch (e) {
    console.warn(`[Client Profile] Note: Could not create folder ${config.storagePath}:`, e.message);
  }
}

if (fs.existsSync(CONFIG_FILE)) {
  try {
    const saved = fs.readJsonSync(CONFIG_FILE);
    config = { ...config, ...saved };
    if (!config.clientProfiles) {
      config.clientProfiles = JSON.parse(JSON.stringify(DEFAULT_CLIENT_PROFILES));
    }
    if (!config.activeClient) {
      config.activeClient = 'Mustang';
    }
    syncConfigWithActiveClient(config.activeClient);
  } catch (err) {
    console.error('Failed to parse config.json, using defaults:', err);
  }
} else {
  syncConfigWithActiveClient('Mustang');
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

    const isJagLot = grp.lotNumbers.some(l => isJaguarLot(l));
    const grpClient = isJagLot ? 'Jaguar' : 'Mustang';
    for (const item of grp.items) {
      item.manifestId = id;
      item.manifestFilename = grp.filename;
      item.client = isJaguarLot(item.lotNumber, item.project, item.client) ? 'Jaguar' : 'Mustang';
    }

    manifests.push({
      id,
      filename: grp.filename,
      sheetName: grp.sheetName,
      lotNumber: grp.lotNumber,
      lotNumbers: grp.lotNumbers,
      client: grpClient,
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

// Fast in-memory index for O(1) manifest item & box lookups
const manifestIndex = {
  byRawLower: new Map(),
  byCleanLower: new Map(),
  byDigits: new Map(),
  byCore9: new Map(),
  byIssn: new Map(),
  bySNo: new Map(),
  byBoxStrip: new Map(),
  itemCount: -1
};

function stripBoxForIndex(boxNumber) {
  if (!boxNumber) return '';
  const norm = String(boxNumber).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const noRb = norm.replace(/^rb/, '');
  return noRb.replace(/^0+/, '') || '0';
}

function addToIndexMap(map, key, item) {
  if (!key) return;
  let arr = map.get(key);
  if (!arr) {
    arr = [];
    map.set(key, arr);
  }
  arr.push(item);
}

function rebuildManifestIndex() {
  manifestIndex.byRawLower.clear();
  manifestIndex.byCleanLower.clear();
  manifestIndex.byDigits.clear();
  manifestIndex.byCore9.clear();
  manifestIndex.byIssn.clear();
  manifestIndex.bySNo.clear();
  manifestIndex.byBoxStrip.clear();

  const items = Array.isArray(manifestData.items) ? manifestData.items : [];
  manifestIndex.itemCount = items.length;

  for (const item of items) {
    if (!item) continue;
    const itemIsbnRaw = String(item.isbn || '').trim();
    const rawLower = itemIsbnRaw.toLowerCase();
    const cleanLower = sanitizeIsbn(itemIsbnRaw).toLowerCase();
    const itemDigits = itemIsbnRaw.replace(/[^0-9Xx]/g, '');

    addToIndexMap(manifestIndex.byRawLower, rawLower, item);
    if (cleanLower !== rawLower) {
      addToIndexMap(manifestIndex.byCleanLower, cleanLower, item);
    }
    if (itemDigits) {
      addToIndexMap(manifestIndex.byDigits, itemDigits, item);
      if (itemDigits.length === 13 && itemDigits.startsWith('978')) {
        addToIndexMap(manifestIndex.byCore9, itemDigits.slice(3, 12), item);
      } else if (itemDigits.length >= 9) {
        addToIndexMap(manifestIndex.byCore9, itemDigits.slice(0, 9), item);
      }
    }
    if (item.printIssn) {
      const issnRaw = String(item.printIssn).trim().toLowerCase();
      const issnDigits = issnRaw.replace(/[^0-9Xx]/g, '');
      addToIndexMap(manifestIndex.byIssn, issnRaw, item);
      if (issnDigits && issnDigits !== issnRaw) {
        addToIndexMap(manifestIndex.byIssn, issnDigits, item);
      }
    }
    if (item.sNo) {
      addToIndexMap(manifestIndex.bySNo, String(item.sNo).trim(), item);
    }
    if (item.boxNumber) {
      addToIndexMap(manifestIndex.byBoxStrip, stripBoxForIndex(item.boxNumber), item);
    }
  }
}

if (fs.existsSync(MANIFEST_FILE)) {
  try {
    manifestData = fs.readJsonSync(MANIFEST_FILE);
    if (!Array.isArray(manifestData.items)) manifestData.items = [];
    let modifiedClients = false;
    for (const item of manifestData.items) {
      const correctClient = isJaguarLot(item.lotNumber, item.project, item.client) ? 'Jaguar' : 'Mustang';
      if (item.client !== correctClient) {
        item.client = correctClient;
        modifiedClients = true;
      }
    }
    const hasCombinedLots = Array.isArray(manifestData.manifests) && manifestData.manifests.some(m => m.lotNumbers && m.lotNumbers.length > 1);
    if (!Array.isArray(manifestData.manifests) || manifestData.manifests.length === 0 || hasCombinedLots || modifiedClients) {
      rebuildManifestHistory(manifestData);
      try { fs.writeJsonSync(MANIFEST_FILE, manifestData, { spaces: 2 }); } catch (e) {}
    }
    rebuildManifestIndex();
  } catch (err) {
    console.error('Failed to parse manifest.json:', err);
  }
}

function saveManifest() {
  rebuildManifestIndex();
  fs.writeJson(MANIFEST_FILE, manifestData, { spaces: 2 }).catch(err => {
    console.error('Failed to save manifest.json:', err);
  });
}

function getManifestItemsForBox(lotNumber, boxNumber) {
  if (!boxNumber || !manifestData.items || manifestData.items.length === 0) return [];
  if (manifestIndex.itemCount !== manifestData.items.length) {
    rebuildManifestIndex();
  }
  const stripped = stripBoxForIndex(boxNumber);
  const candidates = manifestIndex.byBoxStrip.get(stripped) || [];
  if (candidates.length === 0) return [];
  const normLot = normalizeLotString(lotNumber);
  return candidates.filter(i =>
    (normLot === 'unassigned' || normalizeLotString(i.lotNumber) === normLot) &&
    isMatchingBoxNumber(i.boxNumber, boxNumber)
  );
}

// Universal manifest lookup helper: O(1) indexed lookup for ISBN, sanitized, digits-only, ISSN, and copy names
function findManifestItem(identifier, targetClient = config.activeClient) {
  if (!identifier || !manifestData.items || manifestData.items.length === 0) return null;
  if (manifestIndex.itemCount !== manifestData.items.length) {
    rebuildManifestIndex();
  }

  const raw = String(identifier).trim();
  const rawLower = raw.toLowerCase();
  const cleanLower = sanitizeIsbn(raw).toLowerCase();
  const baseLower = getBaseIsbn(sanitizeIsbn(raw)).toLowerCase();
  const digitsOnly = raw.replace(/[^0-9Xx]/g, '');

  const candidateList = [];
  const seen = new Set();
  const pushCandidates = (arr) => {
    if (!arr) return;
    for (const it of arr) {
      if (!seen.has(it)) {
        seen.add(it);
        candidateList.push(it);
      }
    }
  };

  // 1. Direct & sanitized matches
  pushCandidates(manifestIndex.byRawLower.get(rawLower));
  pushCandidates(manifestIndex.byCleanLower.get(cleanLower));
  if (baseLower !== cleanLower) {
    pushCandidates(manifestIndex.byRawLower.get(baseLower));
    pushCandidates(manifestIndex.byCleanLower.get(baseLower));
  }

  // 2. Digits-only & ISBN-10/13 conversion matches
  if (digitsOnly.length > 0) {
    pushCandidates(manifestIndex.byDigits.get(digitsOnly));
    if (digitsOnly.length === 13 && digitsOnly.startsWith('978')) {
      pushCandidates(manifestIndex.byCore9.get(digitsOnly.slice(3, 12)));
    } else if (digitsOnly.length >= 9) {
      pushCandidates(manifestIndex.byCore9.get(digitsOnly.slice(0, 9)));
    }
  }

  // 3. ISSN matches
  pushCandidates(manifestIndex.byIssn.get(rawLower));
  if (digitsOnly.length > 0) {
    pushCandidates(manifestIndex.byIssn.get(digitsOnly));
  }

  // 4. sNo matches
  pushCandidates(manifestIndex.bySNo.get(raw));

  if (candidateList.length === 0) return null;

  // Priority match: items tagged with the active client
  if (targetClient) {
    const targetLower = targetClient.toLowerCase();
    for (const item of candidateList) {
      const itemClient = item.client || (isJaguarLot(item.lotNumber, item.project) ? 'Jaguar' : 'Mustang');
      if (itemClient.toLowerCase() === targetLower) {
        return item;
      }
    }
  }

  return candidateList[0] || null;
}

/**
 * Universal Barcode & ISBN validation, de-duplication, and human-error guard.
 * Catches:
 * 1. Exact double-scans: "987456987987456987" -> cleans to "987456987"
 * 2. Merged scans: multiple ISBNs in one scan -> blocked
 * 3. Invalid characters/letters: "9z157326", "x3291047", "s9917362" -> blocked
 * 4. Manifest enforcement: rejects unmanifested barcodes when manifest is loaded
 * 5. Multi-client enforcement: blocks Jaguar ISBNs (Lot with J) in Mustang mode & vice-versa
 */
function validateAndCleanBarcode(input, manifestItems = [], activeClient = config.activeClient) {
  if (!input || typeof input !== 'string') {
    return { valid: false, cleaned: '', original: '', isDoubleScan: false, isMerged: false, error: 'Barcode/ISBN is required.' };
  }

  let raw = input.trim();
  const original = raw;

  // Strip accidental quotes or brackets
  raw = raw.replace(/^["'\[\(]+|["'\]\)]+$/g, '').trim();

  const checkClient = (item) => {
    if (!activeClient || !item) return { allowed: true };
    const itemClient = item.client || (isJaguarLot(item.lotNumber, item.project) ? 'Jaguar' : 'Mustang');
    if (itemClient.toLowerCase() !== activeClient.toLowerCase()) {
      const lotStr = item.lotNumber ? ` (Lot: ${item.lotNumber})` : '';
      return {
        allowed: false,
        itemClient,
        error: `Client Mismatch: This book belongs to ${itemClient}${lotStr}. Switch to ${itemClient} profile to process this book.`
      };
    }
    return { allowed: true, itemClient };
  };

  // 1. Check direct manifest match
  const directMatch = findManifestItem(raw, activeClient) || findManifestItem(raw, null);
  if (directMatch) {
    const clientValidation = checkClient(directMatch);
    if (!clientValidation.allowed) {
      return {
        valid: false,
        cleaned: raw,
        original,
        isDoubleScan: false,
        isMerged: false,
        clientMismatch: true,
        itemClient: clientValidation.itemClient,
        error: clientValidation.error
      };
    }
    return {
      valid: true,
      cleaned: String(directMatch.isbn).trim(),
      original,
      isDoubleScan: false,
      isMerged: false,
      manifestMatch: directMatch
    };
  }

  // 2. Double-Scan Detection & Auto-Correction (e.g. 987456987987456987)
  if (raw.length >= 8 && raw.length % 2 === 0) {
    const halfLen = raw.length / 2;
    const firstHalf = raw.substring(0, halfLen);
    const secondHalf = raw.substring(halfLen);
    if (firstHalf.toLowerCase() === secondHalf.toLowerCase()) {
      const halfMatch = findManifestItem(firstHalf, activeClient) || findManifestItem(firstHalf, null);
      if (halfMatch) {
        const clientValidation = checkClient(halfMatch);
        if (!clientValidation.allowed) {
          return {
            valid: false,
            cleaned: firstHalf,
            original,
            isDoubleScan: true,
            isMerged: false,
            clientMismatch: true,
            itemClient: clientValidation.itemClient,
            error: clientValidation.error
          };
        }
      }
      return {
        valid: true,
        cleaned: halfMatch ? String(halfMatch.isbn).trim() : firstHalf,
        original,
        isDoubleScan: true,
        isMerged: false,
        manifestMatch: halfMatch || null
      };
    }
  }

  // Double 13-digit EAN/ISBN starting with 978 or 979
  if (raw.length >= 26) {
    const m = raw.match(/^(97[89]\d{10})(97[89]\d{10})$/);
    if (m && m[1] === m[2]) {
      const halfMatch = findManifestItem(m[1], activeClient) || findManifestItem(m[1], null);
      if (halfMatch) {
        const clientValidation = checkClient(halfMatch);
        if (!clientValidation.allowed) {
          return {
            valid: false,
            cleaned: m[1],
            original,
            isDoubleScan: true,
            isMerged: false,
            clientMismatch: true,
            itemClient: clientValidation.itemClient,
            error: clientValidation.error
          };
        }
      }
      return {
        valid: true,
        cleaned: halfMatch ? String(halfMatch.isbn).trim() : m[1],
        original,
        isDoubleScan: true,
        isMerged: false,
        manifestMatch: halfMatch || null
      };
    }
  }

  // 3. Merged scan detection (> 17 characters)
  if (raw.length > 17) {
    return {
      valid: false,
      cleaned: raw,
      original,
      isDoubleScan: false,
      isMerged: true,
      error: `Merged barcode error: "${original}" contains multiple scans combined (${raw.length} chars). Please rescan or type single item.`
    };
  }

  // 4. Invalid letter / corrupted character check (e.g. 9z157326, x3291047, s9917362)
  const cleanChars = raw.replace(/[-\s]/g, '');
  const isValidBarcodeFormat = /^[0-9]+[0-9Xx]?$/.test(cleanChars);

  if (!isValidBarcodeFormat) {
    return {
      valid: false,
      cleaned: raw,
      original,
      isDoubleScan: false,
      isMerged: false,
      error: `Invalid barcode format: "${original}" contains invalid letters and does not exist in the manifest.`
    };
  }

  // 5. Minimum length check
  if (cleanChars.length < 4) {
    return {
      valid: false,
      cleaned: raw,
      original,
      isDoubleScan: false,
      isMerged: false,
      error: `Barcode "${original}" is too short (minimum 4 characters).`
    };
  }

  // 6. Strict Manifest Validation (if manifest is loaded)
  if (manifestItems && manifestItems.length > 0) {
    const match = findManifestItem(cleanChars, activeClient) || 
                  findManifestItem(raw, activeClient) || 
                  findManifestItem(cleanChars, null) || 
                  findManifestItem(raw, null);
    if (!match) {
      return {
        valid: false,
        cleaned: raw,
        original,
        isDoubleScan: false,
        isMerged: false,
        error: `ISBN/Barcode "${original}" is not in the uploaded manifest.`
      };
    }

    const clientValidation = checkClient(match);
    if (!clientValidation.allowed) {
      return {
        valid: false,
        cleaned: raw,
        original,
        isDoubleScan: false,
        isMerged: false,
        clientMismatch: true,
        itemClient: clientValidation.itemClient,
        error: clientValidation.error
      };
    }

    return {
      valid: true,
      cleaned: String(match.isbn).trim(),
      original,
      isDoubleScan: false,
      isMerged: false,
      manifestMatch: match
    };
  }

  return {
    valid: true,
    cleaned: raw,
    original,
    isDoubleScan: false,
    isMerged: false
  };
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

// Clean up empty proof folders (run once at startup with event-loop yielding)
async function cleanupEmptyProofFolders() {
  try {
    if (!fs.existsSync(config.storagePath)) return;
    const entries = await fs.readdir(config.storagePath, { withFileTypes: true });
    let count = 0;
    for (const entry of entries) {
      count++;
      if (count % 50 === 0) {
        await new Promise(r => setImmediate(r));
      }
      if (entry.isDirectory()) {
        if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
        const folder = path.join(config.storagePath, entry.name);

        // If this is a separated part directory (e.g. 2006348420_Part1), auto-merge into single base ISBN folder
        if (/_Part\d+$/i.test(entry.name)) {
          const baseName = getBaseIsbn(entry.name);
          const baseFolder = path.join(config.storagePath, baseName);
          try {
            await fs.ensureDir(baseFolder);
            const partFiles = await fs.readdir(folder);
            for (const pf of partFiles) {
              await fs.move(path.join(folder, pf), path.join(baseFolder, pf), { overwrite: true });
            }
            await fs.remove(folder);
            console.log(`[Storage] Auto-merged separated part folder into base ISBN folder: ${entry.name} -> ${baseName}`);
            continue;
          } catch (e) {}
        }

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

// Fast O(1) cleanup for a single abandoned ISBN folder without scanning the entire storage drive
async function cleanupSingleEmptyProofFolder(identifier) {
  if (!identifier || typeof identifier !== 'string') return;
  try {
    const cleanId = sanitizeIsbn(identifier);
    if (!cleanId || cleanId.startsWith('_') || cleanId.startsWith('.') || cleanId.startsWith('BOX_')) return;
    const folder = getFolderForIdentifier(cleanId);
    if (!folder || !fs.existsSync(folder)) return;
    const files = await fs.readdir(folder);
    const imageFiles = files.filter(f => /\.(jpe?g|png|webp)$/i.test(f));
    if (imageFiles.length === 0) {
      await fs.remove(folder);
    }
  } catch (e) {}
}

// Peer LAN reachability circuit-breaker & auto-discovered peer registry
let peerLastFailureTime = 0;
const PEER_FAILURE_COOLDOWN_MS = 5000;
const discoveredPeers = new Set(); // "ip:port"

function isPeerReachable() {
  if (!config.peerIp) return false;
  return (Date.now() - peerLastFailureTime) >= PEER_FAILURE_COOLDOWN_MS;
}

function markPeerSuccess() {
  peerLastFailureTime = 0;
}

function markPeerFailure() {
  peerLastFailureTime = Date.now();
}

function getAllTargetPeers() {
  const peers = new Set();
  if (config.peerSyncEnabled && config.peerIp) {
    peers.add(`${config.peerIp}:${config.peerPort || 3001}`);
  }
  for (const p of discoveredPeers) {
    peers.add(p);
  }
  return Array.from(peers);
}

function getLocalHeadersForPeer() {
  const ips = getNetworkIps();
  const primaryIp = ips[0]?.address || '';
  return {
    'X-Peer-Ip': primaryIp,
    'X-Peer-Port': String(PORT)
  };
}

// Auto-discover peer PC when it queries this workstation over LAN
app.use((req, res, next) => {
  const headerPeerIp = req.headers['x-peer-ip'];
  const headerPeerPort = req.headers['x-peer-port'] || '3001';
  if (headerPeerIp && typeof headerPeerIp === 'string') {
    const cleanIp = headerPeerIp.trim();
    const myIps = new Set(getNetworkIps().map(i => i.address));
    if (cleanIp && cleanIp !== '127.0.0.1' && cleanIp !== 'localhost' && !myIps.has(cleanIp)) {
      discoveredPeers.add(`${cleanIp}:${headerPeerPort}`);
      if (!config.peerIp) {
        config.peerIp = cleanIp;
        config.peerPort = parseInt(headerPeerPort, 10) || 3001;
        config.peerSyncEnabled = true;
      }
    }
  } else if (req.path.startsWith('/api/sync/') || (req.path === '/api/boxes/list' && req.query.all === 'true')) {
    const remote = (req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
    const myIps = new Set(getNetworkIps().map(i => i.address));
    if (remote && remote !== '127.0.0.1' && remote !== '::1' && !myIps.has(remote)) {
      discoveredPeers.add(`${remote}:${config.peerPort || 3001}`);
      if (!config.peerIp) {
        config.peerIp = remote;
        config.peerSyncEnabled = true;
      }
    }
  }
  next();
});

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

  // Check all client profiles .metadata directories (e.g. Jaguar, Mustang)
  if (config.clientProfiles) {
    for (const p of Object.values(config.clientProfiles)) {
      if (p.storagePath) {
        const altMeta = path.join(p.storagePath, '.metadata', `${cleanIsbn}.json`);
        if (fs.existsSync(altMeta)) {
          try { return fs.readJsonSync(altMeta); } catch (e) {}
        }
      }
    }
  }

  // Check parent legacy .metadata directory (e.g. C:\Journal_Proofs\.metadata)
  if (config.storagePath) {
    const parentMetaPath = path.join(path.dirname(config.storagePath), '.metadata', `${cleanIsbn}.json`);
    if (fs.existsSync(parentMetaPath)) {
      try { return fs.readJsonSync(parentMetaPath); } catch (e) {}
    }
  }

  // Backwards-compatible check: legacy metadata.json inside photo folder
  const folderPath = getFolderForIdentifier(cleanIsbn);
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
  const isJag = metadata?.client === 'Jaguar' || isJaguarLot(metadata?.lotNumber);
  const targetClient = isJag ? 'Jaguar' : (config.activeClient || 'Mustang');
  const targetStorage = config.clientProfiles?.[targetClient]?.storagePath || config.storagePath;
  const targetMetaDir = path.join(targetStorage, '.metadata');
  await fs.ensureDir(targetMetaDir);
  const primaryPath = path.join(targetMetaDir, `${cleanIsbn}.json`);
  await fs.writeJson(primaryPath, metadata, { spaces: 2 });

  // Mirror to active config.storagePath if different
  if (config.storagePath && config.storagePath !== targetStorage) {
    try {
      const mirrorDir = path.join(config.storagePath, '.metadata');
      await fs.ensureDir(mirrorDir);
      await fs.writeJson(path.join(mirrorDir, `${cleanIsbn}.json`), metadata, { spaces: 2 });
    } catch (e) {}
  }

  // Clean up any legacy metadata.json from photo folder so only pictures remain
  const folderPath = getFolderForIdentifier(cleanIsbn);
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


// -------------------------------------------------------------
// High-Speed Thumbnail Generator & Disk Cache
// -------------------------------------------------------------
async function getOrGenerateThumbnail(dir, filename) {
  try {
    let originalPath = path.join(config.storagePath, dir, filename);
    if (!fs.existsSync(originalPath)) {
      const baseId = getBaseIsbn(dir);
      if (baseId && baseId !== dir) {
        originalPath = path.join(config.storagePath, baseId, filename);
      }
    }
    if (!isValidImageFile(originalPath)) {
      return null;
    }

    const thumbDir = path.join(config.storagePath, '.thumbnails', dir);
    const thumbPath = path.join(thumbDir, filename);

    // If cached thumbnail exists and is newer than original, return it
    if (fs.existsSync(thumbPath)) {
      const origStat = fs.statSync(originalPath);
      const thumbStat = fs.statSync(thumbPath);
      if (thumbStat.mtime >= origStat.mtime && thumbStat.size > 200) {
        return thumbPath;
      }
    }

    // Generate fast thumbnail (120x120 cover, jpeg quality 80)
    fs.ensureDirSync(thumbDir);
    await sharp(originalPath)
      .resize(120, 120, { fit: 'cover' })
      .jpeg({ quality: 80 })
      .toFile(thumbPath);

    return thumbPath;
  } catch (err) {
    console.warn(`[Thumbnail] Generation failed for ${dir}/${filename}:`, err.message);
    return null;
  }
}

app.get('/api/thumbnail/:dir/:file', async (req, res) => {
  try {
    const dir = decodeURIComponent(req.params.dir);
    const file = decodeURIComponent(req.params.file);
    const thumbPath = await getOrGenerateThumbnail(dir, file);
    if (thumbPath && fs.existsSync(thumbPath)) {
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      return res.sendFile(thumbPath);
    }

    // Fallback: serve original if thumbnail fails
    let originalPath = path.join(config.storagePath, dir, file);
    if (!fs.existsSync(originalPath)) {
      const baseId = getBaseIsbn(dir);
      if (baseId && baseId !== dir) originalPath = path.join(config.storagePath, baseId, file);
    }
    if (isValidImageFile(originalPath)) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.sendFile(originalPath);
    }
    res.status(404).send('Image not found');
  } catch (e) {
    res.status(500).send('Thumbnail error');
  }
});

// Serve saved shots statically with peer proxy/caching fallback
app.use('/proofs', (req, res, next) => {
  express.static(config.storagePath)(req, res, async () => {
    const cleanReqPath = decodeURIComponent(req.path.split('?')[0]).replace(/^[\\\/]/, '');

    // High-priority handler for box-level shots (/proofs/_boxes/:boxKey/:filename) across all storage folders
    if (cleanReqPath.startsWith('_boxes/') || cleanReqPath.startsWith('_boxes\\')) {
      const parts = cleanReqPath.split(/[\\\/]/);
      if (parts.length >= 3) {
        const boxKey = parts[1];
        const filename = parts[2];
        const [lot, ...boxParts] = boxKey.split('__');
        const box = boxParts.join('__');
        const foundBoxDir = findBoxStorageDir(lot, box);
        if (foundBoxDir) {
          const filePath = path.join(foundBoxDir, filename);
          if (isValidImageFile(filePath)) {
            return res.sendFile(filePath);
          }
        }
      }
    }

    // Fallback for multi-part files stored in base ISBN directory
    const pathParts = cleanReqPath.split(/[\\\/]/);
    if (pathParts.length >= 2) {
      const [idPart, ...rest] = pathParts;
      const baseId = getBaseIsbn(idPart);
      if (baseId && baseId !== idPart) {
        const fallbackPath = path.join(config.storagePath, baseId, rest.join(path.sep));
        if (isValidImageFile(fallbackPath)) {
          return res.sendFile(fallbackPath);
        }
      }
    }

    // Multi-client storage fallback (e.g. proof stored in Jaguar while active profile is Mustang or vice-versa)
    if (config.clientProfiles) {
      for (const p of Object.values(config.clientProfiles)) {
        if (p.storagePath && p.storagePath !== config.storagePath) {
          const altPath = path.join(p.storagePath, cleanReqPath);
          if (isValidImageFile(altPath)) {
            return res.sendFile(altPath);
          }
        }
      }
    }

    // Fallback for parent root folder (e.g. C:\Journal_Proofs) across both Mustang and Jaguar
    const parentDir = path.dirname(config.storagePath);
    if (fs.existsSync(parentDir)) {
      const legacyPath = path.join(parentDir, cleanReqPath);
      if (isValidImageFile(legacyPath)) {
        return res.sendFile(legacyPath);
      }
      if (pathParts.length >= 2) {
        const [idPart, ...rest] = pathParts;
        const baseId = getBaseIsbn(idPart);
        if (baseId && baseId !== idPart) {
          const legacyBaseFallback = path.join(parentDir, baseId, rest.join(path.sep));
          if (isValidImageFile(legacyBaseFallback)) {
            return res.sendFile(legacyBaseFallback);
          }
        }
      }
    }

    // If not found locally, attempt to fetch from peer PC (e.g. PC 1) over LAN
    if (config.peerIp && isPeerReachable()) {
      try {
        const peerUrl = `http://${config.peerIp}:${config.peerPort || 3001}/proofs${req.url}`;
        const peerRes = await fetch(peerUrl, {
          headers: getLocalHeadersForPeer(),
          signal: AbortSignal.timeout(1500)
        }).catch(() => null);
        if (peerRes && peerRes.ok) {
          markPeerSuccess();
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
        } else if (!peerRes) {
          markPeerFailure();
        }
      } catch (err) {
        markPeerFailure();
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
  const prevIsbn = currentSession.activeIsbn;
  if (prevIsbn) {
    cleanupSingleEmptyProofFolder(prevIsbn).catch(() => {});
  }
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
    // Note: Do NOT delete existing picture files! Closing/discarding the session preserves all captured photos.
    if (targetIsbn) {
      cleanupSingleEmptyProofFolder(targetIsbn).catch(() => {});
    }
    currentSession = {
      activeIsbn: '',
      baseIsbn: '',
      lotNumber: req.body?.lotNumber || currentSession.lotNumber || '',
      boxNumber: req.body?.boxNumber || currentSession.boxNumber || '',
      currentStep: 'SCAN_ISBN',
      shots: { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null, 7: null },
      metadata: null,
      bookDetails: null,
      copyNumber: 1,
      isProcessable: true
    };
    broadcastSession('SESSION_RESET', { discarded: true, isbn: targetIsbn });
    res.json({ success: true, message: 'Active session closed without deleting pictures', isbn: targetIsbn });
  } catch (err) {
    console.error('Error closing session:', err);
    res.status(500).json({ error: 'Failed to close session', details: err.message });
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

      const cleanGroupItems = grp.rawItems.map(({ item, originalIdx }) => {
        const lotNumber = item.lotNumber ? String(item.lotNumber).trim() : '';
        const rawProject = item.project ? String(item.project).trim() : '';
        const itemClient = isJaguarLot(lotNumber, rawProject, item.client) ? 'Jaguar' : 'Mustang';
        return {
          sNo: item.sNo ? String(item.sNo).trim() : String(originalIdx + 1),
          isbn: String(item.isbn || '').trim(),
          lotNumber,
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
          client: itemClient,
          importedAt: importTimestamp,
          manifestId: manifestId,
          manifestFilename: safeFilename,
          sheetName: grp.sheetName
        };
      });

      const processableCount = cleanGroupItems.filter(i => i.isProcessable).length;
      const nonProcessableCount = cleanGroupItems.length - processableCount;
      const lotNumbers = grp.lotNumber ? [grp.lotNumber] : [];
      const grpIsJaguar = lotNumbers.some(l => isJaguarLot(l)) || (cleanGroupItems[0] && cleanGroupItems[0].client === 'Jaguar');

      newManifestEntries.push({
        id: manifestId,
        filename: safeFilename,
        sheetName: grp.sheetName,
        lotNumber: grp.lotNumber,
        lotNumbers,
        client: grpIsJaguar ? 'Jaguar' : 'Mustang',
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
    broadcastSession('MANIFEST_UPDATED', {
      totalCount: manifestData.totalCount,
      lastUpdated: manifestData.lastUpdated,
      filename: manifestData.filename
    });

    // Run self-heal and peer manifest replication asynchronously so HTTP response is immediate
    setImmediate(() => {
      selfHealAllMetadataWithManifest().catch(() => {});
      if (!req.body.isReplication) {
        for (const peerAddr of getAllTargetPeers()) {
          fetch(`http://${peerAddr}/api/manifest/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getLocalHeadersForPeer() },
            body: JSON.stringify({ items, filename, replaceAll, isReplication: true }),
            signal: AbortSignal.timeout(8000)
          }).catch(() => {});
        }
      }
    });

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
  const targetClient = req.query.client || config.activeClient;
  const validation = validateAndCleanBarcode(rawIsbn, manifestData.items, targetClient);

  if (!validation.valid) {
    const statusCode = validation.clientMismatch ? 403 : 400;
    return res.status(statusCode).json({
      valid: false,
      error: validation.error,
      clientMismatch: Boolean(validation.clientMismatch),
      itemClient: validation.itemClient,
      isDoubleScan: Boolean(validation.isDoubleScan),
      isMerged: Boolean(validation.isMerged),
      cleaned: validation.cleaned,
      manifestActive: Boolean(manifestData.items && manifestData.items.length > 0),
      found: false,
      isProcessable: false,
      reason: validation.error
    });
  }

  const effectiveIsbn = validation.cleaned;
  const match = validation.manifestMatch || findManifestItem(effectiveIsbn, targetClient) || findManifestItem(rawIsbn, targetClient);

  if (match) {
    return res.json({
      valid: true,
      cleaned: effectiveIsbn,
      isDoubleScan: Boolean(validation.isDoubleScan),
      manifestActive: true,
      found: true,
      isProcessable: match.isProcessable,
      item: match,
      reason: match.reason || (!match.isProcessable ? 'Marked as Not Processable in Manifest' : '')
    });
  }

  if (manifestData.items && manifestData.items.length > 0) {
    return res.status(404).json({
      valid: false,
      manifestActive: true,
      found: false,
      isProcessable: false,
      error: `ISBN/Barcode "${rawIsbn}" was not found in the uploaded manifest.`,
      reason: `ISBN "${rawIsbn}" was not found in the uploaded manifest.`
    });
  }

  return res.json({
    valid: true,
    cleaned: effectiveIsbn,
    isDoubleScan: Boolean(validation.isDoubleScan),
    manifestActive: false,
    found: false,
    isProcessable: true
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
    broadcastSession('MANIFEST_UPDATED', {
      totalCount: manifestData.totalCount,
      lastUpdated: manifestData.lastUpdated
    });
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
  broadcastSession('MANIFEST_UPDATED', { totalCount: 0, lastUpdated: null });
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
    manifestItemCount: manifestData.totalCount || 0,
    activeClient: config.activeClient || 'Mustang',
    clientProfiles: config.clientProfiles || DEFAULT_CLIENT_PROFILES
  });
});

app.get('/api/system/client', (req, res) => {
  res.json({
    activeClient: config.activeClient || 'Mustang',
    clientProfiles: config.clientProfiles || DEFAULT_CLIENT_PROFILES
  });
});

app.post('/api/system/client', (req, res) => {
  const { client } = req.body;
  if (!client || typeof client !== 'string') {
    return res.status(400).json({ error: 'Client name is required (e.g. Mustang, Jaguar)' });
  }

  const clientName = client.trim();

  // Preserve any modified config on the previous profile before switching
  if (config.activeClient && config.clientProfiles && config.clientProfiles[config.activeClient]) {
    config.clientProfiles[config.activeClient] = {
      ...config.clientProfiles[config.activeClient],
      storagePath: config.storagePath,
      s3Enabled: config.s3Enabled !== false,
      s3Bucket: config.s3Bucket || '',
      s3Region: config.s3Region || 'ap-southeast-1',
      s3AccessKeyId: config.s3AccessKeyId || '',
      s3SecretAccessKey: config.s3SecretAccessKey || '',
      s3Prefix: config.s3Prefix || '',
      s3CustomEndpoint: config.s3CustomEndpoint || ''
    };
  }

  syncConfigWithActiveClient(clientName);
  saveConfig();

  // Reset active session state on client switch to guarantee isolation
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

  broadcastSession('CLIENT_SWITCHED', {
    activeClient: config.activeClient,
    storagePath: config.storagePath
  });

  if (config.s3Enabled !== false && config.s3Bucket && config.s3AccessKeyId) {
    scanAllPendingJournalsForS3().catch(() => {});
  }

  res.json({
    success: true,
    activeClient: config.activeClient,
    config,
    session: currentSession
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
    enforceManifest,
    activeClient,
    clientProfiles
  } = req.body;
  
  if (activeClient && typeof activeClient === 'string') {
    const newClient = activeClient.trim();
    if (newClient !== config.activeClient) {
      syncConfigWithActiveClient(newClient);
    }
  }

  if (clientProfiles && typeof clientProfiles === 'object') {
    config.clientProfiles = {
      ...config.clientProfiles,
      ...clientProfiles
    };
  }

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

  // Sync active profile back to config.clientProfiles
  if (config.activeClient && config.clientProfiles && config.clientProfiles[config.activeClient]) {
    config.clientProfiles[config.activeClient] = {
      ...config.clientProfiles[config.activeClient],
      storagePath: config.storagePath,
      s3Enabled: config.s3Enabled !== false,
      s3Bucket: config.s3Bucket,
      s3Region: config.s3Region,
      s3AccessKeyId: config.s3AccessKeyId,
      s3SecretAccessKey: config.s3SecretAccessKey,
      s3Prefix: config.s3Prefix,
      s3CustomEndpoint: config.s3CustomEndpoint
    };
  }

  saveConfig();
  if (config.s3Enabled !== false && config.s3Bucket && config.s3AccessKeyId) {
    scanAllPendingJournalsForS3().catch(() => {});
  }
  if (config.peerSyncEnabled && config.peerIp) {
    syncAllBoxShotsFromPeer().catch(() => {});
  }
  res.json({ success: true, config });
});

// -------------------------------------------------------------
// AWS S3 Cloud Upload & Client Proof Sharing Endpoints
// -------------------------------------------------------------

// Resolve effective S3 configuration with fallback across client profiles & environment
function getEffectiveS3Config(customConfig = {}) {
  const mustangProfile = config.clientProfiles?.Mustang || {};
  const activeProfile = (config.activeClient && config.clientProfiles?.[config.activeClient]) || {};
  const bucket = (customConfig.s3Bucket || activeProfile.s3Bucket || config.s3Bucket || mustangProfile.s3Bucket || process.env.AWS_S3_BUCKET || '').trim();
  const region = (customConfig.s3Region || activeProfile.s3Region || config.s3Region || mustangProfile.s3Region || process.env.AWS_REGION || 'ap-southeast-1').trim();
  const accessKeyId = (customConfig.s3AccessKeyId || activeProfile.s3AccessKeyId || config.s3AccessKeyId || mustangProfile.s3AccessKeyId || process.env.AWS_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (customConfig.s3SecretAccessKey || activeProfile.s3SecretAccessKey || config.s3SecretAccessKey || mustangProfile.s3SecretAccessKey || process.env.AWS_SECRET_ACCESS_KEY || '').trim();
  let prefix = (customConfig.s3Prefix || activeProfile.s3Prefix || config.s3Prefix || mustangProfile.s3Prefix || 'innoscanmussgp1/JournalVerificationImages/').trim();
  if (prefix && !prefix.endsWith('/')) prefix += '/';
  const customEndpoint = (customConfig.s3CustomEndpoint || activeProfile.s3CustomEndpoint || config.s3CustomEndpoint || mustangProfile.s3CustomEndpoint || process.env.AWS_S3_ENDPOINT || '').trim();
  const profileEnabled = activeProfile.s3Enabled !== undefined ? activeProfile.s3Enabled : config.s3Enabled;
  const enabled = customConfig.s3Enabled !== undefined
    ? Boolean(customConfig.s3Enabled)
    : (profileEnabled !== false || Boolean(customConfig.forceUpload) || Boolean(customConfig.manualTrigger));

  return {
    s3Enabled: enabled,
    s3Bucket: bucket,
    s3Region: region,
    s3AccessKeyId: accessKeyId,
    s3SecretAccessKey: secretAccessKey,
    s3Prefix: prefix,
    s3CustomEndpoint: customEndpoint,
    isConfigured: Boolean(bucket && accessKeyId && secretAccessKey)
  };
}

// S3 Client factory helper
function getS3Client(customConfig = {}) {
  const eff = getEffectiveS3Config(customConfig);
  if (!eff.s3AccessKeyId || !eff.s3SecretAccessKey) {
    return null;
  }

  const clientOptions = {
    region: eff.s3Region,
    credentials: {
      accessKeyId: eff.s3AccessKeyId,
      secretAccessKey: eff.s3SecretAccessKey
    }
  };

  if (eff.s3CustomEndpoint) {
    clientOptions.endpoint = eff.s3CustomEndpoint;
    clientOptions.forcePathStyle = true;
  }

  return new S3Client(clientOptions);
}

// S3 Test Connection
app.post('/api/s3/test-connection', async (req, res) => {
  try {
    const eff = getEffectiveS3Config(req.body || {});
    const targetBucket = eff.s3Bucket;
    const targetRegion = eff.s3Region;
    const accessKeyId = eff.s3AccessKeyId;
    const secretAccessKey = eff.s3SecretAccessKey;
    const customEndpoint = eff.s3CustomEndpoint;

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

// Helper: Format date as YYYY-MM-DD in local time
function formatLocalDate(dateInput) {
  if (!dateInput) return formatLocalDate(new Date());
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return formatLocalDate(new Date());
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Helper: Determine the capture date for an ISBN from metadata or local filesystem timestamps
function getIsbnCaptureDate(cleanIsbn, folderPath, metadata) {
  if (!metadata) {
    metadata = readIsbnMetadata(cleanIsbn);
  }

  // 1. Check metadata shots: prioritize journal-specific shots (3..7)
  if (metadata?.shots) {
    for (let s = 3; s <= 7; s++) {
      const shot = metadata.shots[s];
      if (shot && (shot.savedAt || shot.capturedAt)) {
        return formatLocalDate(shot.savedAt || shot.capturedAt);
      }
    }
  }

  // 2. Check metadata level timestamps
  if (metadata?.completedAt) return formatLocalDate(metadata.completedAt);
  if (metadata?.capturedAt) return formatLocalDate(metadata.capturedAt);
  if (metadata?.updatedAt) return formatLocalDate(metadata.updatedAt);

  // 3. Check actual journal picture files in local folderPath (excluding box shots)
  if (folderPath && fs.existsSync(folderPath)) {
    try {
      const files = fs.readdirSync(folderPath);
      const imgFiles = files.filter(f => f.match(/\.(jpg|jpeg|png)$/i) && !f.startsWith('.'));
      const journalImgs = imgFiles.filter(f => !f.toLowerCase().includes('box'));

      for (const f of journalImgs) {
        const stat = fs.statSync(path.join(folderPath, f));
        const fileTime = stat.mtime || stat.birthtime;
        if (fileTime) {
          return formatLocalDate(fileTime);
        }
      }
    } catch (e) {}
  }

  // 4. Default to current local date
  return formatLocalDate(new Date());
}

// Core helper: Upload proof folder for a specific ISBN to S3 (Pictures ONLY, no metadata.json)
async function uploadIsbnToS3(cleanIsbn, customConfig = {}) {
  const folderPath = getFolderForIdentifier(cleanIsbn);
  if (!fs.existsSync(folderPath)) {
    throw new Error(`No local folder found for ISBN ${cleanIsbn}`);
  }

  // Ensure box shots (Shot 1 & Shot 2) are inherited before checking completeness or uploading
  let meta = readIsbnMetadata(cleanIsbn);
  const baseIsbn = getBaseIsbn(cleanIsbn);
  const manifestMatch = findManifestItem(baseIsbn) || findManifestItem(cleanIsbn);
  const resolvedLot = meta?.lotNumber || manifestMatch?.lotNumber || '';
  const resolvedBox = meta?.boxNumber || manifestMatch?.boxNumber || '';
  if (resolvedBox && (!findShotFileInFolder(folderPath, 1, cleanIsbn) || !findShotFileInFolder(folderPath, 2, cleanIsbn))) {
    await applyBoxShotsToIsbn(cleanIsbn, resolvedLot, resolvedBox, folderPath).catch(() => {});
    meta = readIsbnMetadata(cleanIsbn) || meta;
  }

  const itemClient = meta?.client || manifestMatch?.client || (isJaguarLot(resolvedLot, manifestMatch?.project) ? 'Jaguar' : 'Mustang');
  const clientProfile = config.clientProfiles?.[itemClient] || {};

  const eff = getEffectiveS3Config(customConfig);
  const targetBucket = eff.s3Bucket;
  const targetRegion = eff.s3Region;
  let prefix = (customConfig.s3Prefix || clientProfile.s3Prefix || eff.s3Prefix || 'innoscanmussgp1/JournalVerificationImages/').trim();
  if (prefix && !prefix.endsWith('/')) prefix += '/';

  const s3 = getS3Client(eff);

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

  // Only upload valid photo image files (exclude json/zip/hidden/backup files like bak.* or .bak_*)
  const allFilesInFolder = await fs.readdir(folderPath);
  const partNum = getPartNumber(cleanIsbn);
  const partTag = partNum !== null ? `_part${partNum}`.toLowerCase() : null;

  let imageFiles = allFilesInFolder.filter(filename => {
    if (!filename.match(/\.(jpg|jpeg|png)$/i)) return false;
    if (filename.startsWith('.')) return false;
    const lower = filename.toLowerCase();
    if (lower.startsWith('bak') || lower.includes('.bak') || lower.includes('_bak') || lower.includes('bak.') || lower.includes('backup')) {
      return false;
    }
    if (partTag) {
      return lower.includes(partTag);
    }
    return true;
  });

  if (imageFiles.length === 0) {
    throw new Error(`Folder for ISBN ${cleanIsbn} contains no captured picture files.`);
  }

  // Check if journal verification is complete before uploading to S3
  let shotsCount = 0;
  for (let s = 1; s <= 7; s++) {
    if (findShotFileInFolder(folderPath, s, cleanIsbn)) shotsCount++;
  }
  // Also check if this is a base folder containing complete multi-part captures
  if (shotsCount < 7 && !partTag) {
    const parts = await findExistingParts(baseIsbn);
    if (parts.length > 0 && parts.every(p => p.isComplete || p.shotsCount >= 7)) {
      shotsCount = 7;
    }
  }
  const isComplete = shotsCount >= 7 || Boolean(meta && meta.isComplete && shotsCount >= 5);
  if (!isComplete) {
    throw new Error(`Journal verification for ISBN ${cleanIsbn} is incomplete (${shotsCount}/7 shots). Pictures should be directed to S3 when completed only.`);
  }

  const uploadedFiles = [];

  // Determine capture date for this specific ISBN
  const captureDate = getIsbnCaptureDate(cleanIsbn, folderPath, meta);

  // Build S3 folder key incorporating the capture date
  let s3FolderPrefix = prefix;

  // Support placeholders {lot} / {lotNumber} and {project}
  if (/\{lot(?:number)?\}/i.test(s3FolderPrefix) && resolvedLot) {
    s3FolderPrefix = s3FolderPrefix.replace(/\{lot(?:number)?\}/gi, resolvedLot);
  }
  if (/\{project\}/i.test(s3FolderPrefix) && manifestMatch?.project) {
    s3FolderPrefix = s3FolderPrefix.replace(/\{project\}/gi, manifestMatch.project);
  }

  // Incorporate capture date
  if (/\{date\}/i.test(s3FolderPrefix)) {
    s3FolderPrefix = s3FolderPrefix.replace(/\{date\}/gi, captureDate);
  } else if (/\/\d{4}-\d{2}-\d{2}\/$/.test(s3FolderPrefix)) {
    // If prefix already ends with an explicit date folder, substitute with the ISBN's actual capture date
    s3FolderPrefix = s3FolderPrefix.replace(/\/\d{4}-\d{2}-\d{2}\/$/, `/${captureDate}/`);
  } else {
    // Otherwise automatically append the capture date subfolder
    s3FolderPrefix = `${s3FolderPrefix}${captureDate}/`;
  }

  if (!s3FolderPrefix.endsWith('/')) s3FolderPrefix += '/';

  // In multi-part sets, all parts are stored in 1 single base ISBN folder, not separated folders
  const s3BaseFolderKey = `${s3FolderPrefix}${baseIsbn}`;

  // Clean up any stale retake photos or backup files on S3 so S3 only holds the active photos
  try {
    const listRes = await s3.send(new ListObjectsV2Command({
      Bucket: targetBucket,
      Prefix: `${s3BaseFolderKey}/`
    }));

    if (listRes.Contents && listRes.Contents.length > 0) {
      const allowedS3Keys = new Set(imageFiles.map(f => `${s3BaseFolderKey}/${f}`));
      for (const obj of listRes.Contents) {
        const objKey = obj.Key;
        const baseName = path.basename(objKey).toLowerCase();
        // If this object is a backup file, remove it
        if (baseName.includes('bak') || baseName.startsWith('.')) {
          console.log(`[S3 Cleanup] Removing stale/backup file from S3: ${objKey}`);
          await s3.send(new DeleteObjectCommand({
            Bucket: targetBucket,
            Key: objKey
          })).catch(() => {});
        } else if (partTag) {
          // In multi-part, only clean up stale retakes for THIS specific part tag
          if (baseName.includes(partTag) && !allowedS3Keys.has(objKey)) {
            console.log(`[S3 Cleanup] Removing stale ${partTag} file from S3: ${objKey}`);
            await s3.send(new DeleteObjectCommand({
              Bucket: targetBucket,
              Key: objKey
            })).catch(() => {});
          }
        } else if (!allowedS3Keys.has(objKey) && !/_part\d+/i.test(baseName)) {
          console.log(`[S3 Cleanup] Removing stale file from S3: ${objKey}`);
          await s3.send(new DeleteObjectCommand({
            Bucket: targetBucket,
            Key: objKey
          })).catch(() => {});
        }
      }
    }
  } catch (cleanErr) {
    console.warn('[S3 Cleanup] Non-critical warning listing existing S3 files:', cleanErr.message);
  }

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
    captureDate,
    s3FolderUri,
    shareableLink,
    fileCount: uploadedFiles.length
  };
  await saveIsbnMetadata(cleanIsbn, metadata);

  // If this was a multi-part upload, also update the base ISBN metadata so it reflects the shared S3 folder
  if (cleanIsbn !== baseIsbn) {
    let baseMeta = readIsbnMetadata(baseIsbn);
    if (baseMeta) {
      baseMeta.s3Upload = {
        ...(baseMeta.s3Upload || {}),
        uploadedAt: metadata.s3Upload.uploadedAt,
        bucket: targetBucket,
        region: targetRegion,
        captureDate,
        s3FolderUri,
        shareableLink
      };
      await saveIsbnMetadata(baseIsbn, baseMeta);
    }
  }

  if (currentSession.activeIsbn === cleanIsbn && currentSession.metadata) {
    currentSession.metadata.s3Upload = metadata.s3Upload;
  }

  broadcastSession('S3_AUTO_UPLOADED', {
    isbn: cleanIsbn,
    s3Upload: metadata.s3Upload
  });

  console.log(`[S3 Auto-Upload] Successfully uploaded ${uploadedFiles.length} photo(s) for ${cleanIsbn} to ${s3FolderUri} (Capture Date: ${captureDate})`);

  return {
    success: true,
    isbn: cleanIsbn,
    bucket: targetBucket,
    region: targetRegion,
    captureDate,
    prefix: s3FolderPrefix,
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
let s3QueueForceUpload = false;
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

function enqueueS3Upload(cleanIsbn, forceUpload = false) {
  if (!cleanIsbn || cleanIsbn.startsWith('.') || cleanIsbn.startsWith('_')) return;
  if (forceUpload) s3QueueForceUpload = true;
  s3SyncQueue.add(cleanIsbn);
  processS3Queue(s3QueueForceUpload).catch(err => console.error('[S3 Queue Error]', err));
}

async function processS3Queue(forceUpload = false) {
  if (isSyncingS3 || s3SyncQueue.size === 0) return;
  const eff = getEffectiveS3Config({ forceUpload, manualTrigger: true });
  if (!eff.isConfigured) {
    return;
  }

  isSyncingS3 = true;
  s3SyncProgress.isSyncing = true;
  s3SyncProgress.completedCount = 0;
  s3SyncProgress.failedCount = 0;
  s3SyncProgress.lastError = null;
  s3SyncProgress.totalPending = s3SyncQueue.size;

  try {
    while (s3SyncQueue.size > 0) {
      const nextIsbn = Array.from(s3SyncQueue)[0];
      s3SyncQueue.delete(nextIsbn);
      s3SyncProgress.currentIsbn = nextIsbn;

      try {
        await uploadIsbnToS3(nextIsbn, { forceUpload: forceUpload || s3QueueForceUpload });
        s3SyncProgress.completedCount++;
      } catch (err) {
        console.error(`[S3 Auto-Sync] Error uploading ${nextIsbn}:`, err.message);
        s3SyncProgress.failedCount++;
        s3SyncProgress.lastError = `${nextIsbn}: ${err.message}`;
      }
    }
  } finally {
    isSyncingS3 = false;
    s3QueueForceUpload = false;
    s3SyncProgress.isSyncing = false;
    s3SyncProgress.currentIsbn = null;
    s3SyncProgress.lastSyncAt = new Date().toISOString();
  }
}

// Helper: Get all journal folders across active storage path, all client profiles, and legacy root directory
async function getAllCandidateJournalFolders() {
  const folderMap = new Map(); // entryName -> fullFolderPath
  const reservedNames = new Set(['mustang', 'jaguar', '_boxes', '.metadata', 'storage', '.backups']);

  const scanRoot = async (rootDir) => {
    if (!rootDir || !fs.existsSync(rootDir)) return;
    try {
      const entries = await fs.readdir(rootDir);
      for (const entry of entries) {
        if (entry.startsWith('.') || entry.startsWith('_')) continue;
        if (reservedNames.has(entry.toLowerCase())) continue;
        if (folderMap.has(entry)) continue;
        const fullPath = path.join(rootDir, entry);
        const stat = await fs.stat(fullPath).catch(() => null);
        if (stat && stat.isDirectory()) {
          folderMap.set(entry, fullPath);
        }
      }
    } catch (e) {}
  };

  await scanRoot(config.storagePath);

  if (config.clientProfiles) {
    for (const p of Object.values(config.clientProfiles)) {
      if (p.storagePath && p.storagePath !== config.storagePath) {
        await scanRoot(p.storagePath);
      }
    }
  }

  if (config.storagePath) {
    const parentDir = path.dirname(config.storagePath);
    if (parentDir && parentDir !== config.storagePath) {
      await scanRoot(parentDir);
    }
  }

  if (process.platform === 'win32') {
    await scanRoot('C:\\Journal_Proofs\\Mustang');
    await scanRoot('C:\\Journal_Proofs\\Jaguar');
    await scanRoot('C:\\Journal_Proofs');
  }

  return folderMap;
}

let isScanningS3 = false;

async function scanAllPendingJournalsForS3(forceAll = false, manualTrigger = false) {
  if (isScanningS3 && !manualTrigger) {
    return { eligible: true, queued: 0, totalQueueSize: s3SyncQueue.size };
  }
  isScanningS3 = true;
  try {
    const eff = getEffectiveS3Config({ forceUpload: forceAll, manualTrigger });
    if (!eff.isConfigured) {
      return { eligible: false, message: 'S3 credentials not configured. Please check AWS Bucket and Access Keys in Settings.' };
    }
    if (!eff.s3Enabled && !manualTrigger && !forceAll) {
      return { eligible: false, message: `S3 Auto-Sync is currently disabled for ${config.activeClient || 'this client'}.` };
    }

    const folderMap = await getAllCandidateJournalFolders();
    if (folderMap.size === 0) {
      return { eligible: true, queued: 0, totalQueueSize: s3SyncQueue.size };
    }

    let queuedCount = 0;
    let processedIdx = 0;

    for (const [entry, folderPath] of folderMap.entries()) {
      processedIdx++;
      if (processedIdx % 30 === 0) {
        await new Promise(r => setImmediate(r));
      }

      // Fast skip for already-uploaded single-book journals during background daemon scans
      let meta = readIsbnMetadata(entry);
      if (!forceAll && !manualTrigger && meta?.s3Upload?.uploadedAt && meta.isComplete) {
        continue;
      }

      const allFiles = await fs.readdir(folderPath).catch(() => []);
      let imageFiles = allFiles.filter(f => f.match(/\.(jpg|jpeg|png)$/i) && !f.startsWith('.'));
      if (imageFiles.length === 0) continue;

      // Clean up legacy metadata.json from photo folder
      if (allFiles.includes('metadata.json')) {
        const strayMeta = path.join(folderPath, 'metadata.json');
        try {
          const m = await fs.readJson(strayMeta);
          await saveIsbnMetadata(entry, m);
          await fs.remove(strayMeta);
        } catch (e) {}
      }

      // Only check multi-part if filenames actually contain _Part<N>
      const hasPartFiles = imageFiles.some(f => /_part\d+/i.test(f));
      if (hasPartFiles) {
        const existingParts = await findExistingParts(entry, allFiles);
        if (existingParts.length > 0) {
          for (const p of existingParts) {
            let pMeta = readIsbnMetadata(p.identifier);
            const manifestMatch = findManifestItem(entry) || findManifestItem(p.identifier);
            const resolvedLot = pMeta?.lotNumber || manifestMatch?.lotNumber || '';
            const resolvedBox = pMeta?.boxNumber || manifestMatch?.boxNumber || '';
            if (resolvedBox && (!findShotFileInFolder(folderPath, 1, p.identifier, allFiles) || !findShotFileInFolder(folderPath, 2, p.identifier, allFiles))) {
              await applyBoxShotsToIsbn(p.identifier, resolvedLot, resolvedBox, folderPath).catch(() => {});
              pMeta = readIsbnMetadata(p.identifier) || pMeta;
            }

            let pShotsFound = 0;
            for (let s = 1; s <= 7; s++) {
              if (findShotFileInFolder(folderPath, s, p.identifier)) pShotsFound++;
            }
            const pComplete = pShotsFound >= 7 || Boolean(pMeta && pMeta.isComplete && pShotsFound >= 5);
            const pHasUploaded = Boolean(pMeta?.s3Upload?.uploadedAt);
            const partTag = `_part${p.partNumber}`.toLowerCase();
            const partImageCount = imageFiles.filter(f => f.toLowerCase().includes(partTag)).length;
            const pUploadedCount = pMeta?.s3Upload?.fileCount || 0;

            // Pictures are directed to S3 when completed only
            if (pComplete) {
              if (!pHasUploaded || partImageCount > pUploadedCount || forceAll) {
                s3SyncQueue.add(p.identifier);
                queuedCount++;
              }
            }
          }
          continue;
        }
      }

      const hasUploaded = Boolean(meta?.s3Upload?.uploadedAt);
      const uploadedFileCount = meta?.s3Upload?.fileCount || 0;
      if (!forceAll && hasUploaded && imageFiles.length <= uploadedFileCount) {
        continue;
      }

      const baseIsbn = getBaseIsbn(entry);
      const manifestMatch = findManifestItem(baseIsbn) || findManifestItem(entry);
      const resolvedLot = meta?.lotNumber || manifestMatch?.lotNumber || '';
      const resolvedBox = meta?.boxNumber || manifestMatch?.boxNumber || '';

      // Inherit Shot 1 (Box A) & Shot 2 (Box B) if captured in local _boxes before checking completeness
      if (resolvedBox && (!findShotFileInFolder(folderPath, 1, entry, allFiles) || !findShotFileInFolder(folderPath, 2, entry, allFiles))) {
        const resInherit = await applyBoxShotsToIsbn(entry, resolvedLot, resolvedBox, folderPath).catch(() => ({ inherited1: false, inherited2: false }));
        if (resInherit && (resInherit.inherited1 || resInherit.inherited2)) {
          meta = readIsbnMetadata(entry) || meta;
          const refreshedFiles = await fs.readdir(folderPath).catch(() => []);
          imageFiles = refreshedFiles.filter(f => f.match(/\.(jpg|jpeg|png)$/i) && !f.startsWith('.'));
        }
      }

      let shotsFound = 0;
      for (let s = 1; s <= 7; s++) {
        if (findShotFileInFolder(folderPath, s, entry, imageFiles)) shotsFound++;
      }
      const isComplete = shotsFound >= 7 || Boolean(meta && meta.isComplete && shotsFound >= 5);

      // Pictures are directed to S3 when completed only
      if (!isComplete) {
        continue;
      }

      // Queue for S3 upload ONLY if 100% complete and not yet uploaded, or if forced
      if (!hasUploaded || imageFiles.length > uploadedFileCount || forceAll) {
        s3SyncQueue.add(entry);
        queuedCount++;
      }
    }

    if (queuedCount > 0) {
      if (forceAll) s3QueueForceUpload = true;
      console.log(`[S3 Auto-Sync Daemon] Detected ${queuedCount} complete unuploaded journal(s). Automatically uploading in background...`);
      processS3Queue(forceAll).catch(err => console.error('[S3 Queue Error]', err));
    }

    return {
      eligible: true,
      queued: queuedCount,
      totalOnDisk: folderMap.size,
      totalQueueSize: s3SyncQueue.size
    };
  } catch (err) {
    console.error('[S3 Scanner Error]', err);
    return { eligible: false, error: err.message };
  } finally {
    isScanningS3 = false;
  }
}

// Endpoint: Trigger full scan & sync of all pending journals to S3
app.post('/api/s3/sync-all', async (req, res) => {
  try {
    const force = Boolean(req.body?.force);
    await migrateAllLegacyMetadata();
    const result = await scanAllPendingJournalsForS3(force, true);
    res.json({ success: result.eligible !== false, ...result, progress: s3SyncProgress });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint: Get current S3 background auto-sync status
app.get('/api/s3/sync-status', (req, res) => {
  const eff = getEffectiveS3Config();
  res.json({
    success: true,
    queueSize: s3SyncQueue.size,
    progress: s3SyncProgress,
    s3Configured: Boolean(eff.s3Enabled && eff.isConfigured)
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
    const specificFolder = getFolderForIdentifier(cleanIsbn);
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

    // 1. Instant check in manifest first (0ms)
    const manifestMatch = findManifestItem(cleanIsbn) || findManifestItem(rawIsbn);
    if (manifestMatch && manifestMatch.title) {
      const mData = {
        title: manifestMatch.title,
        authors: manifestMatch.author || '',
        publisher: manifestMatch.publisher || '',
        publishYear: manifestMatch.publicationYear || '',
        printIssn: manifestMatch.printIssn || '',
        volume: manifestMatch.volume || '',
        issues: manifestMatch.issues || '',
        source: 'Manifest'
      };
      metadataCache.set(cleanIsbn, mData);
      return res.json({ success: true, found: true, source: 'manifest', data: mData });
    }

    if (metadataCache.has(cleanIsbn)) {
      return res.json({ success: true, found: true, source: 'cache', data: metadataCache.get(cleanIsbn) });
    }

    let bookData = null;

    if (numericOnly.length >= 9) {
      try {
        const olUrl = `https://openlibrary.org/api/books?bibkeys=ISBN:${numericOnly}&format=json&jscmd=data`;
        const olRes = await fetch(olUrl, {
          headers: { 'User-Agent': 'VerificationImages/2.0' },
          signal: AbortSignal.timeout(2000)
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
          signal: AbortSignal.timeout(2000)
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

// Lenient box equality helper (e.g. "RB-0005", "rb0005", "0005", "5" all match)
function isMatchingBoxNumber(boxA, boxB) {
  if (!boxA || !boxB) return false;
  const normA = normalizeBoxString(boxA);
  const normB = normalizeBoxString(boxB);
  if (normA === normB) return true;
  const noRbA = normA.replace(/^rb/, '');
  const noRbB = normB.replace(/^rb/, '');
  if (noRbA && noRbB && noRbA === noRbB) return true;
  const strippedA = noRbA.replace(/^0+/, '') || '0';
  const strippedB = noRbB.replace(/^0+/, '') || '0';
  return strippedA === strippedB;
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

// Helper to gather all existing candidate _boxes directories across clients & storage paths
function getAllCandidateBoxesDirs() {
  const dirs = new Set();
  if (config.storagePath) {
    dirs.add(path.join(config.storagePath, '_boxes'));
    dirs.add(path.join(path.dirname(config.storagePath), '_boxes'));
  }
  if (config.clientProfiles) {
    for (const p of Object.values(config.clientProfiles)) {
      if (p.storagePath) {
        dirs.add(path.join(p.storagePath, '_boxes'));
        dirs.add(path.join(path.dirname(p.storagePath), '_boxes'));
      }
    }
  }
  if (process.platform === 'win32') {
    dirs.add('C:\\Journal_Proofs\\_boxes');
    dirs.add('C:\\Journal_Proofs\\Jaguar\\_boxes');
    dirs.add('C:\\Journal_Proofs\\Mustang\\_boxes');
  } else {
    dirs.add(path.resolve(__dirname, 'storage/journal_proofs/_boxes'));
    dirs.add(path.resolve(__dirname, 'storage/journal_proofs/Jaguar/_boxes'));
    dirs.add(path.resolve(__dirname, 'storage/journal_proofs/Mustang/_boxes'));
  }
  return Array.from(dirs).filter(d => Boolean(d) && fs.existsSync(d));
}

// Helper to scan a _boxes directory for matching folder
function scanBoxesDirForMatch(boxesBaseDir, normLot, boxNumber) {
  if (!fs.existsSync(boxesBaseDir)) return null;
  try {
    const entries = fs.readdirSync(boxesBaseDir);
    for (const entry of entries) {
      const parts = entry.split('__');
      if (parts.length >= 2) {
        const entryLotNorm = normalizeLotString(parts[0]);
        const entryBoxRaw = parts.slice(1).join('__');
        if (isMatchingBoxNumber(entryBoxRaw, boxNumber) && 
            (entryLotNorm === normLot || normLot === 'unassigned' || entryLotNorm === 'unassigned')) {
          const candidate = path.join(boxesBaseDir, entry);
          if (dirHasBoxShots(candidate)) return candidate;
        }
      }
    }
  } catch (err) {
    console.warn('[Box Storage] Error searching _boxes directory:', err.message);
  }
  return null;
}

let cachedDiskBoxesIndex = null;
let cachedDiskBoxesTimestamp = 0;
const DISK_BOXES_CACHE_TTL_MS = 3000;

function invalidateBoxesDiskCache() {
  cachedDiskBoxesIndex = null;
  cachedDiskBoxesTimestamp = 0;
}

function getCachedDiskBoxesIndex() {
  const now = Date.now();
  if (cachedDiskBoxesIndex && (now - cachedDiskBoxesTimestamp) < DISK_BOXES_CACHE_TTL_MS) {
    return cachedDiskBoxesIndex;
  }

  const byExactKey = new Map();
  const byLotAndStrip = new Map();
  const byStripOnly = new Map();

  const candidateDirs = getAllCandidateBoxesDirs();
  for (const bDir of candidateDirs) {
    if (!fs.existsSync(bDir)) continue;
    try {
      const entries = fs.readdirSync(bDir);
      for (const entry of entries) {
        if (byExactKey.has(entry)) continue;
        const parts = entry.split('__');
        if (parts.length >= 2) {
          const entryLot = parts[0];
          const entryBox = parts.slice(1).join('__');
          const boxDir = path.join(bDir, entry);
          const boxShots = getBoxShotsFromDir(boxDir);
          if (boxShots.hasBoxShot || boxShots.hasUnboxShot) {
            const record = { entry, entryLot, entryBox, boxDir, boxShots };
            byExactKey.set(entry, record);
            const normLot = normalizeLotString(entryLot);
            const stripBox = stripBoxForIndex(entryBox);
            if (stripBox) {
              const lotStripKey = `${normLot}__${stripBox}`;
              if (!byLotAndStrip.has(lotStripKey)) {
                byLotAndStrip.set(lotStripKey, record);
              }
              if (!byStripOnly.has(stripBox)) {
                byStripOnly.set(stripBox, record);
              }
            }
          }
        }
      }
    } catch (e) {}
  }

  cachedDiskBoxesIndex = { byExactKey, byLotAndStrip, byStripOnly };
  cachedDiskBoxesTimestamp = now;
  return cachedDiskBoxesIndex;
}

// Multi-tier resolver to locate the Box storage directory on disk across Lots, clients, and formats (O(1) via cache)
function findBoxStorageDir(lotNumber, boxNumber) {
  if (!boxNumber) return null;
  const idx = getCachedDiskBoxesIndex();
  const directKey = getBoxKey(lotNumber, boxNumber);
  if (directKey && idx.byExactKey.has(directKey)) {
    return idx.byExactKey.get(directKey).boxDir;
  }

  const stripBox = stripBoxForIndex(boxNumber);
  if (stripBox) {
    const normLot = normalizeLotString(lotNumber);
    const byLotStrip = idx.byLotAndStrip.get(`${normLot}__${stripBox}`) || idx.byLotAndStrip.get(`unassigned__${stripBox}`);
    if (byLotStrip) return byLotStrip.boxDir;
    const byStrip = idx.byStripOnly.get(stripBox);
    if (byStrip && (normLot === 'unassigned' || normalizeLotString(byStrip.entryLot) === 'unassigned' || normalizeLotString(byStrip.entryLot) === normLot)) {
      return byStrip.boxDir;
    }
  }

  return null;
}

function getBoxStorageDir(lotNumber, boxNumber) {
  const found = findBoxStorageDir(lotNumber, boxNumber);
  if (found) return found;
  const key = getBoxKey(lotNumber, boxNumber);
  if (!key) return null;
  const isJag = isJaguarLot(lotNumber);
  const targetClient = isJag ? 'Jaguar' : 'Mustang';
  const clientStorage = config.clientProfiles?.[targetClient]?.storagePath || config.storagePath;
  return path.join(clientStorage, '_boxes', key);
}

function getBoxShotsFromDir(boxDir) {
  if (!boxDir || !fs.existsSync(boxDir)) {
    return { hasBoxShot: false, hasUnboxShot: false, hasBoxAShot: false, hasBoxBShot: false, boxShotUrl: null, unboxShotUrl: null, boxMeta: null };
  }

  let files = [];
  try {
    files = fs.readdirSync(boxDir);
  } catch (e) {
    files = [];
  }

  const shot1File = (files.includes('shot_1_box_a.jpg') && isValidImageFile(path.join(boxDir, 'shot_1_box_a.jpg'))) ? 'shot_1_box_a.jpg' :
                    (files.includes('shot_1_box.jpg') && isValidImageFile(path.join(boxDir, 'shot_1_box.jpg'))) ? 'shot_1_box.jpg' :
                    findShotFileInFolder(boxDir, 1, 'shot_1', files);
  const shot2File = (files.includes('shot_2_box_b.jpg') && isValidImageFile(path.join(boxDir, 'shot_2_box_b.jpg'))) ? 'shot_2_box_b.jpg' :
                    (files.includes('shot_2_unbox.jpg') && isValidImageFile(path.join(boxDir, 'shot_2_unbox.jpg'))) ? 'shot_2_unbox.jpg' :
                    findShotFileInFolder(boxDir, 2, 'shot_2', files);

  const hasBoxShot = Boolean(shot1File);
  const hasUnboxShot = Boolean(shot2File);

  let boxMeta = null;
  if (files.includes('box_meta.json')) {
    try {
      boxMeta = fs.readJsonSync(path.join(boxDir, 'box_meta.json'));
    } catch (e) {}
  }

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

function getBoxShots(lotNumber, boxNumber) {
  if (!boxNumber) {
    return { hasBoxShot: false, hasUnboxShot: false, hasBoxAShot: false, hasBoxBShot: false, boxShotUrl: null, unboxShotUrl: null, boxMeta: null };
  }
  const idx = getCachedDiskBoxesIndex();
  const directKey = getBoxKey(lotNumber, boxNumber);
  if (directKey && idx.byExactKey.has(directKey)) {
    return idx.byExactKey.get(directKey).boxShots;
  }
  const stripBox = stripBoxForIndex(boxNumber);
  if (stripBox) {
    const normLot = normalizeLotString(lotNumber);
    const byLotStrip = idx.byLotAndStrip.get(`${normLot}__${stripBox}`) || idx.byLotAndStrip.get(`unassigned__${stripBox}`);
    if (byLotStrip) return byLotStrip.boxShots;
    const byStrip = idx.byStripOnly.get(stripBox);
    if (byStrip && (normLot === 'unassigned' || normalizeLotString(byStrip.entryLot) === 'unassigned' || normalizeLotString(byStrip.entryLot) === normLot)) {
      return byStrip.boxShots;
    }
  }
  return { hasBoxShot: false, hasUnboxShot: false, hasBoxAShot: false, hasBoxBShot: false, boxShotUrl: null, unboxShotUrl: null, boxMeta: null };
}

async function saveBoxShotToFile(lotNumber, boxNumber, shotNumber, buffer, blurScore) {
  if (!buffer || buffer.length < 100) return null;
  const key = getBoxKey(lotNumber, boxNumber);
  if (!key) return null;

  const isJag = isJaguarLot(lotNumber);
  const targetClient = isJag ? 'Jaguar' : 'Mustang';
  const clientStorage = config.clientProfiles?.[targetClient]?.storagePath || config.storagePath;

  const primaryBoxDir = path.join(clientStorage, '_boxes', key);
  fs.ensureDirSync(primaryBoxDir);

  const filename = shotNumber === 1 ? 'shot_1_box_a.jpg' : 'shot_2_box_b.jpg';
  const filePath = path.join(primaryBoxDir, filename);

  // Backup existing file before overwrite for undo capability (stored cleanly in .metadata/backups)
  if (fs.existsSync(filePath) && isValidImageFile(filePath)) {
    try {
      const backupBoxDir = path.join(getMetadataDir(), 'backups', '_boxes', key);
      await fs.ensureDir(backupBoxDir);
      await fs.copy(filePath, path.join(backupBoxDir, filename));
    } catch (e) {}
  }

  // Clean up any stray legacy .bak files in primaryBoxDir
  try {
    const boxFiles = await fs.readdir(primaryBoxDir);
    for (const f of boxFiles) {
      if (f.toLowerCase().includes('bak')) {
        await fs.remove(path.join(primaryBoxDir, f)).catch(() => {});
      }
    }
  } catch (e) {}

  await fs.writeFile(filePath, buffer);

  const metaPath = path.join(primaryBoxDir, 'box_meta.json');
  let meta = {
    lotNumber: lotNumber || 'Unassigned',
    boxNumber: boxNumber || '',
    updatedAt: new Date().toISOString(),
    shots: {}
  };
  if (fs.existsSync(metaPath)) {
    try { meta = fs.readJsonSync(metaPath); } catch (e) {}
  }
  if (meta.shots && meta.shots[shotNumber]) {
    meta._backups = meta._backups || {};
    meta._backups[shotNumber] = { ...meta.shots[shotNumber] };
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

  // Mirror into active config.storagePath if different
  if (config.storagePath && config.storagePath !== clientStorage) {
    try {
      const mirrorBoxDir = path.join(config.storagePath, '_boxes', key);
      fs.ensureDirSync(mirrorBoxDir);
      await fs.writeFile(path.join(mirrorBoxDir, filename), buffer);
      await fs.writeJson(path.join(mirrorBoxDir, 'box_meta.json'), meta, { spaces: 2 });
    } catch (e) {}
  }

  invalidateBoxesDiskCache();
  return filename;
}

// Fast single-box peer pull with circuit breaker (only called once per box session if local _boxes is missing shots)
async function pullSingleBoxShotsFromPeer(lotNumber, boxNumber) {
  if (!boxNumber || !config.peerIp || !isPeerReachable()) return false;
  try {
    const peerBoxKey = getBoxKey(lotNumber, boxNumber);
    if (!peerBoxKey) return false;

    const isJag = isJaguarLot(lotNumber);
    const targetClient = isJag ? 'Jaguar' : 'Mustang';
    const targetStorage = config.clientProfiles?.[targetClient]?.storagePath || config.storagePath;
    const destBoxDir = path.join(targetStorage, '_boxes', peerBoxKey);

    const peerApiUrl = `http://${config.peerIp}:${config.peerPort || 3001}/api/sync/get-box-shots?lotNumber=${encodeURIComponent(lotNumber || '')}&boxNumber=${encodeURIComponent(boxNumber || '')}&client=${encodeURIComponent(targetClient)}`;
    const apiRes = await fetch(peerApiUrl, {
      headers: getLocalHeadersForPeer(),
      signal: AbortSignal.timeout(1500)
    }).catch(() => null);

    if (!apiRes) {
      markPeerFailure();
      return false;
    }
    markPeerSuccess();

    if (!apiRes.ok) return false;
    const apiData = await apiRes.json().catch(() => null);
    if (!apiData?.boxShots) return false;

    let pulledAny = false;
    if (apiData.boxShots.hasBoxShot && apiData.boxShots.boxShotUrl && !isValidImageFile(path.join(destBoxDir, 'shot_1_box_a.jpg'))) {
      const imgRes = await fetch(`http://${config.peerIp}:${config.peerPort || 3001}${apiData.boxShots.boxShotUrl}`, {
        headers: getLocalHeadersForPeer(),
        signal: AbortSignal.timeout(2000)
      }).catch(() => null);
      if (imgRes && imgRes.ok) {
        const buf = Buffer.from(await imgRes.arrayBuffer());
        if (buf.length > 1024) {
          fs.ensureDirSync(destBoxDir);
          await fs.writeFile(path.join(destBoxDir, 'shot_1_box_a.jpg'), buf);
          if (config.storagePath && config.storagePath !== targetStorage) {
            try {
              const mDir = path.join(config.storagePath, '_boxes', peerBoxKey);
              fs.ensureDirSync(mDir);
              await fs.writeFile(path.join(mDir, 'shot_1_box_a.jpg'), buf);
            } catch (e) {}
          }
          pulledAny = true;
        }
      }
    }

    if (apiData.boxShots.hasUnboxShot && apiData.boxShots.unboxShotUrl && !isValidImageFile(path.join(destBoxDir, 'shot_2_box_b.jpg'))) {
      const imgRes2 = await fetch(`http://${config.peerIp}:${config.peerPort || 3001}${apiData.boxShots.unboxShotUrl}`, {
        headers: getLocalHeadersForPeer(),
        signal: AbortSignal.timeout(2000)
      }).catch(() => null);
      if (imgRes2 && imgRes2.ok) {
        const buf2 = Buffer.from(await imgRes2.arrayBuffer());
        if (buf2.length > 1024) {
          fs.ensureDirSync(destBoxDir);
          await fs.writeFile(path.join(destBoxDir, 'shot_2_box_b.jpg'), buf2);
          if (config.storagePath && config.storagePath !== targetStorage) {
            try {
              const mDir = path.join(config.storagePath, '_boxes', peerBoxKey);
              fs.ensureDirSync(mDir);
              await fs.writeFile(path.join(mDir, 'shot_2_box_b.jpg'), buf2);
            } catch (e) {}
          }
          pulledAny = true;
        }
      }
    }

    if (pulledAny && apiData.boxShots.boxMeta) {
      try {
        await fs.writeJson(path.join(destBoxDir, 'box_meta.json'), apiData.boxShots.boxMeta, { spaces: 2 });
      } catch (e) {}
    }
    if (pulledAny) invalidateBoxesDiskCache();
    return pulledAny;
  } catch (e) {
    markPeerFailure();
    return false;
  }
}

// Automatically inherit Shot 1 & 2 from local _boxes into an ISBN folder (purely local, 0ms)
async function applyBoxShotsToIsbn(cleanIsbn, lotNumber, boxNumber, folderPath, forceOverwrite = false) {
  // If boxNumber is missing, attempt O(1) lookup from manifest
  if (!boxNumber) {
    const match = findManifestItem(getBaseIsbn(cleanIsbn)) || findManifestItem(cleanIsbn);
    if (match && match.boxNumber) {
      boxNumber = match.boxNumber;
      if (!lotNumber || lotNumber === 'Unassigned') lotNumber = match.lotNumber;
    }
  }

  if (!boxNumber || !folderPath) return { inherited1: false, inherited2: false };

  const boxDir = findBoxStorageDir(lotNumber, boxNumber);
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

  const existingMeta = readIsbnMetadata(cleanIsbn);

  const shouldCopy1 = sourcePath1 && isValidImageFile(sourcePath1) && (
    !isValidImageFile(targetPath1) ||
    forceOverwrite ||
    (existingMeta?.shots?.[1]?.inheritedFromBox && fs.statSync(sourcePath1).mtimeMs > fs.statSync(targetPath1).mtimeMs)
  );

  if (shouldCopy1) {
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

  const shouldCopy2 = sourcePath2 && isValidImageFile(sourcePath2) && (
    !isValidImageFile(targetPath2) ||
    forceOverwrite ||
    (existingMeta?.shots?.[2]?.inheritedFromBox && fs.statSync(sourcePath2).mtimeMs > fs.statSync(targetPath2).mtimeMs)
  );

  if (shouldCopy2) {
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
    let metadata = existingMeta || {
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
  if (!baseIsbn) return [];
  const cleanBase = sanitizeIsbn(baseIsbn);
  const baseFolder = getFolderForIdentifier(cleanBase);
  const parentDir = path.dirname(baseFolder);
  if (!fs.existsSync(parentDir)) return [];

  const candidateNames = [];
  if (fs.existsSync(path.join(parentDir, cleanBase))) {
    candidateNames.push(cleanBase);
  }
  for (let c = 2; c <= 10; c++) {
    const copyName = `${cleanBase}_Copy${c}`;
    if (fs.existsSync(path.join(parentDir, copyName))) {
      candidateNames.push(copyName);
    } else if (c >= 3) {
      break;
    }
  }

  const copies = [];
  for (const name of candidateNames) {
    const folderPath = path.join(parentDir, name);
    const files = await fs.readdir(folderPath).catch(() => []);
    let shotsCount = 0;
    for (let s = 1; s <= 7; s++) {
      const foundFile = findShotFileInFolder(folderPath, s, name, files);
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

// Helper to detect multi-part book sets (e.g. 9788120309869_Part1, Part2, Part3) without scanning all 1,500 folders
async function findExistingParts(baseIsbn, preloadedBaseFiles = null) {
  if (!baseIsbn) return [];

  const cleanBase = getBaseIsbn(sanitizeIsbn(baseIsbn));
  const partsMap = new Map();

  // 1. Check inside base ISBN directory (single folder containing all 21 pictures)
  const baseFolder = getFolderForIdentifier(cleanBase);
  const parentDir = path.dirname(baseFolder);
  let baseFiles = Array.isArray(preloadedBaseFiles) ? preloadedBaseFiles : null;

  if (!baseFiles && fs.existsSync(baseFolder)) {
    try {
      baseFiles = await fs.readdir(baseFolder);
    } catch (e) {
      baseFiles = [];
    }
  }

  if (baseFiles && baseFiles.length > 0) {
    for (const f of baseFiles) {
      const m = f.match(/_Part(\d+)(?:_|\.|$)/i);
      if (m) {
        const pNum = parseInt(m[1], 10);
        if (!partsMap.has(pNum)) {
          partsMap.set(pNum, {
            identifier: `${cleanBase}_Part${pNum}`,
            partNumber: pNum,
            shotsCount: 0,
            isComplete: false,
            shots: {}
          });
        }
      }
    }
  }

  // 2. Check dedicated part directories directly (e.g. 9788120309869_Part1..Part10) in O(1)
  if (fs.existsSync(parentDir)) {
    for (let pNum = 1; pNum <= 10; pNum++) {
      const partDirName = `${cleanBase}_Part${pNum}`;
      if (fs.existsSync(path.join(parentDir, partDirName))) {
        if (!partsMap.has(pNum)) {
          partsMap.set(pNum, {
            identifier: partDirName,
            partNumber: pNum,
            shotsCount: 0,
            isComplete: false,
            shots: {}
          });
        }
      } else if (pNum >= 4 && !partsMap.has(pNum)) {
        break;
      }
    }
  }

  for (const [pNum, partInfo] of partsMap.entries()) {
    const partFolder = getFolderForIdentifier(partInfo.identifier);
    const filesForPart = (partFolder === baseFolder && baseFiles) ? baseFiles : (await fs.readdir(partFolder).catch(() => []));
    let count = 0;
    for (let s = 1; s <= 7; s++) {
      const found = findShotFileInFolder(partFolder, s, partInfo.identifier, filesForPart);
      if (found) {
        count++;
        partInfo.shots[s] = `/proofs/${encodeURIComponent(cleanBase)}/${encodeURIComponent(found)}`;
      } else {
        partInfo.shots[s] = null;
      }
    }
    partInfo.shotsCount = count;
    partInfo.isComplete = count >= 7;
    const meta = readIsbnMetadata(partInfo.identifier);
    if (meta) partInfo.metadata = meta;
  }

  const parts = Array.from(partsMap.values());
  parts.sort((a, b) => a.partNumber - b.partNumber);
  return parts;
}

// Initialize ISBN verification session
app.post('/api/capture/init-isbn', async (req, res) => {
  try {
    const { isbn, client: reqClient, forceNewCopy, forceNewPart, targetPartNumber, partNumber: reqPartNumber, totalParts: reqTotalParts, targetIdentifier, lotNumber, boxNumber } = req.body;
    if (!isbn || !isbn.trim()) {
      return res.status(400).json({ error: 'ISBN is required' });
    }

    const targetClient = reqClient || config.activeClient;
    const validation = validateAndCleanBarcode(isbn, manifestData.items, targetClient);
    if (!validation.valid) {
      const statusCode = validation.clientMismatch ? 403 : 400;
      return res.status(statusCode).json({
        error: validation.error || `Invalid barcode format: "${isbn}"`,
        clientMismatch: Boolean(validation.clientMismatch),
        itemClient: validation.itemClient,
        isDoubleScan: Boolean(validation.isDoubleScan),
        isMerged: Boolean(validation.isMerged)
      });
    }

    const effectiveIsbn = validation.cleaned;
    const cleanBaseIsbn = sanitizeIsbn(effectiveIsbn);
    const baseIsbnOnly = getBaseIsbn(cleanBaseIsbn);

    // Universal manifest matching
    const manifestMatch = validation.manifestMatch || findManifestItem(cleanBaseIsbn, targetClient) || findManifestItem(effectiveIsbn, targetClient) || findManifestItem(baseIsbnOnly, targetClient);
    let isProcessable = true;
    let nonProcessableReason = '';

    if (manifestMatch) {
      isProcessable = manifestMatch.isProcessable;
      if (!isProcessable) {
        nonProcessableReason = manifestMatch.reason || 'Journal is marked as Not Processable in the imported manifest.';
      }
    } else if (manifestData.items && manifestData.items.length > 0) {
      return res.status(400).json({
        error: `ISBN/Barcode "${effectiveIsbn}" is not listed in the imported manifest. Verification session cannot be created.`
      });
    }

    const existingCopies = await findExistingCopies(baseIsbnOnly);
    const existingParts = await findExistingParts(baseIsbnOnly);

    let activeIdentifier = cleanBaseIsbn;
    let copyNumber = 1;
    let partNumber = null;
    let totalParts = reqTotalParts || (existingParts.length > 0 ? Math.max(existingParts.length, 3) : undefined);

    if (forceNewPart) {
      const maxPart = existingParts.reduce((max, p) => Math.max(max, p.partNumber), 0);
      const nextPartNum = Math.max(maxPart + 1, 2);
      activeIdentifier = `${baseIsbnOnly}_Part${nextPartNum}`;
      partNumber = nextPartNum;
    } else if (targetPartNumber !== undefined && targetPartNumber !== null) {
      activeIdentifier = `${baseIsbnOnly}_Part${targetPartNumber}`;
      partNumber = Number(targetPartNumber);
    } else if (reqPartNumber !== undefined && reqPartNumber !== null) {
      activeIdentifier = `${baseIsbnOnly}_Part${reqPartNumber}`;
      partNumber = Number(reqPartNumber);
    } else if (forceNewCopy) {
      const maxCopy = existingCopies.reduce((max, c) => Math.max(max, c.copyNumber), 0);
      const nextCopyNum = Math.max(maxCopy + 1, 2);
      activeIdentifier = `${baseIsbnOnly}_Copy${nextCopyNum}`;
      copyNumber = nextCopyNum;
    } else if (targetIdentifier) {
      activeIdentifier = sanitizeIsbn(targetIdentifier);
      const copyMatch = activeIdentifier.match(/_Copy(\d+)$/i);
      copyNumber = copyMatch ? parseInt(copyMatch[1], 10) : 1;
      const partMatch = activeIdentifier.match(/_Part(\d+)$/i);
      if (partMatch) {
        partNumber = parseInt(partMatch[1], 10);
      }
    } else if (existingParts.length > 0) {
      const incomplete = existingParts.find(p => !p.isComplete);
      const chosen = incomplete || existingParts[0];
      activeIdentifier = chosen.identifier;
      partNumber = chosen.partNumber;
    }

    if (partNumber === null) {
      partNumber = getPartNumber(activeIdentifier);
    }

    if (currentSession.activeIsbn && currentSession.activeIsbn !== activeIdentifier) {
      cleanupSingleEmptyProofFolder(currentSession.activeIsbn).catch(() => {});
    }

    const folderPath = getFolderForIdentifier(activeIdentifier);
    await fs.ensureDir(folderPath);
    const alreadyExists = fs.existsSync(folderPath);
    let metadata = alreadyExists ? readIsbnMetadata(activeIdentifier) : null;

    const resolvedLot = (lotNumber && lotNumber !== 'Unassigned' && lotNumber !== 'Unassigned Lot' && lotNumber !== 'Lot-1')
      ? lotNumber
      : (manifestMatch?.lotNumber || metadata?.lotNumber || currentSession.lotNumber || lotNumber || 'Unassigned Lot');

    const resolvedBox = (boxNumber && boxNumber !== 'Unassigned' && boxNumber !== 'Unassigned Box')
      ? boxNumber
      : (manifestMatch?.boxNumber || metadata?.boxNumber || currentSession.boxNumber || boxNumber || '');

    let boxShots = getBoxShots(resolvedLot, resolvedBox);
    if (resolvedBox && (!boxShots.hasBoxShot || !boxShots.hasUnboxShot)) {
      const pulled = await pullSingleBoxShotsFromPeer(resolvedLot, resolvedBox);
      if (pulled) {
        boxShots = getBoxShots(resolvedLot, resolvedBox);
      }
    }

    // Automatically inherit Shot 1 (Box) & Shot 2 (Unbox) if captured for this Box (e.g. by PC 1)
    const { inherited1, inherited2 } = await applyBoxShotsToIsbn(activeIdentifier, resolvedLot, resolvedBox, folderPath);
    if (inherited1 || inherited2) {
      metadata = readIsbnMetadata(activeIdentifier);
    }

    const folderFiles = await fs.readdir(folderPath).catch(() => []);
    const existingShots = {};
    let shotsFoundCount = 0;

    for (let s = 1; s <= 7; s++) {
      const foundFile = findShotFileInFolder(folderPath, s, activeIdentifier, folderFiles);
      if (alreadyExists && foundFile) {
        existingShots[s] = foundFile;
        shotsFoundCount++;
      }
    }

    let metadataModified = false;

    // Self-healing: only remove inherited shots if the file is corrupt/empty (< 1KB) or belongs to a mismatched box
    if (!boxShots.hasBoxShot && metadata?.shots?.[1]?.inheritedFromBox) {
      const shot1Target = path.join(folderPath, getShotFilename(1, activeIdentifier));
      const isCorruptOrEmpty = !fs.existsSync(shot1Target) || fs.statSync(shot1Target).size < 1024;
      const isMismatchedBox = Boolean(metadata.boxNumber && resolvedBox && !isMatchingBoxNumber(metadata.boxNumber, resolvedBox));
      if (isCorruptOrEmpty || isMismatchedBox) {
        if (fs.existsSync(shot1Target)) {
          try { fs.removeSync(shot1Target); } catch (e) {}
        }
        delete existingShots[1];
        delete metadata.shots[1];
        metadataModified = true;
      }
    }

    if (!boxShots.hasUnboxShot && metadata?.shots?.[2]?.inheritedFromBox) {
      const shot2Target = path.join(folderPath, getShotFilename(2, activeIdentifier));
      const isCorruptOrEmpty = !fs.existsSync(shot2Target) || fs.statSync(shot2Target).size < 1024;
      const isMismatchedBox = Boolean(metadata.boxNumber && resolvedBox && !isMatchingBoxNumber(metadata.boxNumber, resolvedBox));
      if (isCorruptOrEmpty || isMismatchedBox) {
        if (fs.existsSync(shot2Target)) {
          try { fs.removeSync(shot2Target); } catch (e) {}
        }
        delete existingShots[2];
        delete metadata.shots[2];
        metadataModified = true;
      }
    }

    if (metadataModified && metadata) {
      metadata.updatedAt = new Date().toISOString();
      await saveIsbnMetadata(activeIdentifier, metadata);
    }

    // Recalculate shots found count after self-healing
    shotsFoundCount = 0;
    for (let s = 1; s <= 7; s++) {
      if (existingShots[s]) shotsFoundCount++;
    }

    // Fallback: If Shot 1 or Shot 2 were not yet in book folder, but box has them in _boxes/
    if (!existingShots[1] && boxShots.hasBoxShot) {
      existingShots[1] = 'shot_1_box_a.jpg';
      shotsFoundCount++;
    }
    if (!existingShots[2] && boxShots.hasUnboxShot) {
      existingShots[2] = 'shot_2_box_b.jpg';
      shotsFoundCount++;
    }

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
        const isBoxFallback = existingShots[s].startsWith('shot_');
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
      partNumber: partNumber !== null ? partNumber : undefined,
      totalParts,
      existingParts,
      isProcessable
    };

    broadcastSession('ISBN_INITIALIZED', {
      isbn: activeIdentifier,
      baseIsbn: baseIsbnOnly,
      lotNumber: resolvedLot,
      boxNumber: resolvedBox,
      currentStep: initialStep,
      copyNumber,
      partNumber: partNumber !== null ? partNumber : undefined,
      totalParts,
      existingParts,
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
      partNumber: partNumber !== null ? partNumber : undefined,
      totalParts,
      hasParts: existingParts.length > 0,
      existingParts,
      folderPath,
      exists: alreadyExists,
      shotsCount: shotsFoundCount,
      existingShots,
      boxShots,
      metadata,
      bookDetails: currentSession.bookDetails,
      isProcessable,
      nonProcessableReason,
      manifestMatch,
      existingCopies,
      hasDuplicateCopies: existingCopies.length > 1 || (existingCopies.length === 1 && existingCopies[0].isComplete)
    });
  } catch (err) {
    console.error('Error initializing ISBN folder:', err);
    res.status(500).json({ error: 'Failed to initialize ISBN folder', details: err.message });
  }
});

// Convert standard single-book captures to multi-part (_Part1)
app.post('/api/capture/convert-to-parts', async (req, res) => {
  try {
    const { isbn, totalParts = 3 } = req.body;
    if (!isbn) return res.status(400).json({ error: 'ISBN is required' });

    const cleanIsbn = sanitizeIsbn(isbn);
    const baseIsbn = getBaseIsbn(cleanIsbn);
    const folderPath = getFolderForIdentifier(baseIsbn);

    if (fs.existsSync(folderPath)) {
      const files = await fs.readdir(folderPath);
      for (const f of files) {
        if (f.startsWith(`${baseIsbn}_`) && !/_Part\d+/i.test(f) && !/_Copy\d+/i.test(f) && /\.(jpe?g|png)$/i.test(f)) {
          const ext = path.extname(f);
          const baseWithoutExt = f.slice(0, -ext.length);
          const newName = `${baseWithoutExt}_Part1${ext}`;
          try {
            await fs.rename(path.join(folderPath, f), path.join(folderPath, newName));
          } catch (e) {
            console.warn('[convertToParts] Rename failed:', e.message);
          }
        } else if (f.startsWith(`${baseIsbn}_Part1_`)) {
          // Backward compatibility: Rename legacy ISBN_Part1_front cover.jpg -> ISBN_front cover_Part1.jpg
          const ext = path.extname(f);
          const remainder = f.substring(`${baseIsbn}_Part1_`.length).slice(0, -ext.length);
          const newName = `${baseIsbn}_${remainder}_Part1${ext}`;
          try {
            await fs.rename(path.join(folderPath, f), path.join(folderPath, newName));
          } catch (e) {}
        }
      }
    }

    const oldMeta = readIsbnMetadata(baseIsbn);
    const part1Meta = oldMeta ? { ...oldMeta } : {};
    part1Meta.identifier = `${baseIsbn}_Part1`;
    part1Meta.isbn = baseIsbn;
    part1Meta.partNumber = 1;
    part1Meta.totalParts = totalParts;
    if (part1Meta.shots) {
      for (const s of Object.keys(part1Meta.shots)) {
        if (part1Meta.shots[s]?.filename) {
          const fn = part1Meta.shots[s].filename;
          const ext = path.extname(fn);
          if (fn.includes('_Part1_')) {
            const remainder = fn.substring(`${baseIsbn}_Part1_`.length).slice(0, -ext.length);
            part1Meta.shots[s].filename = `${baseIsbn}_${remainder}_Part1${ext}`;
          } else if (!fn.includes('_Part')) {
            const baseWithoutExt = fn.slice(0, -ext.length);
            part1Meta.shots[s].filename = `${baseWithoutExt}_Part1${ext}`;
          }
        }
      }
    }
    await saveIsbnMetadata(`${baseIsbn}_Part1`, part1Meta);

    const existingParts = await findExistingParts(baseIsbn);
    res.json({
      success: true,
      isbn: `${baseIsbn}_Part1`,
      baseIsbn,
      partNumber: 1,
      totalParts,
      existingParts
    });
  } catch (err) {
    console.error('[convertToParts] Error:', err);
    res.status(500).json({ error: err.message });
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
    const partNumber = getPartNumber(cleanIsbn);
    const totalParts = req.body.totalParts || currentSession?.totalParts;
    const folderPath = getFolderForIdentifier(cleanIsbn);
    await fs.ensureDir(folderPath);

    const shotDef = SHOT_DEFINITIONS[sNum];
    const filename = getShotFilename(sNum, cleanIsbn);
    const filePath = path.join(folderPath, filename);

    // Detect if this shot already exists (Retake scenario) and create backup for Undo capability
    const existingFilename = findShotFileInFolder(folderPath, sNum, cleanIsbn);
    let wasRetake = false;
    if (existingFilename && isValidImageFile(path.join(folderPath, existingFilename))) {
      wasRetake = true;
      try {
        // Store backup cleanly outside the photo folder in .metadata/backups
        const backupDir = path.join(getMetadataDir(), 'backups', cleanIsbn);
        await fs.ensureDir(backupDir);
        await fs.copy(path.join(folderPath, existingFilename), path.join(backupDir, `${sNum}_${filename}`));
      } catch (e) {}

      // If existing filename differs from the standard target filename, clean it up so no duplicate or previous file remains
      if (existingFilename !== filename) {
        try { await fs.remove(path.join(folderPath, existingFilename)); } catch (e) {}
      }
    }

    // Clean up any stray backup or bak files inside folderPath to keep directory 100% clean
    try {
      const folderFiles = await fs.readdir(folderPath);
      for (const f of folderFiles) {
        const lower = f.toLowerCase();
        if (lower.startsWith('.bak') || lower.startsWith('bak') || lower.includes('.bak') || lower.includes('bak.') || lower.includes('_bak')) {
          await fs.remove(path.join(folderPath, f)).catch(() => {});
        }
      }
    } catch (e) {}

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
      partNumber: partNumber !== null ? partNumber : undefined,
      totalParts: totalParts || undefined,
      lotNumber: resolvedLot,
      boxNumber: resolvedBox,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      operator: operatorName || 'Inventory Operator',
      station: config.watermarkStation || os.hostname(),
      bookDetails: bookDetails || null,
      shots: {}
    };

    if (wasRetake && metadata.shots && metadata.shots[sNum]) {
      metadata._backups = metadata._backups || {};
      metadata._backups[sNum] = { ...metadata.shots[sNum] };
    }

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

    // Track in session undo history
    if (!currentSession.undoHistory) currentSession.undoHistory = [];
    currentSession.undoHistory.push({
      isbn: cleanIsbn,
      shotNumber: sNum,
      wasRetake,
      timestamp: Date.now()
    });

    // Calculate next step
    let nextStep = 'COMPLETE';
    for (let s = 1; s <= 7; s++) {
      if (!currentSession.shots[s]) {
        nextStep = `CAPTURE_SHOT_${s}`;
        break;
      }
    }
    currentSession.currentStep = nextStep;

    // If Shot 1 (Box) or Shot 2 (Unbox), save to box-level storage immediately before broadcasting
    if ((sNum === 1 || sNum === 2) && resolvedBox) {
      await saveBoxShotToFile(resolvedLot, resolvedBox, sNum, buffer, blurScore);
    }

    const boxShotsData = (resolvedBox) ? getBoxShots(resolvedLot, resolvedBox) : null;

    broadcastSession('SHOT_SAVED', {
      isbn: cleanIsbn,
      shotNumber: sNum,
      shotInfo: newShotInfo,
      wasRetake,
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

      if (resolvedBox) {
        const reqClientForBox = req.body.client || (isJaguarLot(resolvedLot) ? 'Jaguar' : 'Mustang');
        const isRep = Boolean(req.body.isReplication);
        setImmediate(async () => {
          try {
            if (!isRep && config.peerSyncEnabled) {
              replicateBoxShotToPeer({
                lotNumber: resolvedLot,
                boxNumber: resolvedBox,
                shotNumber: sNum,
                imageBase64,
                blurScore,
                client: reqClientForBox
              });
            }
            const matchingItems = getManifestItemsForBox(resolvedLot, resolvedBox);
            for (const item of matchingItems) {
              const itemClean = sanitizeIsbn(item.isbn);
              if (itemClean !== cleanIsbn) {
                const itemFolder = getFolderForIdentifier(itemClean);
                if (fs.existsSync(itemFolder)) {
                  await applyBoxShotsToIsbn(itemClean, resolvedLot, resolvedBox, itemFolder, true);
                }
              }
            }
          } catch (e) {}
        });
      }
    } else if (!req.body.isReplication && config.peerSyncEnabled) {
      setImmediate(() => {
        replicateToPeer({
          isbn: cleanIsbn,
          shotNumber: sNum,
          imageBase64,
          operatorName,
          bookDetails,
          blurScore,
          metadata
        });
      });
    }

    if (config.autoOpenExplorer && totalShots >= 7) {
      if (process.platform === 'win32') {
        exec(`explorer.exe "${path.resolve(folderPath)}"`, () => {});
      }
    }

    // Automatic S3 Upload ONLY upon 100% full verification completion (all 7 shots saved & verified)
    const isReadyForS3 = (totalShots >= 7) || Boolean(metadata && metadata.isComplete);

    if (isReadyForS3 && config.s3Enabled !== false && config.s3Bucket && config.s3AccessKeyId) {
      console.log(`[S3 Auto-Upload] Verification capture 100% complete for ${cleanIsbn} (${totalShots} shots saved). Enqueuing background upload...`);
      enqueueS3Upload(cleanIsbn);
    }

    const updatedParts = (partNumber !== null || (currentSession.existingParts && currentSession.existingParts.length > 0))
      ? await findExistingParts(baseIsbnOnly)
      : [];
    res.json({
      success: true,
      isbn: cleanIsbn,
      baseIsbn: baseIsbnOnly,
      partNumber: partNumber !== null ? partNumber : undefined,
      totalParts,
      existingParts: updatedParts,
      shotNumber: sNum,
      wasRetake,
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

// Undo a captured or retaken shot (Reverts to previous image or cancels capture)
app.post('/api/capture/undo-shot', async (req, res) => {
  try {
    const { isbn, shotNumber } = req.body;
    const cleanIsbn = sanitizeIsbn(isbn || currentSession.activeIsbn);
    if (!cleanIsbn) {
      return res.status(400).json({ error: 'Active ISBN required for undo' });
    }

    const folderPath = getFolderForIdentifier(cleanIsbn);
    let metadata = readIsbnMetadata(cleanIsbn) || currentSession.metadata;

    let sNum = shotNumber ? parseInt(shotNumber, 10) : null;
    let lastHistoryItem = null;

    if (!sNum) {
      if (currentSession.undoHistory && currentSession.undoHistory.length > 0) {
        for (let i = currentSession.undoHistory.length - 1; i >= 0; i--) {
          if (currentSession.undoHistory[i].isbn === cleanIsbn) {
            lastHistoryItem = currentSession.undoHistory.splice(i, 1)[0];
            sNum = lastHistoryItem.shotNumber;
            break;
          }
        }
      }
    }

    if (!sNum && metadata?.shots) {
      const shotNums = Object.keys(metadata.shots).map(n => parseInt(n, 10)).filter(n => !isNaN(n));
      if (shotNums.length > 0) {
        sNum = Math.max(...shotNums);
      }
    }

    if (!sNum) {
      return res.status(400).json({ error: 'No shot available to undo for this journal' });
    }

    const shotDef = SHOT_DEFINITIONS[sNum];
    const shotFilename = getShotFilename(sNum, cleanIsbn);
    const targetFilePath = path.join(folderPath, shotFilename);
    const extBackupPath = path.join(getMetadataDir(), 'backups', cleanIsbn, `${sNum}_${shotFilename}`);
    const legacyBackupPath = path.join(folderPath, `.bak_${shotFilename}`);
    const backupPath = fs.existsSync(extBackupPath) ? extBackupPath : legacyBackupPath;

    let wasRetake = false;
    let restoredShotInfo = null;

    if (fs.existsSync(backupPath) && isValidImageFile(backupPath)) {
      // 1. Retake restore: Restore previous image from backup
      wasRetake = true;
      await fs.copy(backupPath, targetFilePath);
      await fs.remove(backupPath);

      const restoredMeta = metadata?._backups?.[sNum] || {
        filename: shotFilename,
        savedAt: new Date().toISOString(),
        type: shotDef?.type || `Shot ${sNum}`,
        scope: shotDef?.scope || 'book_level'
      };

      if (metadata) {
        metadata.shots = metadata.shots || {};
        metadata.shots[sNum] = restoredMeta;
        if (metadata._backups) delete metadata._backups[sNum];
        metadata.updatedAt = new Date().toISOString();
        const totalShots = Object.keys(metadata.shots).length;
        metadata.isComplete = totalShots >= 7;
        await saveIsbnMetadata(cleanIsbn, metadata);
      }

      restoredShotInfo = {
        filename: shotFilename,
        savedAt: new Date().toISOString(),
        type: shotDef?.type || `Shot ${sNum}`,
        scope: shotDef?.scope || 'book_level',
        previewDataUrl: `/proofs/${encodeURIComponent(cleanIsbn)}/${encodeURIComponent(shotFilename)}?t=${Date.now()}`
      };

      if (currentSession.shots) {
        currentSession.shots[sNum] = restoredShotInfo;
        currentSession.metadata = metadata;
      }
    } else {
      // 2. Accidental new capture undo: delete file and remove from metadata
      const foundFile = findShotFileInFolder(folderPath, sNum, cleanIsbn);
      if (foundFile) {
        const delPath = path.join(folderPath, foundFile);
        if (fs.existsSync(delPath)) await fs.remove(delPath);
      }
      if (fs.existsSync(targetFilePath)) {
        await fs.remove(targetFilePath);
      }

      if (metadata?.shots?.[sNum]) {
        delete metadata.shots[sNum];
        metadata.updatedAt = new Date().toISOString();
        const totalShots = Object.keys(metadata.shots).length;
        metadata.isComplete = totalShots >= 7;
        await saveIsbnMetadata(cleanIsbn, metadata);
      }

      if (currentSession.shots) {
        currentSession.shots[sNum] = null;
        currentSession.metadata = metadata;
      }
    }

    // Determine target step after undo
    let newStep = `CAPTURE_SHOT_${sNum}`;
    if (wasRetake) {
      let allFilled = true;
      for (let s = 1; s <= 7; s++) {
        if (!currentSession.shots?.[s]) {
          allFilled = false;
          newStep = `CAPTURE_SHOT_${s}`;
          break;
        }
      }
      if (allFilled) newStep = 'COMPLETE';
    }
    currentSession.currentStep = newStep;

    broadcastSession('SHOT_UNDO', {
      isbn: cleanIsbn,
      shotNumber: sNum,
      wasRetake,
      restoredShotInfo,
      currentStep: newStep,
      session: currentSession
    });

    res.json({
      success: true,
      restored: true,
      wasRetake,
      shotNumber: sNum,
      currentStep: newStep,
      shots: currentSession.shots,
      metadata,
      message: wasRetake 
        ? `Restored previous photo for Shot ${sNum} (${shotDef?.type || ''})` 
        : `Undid capture for Shot ${sNum} (${shotDef?.type || ''}). Ready to capture again.`
    });
  } catch (err) {
    console.error('Error undoing shot:', err);
    res.status(500).json({ error: 'Failed to undo shot', details: err.message });
  }
});

// Get all Boxes from manifest with Box & Unbox status and completion stats
app.get('/api/boxes/list', async (req, res) => {
  try {
    const isAll = req.query.all === 'true' || req.query.client === 'all';
    const includeItems = req.query.includeItems === 'true';
    const targetClient = isAll ? null : (req.query.client || config.activeClient);
    const boxesMap = new Map();

    // 1. Use fast cached _boxes index (0ms on cache hit, 3s TTL, invalidated on any box shot save/undo/sync)
    const idx = getCachedDiskBoxesIndex();

    // 2. Group manifest items into boxes in pure memory (0 disk calls per item)
    if (manifestData.items && manifestData.items.length > 0) {
      for (const item of manifestData.items) {
        const itemClient = item.client || (isJaguarLot(item.lotNumber, item.project) ? 'Jaguar' : 'Mustang');
        if (targetClient && itemClient.toLowerCase() !== targetClient.toLowerCase()) {
          continue;
        }
        const lot = item.lotNumber || 'Unassigned';
        const box = item.boxNumber || 'Unassigned';
        const key = getBoxKey(lot, box);
        if (!key) continue;

        let b = boxesMap.get(key);
        if (!b) {
          const boxShots = getBoxShots(lot, box);
          b = {
            lotNumber: lot,
            boxNumber: box,
            boxKey: key,
            totalBooks: 0,
            completedBooks: 0,
            hasBoxShot: boxShots.hasBoxShot,
            hasUnboxShot: boxShots.hasUnboxShot,
            boxShotUrl: boxShots.boxShotUrl,
            unboxShotUrl: boxShots.unboxShotUrl,
            boxMeta: boxShots.boxMeta || null,
            sampleIsbn: item.isbn
          };
          if (includeItems) b.items = [];
          boxesMap.set(key, b);
        }

        b.totalBooks++;
        if (includeItems) b.items.push(item);
      }
    }

    // 3. Also include any physical boxes stored on disk that weren't in the manifest
    for (const [entry, info] of idx.byExactKey.entries()) {
      if (!boxesMap.has(entry)) {
        const { entryLot, entryBox, boxShots } = info;
        const itemClient = isJaguarLot(entryLot) ? 'Jaguar' : 'Mustang';
        if (targetClient && itemClient.toLowerCase() !== targetClient.toLowerCase()) {
          continue;
        }
        const b = {
          lotNumber: entryLot,
          boxNumber: entryBox,
          boxKey: entry,
          totalBooks: 0,
          completedBooks: 0,
          hasBoxShot: boxShots.hasBoxShot,
          hasUnboxShot: boxShots.hasUnboxShot,
          boxShotUrl: boxShots.boxShotUrl,
          unboxShotUrl: boxShots.unboxShotUrl,
          boxMeta: boxShots.boxMeta || null,
          sampleIsbn: `BOX_${entryBox}`
        };
        if (includeItems) b.items = [];
        boxesMap.set(entry, b);
      }
    }

    const boxes = Array.from(boxesMap.values());
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
    let boxShots = getBoxShots(resolvedLot, boxNumber);

    // If box shots are missing locally, attempt fast single-box fetch from peer PC (with circuit breaker)
    if (!boxShots.hasBoxShot || !boxShots.hasUnboxShot) {
      const pulled = await pullSingleBoxShotsFromPeer(resolvedLot, boxNumber);
      if (pulled) {
        boxShots = getBoxShots(resolvedLot, boxNumber);
      }
    }

    const boxBooks = getManifestItemsForBox(resolvedLot, boxNumber);
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
    const { lotNumber, boxNumber, shotNumber, imageBase64, blurScore, client } = req.body;
    const sNum = parseInt(shotNumber, 10);
    if (!boxNumber || !imageBase64 || (sNum !== 1 && sNum !== 2)) {
      return res.status(400).json({ error: 'Valid boxNumber, shotNumber (1 or 2), and base64 image required' });
    }

    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');

    const filename = await saveBoxShotToFile(lotNumber, boxNumber, sNum, buffer, blurScore);
    const boxShots = getBoxShots(lotNumber, boxNumber);

    broadcastSession('BOX_SHOT_SAVED', {
      lotNumber,
      boxNumber,
      shotNumber: sNum,
      boxShots
    });

    const isRep = Boolean(req.body.isReplication);
    const targetClient = client || (isJaguarLot(lotNumber) ? 'Jaguar' : 'Mustang');
    setImmediate(async () => {
      try {
        if (!isRep && config.peerSyncEnabled) {
          replicateBoxShotToPeer({
            lotNumber,
            boxNumber,
            shotNumber: sNum,
            imageBase64,
            blurScore,
            client: targetClient
          });
        }
        const matchingItems = getManifestItemsForBox(lotNumber, boxNumber);
        for (const item of matchingItems) {
          const itemClean = sanitizeIsbn(item.isbn);
          const itemFolder = getFolderForIdentifier(itemClean);
          if (fs.existsSync(itemFolder)) {
            await applyBoxShotsToIsbn(itemClean, lotNumber, boxNumber, itemFolder, true);
          }
        }
      } catch (e) {}
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

// Synchronize all available box shots from peer PC into local storage
let isSyncingFromPeer = false;
async function syncAllBoxShotsFromPeer() {
  if (!config.peerSyncEnabled) return 0;
  const peers = getAllTargetPeers();
  if (peers.length === 0) return 0;
  if (isSyncingFromPeer) return 0;
  isSyncingFromPeer = true;

  let totalSyncedCount = 0;
  try {
    for (const peerAddr of peers) {
      try {
        const peerUrl = `http://${peerAddr}/api/boxes/list?all=true`;
        const res = await fetch(peerUrl, {
          headers: getLocalHeadersForPeer(),
          signal: AbortSignal.timeout(3000)
        }).catch(() => null);
        if (!res) {
          markPeerFailure();
          continue;
        }
        markPeerSuccess();
        if (!res.ok) continue;

        const data = await res.json().catch(() => null);
        const peerBoxes = (data?.boxes || []).filter(b => b.hasBoxShot || b.hasUnboxShot);
        if (peerBoxes.length === 0) continue;

        let syncedCount = 0;
        for (const b of peerBoxes) {
          const isJag = isJaguarLot(b.lotNumber);
          const targetClient = isJag ? 'Jaguar' : 'Mustang';
          const targetStorage = config.clientProfiles?.[targetClient]?.storagePath || config.storagePath;
          const boxDir = path.join(targetStorage, '_boxes', b.boxKey);
          const metaPath = path.join(boxDir, 'box_meta.json');
          let localMeta = null;
          try { if (fs.existsSync(metaPath)) localMeta = fs.readJsonSync(metaPath); } catch (e) {}

          let boxUpdated = false;

          if (b.hasBoxShot && b.boxShotUrl) {
            const shot1Target = path.join(boxDir, 'shot_1_box_a.jpg');
            const peerSavedAt = b.boxMeta?.shots?.[1]?.savedAt;
            const localSavedAt = localMeta?.shots?.[1]?.savedAt;
            const isNewer = Boolean(peerSavedAt && localSavedAt && peerSavedAt > localSavedAt);
            if (!isValidImageFile(shot1Target) || isNewer) {
              const s1Res = await fetch(`http://${peerAddr}${b.boxShotUrl}`, {
                headers: getLocalHeadersForPeer(),
                signal: AbortSignal.timeout(3000)
              }).catch(() => null);
              if (s1Res && s1Res.ok) {
                fs.ensureDirSync(boxDir);
                const bBuf1 = Buffer.from(await s1Res.arrayBuffer());
                if (bBuf1.length > 1024) {
                  await fs.writeFile(shot1Target, bBuf1);
                  if (config.storagePath && config.storagePath !== targetStorage) {
                    try {
                      const mDir = path.join(config.storagePath, '_boxes', b.boxKey);
                      fs.ensureDirSync(mDir);
                      await fs.writeFile(path.join(mDir, 'shot_1_box_a.jpg'), bBuf1);
                    } catch (e) {}
                  }
                  syncedCount++;
                  boxUpdated = true;
                }
              }
            }
          }

          if (b.hasUnboxShot && b.unboxShotUrl) {
            const shot2Target = path.join(boxDir, 'shot_2_box_b.jpg');
            const peerSavedAt = b.boxMeta?.shots?.[2]?.savedAt;
            const localSavedAt = localMeta?.shots?.[2]?.savedAt;
            const isNewer = Boolean(peerSavedAt && localSavedAt && peerSavedAt > localSavedAt);
            if (!isValidImageFile(shot2Target) || isNewer) {
              const s2Res = await fetch(`http://${peerAddr}${b.unboxShotUrl}`, {
                headers: getLocalHeadersForPeer(),
                signal: AbortSignal.timeout(3000)
              }).catch(() => null);
              if (s2Res && s2Res.ok) {
                fs.ensureDirSync(boxDir);
                const bBuf2 = Buffer.from(await s2Res.arrayBuffer());
                if (bBuf2.length > 1024) {
                  await fs.writeFile(shot2Target, bBuf2);
                  if (config.storagePath && config.storagePath !== targetStorage) {
                    try {
                      const mDir = path.join(config.storagePath, '_boxes', b.boxKey);
                      fs.ensureDirSync(mDir);
                      await fs.writeFile(path.join(mDir, 'shot_2_box_b.jpg'), bBuf2);
                    } catch (e) {}
                  }
                  syncedCount++;
                  boxUpdated = true;
                }
              }
            }
          }

          // If local box shots were updated, update box_meta.json, notify UI, and propagate to local journals in this box
          if (boxUpdated) {
            if (b.boxMeta) {
              try { await fs.writeJson(metaPath, b.boxMeta, { spaces: 2 }); } catch (e) {}
              if (config.storagePath && config.storagePath !== targetStorage) {
                try { await fs.writeJson(path.join(config.storagePath, '_boxes', b.boxKey, 'box_meta.json'), b.boxMeta, { spaces: 2 }); } catch (e) {}
              }
            }
            invalidateBoxesDiskCache();
            const matchingItems = getManifestItemsForBox(b.lotNumber, b.boxNumber);
            for (const item of matchingItems) {
              const itemClean = sanitizeIsbn(item.isbn);
              const itemFolder = getFolderForIdentifier(itemClean);
              if (fs.existsSync(itemFolder)) {
                await applyBoxShotsToIsbn(itemClean, b.lotNumber, b.boxNumber, itemFolder, true);
              }
            }
            const updatedBoxShots = getBoxShots(b.lotNumber, b.boxNumber);
            broadcastSession('BOX_SHOT_SAVED', {
              lotNumber: b.lotNumber,
              boxNumber: b.boxNumber,
              boxShots: updatedBoxShots
            });
          }
        }

        totalSyncedCount += syncedCount;
      } catch (e) {}
    }

    if (totalSyncedCount > 0) {
      console.log(`[PeerSync] Automatically synchronized ${totalSyncedCount} new box shot(s) from peer PC`);
      broadcastSession('PEER_BOXES_SYNCED', { count: totalSyncedCount });
    }
    return totalSyncedCount;
  } finally {
    isSyncingFromPeer = false;
  }
}

// Undo Shot 1 (Box A) or Shot 2 (Box B) for Box-level capture
app.post('/api/boxes/undo-shot', async (req, res) => {
  try {
    const { lotNumber, boxNumber, shotNumber } = req.body;
    const sNum = parseInt(shotNumber, 10);
    if (!boxNumber || (sNum !== 1 && sNum !== 2)) {
      return res.status(400).json({ error: 'Valid boxNumber and shotNumber (1 or 2) required' });
    }

    const key = getBoxKey(lotNumber, boxNumber);
    if (!key) return res.status(400).json({ error: 'Invalid lot and box' });
    const targetBoxDir = findBoxStorageDir(lotNumber, boxNumber) || path.join(config.storagePath, '_boxes', key);
    const filename = sNum === 1 ? 'shot_1_box_a.jpg' : 'shot_2_box_b.jpg';
    const filePath = path.join(targetBoxDir, filename);
    const extBackupPath = path.join(getMetadataDir(), 'backups', '_boxes', key, filename);
    const legacyBackupPath = path.join(targetBoxDir, `.bak_${filename}`);
    const backupPath = fs.existsSync(extBackupPath) ? extBackupPath : legacyBackupPath;

    const metaPath = path.join(targetBoxDir, 'box_meta.json');
    let meta = fs.existsSync(metaPath) ? fs.readJsonSync(metaPath) : null;

    let wasRetake = false;

    if (fs.existsSync(backupPath) && isValidImageFile(backupPath)) {
      wasRetake = true;
      await fs.copy(backupPath, filePath);
      await fs.remove(backupPath);
      if (meta && meta._backups && meta._backups[sNum]) {
        meta.shots = meta.shots || {};
        meta.shots[sNum] = meta._backups[sNum];
        delete meta._backups[sNum];
        await fs.writeJson(metaPath, meta, { spaces: 2 });
      }
    } else {
      for (const bDir of getAllCandidateBoxesDirs()) {
        const candFile = path.join(bDir, key, filename);
        if (fs.existsSync(candFile)) {
          await fs.remove(candFile).catch(() => {});
        }
      }
      if (fs.existsSync(filePath)) {
        await fs.remove(filePath).catch(() => {});
      }
      if (meta && meta.shots && meta.shots[sNum]) {
        delete meta.shots[sNum];
        await fs.writeJson(metaPath, meta, { spaces: 2 });
      }

      // Clean up inherited copies from matching books in background
      setImmediate(() => {
        try {
          const matchingItems = getManifestItemsForBox(lotNumber, boxNumber);
          for (const item of matchingItems) {
            const itemClean = sanitizeIsbn(item.isbn);
            const itemFolder = getFolderForIdentifier(itemClean);
            if (!fs.existsSync(itemFolder)) continue;
            const itemShotFile = findShotFileInFolder(itemFolder, sNum, itemClean);
            const itemMeta = readIsbnMetadata(itemClean);
            if (itemMeta?.shots?.[sNum]?.inheritedFromBox && itemShotFile) {
              try {
                fs.removeSync(path.join(itemFolder, itemShotFile));
                delete itemMeta.shots[sNum];
                saveIsbnMetadata(itemClean, itemMeta);
              } catch (e) {}
            }
          }
        } catch (e) {}
      });
    }

    invalidateBoxesDiskCache();
    const boxShots = getBoxShots(lotNumber, boxNumber);

    broadcastSession('BOX_SHOT_SAVED', {
      lotNumber,
      boxNumber,
      shotNumber: sNum,
      wasRetake,
      boxShots
    });

    if (!req.body.isReplication && config.peerSyncEnabled) {
      setImmediate(async () => {
        for (const peerAddr of getAllTargetPeers()) {
          try {
            await fetch(`http://${peerAddr}/api/boxes/undo-shot`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...getLocalHeadersForPeer() },
              body: JSON.stringify({ lotNumber, boxNumber, shotNumber: sNum, isReplication: true }),
              signal: AbortSignal.timeout(4000)
            });
          } catch (e) {}
        }
      });
    }

    res.json({
      success: true,
      restored: true,
      wasRetake,
      lotNumber,
      boxNumber,
      shotNumber: sNum,
      boxShots,
      message: wasRetake ? `Restored previous photo for Box Shot ${sNum}` : `Undid Box Shot ${sNum}`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Asynchronous 2-way peer replication helper
async function replicateToPeer(shotData) {
  if (!config.peerSyncEnabled) return;
  const peers = getAllTargetPeers();
  for (const peerAddr of peers) {
    try {
      const peerUrl = `http://${peerAddr}/api/sync/receive-shot`;
      const res = await fetch(peerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getLocalHeadersForPeer() },
        body: JSON.stringify({ ...shotData, isReplication: true }),
        signal: AbortSignal.timeout(6000)
      });
      if (res.ok) {
        markPeerSuccess();
      } else {
        console.warn(`[PeerSync] Replicating to ${peerUrl} status: ${res.status}`);
      }
    } catch (err) {
      markPeerFailure();
      console.warn(`[PeerSync] Could not replicate shot to peer ${peerAddr}:`, err.message);
    }
  }
}

async function replicateBoxShotToPeer(boxShotData) {
  if (!config.peerSyncEnabled) return;
  const isJag = isJaguarLot(boxShotData.lotNumber);
  const client = boxShotData.client || (isJag ? 'Jaguar' : 'Mustang');
  const peers = getAllTargetPeers();
  for (const peerAddr of peers) {
    try {
      const peerUrl = `http://${peerAddr}/api/sync/receive-box-shot`;
      const res = await fetch(peerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getLocalHeadersForPeer() },
        body: JSON.stringify({ ...boxShotData, client, isReplication: true }),
        signal: AbortSignal.timeout(6000)
      });
      if (res.ok) {
        markPeerSuccess();
      } else {
        console.warn(`[PeerSync] Replicating box shot to ${peerUrl} status: ${res.status}`);
      }
    } catch (err) {
      markPeerFailure();
      console.warn(`[PeerSync] Could not replicate box shot to peer ${peerAddr}:`, err.message);
    }
  }
}

// -------------------------------------------------------------
// Multi-PC Peer Synchronization Endpoints
// -------------------------------------------------------------
app.all('/api/sync/pull-boxes', async (req, res) => {
  try {
    const synced = await syncAllBoxShotsFromPeer();
    res.json({ success: true, count: synced });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

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

    // If current session on this PC is working on this box, update live session state too
    if (currentSession.boxNumber && isMatchingBoxNumber(currentSession.boxNumber, boxNumber)) {
      const shotUrl = sNum === 1 ? boxShots.boxShotUrl : boxShots.unboxShotUrl;
      if (shotUrl) {
        currentSession.shots = currentSession.shots || {};
        currentSession.shots[sNum] = {
          filename: sNum === 1 ? 'shot_1_box_a.jpg' : 'shot_2_box_b.jpg',
          savedAt: new Date().toISOString(),
          type: SHOT_DEFINITIONS[sNum].type,
          scope: SHOT_DEFINITIONS[sNum].scope,
          previewDataUrl: shotUrl,
          blurScore
        };
      }
    }

    broadcastSession('BOX_SHOT_SAVED', {
      lotNumber,
      boxNumber,
      shotNumber: sNum,
      boxShots
    });

    // Propagate to any existing book folders belonging to this box in background so HTTP responds in <15ms
    setImmediate(async () => {
      try {
        const matchingItems = getManifestItemsForBox(lotNumber, boxNumber);
        for (const item of matchingItems) {
          const itemClean = sanitizeIsbn(item.isbn);
          const itemFolder = getFolderForIdentifier(itemClean);
          if (fs.existsSync(itemFolder)) {
            await applyBoxShotsToIsbn(itemClean, lotNumber, boxNumber, itemFolder, true);
          }
        }
      } catch (e) {}
    });

    res.json({ success: true, replicated: true, lotNumber, boxNumber, shotNumber: sNum });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint: Query box shots for peer LAN pull
app.get('/api/sync/get-box-shots', async (req, res) => {
  try {
    const lotNumber = req.query.lotNumber || 'Unassigned';
    const boxNumber = req.query.boxNumber || '';
    if (!boxNumber) return res.status(400).json({ error: 'boxNumber is required' });
    const boxShots = getBoxShots(lotNumber, boxNumber);
    res.json({ success: true, lotNumber, boxNumber, boxShots });
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
    const folderPath = getFolderForIdentifier(cleanIsbn);
    await fs.ensureDir(folderPath);

    const shotDef = SHOT_DEFINITIONS[sNum];
    const filename = getShotFilename(sNum, cleanIsbn);
    const filePath = path.join(folderPath, filename);

    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
    await fs.writeFile(filePath, buffer);

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
    if (bookDetails) {
      metadata.bookDetails = { ...(metadata.bookDetails || {}), ...bookDetails };
    }

    metadata.shots = metadata.shots || {};
    metadata.shots[sNum] = {
      filename,
      savedAt: new Date().toISOString(),
      type: shotDef.type,
      scope: shotDef.scope,
      blurScore
    };

    // Also inherit local box shots if available on this PC
    if (metadata.boxNumber) {
      await applyBoxShotsToIsbn(cleanIsbn, metadata.lotNumber, metadata.boxNumber, folderPath);
      const refreshedMeta = readIsbnMetadata(cleanIsbn);
      if (refreshedMeta?.shots) {
        metadata.shots = { ...refreshedMeta.shots, ...metadata.shots };
      }
    }

    const totalShots = Object.keys(metadata.shots).length;
    metadata.isComplete = totalShots >= 7;

    await saveIsbnMetadata(cleanIsbn, metadata);

    // If received shot is Shot 1 or 2, ensure it is also saved into _boxes storage on this PC
    if (sNum === 1 || sNum === 2) {
      let peerLot = incomingMeta?.lotNumber || metadata.lotNumber || '';
      let peerBox = incomingMeta?.boxNumber || metadata.boxNumber || '';
      if (!peerBox) {
        const match = findManifestItem(cleanIsbn);
        if (match) {
          peerBox = match.boxNumber || '';
          peerLot = match.lotNumber || peerLot;
        }
      }
      if (peerBox) {
        await saveBoxShotToFile(peerLot, peerBox, sNum, buffer, blurScore);
      }
    }

    const shotInfo = {
      filename,
      savedAt: new Date().toISOString(),
      type: shotDef.type,
      scope: shotDef.scope,
      previewDataUrl: `/proofs/${encodeURIComponent(cleanIsbn)}/${encodeURIComponent(filename)}?t=${Date.now()}`,
      blurScore
    };

    // If active session matches this ISBN on peer PC, update live state
    let nextStep = currentSession.currentStep;
    if (currentSession.activeIsbn === cleanIsbn) {
      currentSession.shots[sNum] = shotInfo;
      currentSession.metadata = metadata;

      nextStep = 'COMPLETE';
      for (let s = 1; s <= 7; s++) {
        if (!currentSession.shots[s]) {
          nextStep = `CAPTURE_SHOT_${s}`;
          break;
        }
      }
      currentSession.currentStep = nextStep;
    }

    broadcastSession('SHOT_SAVED', {
      isbn: cleanIsbn,
      shotNumber: sNum,
      shotInfo,
      isComplete: totalShots >= 7,
      currentStep: nextStep
    });

    if (totalShots >= 7 && config.s3Enabled !== false && config.s3Bucket && config.s3AccessKeyId) {
      enqueueS3Upload(cleanIsbn);
    }

    res.json({ success: true, replicated: true, isbn: cleanIsbn, shotNumber: sNum, isComplete: totalShots >= 7 });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save replicated photo', details: err.message });
  }
});

// Download ZIP of proof package (Pictures ONLY, no metadata.json)
app.get('/api/capture/zip/:isbn', async (req, res) => {
  const cleanIsbn = sanitizeIsbn(req.params.isbn);
  const folderPath = getFolderForIdentifier(cleanIsbn);

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
    const imageFiles = allFiles.filter(f => {
      if (!f.match(/\.(jpg|jpeg|png)$/i)) return false;
      if (f.startsWith('.')) return false;
      const lower = f.toLowerCase();
      if (lower.startsWith('bak') || lower.includes('.bak') || lower.includes('bak.') || lower.includes('_bak') || lower.includes('backup')) return false;
      return true;
    });
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
      'Part #',
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
        meta?.partNumber ? `Part ${meta.partNumber}` : (getPartNumber(dir.name) ? `Part ${getPartNumber(dir.name)}` : 'Single Book'),
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
    const folderMap = await getAllCandidateJournalFolders();
    if (folderMap.size === 0) {
      return res.json({ items: [] });
    }

    const dirEntries = Array.from(folderMap.entries()).map(([name, fullPath]) => ({ name, fullPath }));

    const items = [];
    let processedCount = 0;
    for (const dir of dirEntries) {
      processedCount++;
      if (processedCount % 40 === 0) {
        await new Promise(r => setImmediate(r));
      }

      const folderPath = dir.fullPath;
      let metadata = readIsbnMetadata(dir.name);

      let stat = null;
      let folderFiles = [];
      try {
        stat = await fs.stat(folderPath);
        folderFiles = await fs.readdir(folderPath);
      } catch (e) {}

      // Multi-part detection: only check if filenames contain _PartN
      const hasPartFiles = folderFiles.some(f => /_part\d+/i.test(f));
      const existingParts = hasPartFiles ? await findExistingParts(dir.name, folderFiles) : [];
      if (existingParts.length > 0) {
        for (const p of existingParts) {
          const pMeta = readIsbnMetadata(p.identifier) || metadata;
          const pShots = {};
          let pCount = 0;
          for (let s = 1; s <= 7; s++) {
            const foundFile = findShotFileInFolder(folderPath, s, p.identifier, folderFiles);
            if (foundFile) {
              pShots[s] = `/proofs/${encodeURIComponent(dir.name)}/${encodeURIComponent(foundFile)}`;
              pCount++;
            } else {
              pShots[s] = null;
            }
          }

          const baseIsbn = dir.name;
          const manifestMatch = findManifestItem(baseIsbn);
          items.push({
            isbn: p.identifier,
            baseIsbn,
            lotNumber: pMeta?.lotNumber || metadata?.lotNumber || manifestMatch?.lotNumber || 'Unassigned Lot',
            boxNumber: pMeta?.boxNumber || metadata?.boxNumber || manifestMatch?.boxNumber || '',
            copyNumber: 1,
            partNumber: p.partNumber,
            totalParts: Math.max(existingParts.length, pMeta?.totalParts || 3),
            folderPath,
            shotsCount: pCount,
            isComplete: pCount >= 7,
            shots: pShots,
            shot1Url: pShots[1],
            shot2Url: pShots[2],
            shot3Url: pShots[3],
            shot4Url: pShots[4],
            shot5Url: pShots[5],
            shot6Url: pShots[6],
            shot7Url: pShots[7],
            modifiedAt: stat ? stat.mtime.toISOString() : null,
            metadata: pMeta || metadata
          });
        }
        continue;
      }

      const shots = {};
      let shotsCount = 0;
      for (let s = 1; s <= 7; s++) {
        const foundFile = findShotFileInFolder(folderPath, s, dir.name, folderFiles);
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
// Auto-Startup Daemon: Cleanup Metadata, Sync Peer Boxes & Auto-Upload
// -------------------------------------------------------------
setTimeout(async () => {
  console.log('[System Daemon] Running initial metadata migration & cleanup...');
  await migrateAllLegacyMetadata();
  console.log('[System Daemon] Syncing all box shots from peer PC...');
  await syncAllBoxShotsFromPeer();
  console.log('[System Daemon] Scanning for unuploaded journals on disk to automatically upload to S3...');
  await scanAllPendingJournalsForS3();
}, 3000);

// Fast background peer box sync every 4 seconds (protected by isSyncingFromPeer mutex & circuit breaker)
setInterval(() => {
  syncAllBoxShotsFromPeer().catch(() => {});
}, 4000);

// Background S3 scan every 60 seconds (protected by isScanningS3 mutex & event-loop yielding)
setInterval(() => {
  scanAllPendingJournalsForS3().catch(() => {});
}, 60000);


