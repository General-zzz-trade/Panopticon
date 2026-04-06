/**
 * Document Scanner — batch PDF/image metadata extraction from target websites
 * Crawls for documents, extracts EXIF/PDF metadata for intelligence
 */

import { parsePdfMetadata, parseExif, type PdfMetadata, type ExifData } from "./metadata-extract.js";

export interface DocScanResult {
  baseUrl: string;
  documents: DocEntry[];
  images: ImageEntry[];
  authors: string[];
  software: string[];
  gpsLocations: { lat: number; lon: number; source: string }[];
  stats: {
    docsFound: number;
    imagesScanned: number;
    authorsFound: number;
    gpsPoints: number;
    durationMs: number;
  };
  timestamp: string;
}

export interface DocEntry {
  url: string;
  type: string;
  size?: number;
  metadata: PdfMetadata;
}

export interface ImageEntry {
  url: string;
  exif: ExifData;
  hasGps: boolean;
}

// ── Document URL Discovery ──────────────────────────────

const DOC_EXTENSIONS = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods"];
const IMG_EXTENSIONS = [".jpg", ".jpeg", ".png", ".tiff", ".bmp"];

async function discoverDocuments(baseUrl: string, maxPages = 5): Promise<{ docs: string[]; images: string[] }> {
  const docs: string[] = [];
  const images: string[] = [];
  const visited = new Set<string>();
  const queue = [baseUrl];
  let pagesVisited = 0;

  while (queue.length > 0 && pagesVisited < maxPages) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);
    pagesVisited++;

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10000),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; DocScanner/1.0)" },
      });

      if (!response.ok) continue;
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("text/html")) continue;

      const html = await response.text();
      const baseHost = new URL(baseUrl).hostname;

      // Find all href/src attributes
      const linkMatches = html.matchAll(/(?:href|src)=["']([^"']+)["']/gi);

      for (const match of linkMatches) {
        try {
          const resolved = new URL(match[1], url).href;
          const lower = resolved.toLowerCase();

          // Check for documents
          if (DOC_EXTENSIONS.some(ext => lower.endsWith(ext) || lower.includes(ext + "?"))) {
            if (!docs.includes(resolved)) docs.push(resolved);
          }

          // Check for images (only from same domain)
          if (IMG_EXTENSIONS.some(ext => lower.endsWith(ext) || lower.includes(ext + "?")) && resolved.includes(baseHost)) {
            if (!images.includes(resolved)) images.push(resolved);
          }

          // Queue internal HTML pages
          if (new URL(resolved).hostname === baseHost && !visited.has(resolved)) {
            queue.push(resolved);
          }
        } catch {}
      }
    } catch {}
  }

  return { docs: docs.slice(0, 50), images: images.slice(0, 30) };
}

// ── Scan Documents for Metadata ─────────────────────────

async function scanDocument(url: string): Promise<DocEntry | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(30000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; DocScanner/1.0)" },
    });

    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") || "";
    const buffer = Buffer.from(await response.arrayBuffer());

    if (contentType.includes("pdf") || url.toLowerCase().endsWith(".pdf")) {
      const metadata = parsePdfMetadata(buffer);
      return {
        url,
        type: "pdf",
        size: buffer.length,
        metadata,
      };
    }

    return null;
  } catch {
    return null;
  }
}

// ── Scan Images for EXIF ────────────────────────────────

async function scanImage(url: string): Promise<ImageEntry | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { Range: "bytes=0-65535" }, // Only first 64KB for EXIF
    });

    if (!response.ok) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    const exif = parseExif(buffer);

    if (Object.keys(exif.raw).length === 0) return null;

    return {
      url,
      exif,
      hasGps: exif.gpsLatitude !== undefined && exif.gpsLongitude !== undefined,
    };
  } catch {
    return null;
  }
}

// ── Full Document Scan ──────────────────────────────────

export async function fullDocScan(baseUrl: string, options: { maxPages?: number } = {}): Promise<DocScanResult> {
  const start = Date.now();
  const url = baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`;

  // Discover documents and images
  const { docs, images } = await discoverDocuments(url, options.maxPages || 5);

  // Scan documents
  const docResults: DocEntry[] = [];
  for (const docUrl of docs.slice(0, 20)) {
    const result = await scanDocument(docUrl);
    if (result) docResults.push(result);
  }

  // Scan images for EXIF (batch of 5)
  const imgResults: ImageEntry[] = [];
  for (let i = 0; i < images.length && i < 20; i += 5) {
    const batch = images.slice(i, i + 5);
    const results = await Promise.all(batch.map(scanImage));
    imgResults.push(...results.filter((r): r is ImageEntry => r !== null));
  }

  // Extract intelligence
  const authors = new Set<string>();
  const software = new Set<string>();
  const gpsLocations: DocScanResult["gpsLocations"] = [];

  for (const doc of docResults) {
    if (doc.metadata.author) authors.add(doc.metadata.author);
    if (doc.metadata.creator) software.add(doc.metadata.creator);
    if (doc.metadata.producer) software.add(doc.metadata.producer);
  }

  for (const img of imgResults) {
    if (img.exif.make) software.add(`${img.exif.make} ${img.exif.model || ""}`);
    if (img.exif.software) software.add(img.exif.software);
    if (img.exif.artist) authors.add(img.exif.artist);
    if (img.hasGps && img.exif.gpsLatitude && img.exif.gpsLongitude) {
      gpsLocations.push({
        lat: img.exif.gpsLatitude,
        lon: img.exif.gpsLongitude,
        source: img.url,
      });
    }
  }

  return {
    baseUrl: url,
    documents: docResults,
    images: imgResults,
    authors: [...authors],
    software: [...software],
    gpsLocations,
    stats: {
      docsFound: docResults.length,
      imagesScanned: imgResults.length,
      authorsFound: authors.size,
      gpsPoints: gpsLocations.length,
      durationMs: Date.now() - start,
    },
    timestamp: new Date().toISOString(),
  };
}
