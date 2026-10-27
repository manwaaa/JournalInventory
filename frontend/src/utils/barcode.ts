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
 * Normalizes a box number by removing non-alphanumeric characters and converting to lowercase.
 */
export function normalizeBoxString(boxNumber?: string): string {
  if (!boxNumber) return '';
  return String(boxNumber).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Compares two box numbers with lenient matching:
 * - "RB-0005" == "rb0005" == "0005" == "5" == "RB5"
 */
export function isMatchingBoxNumber(boxA?: string, boxB?: string): boolean {
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

/**
 * Comprehensive manifest lookup helper: handles exact ISBN, sanitized, numeric,
 * 10/13-digit conversions, ISSN, and sNo.
 */
export function findManifestMatch(rawInput: string, manifestItems: ManifestItem[] = [], activeClient?: string): ManifestItem | null {
  if (!rawInput || !manifestItems || manifestItems.length === 0) return null;
  const raw = String(rawInput).trim();
  const rawLower = raw.toLowerCase();
  const rawClean = rawLower.replace(/[^a-z0-9]/g, '');
  const digitsOnly = raw.replace(/[^0-9Xx]/g, '');
  const targetClientLower = activeClient ? activeClient.toLowerCase() : null;

  let fallbackMatch: ManifestItem | null = null;

  for (let i = 0; i < manifestItems.length; i++) {
    const item = manifestItems[i];
    if (!item) continue;
    const itemIsbnRaw = String(item.isbn || '').trim();
    const itemLower = itemIsbnRaw.toLowerCase();
    const itemClean = itemLower.replace(/[^a-z0-9]/g, '');
    const itemDigits = itemIsbnRaw.replace(/[^0-9Xx]/g, '');

    let isMatch = false;

    // 1. Direct or sanitized match
    if (itemLower === rawLower) isMatch = true;
    else if (rawClean.length > 0 && itemClean === rawClean) isMatch = true;
    // 2. Numeric / digits-only match
    else if (digitsOnly.length > 0 && itemDigits.length > 0) {
      if (itemDigits === digitsOnly) isMatch = true;
      else if (digitsOnly.length === 13 && digitsOnly.startsWith('978') && digitsOnly.slice(3, 12) === itemDigits.slice(0, 9)) isMatch = true;
      else if (itemDigits.length === 13 && itemDigits.startsWith('978') && itemDigits.slice(3, 12) === digitsOnly.slice(0, 9)) isMatch = true;
    }

    // 3. Print ISSN match
    if (!isMatch && item.printIssn) {
      const issnRaw = String(item.printIssn).trim().toLowerCase();
      const issnDigits = issnRaw.replace(/[^0-9Xx]/g, '');
      if (issnRaw === rawLower) isMatch = true;
      else if (digitsOnly.length > 0 && issnDigits === digitsOnly) isMatch = true;
    }

    // 4. sNo match
    if (!isMatch && item.sNo && String(item.sNo).trim() === raw) isMatch = true;

    if (isMatch) {
      if (!targetClientLower) return item;
      const itemClient = (item.client || (isJaguarLot(item.lotNumber, (item as any).project, item.client) ? 'Jaguar' : 'Mustang')).toLowerCase();
      if (itemClient === targetClientLower) {
        return item;
      }
      if (!fallbackMatch) fallbackMatch = item;
    }
  }

  return fallbackMatch;
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
    const directMatch = findManifestMatch(raw, manifestItems, activeClient);
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
        const match = findManifestMatch(firstHalf, manifestItems, activeClient);
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
      const match = findManifestMatch(half, manifestItems, activeClient);
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
    const match = findManifestMatch(raw, manifestItems, activeClient);
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
