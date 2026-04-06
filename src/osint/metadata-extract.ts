/**
 * Metadata Extraction — EXIF from images, document metadata, HTTP fingerprinting
 * No external APIs — pure Node.js buffer parsing
 */

export interface ExifData {
  make?: string;
  model?: string;
  software?: string;
  dateTime?: string;
  dateTimeOriginal?: string;
  gpsLatitude?: number;
  gpsLongitude?: number;
  gpsAltitude?: number;
  imageWidth?: number;
  imageHeight?: number;
  orientation?: number;
  colorSpace?: string;
  exposureTime?: string;
  fNumber?: string;
  iso?: number;
  focalLength?: string;
  flash?: string;
  artist?: string;
  copyright?: string;
  description?: string;
  userComment?: string;
  raw: Record<string, string | number>;
}

export interface HttpFingerprint {
  url: string;
  serverSoftware?: string;
  poweredBy?: string;
  aspVersion?: string;
  phpVersion?: string;
  etag?: string;
  lastModified?: string;
  contentType?: string;
  xGenerator?: string;
  xDrupalCache?: boolean;
  xWordpress?: boolean;
  viaProxy?: string;
  cacheControl?: string;
  cors?: boolean;
  hsts?: boolean;
  csp?: string;
  xFrameOptions?: string;
  allHeaders: Record<string, string>;
}

// ── EXIF Tag IDs ────────────────────────────────────────

const EXIF_TAGS: Record<number, string> = {
  0x010f: "make", 0x0110: "model", 0x0131: "software",
  0x0132: "dateTime", 0x9003: "dateTimeOriginal", 0x9004: "dateTimeDigitized",
  0xa002: "imageWidth", 0xa003: "imageHeight", 0x0112: "orientation",
  0xa001: "colorSpace", 0x829a: "exposureTime", 0x829d: "fNumber",
  0x8827: "iso", 0x920a: "focalLength", 0x9209: "flash",
  0x013b: "artist", 0x8298: "copyright", 0x010e: "description",
  0x9286: "userComment",
};

const GPS_TAGS: Record<number, string> = {
  0x0001: "latRef", 0x0002: "lat", 0x0003: "lonRef", 0x0004: "lon",
  0x0005: "altRef", 0x0006: "alt",
};

// ── EXIF Parser (pure JS, no dependencies) ──────────────

export function parseExif(buffer: Buffer): ExifData {
  const result: ExifData = { raw: {} };

  // Find EXIF marker (APP1 = 0xFFE1)
  let offset = 0;

  // Check JPEG SOI marker
  if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
    offset = 2;
  } else {
    return result; // Not a JPEG
  }

  while (offset < buffer.length - 4) {
    if (buffer[offset] !== 0xFF) break;
    const marker = buffer[offset + 1];

    if (marker === 0xE1) {
      // APP1 — EXIF data
      const length = buffer.readUInt16BE(offset + 2);
      const exifData = buffer.subarray(offset + 4, offset + 4 + length - 2);

      // Check "Exif\0\0" header
      if (exifData.toString("ascii", 0, 4) === "Exif") {
        parseExifBlock(exifData.subarray(6), result);
      }
      break;
    }

    // Skip other markers
    const segLength = buffer.readUInt16BE(offset + 2);
    offset += 2 + segLength;
  }

  return result;
}

function parseExifBlock(data: Buffer, result: ExifData): void {
  // Determine byte order
  const byteOrder = data.toString("ascii", 0, 2);
  const littleEndian = byteOrder === "II";

  const readU16 = (off: number) => littleEndian ? data.readUInt16LE(off) : data.readUInt16BE(off);
  const readU32 = (off: number) => littleEndian ? data.readUInt32LE(off) : data.readUInt32BE(off);

  // Verify TIFF magic
  if (readU16(2) !== 0x002A) return;

  const ifd0Offset = readU32(4);
  parseIFD(data, ifd0Offset, readU16, readU32, result, false);

  // Check for GPS IFD
  // Look for GPS IFD pointer (tag 0x8825)
  const entryCount = readU16(ifd0Offset);
  for (let i = 0; i < entryCount; i++) {
    const entryOff = ifd0Offset + 2 + i * 12;
    if (entryOff + 12 > data.length) break;
    const tag = readU16(entryOff);
    if (tag === 0x8825) {
      const gpsOffset = readU32(entryOff + 8);
      parseGpsIFD(data, gpsOffset, readU16, readU32, result);
    }
    // Check for EXIF IFD pointer (tag 0x8769)
    if (tag === 0x8769) {
      const exifOffset = readU32(entryOff + 8);
      parseIFD(data, exifOffset, readU16, readU32, result, false);
    }
  }
}

function parseIFD(
  data: Buffer,
  offset: number,
  readU16: (o: number) => number,
  readU32: (o: number) => number,
  result: ExifData,
  isGps: boolean
): void {
  if (offset + 2 > data.length) return;

  const entryCount = readU16(offset);

  for (let i = 0; i < entryCount; i++) {
    const entryOff = offset + 2 + i * 12;
    if (entryOff + 12 > data.length) break;

    const tag = readU16(entryOff);
    const type = readU16(entryOff + 2);
    const count = readU32(entryOff + 4);

    const tagName = isGps ? GPS_TAGS[tag] : EXIF_TAGS[tag];
    if (!tagName) continue;

    try {
      const value = readTagValue(data, entryOff + 8, type, count, readU16, readU32);
      if (value !== undefined) {
        result.raw[tagName] = value as any;

        // Map to typed fields
        if (typeof value === "string") {
          if (tagName in result) (result as any)[tagName] = value;
        } else if (typeof value === "number") {
          if (tagName in result) (result as any)[tagName] = value;
        }
      }
    } catch {}
  }
}

function parseGpsIFD(
  data: Buffer,
  offset: number,
  readU16: (o: number) => number,
  readU32: (o: number) => number,
  result: ExifData
): void {
  if (offset + 2 > data.length) return;
  const entryCount = readU16(offset);

  let latRef = "N", lonRef = "E";
  let latDeg = 0, latMin = 0, latSec = 0;
  let lonDeg = 0, lonMin = 0, lonSec = 0;
  let hasLat = false, hasLon = false;

  for (let i = 0; i < entryCount; i++) {
    const entryOff = offset + 2 + i * 12;
    if (entryOff + 12 > data.length) break;

    const tag = readU16(entryOff);
    const type = readU16(entryOff + 2);
    const count = readU32(entryOff + 4);

    try {
      if (tag === 0x0001) {
        // Lat ref
        latRef = String.fromCharCode(data[entryOff + 8]);
      } else if (tag === 0x0003) {
        // Lon ref
        lonRef = String.fromCharCode(data[entryOff + 8]);
      } else if (tag === 0x0002 && type === 5 && count === 3) {
        // Latitude (3 rationals)
        const valOffset = readU32(entryOff + 8);
        latDeg = readU32(valOffset) / readU32(valOffset + 4);
        latMin = readU32(valOffset + 8) / readU32(valOffset + 12);
        latSec = readU32(valOffset + 16) / readU32(valOffset + 20);
        hasLat = true;
      } else if (tag === 0x0004 && type === 5 && count === 3) {
        // Longitude (3 rationals)
        const valOffset = readU32(entryOff + 8);
        lonDeg = readU32(valOffset) / readU32(valOffset + 4);
        lonMin = readU32(valOffset + 8) / readU32(valOffset + 12);
        lonSec = readU32(valOffset + 16) / readU32(valOffset + 20);
        hasLon = true;
      } else if (tag === 0x0006 && type === 5) {
        // Altitude
        const valOffset = readU32(entryOff + 8);
        result.gpsAltitude = readU32(valOffset) / readU32(valOffset + 4);
      }
    } catch {}
  }

  if (hasLat) {
    result.gpsLatitude = (latDeg + latMin / 60 + latSec / 3600) * (latRef === "S" ? -1 : 1);
  }
  if (hasLon) {
    result.gpsLongitude = (lonDeg + lonMin / 60 + lonSec / 3600) * (lonRef === "W" ? -1 : 1);
  }
}

function readTagValue(
  data: Buffer,
  offset: number,
  type: number,
  count: number,
  readU16: (o: number) => number,
  readU32: (o: number) => number,
): string | number | undefined {
  const typeSize: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
  const size = (typeSize[type] || 1) * count;

  let valOffset = offset;
  if (size > 4) {
    valOffset = readU32(offset);
    if (valOffset + size > data.length) return undefined;
  }

  // ASCII string
  if (type === 2) {
    return data.toString("ascii", valOffset, valOffset + count - 1).replace(/\0/g, "").trim();
  }
  // Unsigned short
  if (type === 3 && count === 1) return readU16(valOffset);
  // Unsigned long
  if (type === 4 && count === 1) return readU32(valOffset);
  // Rational (unsigned)
  if (type === 5 && count === 1) {
    const num = readU32(valOffset);
    const den = readU32(valOffset + 4);
    return den ? `${num}/${den}` : `${num}`;
  }

  return undefined;
}

// ── Extract EXIF from URL ───────────────────────────────

export async function extractExifFromUrl(imageUrl: string): Promise<ExifData> {
  try {
    const response = await fetch(imageUrl, {
      signal: AbortSignal.timeout(30000),
      headers: { Range: "bytes=0-65535" }, // Only need first 64KB for EXIF
    });

    const arrayBuf = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    return parseExif(buffer);
  } catch {
    return { raw: {} };
  }
}

// ── HTTP Fingerprinting ─────────────────────────────────

export async function httpFingerprint(url: string): Promise<HttpFingerprint> {
  const result: HttpFingerprint = { url, allHeaders: {} };

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Fingerprint/1.0)" },
    });

    for (const [key, value] of response.headers.entries()) {
      result.allHeaders[key] = value;
      const k = key.toLowerCase();

      if (k === "server") result.serverSoftware = value;
      if (k === "x-powered-by") result.poweredBy = value;
      if (k === "x-aspnet-version") result.aspVersion = value;
      if (k === "x-generator") result.xGenerator = value;
      if (k === "etag") result.etag = value;
      if (k === "last-modified") result.lastModified = value;
      if (k === "content-type") result.contentType = value;
      if (k === "via") result.viaProxy = value;
      if (k === "cache-control") result.cacheControl = value;
      if (k === "access-control-allow-origin") result.cors = true;
      if (k === "strict-transport-security") result.hsts = true;
      if (k === "content-security-policy") result.csp = value;
      if (k === "x-frame-options") result.xFrameOptions = value;
      if (k === "x-drupal-cache") result.xDrupalCache = true;
    }

    // Check for PHP version in headers or response
    const phpMatch = (result.poweredBy || "").match(/PHP\/([\d.]+)/i);
    if (phpMatch) result.phpVersion = phpMatch[1];

    // Check for WordPress
    const body = await response.text();
    if (body.includes("wp-content") || body.includes("WordPress")) {
      result.xWordpress = true;
    }
  } catch {}

  return result;
}

// ── PDF Metadata Extraction ─────────────────────────────

export interface PdfMetadata {
  title?: string;
  author?: string;
  subject?: string;
  creator?: string;
  producer?: string;
  creationDate?: string;
  modDate?: string;
  keywords?: string;
  pageCount?: number;
}

export function parsePdfMetadata(buffer: Buffer): PdfMetadata {
  const result: PdfMetadata = {};
  const text = buffer.toString("latin1");

  // Find /Info dictionary in PDF
  const infoPatterns: Record<string, keyof PdfMetadata> = {
    "/Title": "title", "/Author": "author", "/Subject": "subject",
    "/Creator": "creator", "/Producer": "producer",
    "/CreationDate": "creationDate", "/ModDate": "modDate",
    "/Keywords": "keywords",
  };

  for (const [pdfKey, metaKey] of Object.entries(infoPatterns)) {
    const regex = new RegExp(`${pdfKey.replace("/", "\\/")}\\s*\\(([^)]+)\\)`, "i");
    const match = text.match(regex);
    if (match) {
      (result as any)[metaKey] = match[1].trim();
    }
  }

  // Count pages
  const pageCountMatch = text.match(/\/Count\s+(\d+)/);
  if (pageCountMatch) {
    result.pageCount = parseInt(pageCountMatch[1], 10);
  }

  return result;
}

export async function extractPdfMetadataFromUrl(pdfUrl: string): Promise<PdfMetadata> {
  try {
    const response = await fetch(pdfUrl, {
      signal: AbortSignal.timeout(30000),
    });
    const arrayBuf = await response.arrayBuffer();
    return parsePdfMetadata(Buffer.from(arrayBuf));
  } catch {
    return {};
  }
}
