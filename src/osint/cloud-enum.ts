/**
 * Cloud Storage Enumeration — discover public S3 buckets, Azure blobs, GCP storage
 * Generates name patterns and checks for public read access
 */

import { execFileNoThrow } from "../utils/execFileNoThrow.js";

export interface CloudEnumResult {
  target: string;
  buckets: CloudBucket[];
  stats: { checked: number; found: number; publicRead: number };
  timestamp: string;
}

export interface CloudBucket {
  url: string;
  provider: "aws" | "azure" | "gcp";
  name: string;
  exists: boolean;
  publicRead: boolean;
  listable: boolean;
  sampleFiles: string[];
}

// ── Generate Bucket Name Permutations ───────────────────

function generateBucketNames(target: string): string[] {
  const base = target.replace(/\.[^.]+$/, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  const domain = target.replace(/[^a-z0-9.]/gi, "").toLowerCase();
  const names = new Set<string>();

  const suffixes = [
    "", "-backup", "-backups", "-bak", "-data", "-files", "-uploads", "-media",
    "-assets", "-static", "-public", "-private", "-dev", "-staging", "-prod",
    "-production", "-test", "-logs", "-archive", "-docs", "-images", "-img",
    "-cdn", "-content", "-storage", "-db", "-database", "-dump", "-export",
    "-internal", "-config", "-secrets", "-keys", "-creds",
  ];

  const prefixes = ["", "backup-", "dev-", "staging-", "prod-", "s3-", "data-"];

  for (const prefix of prefixes) {
    for (const suffix of suffixes) {
      names.add(`${prefix}${base}${suffix}`);
      names.add(`${prefix}${domain}${suffix}`);
    }
  }

  return Array.from(names).filter(n => n.length >= 3 && n.length <= 63);
}

// ── Check S3 Bucket ─────────────────────────────────────

async function checkS3Bucket(name: string): Promise<CloudBucket> {
  const result: CloudBucket = {
    url: `https://${name}.s3.amazonaws.com`,
    provider: "aws",
    name,
    exists: false,
    publicRead: false,
    listable: false,
    sampleFiles: [],
  };

  try {
    const response = await fetch(result.url, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });

    if (response.status === 404) return result;

    result.exists = true;

    if (response.status === 200) {
      const body = await response.text();
      if (body.includes("<ListBucketResult")) {
        result.publicRead = true;
        result.listable = true;
        // Extract file keys
        const keys = body.matchAll(/<Key>([^<]+)<\/Key>/g);
        for (const key of keys) {
          result.sampleFiles.push(key[1]);
          if (result.sampleFiles.length >= 10) break;
        }
      }
    } else if (response.status === 403) {
      result.exists = true; // Bucket exists but access denied
    }
  } catch {}

  return result;
}

// ── Check Azure Blob ────────────────────────────────────

async function checkAzureBlob(name: string): Promise<CloudBucket> {
  const result: CloudBucket = {
    url: `https://${name}.blob.core.windows.net`,
    provider: "azure",
    name,
    exists: false,
    publicRead: false,
    listable: false,
    sampleFiles: [],
  };

  try {
    // Check common container names
    for (const container of ["public", "data", "files", "uploads", "assets", "$web"]) {
      const containerUrl = `${result.url}/${container}?restype=container&comp=list`;
      const response = await fetch(containerUrl, { signal: AbortSignal.timeout(5000) });

      if (response.status === 200) {
        result.exists = true;
        result.publicRead = true;
        result.listable = true;
        const body = await response.text();
        const blobs = body.matchAll(/<Name>([^<]+)<\/Name>/g);
        for (const blob of blobs) {
          result.sampleFiles.push(`${container}/${blob[1]}`);
          if (result.sampleFiles.length >= 10) break;
        }
        break;
      } else if (response.status === 403) {
        result.exists = true;
      }
    }
  } catch {}

  return result;
}

// ── Check GCP Storage ───────────────────────────────────

async function checkGcpBucket(name: string): Promise<CloudBucket> {
  const result: CloudBucket = {
    url: `https://storage.googleapis.com/${name}`,
    provider: "gcp",
    name,
    exists: false,
    publicRead: false,
    listable: false,
    sampleFiles: [],
  };

  try {
    const response = await fetch(result.url, { signal: AbortSignal.timeout(5000) });

    if (response.status === 404) return result;

    result.exists = true;

    if (response.status === 200) {
      const body = await response.text();
      if (body.includes("<ListBucketResult")) {
        result.publicRead = true;
        result.listable = true;
        const keys = body.matchAll(/<Key>([^<]+)<\/Key>/g);
        for (const key of keys) {
          result.sampleFiles.push(key[1]);
          if (result.sampleFiles.length >= 10) break;
        }
      }
    }
  } catch {}

  return result;
}

// ── Full Cloud Enumeration ──────────────────────────────

export async function enumerateCloud(
  target: string,
  options: { providers?: ("aws" | "azure" | "gcp")[]; maxNames?: number; concurrency?: number } = {}
): Promise<CloudEnumResult> {
  const providers = options.providers || ["aws", "azure", "gcp"];
  const maxNames = options.maxNames || 30;
  const concurrency = options.concurrency || 5;

  const names = generateBucketNames(target).slice(0, maxNames);
  const results: CloudBucket[] = [];
  let checked = 0;

  for (let i = 0; i < names.length; i += concurrency) {
    const batch = names.slice(i, i + concurrency);
    const promises: Promise<CloudBucket>[] = [];

    for (const name of batch) {
      if (providers.includes("aws")) promises.push(checkS3Bucket(name));
      if (providers.includes("gcp")) promises.push(checkGcpBucket(name));
      // Azure uses account name, less predictable — check fewer
      if (providers.includes("azure") && i < 10) promises.push(checkAzureBlob(name));
    }

    const batchResults = await Promise.all(promises);
    results.push(...batchResults.filter(r => r.exists));
    checked += batch.length * providers.length;
  }

  return {
    target,
    buckets: results,
    stats: {
      checked,
      found: results.length,
      publicRead: results.filter(r => r.publicRead).length,
    },
    timestamp: new Date().toISOString(),
  };
}
