import { ManifestItem } from '../types';

export interface BarcodeValidationResult {
  valid: boolean;
  cleaned: string;
  original: string;
  isDoubleScan: boolean;
  isMerged: boolean;
  clientMismatch?: boolean;
  itemClient?: string;
  error?: string;
  manifestMatch?: ManifestItem;
}

/**
 * Determines whether a lot number or project denotes client Jaguar
 * Key rule: Lot number with letter 'J' on it (e.g. Lot-156J, 156J) = Jaguar
 */
export function isJaguarLot(lotNumber?: string, project?: string, client?: string): boolean {
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

/**
 * Comprehensive manifest lookup helper: handles exact ISBN, sanitized, numeric,
 * 10/13-digit conversions, ISSN, and sNo.
 */
export function findManifestMatch(rawInput: string, manifestItems: ManifestItem[] = []): ManifestItem | null {
  if (!rawInput || !manifestItems || manifestItems.length === 0) return null;
  const raw = String(rawInput).trim();
  const rawClean = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  const digitsOnly = raw.replace(/[^0-9Xx]/g, '');

  return manifestItems.find(item => {
    if (!item) return false;
    const itemIsbnRaw = String(item.isbn || '').trim();
    const itemClean = itemIsbnRaw.toLowerCase().replace(/[^a-z0-9]/g, '');
    const itemDigits = itemIsbnRaw.replace(/[^0-9Xx]/g, '');

    // 1. Direct or sanitized match
    if (itemIsbnRaw.toLowerCase() === raw.toLowerCase()) return true;
    if (rawClean.length > 0 && itemClean === rawClean) return true;

    // 2. Numeric / digits-only match
    if (digitsOnly.length > 0 && itemDigits.length > 0) {
      if (itemDigits === digitsOnly) return true;
      // 13-digit to 10-digit ISBN conversion (e.g. 978... to 10-digit)
      if (digitsOnly.length === 13 && digitsOnly.startsWith('978') && digitsOnly.slice(3, 12) === itemDigits.slice(0, 9)) return true;
      if (itemDigits.length === 13 && itemDigits.startsWith('978') && itemDigits.slice(3, 12) === digitsOnly.slice(0, 9)) return true;
    }

    // 3. Print ISSN match
    if (item.printIssn) {
      const issnRaw = String(item.printIssn).trim().toLowerCase();
      const issnDigits = issnRaw.replace(/[^0-9Xx]/g, '');
      if (issnRaw === raw.toLowerCase()) return true;
      if (digitsOnly.length > 0 && issnDigits === digitsOnly) return true;
    }

    // 4. sNo match
    if (item.sNo && String(item.sNo).trim() === raw) return true;

    return false;
  }) || null;
}

/**
 * Universal Barcode & ISBN validation, de-duplication, and human-error guard for Frontend.
 * Catches:
 * 1. Exact double-scans: "987456987987456987" -> cleans to "987456987"
 * 2. Merged scans: multiple ISBNs in one scan -> blocked
 * 3. Invalid characters/letters: "9z157326", "x3291047", "s9917362" -> blocked
 * 4. Manifest enforcement: rejects unmanifested barcodes when manifest is loaded
 * 5. Multi-client enforcement: blocks Jaguar ISBNs (Lot with J) in Mustang mode & vice-versa
 */
export function validateAndCleanBarcode(
  input: string,
  manifestItems: ManifestItem[] = [],
  activeClient?: string
): BarcodeValidationResult {
  if (!input || typeof input !== 'string') {
    return { valid: false, cleaned: '', original: '', isDoubleScan: false, isMerged: false, error: 'ISBN/Barcode is required.' };
  }

  let raw = input.trim();
  const original = raw;

  // Strip accidental quotes or brackets
  raw = raw.replace(/^["'\[\(]+|["'\]\)]+$/g, '').trim();

  // Helper to verify client match on a found manifest item
  const checkClientMatch = (match: ManifestItem): { allowed: boolean; error?: string; itemClient?: string } => {
    if (!activeClient) return { allowed: true };
    const lotNumber = match.lotNumber ? String(match.lotNumber).trim() : '';
    const isJaguar = isJaguarLot(lotNumber, (match as any).project, match.client);
    const itemClient = isJaguar ? 'Jaguar' : 'Mustang';

    if (activeClient.toLowerCase() !== itemClient.toLowerCase()) {
      return {
        allowed: false,
        itemClient,
        error: `Client Mismatch: ISBN "${original}" belongs to ${itemClient} (Lot: ${lotNumber || 'N/A'}). You are currently in ${activeClient} profile. Please switch to ${itemClient} to process this book.`
      };
    }
    return { allowed: true, itemClient };
  };

  // 1. Direct manifest match check (with full ISBN-10/13, ISSN, and sNo support)
  if (manifestItems && manifestItems.length > 0) {
    const directMatch = findManifestMatch(raw, manifestItems);
    if (directMatch) {
      const clientCheck = checkClientMatch(directMatch);
      if (!clientCheck.allowed) {
        return {
          valid: false,
          cleaned: raw,
          original,
          isDoubleScan: false,
          isMerged: false,
          clientMismatch: true,
          itemClient: clientCheck.itemClient,
          error: clientCheck.error
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
  }

  // 2. Double-Scan Detection & Auto-Correction (e.g. 987456987987456987)
  if (raw.length >= 8 && raw.length % 2 === 0) {
    const halfLen = raw.length / 2;
    const firstHalf = raw.substring(0, halfLen);
    const secondHalf = raw.substring(halfLen);
    if (firstHalf.toLowerCase() === secondHalf.toLowerCase()) {
      if (manifestItems && manifestItems.length > 0) {
        const match = findManifestMatch(firstHalf, manifestItems);
        if (match) {
          const clientCheck = checkClientMatch(match);
          if (!clientCheck.allowed) {
            return {
              valid: false,
              cleaned: firstHalf,
              original,
              isDoubleScan: true,
              isMerged: false,
              clientMismatch: true,
              itemClient: clientCheck.itemClient,
              error: clientCheck.error
            };
          }
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
      const match = findManifestMatch(half, manifestItems);
      if (match) {
        const clientCheck = checkClientMatch(match);
        if (!clientCheck.allowed) {
          return {
            valid: false,
            cleaned: half,
            original,
            isDoubleScan: true,
            isMerged: false,
            clientMismatch: true,
            itemClient: clientCheck.itemClient,
            error: clientCheck.error
          };
        }
      }
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
    const match = findManifestMatch(raw, manifestItems);
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

    const clientCheck = checkClientMatch(match);
    if (!clientCheck.allowed) {
      return {
        valid: false,
        cleaned: raw,
        original,
        isDoubleScan: false,
        isMerged: false,
        clientMismatch: true,
        itemClient: clientCheck.itemClient,
        error: clientCheck.error
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
