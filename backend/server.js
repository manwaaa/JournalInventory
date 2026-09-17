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
const DEFAULT_STORAGE_PATH = process.platform === 'win32' 
  ? 'C:\\Journal_Proofs' 
  : path.resolve(__dirname, 'storage/journal_proofs');

const CONFIG_FILE = path.resolve(__dirname, 'config.json');
const MANIFEST_FILE = path.resolve(__dirname, 'manifest.json');

// Helper to sanitize ISBN for filesystem safely
function sanitizeIsbn(isbn) {
  if (!isbn || typeof isbn !== 'string') return '';
  return isbn.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
}

// Helper to extract base ISBN from copy names (e.g. 9780198826545_Copy2 -> 9780198826545)
function getBaseIsbn(identifier) {
  return identifier.replace(/_Copy\d+$/i, '');
}

// 7 Shot definitions & filenames (isbn_<type>.jpg)
const SHOT_DEFINITIONS = {
  1: { suffix: '_box.jpg', legacyNames: ['1_books_in_box.jpg', '1_front_spine.jpg', '1_box.jpg', 'box.jpg'], type: 'Box', scope: 'box_level' },
  2: { suffix: '_unbox.jpg', legacyNames: ['2_unbox_books.jpg', '2_author_title.jpg', '2_unbox.jpg', 'unbox.jpg'], type: 'Unbox', scope: 'box_level' },
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

function findShotFileInFolder(folderPath, shotNumber, identifier) {
  const def = SHOT_DEFINITIONS[shotNumber];
  if (!def || !fs.existsSync(folderPath)) return null;

  // 1. Direct match with identifier prefix (e.g. 9780198826545_box.jpg)
  const targetName = getShotFilename(shotNumber, identifier);
  if (fs.existsSync(path.join(folderPath, targetName))) {
    return targetName;
  }

  // 2. Scan directory for matching suffix or legacy names
  try {
    const files = fs.readdirSync(folderPath);
    const suffix = def.suffix.toLowerCase();

    // Check files ending with this shot's suffix (e.g. any *_box.jpg, *_front cover.jpg)
    const suffixMatch = files.find(f => f.toLowerCase().endsWith(suffix));
    if (suffixMatch) return suffixMatch;

    // Check legacy names
    for (const leg of def.legacyNames) {
      const legMatch = files.find(f => f.toLowerCase() === leg.toLowerCase() || f.toLowerCase().endsWith(leg.toLowerCase()));
      if (legMatch) return legMatch;
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
  enforceManifest: false
};

if (fs.existsSync(CONFIG_FILE)) {
  try {
    const saved = fs.readJsonSync(CONFIG_FILE);
    config = { ...config, ...saved };
  } catch (err) {
    console.error('Failed to parse config.json, using defaults:', err);
  }
} else {
  fs.writeJsonSync(CONFIG_FILE, config, { spaces: 2 });
}

// Load or initialize Manifest database
let manifestData = {
  items: [],
  totalCount: 0,
  processableCount: 0,
  nonProcessableCount: 0,
  lastUpdated: null,
  filename: null
};

if (fs.existsSync(MANIFEST_FILE)) {
  try {
    manifestData = fs.readJsonSync(MANIFEST_FILE);
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

// Serve saved shots statically
app.use('/proofs', (req, res, next) => {
  express.static(config.storagePath)(req, res, next);
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
  broadcastSession('SESSION_RESET');
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

app.post('/api/manifest/import', (req, res) => {
  try {
    const { items, filename } = req.body;
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'Items array is required' });
    }

    const cleanItems = items.map(item => ({
      isbn: String(item.isbn || '').trim(),
      lotNumber: item.lotNumber ? String(item.lotNumber).trim() : '',
      boxNumber: item.boxNumber ? String(item.boxNumber).trim() : '',
      title: item.title ? String(item.title).trim() : '',
      author: item.author ? String(item.author).trim() : '',
      isProcessable: item.isProcessable !== false && String(item.isProcessable).toLowerCase() !== 'false' && String(item.isProcessable).toLowerCase() !== 'no',
      reason: item.reason ? String(item.reason).trim() : '',
      notes: item.notes ? String(item.notes).trim() : '',
      importedAt: new Date().toISOString()
    })).filter(i => i.isbn.length > 0);

    const processableCount = cleanItems.filter(i => i.isProcessable).length;
    const nonProcessableCount = cleanItems.length - processableCount;

    manifestData = {
      items: cleanItems,
      totalCount: cleanItems.length,
      processableCount,
      nonProcessableCount,
      lastUpdated: new Date().toISOString(),
      filename: filename || 'manifest_import.csv'
    };

    saveManifest();
    broadcastSession('MANIFEST_UPDATED', { manifestData });

    res.json({
      success: true,
      manifestData
    });
  } catch (err) {
    console.error('Manifest import error:', err);
    res.status(500).json({ error: 'Failed to import manifest', details: err.message });
  }
});

app.get('/api/manifest/check/:isbn', (req, res) => {
  const rawIsbn = req.params.isbn;
  const cleanIsbn = sanitizeIsbn(rawIsbn);
  const numericOnly = rawIsbn.replace(/[^0-9Xx]/g, '');

  if (!manifestData.items || manifestData.items.length === 0) {
    return res.json({
      manifestActive: false,
      found: false,
      isProcessable: true
    });
  }

  const match = manifestData.items.find(item => {
    const itemNum = item.isbn.replace(/[^0-9Xx]/g, '');
    return item.isbn.toLowerCase() === rawIsbn.toLowerCase() ||
      item.isbn.toLowerCase() === cleanIsbn.toLowerCase() ||
      (numericOnly.length > 0 && itemNum === numericOnly);
  });

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

app.delete('/api/manifest', (req, res) => {
  manifestData = {
    items: [],
    totalCount: 0,
    processableCount: 0,
    nonProcessableCount: 0,
    lastUpdated: null,
    filename: null
  };
  saveManifest();
  broadcastSession('MANIFEST_UPDATED', { manifestData });
  res.json({ success: true, message: 'Manifest cleared' });
});

// -------------------------------------------------------------
// System Endpoints
// -------------------------------------------------------------
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

  saveConfig();
  res.json({ success: true, config });
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
// -------------------------------------------------------------
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

    let meta = null;
    try {
      meta = await fs.readJson(path.join(folderPath, 'metadata.json'));
    } catch (e) {}

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

    // Check Manifest validation
    let manifestMatch = null;
    let isProcessable = true;
    let nonProcessableReason = '';

    if (manifestData.items && manifestData.items.length > 0) {
      const numericOnly = isbn.replace(/[^0-9Xx]/g, '');
      manifestMatch = manifestData.items.find(item => {
        const itemNum = item.isbn.replace(/[^0-9Xx]/g, '');
        return item.isbn.toLowerCase() === isbn.toLowerCase() ||
          item.isbn.toLowerCase() === cleanBaseIsbn.toLowerCase() ||
          (numericOnly.length > 0 && itemNum === numericOnly);
      });

      if (manifestMatch) {
        isProcessable = manifestMatch.isProcessable;
        if (!isProcessable) {
          nonProcessableReason = manifestMatch.reason || 'Journal is marked as Not Processable in the imported manifest.';
        }
      } else if (config.enforceManifest) {
        isProcessable = false;
        nonProcessableReason = 'ISBN is not listed in the imported manifest (Strict Mode Active).';
      }
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

    let metadata = null;
    const metaPath = path.join(folderPath, 'metadata.json');
    if (alreadyExists && fs.existsSync(metaPath)) {
      try {
        metadata = fs.readJsonSync(metaPath);
      } catch (e) {}
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
        shotsState[s] = {
          filename: existingShots[s],
          savedAt: metadata?.shots?.[s]?.savedAt || new Date().toISOString(),
          type: SHOT_DEFINITIONS[s].type,
          scope: SHOT_DEFINITIONS[s].scope,
          blurScore: metadata?.shots?.[s]?.blurScore
        };
      } else {
        shotsState[s] = null;
      }
    }

    const resolvedLot = manifestMatch?.lotNumber || metadata?.lotNumber || lotNumber || currentSession.lotNumber || 'Lot-1';
    const resolvedBox = manifestMatch?.boxNumber || metadata?.boxNumber || boxNumber || currentSession.boxNumber || '';

    currentSession = {
      activeIsbn: activeIdentifier,
      baseIsbn: baseIsbnOnly,
      lotNumber: resolvedLot,
      boxNumber: resolvedBox,
      currentStep: initialStep,
      shots: shotsState,
      metadata,
      bookDetails: metadata?.bookDetails || (manifestMatch?.title ? { title: manifestMatch.title, authors: manifestMatch.author } : null),
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
      manifestMatch
    });

    res.json({
      success: true,
      isbn: activeIdentifier,
      baseIsbn: baseIsbnOnly,
      lotNumber: resolvedLot,
      boxNumber: resolvedBox,
      copyNumber,
      folderPath,
      exists: alreadyExists,
      existingShots,
      shotsCount: shotsFoundCount,
      metadata,
      existingCopies,
      hasDuplicateCopies: existingCopies.length > 0 && !forceNewCopy && !targetIdentifier,
      isProcessable,
      nonProcessableReason,
      manifestMatch
    });
  } catch (err) {
    console.error('Error in init-isbn:', err);
    res.status(500).json({ error: 'Failed to initialize verification session', details: err.message });
  }
});

// Save captured shot (1 to 7)
app.post('/api/capture/save-shot', async (req, res) => {
  try {
    const { 
      isbn, 
      shotNumber, 
      imageBase64, 
      operatorName, 
      bookDetails,
      blurScore,
      lotNumber,
      boxNumber
    } = req.body;

    const sNum = parseInt(shotNumber, 10);
    if (!isbn || !imageBase64 || sNum < 1 || sNum > 7) {
      return res.status(400).json({ error: 'Valid ISBN, shotNumber (1-7), and base64 image required' });
    }

    const cleanIsbn = sanitizeIsbn(isbn);
    const baseIsbnOnly = getBaseIsbn(cleanIsbn);
    const copyMatch = cleanIsbn.match(/_Copy(\d+)$/i);
    const copyNumber = copyMatch ? parseInt(copyMatch[1], 10) : 1;

    const folderPath = path.join(config.storagePath, cleanIsbn);
    fs.ensureDirSync(folderPath);

    const shotDef = SHOT_DEFINITIONS[sNum];
    const filename = getShotFilename(sNum, cleanIsbn);
    const filePath = path.join(folderPath, filename);

    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
    await fs.writeFile(filePath, buffer);

    // Look up manifest to ensure lot and box are preserved from manifest
    let manifestMatchForShot = null;
    if (manifestData.items && manifestData.items.length > 0) {
      const numericOnly = baseIsbnOnly.replace(/[^0-9Xx]/g, '');
      manifestMatchForShot = manifestData.items.find(item => {
        const itemNum = item.isbn.replace(/[^0-9Xx]/g, '');
        return item.isbn.toLowerCase() === baseIsbnOnly.toLowerCase() ||
          (numericOnly.length > 0 && itemNum === numericOnly);
      });
    }

    const resolvedLot = manifestMatchForShot?.lotNumber || lotNumber || currentSession.lotNumber || 'Lot-1';
    const resolvedBox = manifestMatchForShot?.boxNumber || boxNumber || currentSession.boxNumber || '';

    const metaPath = path.join(folderPath, 'metadata.json');
    let metadata = {
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

    if (fs.existsSync(metaPath)) {
      try {
        const savedMeta = fs.readJsonSync(metaPath);
        metadata = { ...metadata, ...savedMeta, updatedAt: new Date().toISOString() };
        if (bookDetails) {
          metadata.bookDetails = { ...(metadata.bookDetails || {}), ...bookDetails };
        }
      } catch (e) {}
    }

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

    await fs.writeJson(metaPath, metadata, { spaces: 2 });

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

    broadcastSession('SHOT_SAVED', {
      isbn: cleanIsbn,
      shotNumber: sNum,
      shotInfo: newShotInfo,
      isComplete: totalShots >= 7,
      currentStep: nextStep
    });

    if (config.autoOpenExplorer && totalShots >= 7) {
      if (process.platform === 'win32') {
        exec(`explorer.exe "${path.resolve(folderPath)}"`, () => {});
      }
    }

    if (!req.body.isReplication && config.peerSyncEnabled && config.peerIp) {
      replicateToPeer({
        isbn: cleanIsbn,
        shotNumber: sNum,
        imageBase64,
        operatorName,
        bookDetails,
        blurScore,
        metadata
      });
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

// -------------------------------------------------------------
// Multi-PC Peer Synchronization Endpoints
// -------------------------------------------------------------
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

    const metaPath = path.join(folderPath, 'metadata.json');
    let metadata = incomingMeta || {
      identifier: cleanIsbn,
      isbn: getBaseIsbn(cleanIsbn),
      operator: operatorName || 'Peer Station',
      station: 'Peer Station',
      shots: {}
    };

    if (fs.existsSync(metaPath)) {
      try {
        const saved = fs.readJsonSync(metaPath);
        metadata = { ...metadata, ...saved, updatedAt: new Date().toISOString() };
      } catch (e) {}
    }

    metadata.shots = metadata.shots || {};
    metadata.shots[sNum] = {
      filename,
      savedAt: new Date().toISOString(),
      type: shotDef.type,
      scope: shotDef.scope,
      blurScore
    };

    await fs.writeJson(metaPath, metadata, { spaces: 2 });
    res.json({ success: true, replicated: true, isbn: cleanIsbn, shotNumber: sNum });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save replicated photo', details: err.message });
  }
});

// Download ZIP of proof package (All 7 Shots)
app.get('/api/capture/zip/:isbn', (req, res) => {
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
  archive.directory(folderPath, false);
  archive.finalize();
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
    const dirEntries = entries.filter(e => e.isDirectory());

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
      'Shot 1 (Box)',
      'Shot 2 (Unbox)',
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
      const metaPath = path.join(folderPath, 'metadata.json');

      let meta = null;
      if (fs.existsSync(metaPath)) {
        try {
          meta = await fs.readJson(metaPath);
        } catch (e) {}
      }

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
      const lotNum = meta?.lotNumber || 'Lot-131';
      const boxNum = meta?.boxNumber || '';
      const title = meta?.bookDetails?.title || '';
      const authors = meta?.bookDetails?.authors || '';
      const publisher = meta?.bookDetails?.publisher || '';
      const year = meta?.bookDetails?.publishYear || '';
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
    const dirEntries = entries.filter(e => e.isDirectory());

    const items = [];
    for (const dir of dirEntries) {
      const folderPath = path.join(config.storagePath, dir.name);
      const metaPath = path.join(folderPath, 'metadata.json');

      let stat = null;
      try {
        stat = await fs.stat(folderPath);
      } catch (e) {}

      let metadata = null;
      if (fs.existsSync(metaPath)) {
        try {
          metadata = await fs.readJson(metaPath);
        } catch (e) {}
      }

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

      items.push({
        isbn: dir.name,
        baseIsbn,
        lotNumber: metadata?.lotNumber || 'Lot-131',
        boxNumber: metadata?.boxNumber || '',
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

// Start HTTPS server for Mobile Devices
if (sslOptions) {
  try {
    const httpsServer = https.createServer(sslOptions, app);
    httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
      const ips = getNetworkIps();
      console.log(`  HTTPS (Mobile):   https://localhost:${HTTPS_PORT}`);
      ips.forEach(ip => console.log(`  Mobile HTTPS:     https://${ip.address}:${HTTPS_PORT}`));
      console.log(`====================================================`);
    });
  } catch (e) {
    console.error('Failed to start HTTPS server:', e);
  }
}
