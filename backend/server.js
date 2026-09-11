import express from 'express';
import cors from 'cors';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import os from 'os';
import archiver from 'archiver';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

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
  cameraResolution: '1080p'
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

// Helper to sanitize ISBN for filesystem safely
function sanitizeIsbn(isbn) {
  if (!isbn || typeof isbn !== 'string') return '';
  return isbn.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
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

// -------------------------------------------------------------
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

  res.json({
    status: 'online',
    hostname: os.hostname(),
    platform: process.platform,
    networkIps: getNetworkIps(),
    port: PORT,
    storagePath: config.storagePath,
    totalCapturedJournals: proofCount
  });
});

// Config GET & POST
app.get('/api/system/config', (req, res) => {
  res.json(config);
});

app.post('/api/system/config', (req, res) => {
  const { storagePath, autoOpenExplorer, soundEnabled, imageQuality, cameraResolution } = req.body;
  
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
    exec(`explorer.exe "${normalizedPath}"`, (err) => {
      if (err) {
        console.error('Error opening Windows Explorer:', err);
        return res.status(500).json({ error: 'Failed to open Windows Explorer' });
      }
      res.json({ success: true, path: normalizedPath });
    });
  } else if (process.platform === 'darwin') {
    exec(`open "${normalizedPath}"`, () => res.json({ success: true, path: normalizedPath }));
  } else {
    exec(`xdg-open "${normalizedPath}"`, () => res.json({ success: true, path: normalizedPath }));
  }
});

// -------------------------------------------------------------
// Capture & Storage Endpoints
// -------------------------------------------------------------

// Initialize ISBN folder
app.post('/api/capture/init-isbn', (req, res) => {
  const { isbn } = req.body;
  if (!isbn || !isbn.trim()) {
    return res.status(400).json({ error: 'ISBN is required' });
  }

  const cleanIsbn = sanitizeIsbn(isbn);
  const folderPath = path.join(config.storagePath, cleanIsbn);

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

  res.json({
    success: true,
    isbn: cleanIsbn,
    folderPath,
    exists: alreadyExists,
    existingShots,
    metadata
  });
});

// Save captured shot (1 or 2)
app.post('/api/capture/save-shot', async (req, res) => {
  try {
    const { isbn, shotNumber, imageBase64, operatorName } = req.body;

    if (!isbn || !imageBase64 || (shotNumber !== 1 && shotNumber !== 2)) {
      return res.status(400).json({ error: 'Valid ISBN, shotNumber (1 or 2), and base64 image required' });
    }

    const cleanIsbn = sanitizeIsbn(isbn);
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
      isbn: cleanIsbn,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      operator: operatorName || 'Inventory Operator',
      shots: {}
    };

    if (fs.existsSync(metaPath)) {
      try {
        metadata = { ...metadata, ...fs.readJsonSync(metaPath) };
        metadata.updatedAt = new Date().toISOString();
      } catch (e) {}
    }

    metadata.shots[shotNumber] = {
      filename,
      sizeBytes: buffer.length,
      savedAt: new Date().toISOString(),
      type: shotNumber === 1 ? 'Front Cover & Spine Angle' : 'Author & Title Page Angle'
    };

    await fs.writeJson(metaPath, metadata, { spaces: 2 });

    const totalShots = Object.keys(metadata.shots).length;

    // Check if autoOpenExplorer is set and both shots are complete
    if (config.autoOpenExplorer && totalShots >= 2) {
      if (process.platform === 'win32') {
        exec(`explorer.exe "${path.resolve(folderPath)}"`, () => {});
      }
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
// Gallery & History Endpoints
// -------------------------------------------------------------

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

      items.push({
        isbn: dir.name,
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`  JOURNAL PROOF & ANTI-PLAGIARISM CAPTURE SERVER`);
  console.log(`  Running on: http://localhost:${PORT}`);
  console.log(`  Storage Root: ${config.storagePath}`);
  const ips = getNetworkIps();
  if (ips.length > 0) {
    console.log(`  LAN Access:`);
    ips.forEach(ip => console.log(`    - http://${ip.address}:${PORT} (${ip.interface})`));
  }
  console.log(`====================================================`);
});
