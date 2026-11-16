const { S3Client, ListObjectsV2Command } = require('../node_modules/@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '../config.json'), 'utf8'));

function verifyJournalShots(files = [], expectedParts = 1) {
  const filenames = files.map(f => (typeof f === 'string' ? f : f.filename || f.key || '').toLowerCase());
  
  const frontCover = filenames.some(f => f.includes('front cover') || f.includes('front_cover') || f.includes('shot_3') || f.includes('3_front'));
  const backCover = filenames.some(f => f.includes('back cover') || f.includes('back_cover') || f.includes('shot_7') || f.includes('7_back'));
  const titlePage = filenames.some(f => f.includes('title page') || f.includes('title_page') || f.includes('shot_5') || f.includes('5_title'));
  const spine = filenames.some(f => f.includes('spine') || f.includes('shot_4') || f.includes('4_spine'));
  const editionNotice = filenames.some(f => f.includes('edition notice') || f.includes('edition_notice') || f.includes('front_matter') || f.includes('shot_6') || f.includes('6_edition'));
  const boxA = filenames.some(f => f.includes('box a') || f.includes('box_a') || f.includes('shot_1') || f.includes('1_box') || f.endsWith('box.jpg') || f.includes('_box.jpg'));
  const boxB = filenames.some(f => f.includes('box b') || f.includes('box_b') || f.includes('unbox') || f.includes('shot_2') || f.includes('2_box'));

  const distinctParts = new Set();
  for (const f of filenames) {
    const m = f.match(/_part(\d+)/i);
    if (m) distinctParts.add(parseInt(m[1], 10));
  }
  const actualParts = distinctParts.size || (files.length >= 14 ? Math.floor(files.length / 7) : 1);
  const targetParts = Math.max(expectedParts || 1, actualParts);

  const imageFiles = filenames.filter(f => !f.endsWith('.json') && !f.startsWith('.') && !f.includes('.bak'));
  const expectedShotsCount = targetParts * 7;
  const hasRequiredCount = imageFiles.length >= expectedShotsCount;
  const allShotsPresent = Boolean(frontCover && backCover && titlePage && spine && editionNotice && boxA && boxB);

  const allComplete = Boolean(allShotsPresent && hasRequiredCount);
  const allPartsComplete = Boolean(actualParts >= targetParts && allComplete);

  return {
    frontCover: Boolean(frontCover),
    backCover: Boolean(backCover),
    titlePage: Boolean(titlePage),
    spine: Boolean(spine),
    editionNotice: Boolean(editionNotice),
    boxA: Boolean(boxA),
    boxB: Boolean(boxB),
    allComplete,
    allPartsComplete,
    actualParts,
    expectedParts: targetParts,
    filesCount: imageFiles.length,
    expectedCount: expectedShotsCount
  };
}

async function buildCache({ bucket, prefix, clientName }) {
  console.log(`[Cache Builder] Starting build for ${bucket} -> ${prefix} (${clientName})...`);
  const profile = cfg.clientProfiles?.[clientName] || {};
  const s3 = new S3Client({
    region: profile.s3Region || (clientName === 'Mustang' ? 'ap-southeast-1' : 'us-east-1'),
    credentials: {
      accessKeyId: profile.s3AccessKeyId,
      secretAccessKey: profile.s3SecretAccessKey
    }
  });

  const isbns = new Map();
  const dateCounts = new Map();
  let totalObjects = 0;
  let continuationToken = null;
  let pageCount = 0;

  do {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken
    }));

    if (res.Contents) {
      for (const obj of res.Contents) {
        totalObjects++;
        const parts = obj.Key.split('/');
        let date = 'All';
        let isbn = '';
        let filename = '';

        if (parts.length >= 5 && parts[0].toLowerCase().startsWith('phase')) {
          date = parts[2];
          isbn = parts[3];
          filename = parts.slice(4).join('/');
        } else if (parts.length >= 4 && parts[0] === 'innoscanmussgp1' && parts[1] === 'JournalVerificationImages') {
          isbn = parts[2];
          filename = parts.slice(3).join('/');
          date = obj.LastModified ? (typeof obj.LastModified.toISOString === 'function' ? obj.LastModified.toISOString().slice(0, 10) : String(obj.LastModified).slice(0, 10)) : 'All';
        } else if (parts.length >= 3 && parts[0] === 'innoscanmussgp1') {
          isbn = parts[1];
          filename = parts.slice(2).join('/');
          date = obj.LastModified ? (typeof obj.LastModified.toISOString === 'function' ? obj.LastModified.toISOString().slice(0, 10) : String(obj.LastModified).slice(0, 10)) : 'All';
        }

        if (!isbn || !filename || filename.startsWith('.') || filename.includes('.bak')) {
          continue;
        }

        dateCounts.set(date, (dateCounts.get(date) || 0) + 1);

        if (!isbns.has(isbn)) {
          isbns.set(isbn, {
            isbn,
            date,
            s3Path: `${bucket}/${parts.slice(0, parts.length - 1).join('/')}`,
            files: []
          });
        }
        isbns.get(isbn).files.push({
          filename,
          size: obj.Size || 0,
          key: obj.Key
        });
      }
    }

    continuationToken = res.IsTruncated ? res.NextContinuationToken : null;
    pageCount++;
    if (pageCount % 20 === 0) {
      console.log(`[Cache Builder] Fetched ${pageCount} pages (${totalObjects} objects, ${isbns.size} journals)...`);
    }
  } while (continuationToken);

  console.log(`[Cache Builder] Finished S3 listing: ${totalObjects} objects across ${isbns.size} journals.`);

  let completeJournals = 0;
  let incompleteJournals = 0;
  let multiPartJournals = 0;

  for (const [isbn, data] of isbns.entries()) {
    const hasPartFiles = Boolean(data.files.some(f => /_part\d+/i.test(f.filename || f.key || '')));
    let partsCount = 1;
    if (hasPartFiles) {
      const distinctParts = new Set();
      for (const f of data.files) {
        const m = (f.filename || f.key || '').match(/_part(\d+)/i);
        if (m) distinctParts.add(parseInt(m[1], 10));
      }
      partsCount = distinctParts.size || (data.files.length >= 14 ? Math.floor(data.files.length / 7) : 1);
    } else if (data.files.length >= 14) {
      partsCount = Math.floor(data.files.length / 7);
    }
    data.partsCount = partsCount;

    const shots = verifyJournalShots(data.files, partsCount);
    data.shots = shots;

    if (partsCount > 1) multiPartJournals++;
    if (shots.allComplete) {
      completeJournals++;
    } else {
      incompleteJournals++;
    }
  }

  const sortedDates = Array.from(dateCounts.keys()).sort().reverse().map(d => ({
    date: d,
    journalCount: Array.from(isbns.values()).filter(i => i.date === d).length,
    objectCount: dateCounts.get(d) || 0
  }));

  const cacheObj = {
    timestamp: Date.now(),
    bucket,
    prefix,
    dates: sortedDates,
    isbns: Array.from(isbns.entries()),
    stats: {
      totalJournals: isbns.size,
      completeJournals,
      incompleteJournals,
      multiPartJournals,
      totalObjects,
      lastUpdated: new Date().toISOString()
    }
  };

  const safeKey = `${bucket}_${prefix}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  const cachePath = path.join(__dirname, '../data', `s3_cache_${safeKey}.json`);
  fs.writeFileSync(cachePath, JSON.stringify(cacheObj), 'utf8');
  console.log(`[Cache Builder] Saved cache to ${cachePath} (${(fs.statSync(cachePath).size / 1024 / 1024).toFixed(2)} MB). Complete: ${completeJournals}, Incomplete: ${incompleteJournals}.`);
}

async function run() {
  // 1. Mustang
  await buildCache({
    bucket: 'innoscanmussgp1-s3',
    prefix: 'innoscanmussgp1/JournalVerificationImages/',
    clientName: 'Mustang'
  });

  // 2. Jaguar Lot-159J
  await buildCache({
    bucket: 'innoscanjagjx1-s3',
    prefix: 'Phase-09/Lot-159J/',
    clientName: 'Jaguar'
  });

  // 3. Jaguar Lot-156J
  await buildCache({
    bucket: 'innoscanjagjx1-s3',
    prefix: 'Phase-09/Lot-156J/',
    clientName: 'Jaguar'
  });

  console.log('ALL CACHES BUILT SUCCESSFULLY!');
}

run().catch(console.error);
