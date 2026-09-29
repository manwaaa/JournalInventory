import { ManifestItem } from '../types';

export interface BarcodeValidationResult {
  valid: boolean;
  cleaned: string;
  original: string;
  isDoubleScan: boolean;
  isMerged: boolean;
  error?: string;
  manifestMatch?: ManifestItem;
}

/**
 * Universal Barcode & ISBN validation, de-duplication, and human-error guard for Frontend.
 * Catches:
 * 1. Exact double-scans: "987456987987456987" -> cleans to "987456987"
 * 2. Merged scans: multiple ISBNs in one scan -> blocked
 * 3. Invalid characters/letters: "9z157326", "x3291047", "s9917362" -> blocked
 * 4. Manifest enforcement: rejects unmanifested barcodes when manifest is loaded
 */
export function validateAndCleanBarcode(
  input: string,
  manifestItems: ManifestItem[] = []
): BarcodeValidationResult {
  if (!input || typeof input !== 'string') {
    return { valid: false, cleaned: '', original: '', isDoubleScan: false, isMerged: false, error: 'ISBN/Barcode is required.' };
  }

  let raw = input.trim();
  const original = raw;

  // Strip accidental quotes or brackets
  raw = raw.replace(/^["'\[\(]+|["'\]\)]+$/g, '').trim();

  // 1. Direct manifest match check (case-insensitive & numeric match)
  if (manifestItems && manifestItems.length > 0) {
    const rawClean = raw.replace(/[^0-9Xx]/g, '');
    const directMatch = manifestItems.find(item => {
      if (!item || !item.isbn) return false;
      const mIsbn = String(item.isbn).trim();
      const mClean = mIsbn.replace(/[^0-9Xx]/g, '');
      return mIsbn.toLowerCase() === raw.toLowerCase() ||
             (rawClean.length > 0 && mClean.toLowerCase() === rawClean.toLowerCase());
    });

    if (directMatch) {
      return {
        valid: true,
        cleaned: String(directMatch.isbn).trim(),
        original,
        isDoubleScan: false,
        isMerged: false,
        manifestMatch: directMatch
      };
    }
  }

  // 2. Double-Scan Detection & Auto-Correction (e.g. 987456987987456987)
  if (raw.length >= 8 && raw.length % 2 === 0) {
    const halfLen = raw.length / 2;
    const firstHalf = raw.substring(0, halfLen);
    const secondHalf = raw.substring(halfLen);
    if (firstHalf.toLowerCase() === secondHalf.toLowerCase()) {
      // Check if first half is in manifest
      if (manifestItems && manifestItems.length > 0) {
        const halfClean = firstHalf.replace(/[^0-9Xx]/g, '');
        const match = manifestItems.find(item => {
          if (!item || !item.isbn) return false;
          const mIsbn = String(item.isbn).trim();
          return mIsbn.toLowerCase() === firstHalf.toLowerCase() ||
                 (halfClean.length > 0 && mIsbn.replace(/[^0-9Xx]/g, '').toLowerCase() === halfClean.toLowerCase());
        });
        if (match) {
          return {
            valid: true,
            cleaned: String(match.isbn).trim(),
            original,
            isDoubleScan: true,
            isMerged: false,
            manifestMatch: match
          };
        }
      }
      return {
        valid: true,
        cleaned: firstHalf,
        original,
        isDoubleScan: true,
        isMerged: false
      };
    }
  }

  // Double 13-digit EAN/ISBN starting with 978 or 979
  if (raw.length >= 26) {
    const m = raw.match(/^(97[89]\d{10})(97[89]\d{10})$/);
    if (m && m[1] === m[2]) {
      const half = m[1];
      const match = manifestItems.find(item => String(item.isbn).trim().replace(/[^0-9Xx]/g, '') === half);
      return {
        valid: true,
        cleaned: match ? String(match.isbn).trim() : half,
        original,
        isDoubleScan: true,
        isMerged: false,
        manifestMatch: match || undefined
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
      error: `Merged barcode error: "${original}" contains multiple scans combined (${raw.length} chars). Please rescan single item.`
    };
  }

  // 4. Invalid letter / corrupted character check (e.g. 9z157326, x3291047, s9917362)
  // Standard barcodes only allow digits, hyphens, and a single trailing 'X' (for ISBN-10 or ISSN)
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
    const rawClean = raw.replace(/[^0-9Xx]/g, '');
    const match = manifestItems.find(item => {
      if (!item || !item.isbn) return false;
      const mIsbn = String(item.isbn).trim();
      const mClean = mIsbn.replace(/[^0-9Xx]/g, '');
      return mIsbn.toLowerCase() === raw.toLowerCase() ||
             (rawClean.length > 0 && mClean.toLowerCase() === rawClean.toLowerCase());
    });

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
