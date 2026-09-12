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
      { name: 'organizationName', value: 'JournalProof Inventory' }
    ], { days: 730 });

    fs.writeFileSync(CERT_FILE, pems.cert, 'utf8');
    fs.writeFileSync(KEY_FILE, pems.private, 'utf8');
    sslOptions = { cert: pems.cert, key: pems.private };
    console.log('[SSL] Local SSL certificate generated and saved.');
  }
} catch (e) {
  console.warn('[SSL] Could not initialize SSL certificate:', e.message);
}

// Default storage directory: C:\Journal_Proofs on Windows, or ./storage/journal_proofs
const DEFAULT_STORAGE_PATH = process.platform === 'win32' 
  ? 'C:\\Journal_Proofs' 
  : path.resolve(__dirname, 'storage/journal_proofs');

const CONFIG_FILE = path.resolve(__dirname, 'config.json');

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
  peerPort: 3001
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

// Ensure storage directory exists
try {
  fs.ensureDirSync(config.storagePath);
  console.log(`[Storage] Storage directory ready at: ${config.storagePath}`);
} catch (err) {
  console.error(`[Storage] Failed to create default storage path (${config.storagePath}), falling back to local storage.`, err);
  config.storagePath = path.resolve(__dirname, 'storage/journal_proofs');
  fs.ensureDirSync(config.storagePath);
}

// Helper to save config
function saveConfig() {
  try {
    fs.writeJsonSync(CONFIG_FILE, config, { spaces: 2 });
  } catch (err) {
    console.error('Failed to save config:', err);
  }
}

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
      console.warn(`[PeerSync] Replicating to ${peerUrl} responded with status: ${res.status}`);
    } else {
      console.log(`[PeerSync] Successfully replicated shot ${shotData.shotNumber} for ${shotData.isbn} to peer ${config.peerIp}`);
    }
  } catch (err) {
    console.warn(`[PeerSync] Could not replicate shot to peer ${config.peerIp}:`, err.message);
  }
}

// Global active capture session state (synced across PC & Phone)
let currentSession = {
  activeIsbn: '',
  baseIsbn: '',
  currentStep: 'SCAN_ISBN',
  shot1: null,
  shot2: null,
  metadata: null,
  bookDetails: null,
  copyNumber: 1
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

// Helper to sanitize ISBN for filesystem safely
function sanitizeIsbn(isbn) {
  if (!isbn || typeof isbn !== 'string') return '';
  return isbn.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
}

// Helper to extract base ISBN from copy names (e.g. 9780198826545_Copy2 -> 9780198826545)
function getBaseIsbn(identifier) {
  return identifier.replace(/_Copy\d+$/i, '');
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
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Serve saved shots statically
app.use('/proofs', (req, res, next) => {
  express.static(config.storagePath)(req, res, next);
});

// Cache for metadata lookups
const metadataCache = new Map();

// -------------------------------------------------------------
// Real-Time Cross-Device Session Endpoints (SSE)
// -------------------------------------------------------------

// SSE stream for real-time pairing between PC & Phone
app.get('/api/session/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  // Immediately send current session state upon connection
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

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// Get current live session
app.get('/api/session/current', (req, res) => {
  res.json({ session: currentSession });
});

// Reset live session (e.g. Next Journal)
app.post('/api/session/reset', (req, res) => {
  currentSession = {
    activeIsbn: '',
    baseIsbn: '',
    currentStep: 'SCAN_ISBN',
    shot1: null,
    shot2: null,
    metadata: null,
    bookDetails: null,
    copyNumber: 1
  };
  broadcastSession('SESSION_RESET');
  res.json({ success: true, session: currentSession });
});
// System Endpoints
// -------------------------------------------------------------

// System Status & Network info
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
    peerPort: config.peerPort || 3001
  });
});

// Config GET & POST
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
    peerPort
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

  saveConfig();
  res.json({ success: true, config });
});

// Open folder in Windows Explorer
app.post('/api/system/open-folder', (req, res) => {
  const { isbn, targetPath } = req.body;
  let folderToOpen = targetPath || config.storagePath;

  if (isbn) {
    const cleanIsbn = sanitizeIsbn(isbn);
    folderToOpen = path.join(config.storagePath, cleanIsbn);
  }

  if (!fs.existsSync(folderToOpen)) {
    fs.ensureDirSync(folderToOpen);
  }

  const normalizedPath = path.resolve(folderToOpen);

  if (process.platform === 'win32') {
    // Note: explorer.exe returns exit code 1 when delegating to the Windows Shell
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
// Metadata Automated Lookup (OpenLibrary, Google Books, CrossRef)
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

    // 1. Try OpenLibrary API
    if (numericOnly.length >= 9) {
      try {
        const olUrl = `https://openlibrary.org/api/books?bibkeys=ISBN:${numericOnly}&format=json&jscmd=data`;
        const olRes = await fetch(olUrl, {
          headers: { 'User-Agent': 'JournalProofInventory/1.0' },
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
      } catch (e) {
        // continue to next provider
      }
    }

    // 2. Fallback: Google Books API
    if (!bookData && numericOnly.length >= 8) {
      try {
        const gbUrl = `https://www.googleapis.com/books/v1/volumes?q=isbn:${numericOnly}`;
        const gbRes = await fetch(gbUrl, {
          headers: { 'User-Agent': 'JournalProofInventory/1.0' },
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
      } catch (e) {
        // continue to fallback
      }
    }

    // 3. Fallback: CrossRef for Journals / ISSN / titles
    if (!bookData) {
      try {
        const crUrl = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(cleanIsbn)}&rows=1`;
        const crRes = await fetch(crUrl, {
          headers: { 'User-Agent': 'JournalProofInventory/1.0 (mailto:admin@journalproof.local)' },
          signal: AbortSignal.timeout(3000)
        });
        if (crRes.ok) {
          const crJson = await crRes.json();
          const item = crJson.message?.items?.[0];
          if (item) {
            const authors = item.author?.map(a => `${a.given || ''} ${a.family || ''}`.trim()).filter(Boolean).join(', ') || '';
            bookData = {
              title: item.title?.[0] || item['container-title']?.[0] || '',
              publisher: item.publisher || '',
              authors: authors,
              publishYear: item.published?.['date-parts']?.[0]?.[0]?.toString() || '',
              source: 'CrossRef'
            };
          }
        }
      } catch (e) {
        // ignore
      }
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
// Capture & Storage Endpoints
// -------------------------------------------------------------

// Helper to find existing copies of an ISBN
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
    const hasShot1 = fs.existsSync(path.join(folderPath, '1_front_spine.jpg'));
    const hasShot2 = fs.existsSync(path.join(folderPath, '2_author_title.jpg'));
    let meta = null;
    try {
      meta = await fs.readJson(path.join(folderPath, 'metadata.json'));
    } catch (e) {}

    // Parse copy number
    const copyMatch = name.match(/_Copy(\d+)$/i);
    const copyNumber = copyMatch ? parseInt(copyMatch[1], 10) : 1;

    copies.push({
      identifier: name,
      copyNumber,
      hasShot1,
      hasShot2,
      isComplete: hasShot1 && hasShot2,
      metadata: meta
    });
  }

  copies.sort((a, b) => a.copyNumber - b.copyNumber);
  return copies;
}

// Initialize ISBN folder (supports new copy creation & duplicate detection)
app.post('/api/capture/init-isbn', async (req, res) => {
  try {
    const { isbn, forceNewCopy, targetIdentifier } = req.body;
    if (!isbn || !isbn.trim()) {
      return res.status(400).json({ error: 'ISBN is required' });
    }

    const cleanBaseIsbn = sanitizeIsbn(isbn);
    const baseIsbnOnly = getBaseIsbn(cleanBaseIsbn);

    const existingCopies = await findExistingCopies(baseIsbnOnly);

    let activeIdentifier = cleanBaseIsbn;
    let copyNumber = 1;

    if (forceNewCopy) {
      // Find highest copy number and increment
      const maxCopy = existingCopies.reduce((max, c) => Math.max(max, c.copyNumber), 0);
      const nextCopyNum = Math.max(maxCopy + 1, 2);
      activeIdentifier = `${baseIsbnOnly}_Copy${nextCopyNum}`;
      copyNumber = nextCopyNum;
    } else if (targetIdentifier) {
      activeIdentifier = sanitizeIsbn(targetIdentifier);
      const match = activeIdentifier.match(/_Copy(\d+)$/i);
      copyNumber = match ? parseInt(match[1], 10) : 1;
    }

    const folderPath = path.join(config.storagePath, activeIdentifier);
    const alreadyExists = fs.existsSync(folderPath);
    fs.ensureDirSync(folderPath);

    const existingShots = [];
    const shot1Path = path.join(folderPath, '1_front_spine.jpg');
    const shot2Path = path.join(folderPath, '2_author_title.jpg');

    if (fs.existsSync(shot1Path)) existingShots.push('1_front_spine.jpg');
    if (fs.existsSync(shot2Path)) existingShots.push('2_author_title.jpg');

    let metadata = null;
    const metaPath = path.join(folderPath, 'metadata.json');
    if (fs.existsSync(metaPath)) {
      try {
        metadata = fs.readJsonSync(metaPath);
      } catch (e) {}
    }

    // Update live session state
    let initialStep = 'CAPTURE_SHOT_1';
    let shot1Info = null;
    let shot2Info = null;

    if (existingShots.includes('1_front_spine.jpg')) {
      shot1Info = {
        filename: '1_front_spine.jpg',
        savedAt: metadata?.shots?.['1']?.savedAt || new Date().toISOString(),
        type: 'Front Cover & Spine Angle',
        blurScore: metadata?.shots?.['1']?.blurScore
      };
    }
    if (existingShots.includes('2_author_title.jpg')) {
      shot2Info = {
        filename: '2_author_title.jpg',
        savedAt: metadata?.shots?.['2']?.savedAt || new Date().toISOString(),
        type: 'Author & Title Page Angle',
        blurScore: metadata?.shots?.['2']?.blurScore
      };
    }

    if (existingShots.length >= 2) {
      initialStep = 'COMPLETE';
    } else if (existingShots.includes('1_front_spine.jpg')) {
      initialStep = 'CAPTURE_SHOT_2';
    }

    currentSession = {
      activeIsbn: activeIdentifier,
      baseIsbn: baseIsbnOnly,
      currentStep: initialStep,
      shot1: shot1Info,
      shot2: shot2Info,
      metadata,
      bookDetails: metadata?.bookDetails || null,
      copyNumber
    };

    broadcastSession('ISBN_INITIALIZED', {
      isbn: activeIdentifier,
      baseIsbn: baseIsbnOnly,
      currentStep: initialStep,
      copyNumber
    });

    res.json({
      success: true,
      isbn: activeIdentifier,
      baseIsbn: baseIsbnOnly,
      copyNumber,
      folderPath,
      exists: alreadyExists,
      existingShots,
      metadata,
      existingCopies,
      hasDuplicateCopies: existingCopies.length > 0 && !forceNewCopy && !targetIdentifier
    });
  } catch (err) {
    console.error('Error in init-isbn:', err);
    res.status(500).json({ error: 'Failed to initialize ISBN folder', details: err.message });
  }
});

// Save captured shot (1 or 2)
app.post('/api/capture/save-shot', async (req, res) => {
  try {
    const { 
      isbn, 
      shotNumber, 
      imageBase64, 
      operatorName, 
      bookDetails,
      blurScore
    } = req.body;

    if (!isbn || !imageBase64 || (shotNumber !== 1 && shotNumber !== 2)) {
      return res.status(400).json({ error: 'Valid ISBN, shotNumber (1 or 2), and base64 image required' });
    }

    const cleanIsbn = sanitizeIsbn(isbn);
    const baseIsbnOnly = getBaseIsbn(cleanIsbn);
    const copyMatch = cleanIsbn.match(/_Copy(\d+)$/i);
    const copyNumber = copyMatch ? parseInt(copyMatch[1], 10) : 1;

    const folderPath = path.join(config.storagePath, cleanIsbn);
    fs.ensureDirSync(folderPath);

    const filename = shotNumber === 1 ? '1_front_spine.jpg' : '2_author_title.jpg';
    const filePath = path.join(folderPath, filename);

    // Strip data URL prefix if present
    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');

    await fs.writeFile(filePath, buffer);

    // Update metadata.json
    const metaPath = path.join(folderPath, 'metadata.json');
    let metadata = {
      identifier: cleanIsbn,
      isbn: baseIsbnOnly,
      copyNumber,
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
        metadata = { 
          ...metadata, 
          ...savedMeta, 
          updatedAt: new Date().toISOString() 
        };
        if (bookDetails) {
          metadata.bookDetails = { ...(metadata.bookDetails || {}), ...bookDetails };
        }
      } catch (e) {}
    }

    metadata.shots[shotNumber] = {
      filename,
      sizeBytes: buffer.length,
      savedAt: new Date().toISOString(),
      type: shotNumber === 1 ? 'Front Cover & Spine Angle' : 'Author & Title Page Angle',
      blurScore: blurScore !== undefined ? blurScore : null
    };

    await fs.writeJson(metaPath, metadata, { spaces: 2 });

    const totalShots = Object.keys(metadata.shots).length;

    const newShotInfo = {
      filename,
      savedAt: new Date().toISOString(),
      type: shotNumber === 1 ? 'Front Cover & Spine Angle' : 'Author & Title Page Angle',
      previewDataUrl: imageBase64,
      blurScore
    };

    if (shotNumber === 1) {
      currentSession.shot1 = newShotInfo;
      currentSession.currentStep = totalShots >= 2 ? 'COMPLETE' : 'CAPTURE_SHOT_2';
    } else {
      currentSession.shot2 = newShotInfo;
      currentSession.currentStep = 'COMPLETE';
    }

    currentSession.metadata = metadata;
    if (bookDetails) currentSession.bookDetails = bookDetails;

    broadcastSession('SHOT_SAVED', {
      isbn: cleanIsbn,
      shotNumber,
      shotInfo: newShotInfo,
      isComplete: totalShots >= 2,
      currentStep: currentSession.currentStep
    });

    // Optional: Only auto-open Windows Explorer folder on PC if explicitly enabled in settings
    if (config.autoOpenExplorer && totalShots >= 2) {
      if (process.platform === 'win32') {
        exec(`explorer.exe "${path.resolve(folderPath)}"`, (err) => {
          if (err && err.code !== 1 && err.code !== 0) {
            console.warn('Explorer launch warning:', err.message);
          }
        });
      }
    }

    // 2-Way Multi-PC sync: replicate to peer PC if enabled and not already a replicated shot
    if (!req.body.isReplication && config.peerSyncEnabled && config.peerIp) {
      replicateToPeer({
        isbn: cleanIsbn,
        shotNumber,
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
      shotNumber,
      filename,
      filePath,
      relativeUrl: `/proofs/${encodeURIComponent(cleanIsbn)}/${filename}`,
      totalShotsSaved: totalShots,
      isComplete: totalShots >= 2,
      metadata
    });
  } catch (err) {
    console.error('Error saving shot:', err);
    res.status(500).json({ error: 'Failed to save photo to disk', details: err.message });
  }
});

// -------------------------------------------------------------
// 2-Way Multi-PC Peer Synchronization Endpoints
// -------------------------------------------------------------

// Receive replicated shot from peer PC
app.post('/api/sync/receive-shot', async (req, res) => {
  try {
    const { 
      isbn, 
      shotNumber, 
      imageBase64, 
      operatorName, 
      bookDetails,
      blurScore,
      metadata: incomingMeta
    } = req.body;

    if (!isbn || !imageBase64 || (shotNumber !== 1 && shotNumber !== 2)) {
      return res.status(400).json({ error: 'Valid ISBN, shotNumber, and base64 image required for peer sync' });
    }

    const cleanIsbn = sanitizeIsbn(isbn);
    const baseIsbnOnly = getBaseIsbn(cleanIsbn);
    const copyMatch = cleanIsbn.match(/_Copy(\d+)$/i);
    const copyNumber = copyMatch ? parseInt(copyMatch[1], 10) : 1;

    const folderPath = path.join(config.storagePath, cleanIsbn);
    fs.ensureDirSync(folderPath);

    const filename = shotNumber === 1 ? '1_front_spine.jpg' : '2_author_title.jpg';
    const filePath = path.join(folderPath, filename);

    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
    await fs.writeFile(filePath, buffer);

    const metaPath = path.join(folderPath, 'metadata.json');
    let metadata = incomingMeta || {
      identifier: cleanIsbn,
      isbn: baseIsbnOnly,
      copyNumber,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      operator: operatorName || 'Peer Station',
      station: 'Peer Station',
      bookDetails: bookDetails || null,
      shots: {}
    };

    if (fs.existsSync(metaPath)) {
      try {
        const savedMeta = fs.readJsonSync(metaPath);
        metadata = { ...metadata, ...savedMeta, updatedAt: new Date().toISOString() };
      } catch (e) {}
    }

    metadata.shots = metadata.shots || {};
    metadata.shots[shotNumber] = {
      filename,
      sizeBytes: buffer.length,
      savedAt: new Date().toISOString(),
      type: shotNumber === 1 ? 'Front Cover & Spine Angle' : 'Author & Title Page Angle',
      blurScore: blurScore !== undefined ? blurScore : null
    };

    await fs.writeJson(metaPath, metadata, { spaces: 2 });
    console.log(`[PeerSync] Received and saved replicated proof for ${cleanIsbn} (Shot ${shotNumber})`);

    res.json({ success: true, replicated: true, isbn: cleanIsbn, shotNumber });
  } catch (err) {
    console.error('[PeerSync] Error saving replicated shot:', err);
    res.status(500).json({ error: 'Failed to save replicated photo', details: err.message });
  }
});

// Return manifest of all local captured proofs for catch-up diffing
app.get('/api/sync/manifest', async (req, res) => {
  try {
    if (!fs.existsSync(config.storagePath)) {
      return res.json({ items: [] });
    }
    const entries = await fs.readdir(config.storagePath, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);
    const items = [];

    for (const dir of dirs) {
      const folderPath = path.join(config.storagePath, dir);
      const hasShot1 = fs.existsSync(path.join(folderPath, '1_front_spine.jpg'));
      const hasShot2 = fs.existsSync(path.join(folderPath, '2_author_title.jpg'));
      let meta = null;
      try {
        meta = await fs.readJson(path.join(folderPath, 'metadata.json'));
      } catch (e) {}

      items.push({
        identifier: dir,
        hasShot1,
        hasShot2,
        isComplete: hasShot1 && hasShot2,
        metadata: meta
      });
    }

    res.json({ items, hostname: os.hostname(), total: items.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read manifest' });
  }
});

// Test connection to peer PC
app.post('/api/sync/test-connection', async (req, res) => {
  const targetIp = req.body.peerIp || config.peerIp;
  const targetPort = req.body.peerPort || config.peerPort || 3001;

  if (!targetIp) {
    return res.status(400).json({ success: false, error: 'Peer IP address is required' });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const pingRes = await fetch(`http://${targetIp}:${targetPort}/api/system/status`, {
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (pingRes.ok) {
      const data = await pingRes.json();
      return res.json({
        success: true,
        reachable: true,
        peerHostname: data.hostname,
        peerStoragePath: data.storagePath,
        peerJournalsCount: data.totalCapturedJournals
      });
    } else {
      return res.status(pingRes.status).json({ success: false, reachable: false, error: `Peer returned HTTP ${pingRes.status}` });
    }
  } catch (err) {
    return res.json({ success: false, reachable: false, error: `Could not reach ${targetIp}:${targetPort} (${err.message})` });
  }
});

// Catch-up / Reconcile all missing proofs from peer PC
app.post('/api/sync/reconcile-all', async (req, res) => {
  const targetIp = req.body.peerIp || config.peerIp;
  const targetPort = req.body.peerPort || config.peerPort || 3001;

  if (!targetIp) {
    return res.status(400).json({ error: 'Peer IP address is required' });
  }

  try {
    const manifestRes = await fetch(`http://${targetIp}:${targetPort}/api/sync/manifest`);
    if (!manifestRes.ok) {
      return res.status(500).json({ error: 'Could not fetch peer manifest' });
    }
    const { items: peerItems } = await manifestRes.json();
    let syncedCount = 0;

    for (const peerItem of peerItems) {
      const folderPath = path.join(config.storagePath, peerItem.identifier);
      fs.ensureDirSync(folderPath);

      // Check and fetch shot 1 if missing
      const localShot1 = path.join(folderPath, '1_front_spine.jpg');
      if (peerItem.hasShot1 && !fs.existsSync(localShot1)) {
        try {
          const imgRes = await fetch(`http://${targetIp}:${targetPort}/proofs/${encodeURIComponent(peerItem.identifier)}/1_front_spine.jpg`);
          if (imgRes.ok) {
            const arrayBuffer = await imgRes.arrayBuffer();
            await fs.writeFile(localShot1, Buffer.from(arrayBuffer));
            syncedCount++;
          }
        } catch (e) {}
      }

      // Check and fetch shot 2 if missing
      const localShot2 = path.join(folderPath, '2_author_title.jpg');
      if (peerItem.hasShot2 && !fs.existsSync(localShot2)) {
        try {
          const imgRes = await fetch(`http://${targetIp}:${targetPort}/proofs/${encodeURIComponent(peerItem.identifier)}/2_author_title.jpg`);
          if (imgRes.ok) {
            const arrayBuffer = await imgRes.arrayBuffer();
            await fs.writeFile(localShot2, Buffer.from(arrayBuffer));
            syncedCount++;
          }
        } catch (e) {}
      }

      // Save metadata if provided
      if (peerItem.metadata) {
        const metaPath = path.join(folderPath, 'metadata.json');
        await fs.writeJson(metaPath, peerItem.metadata, { spaces: 2 });
      }
    }

    res.json({
      success: true,
      syncedCount,
      peerTotalItems: peerItems.length
    });
  } catch (err) {
    console.error('[PeerSync] Reconcile error:', err);
    res.status(500).json({ error: 'Failed to reconcile with peer', details: err.message });
  }
});

// Download ZIP of proof package
app.get('/api/capture/zip/:isbn', (req, res) => {
  const cleanIsbn = sanitizeIsbn(req.params.isbn);
  const folderPath = path.join(config.storagePath, cleanIsbn);

  if (!fs.existsSync(folderPath)) {
    return res.status(404).json({ error: 'Folder not found for this ISBN' });
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="Proof_${cleanIsbn}.zip"`);

  const archive = archiver('zip', { zlib: { level: 9 } });

  archive.on('error', (err) => {
    res.status(500).send({ error: err.message });
  });

  archive.pipe(res);
  archive.directory(folderPath, false);
  archive.finalize();
});

// -------------------------------------------------------------
// Gallery, History & CSV Export Endpoints
// -------------------------------------------------------------

// Helper to escape CSV values according to RFC 4180
function escapeCsv(val) {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

// Export entire inventory records to CSV / Excel
app.get('/api/gallery/export-csv', async (req, res) => {
  try {
    if (!fs.existsSync(config.storagePath)) {
      return res.status(400).send('No storage directory found');
    }

    const entries = await fs.readdir(config.storagePath, { withFileTypes: true });
    const dirEntries = entries.filter(e => e.isDirectory());

    const rows = [];
    // Header row
    const headers = [
      'Folder Identifier',
      'ISBN / ISSN',
      'Copy #',
      'Journal / Book Title',
      'Authors',
      'Publisher',
      'Publication Year',
      'Status',
      'Shot 1 (Front & Spine)',
      'Shot 2 (Author & Title)',
      'Operator',
      'Workstation',
      'Date Created',
      'Date Modified',
      'Local Storage Path'
    ];
    rows.push(headers.map(escapeCsv).join(','));

    for (const dir of dirEntries) {
      const folderPath = path.join(config.storagePath, dir.name);
      const shot1Path = path.join(folderPath, '1_front_spine.jpg');
      const shot2Path = path.join(folderPath, '2_author_title.jpg');
      const metaPath = path.join(folderPath, 'metadata.json');

      const hasShot1 = fs.existsSync(shot1Path);
      const hasShot2 = fs.existsSync(shot2Path);
      const isComplete = hasShot1 && hasShot2;

      let stat = null;
      try {
        stat = await fs.stat(folderPath);
      } catch (e) {}

      let meta = null;
      if (fs.existsSync(metaPath)) {
        try {
          meta = await fs.readJson(metaPath);
        } catch (e) {}
      }

      const copyMatch = dir.name.match(/_Copy(\d+)$/i);
      const copyNum = meta?.copyNumber || (copyMatch ? copyMatch[1] : '1');
      const baseIsbn = meta?.isbn || getBaseIsbn(dir.name);
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
        baseIsbn,
        copyNum,
        title,
        authors,
        publisher,
        year,
        isComplete ? 'Complete (2/2)' : 'Partial',
        hasShot1 ? '1_front_spine.jpg' : 'Missing',
        hasShot2 ? '2_author_title.jpg' : 'Missing',
        operator,
        station,
        createdAt,
        modifiedAt,
        folderPath
      ];

      rows.push(row.map(escapeCsv).join(','));
    }

    const csvContent = '\uFEFF' + rows.join('\r\n'); // Add UTF-8 BOM for Excel
    const filename = `Journal_Inventory_Report_${new Date().toISOString().slice(0, 10)}.csv`;

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
      const shot1Path = path.join(folderPath, '1_front_spine.jpg');
      const shot2Path = path.join(folderPath, '2_author_title.jpg');
      const metaPath = path.join(folderPath, 'metadata.json');

      const hasShot1 = fs.existsSync(shot1Path);
      const hasShot2 = fs.existsSync(shot2Path);

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

      const copyMatch = dir.name.match(/_Copy(\d+)$/i);
      const copyNumber = metadata?.copyNumber || (copyMatch ? parseInt(copyMatch[1], 10) : 1);
      const baseIsbn = metadata?.isbn || getBaseIsbn(dir.name);

      items.push({
        isbn: dir.name,
        baseIsbn,
        copyNumber,
        folderPath,
        hasShot1,
        hasShot2,
        shot1Url: hasShot1 ? `/proofs/${encodeURIComponent(dir.name)}/1_front_spine.jpg` : null,
        shot2Url: hasShot2 ? `/proofs/${encodeURIComponent(dir.name)}/2_author_title.jpg` : null,
        isComplete: hasShot1 && hasShot2,
        modifiedAt: stat ? stat.mtime : null,
        metadata
      });
    }

    // Sort descending by modified date
    items.sort((a, b) => new Date(b.modifiedAt || 0) - new Date(a.modifiedAt || 0));

    res.json({ items, total: items.length });
  } catch (err) {
    console.error('Error fetching gallery:', err);
    res.status(500).json({ error: 'Failed to read proofs directory' });
  }
});

// Delete proof entry
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

// Serve frontend in production if dist directory exists
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
  console.log(`  JOURNAL PROOF CAPTURE SERVER`);
  console.log(`  HTTP (PC Local):  http://localhost:${PORT}`);
  const ips = getNetworkIps();
  ips.forEach(ip => console.log(`  LAN HTTP:         http://${ip.address}:${PORT} (${ip.interface})`));
  console.log(`  Storage Root:     ${config.storagePath}`);
  console.log(`====================================================`);
});

// Start HTTPS server for Mobile Devices if SSL is ready
if (sslOptions) {
  try {
    const httpsServer = https.createServer(sslOptions, app);
    httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
      const ips = getNetworkIps();
      console.log(`  HTTPS (Mobile):   https://localhost:${HTTPS_PORT}`);
      ips.forEach(ip => console.log(`  Mobile HTTPS:     https://${ip.address}:${HTTPS_PORT} (Scan via Phone)`));
      console.log(`====================================================`);
    });
  } catch (e) {
    console.error('Failed to start HTTPS server:', e);
  }
}


