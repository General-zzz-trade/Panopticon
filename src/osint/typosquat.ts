/**
 * Typosquatting / Domain Similarity Detection — generate and check domain variants
 * Detects homograph attacks, bitsquatting, and common typos
 */

import { execFileNoThrow } from "../utils/execFileNoThrow.js";

export interface TyposquatResult {
  originalDomain: string;
  variants: DomainVariant[];
  registered: DomainVariant[];
  stats: { generated: number; checked: number; registered: number; suspicious: number };
  timestamp: string;
}

export interface DomainVariant {
  domain: string;
  type: string;
  registered: boolean;
  ip?: string;
  suspicious: boolean;
}

// ── Generate Domain Variants ────────────────────────────

export function generateVariants(domain: string): { domain: string; type: string }[] {
  const parts = domain.split(".");
  const name = parts[0];
  const tld = parts.slice(1).join(".");
  const variants: { domain: string; type: string }[] = [];
  const seen = new Set<string>();

  const add = (d: string, type: string) => {
    const lower = d.toLowerCase();
    if (lower !== domain.toLowerCase() && !seen.has(lower)) {
      seen.add(lower);
      variants.push({ domain: lower, type });
    }
  };

  // 1. Character omission (missing letters)
  for (let i = 0; i < name.length; i++) {
    add(name.slice(0, i) + name.slice(i + 1) + "." + tld, "omission");
  }

  // 2. Adjacent character swap
  for (let i = 0; i < name.length - 1; i++) {
    const swapped = name.slice(0, i) + name[i + 1] + name[i] + name.slice(i + 2);
    add(swapped + "." + tld, "swap");
  }

  // 3. Adjacent key substitution (keyboard proximity)
  const keyboard: Record<string, string[]> = {
    q: ["w", "a"], w: ["q", "e", "s"], e: ["w", "r", "d"], r: ["e", "t", "f"], t: ["r", "y", "g"],
    y: ["t", "u", "h"], u: ["y", "i", "j"], i: ["u", "o", "k"], o: ["i", "p", "l"], p: ["o"],
    a: ["q", "s", "z"], s: ["a", "d", "w", "x"], d: ["s", "f", "e", "c"], f: ["d", "g", "r", "v"],
    g: ["f", "h", "t", "b"], h: ["g", "j", "y", "n"], j: ["h", "k", "u", "m"], k: ["j", "l", "i"],
    l: ["k", "o"], z: ["a", "x"], x: ["z", "s", "c"], c: ["x", "d", "v"], v: ["c", "f", "b"],
    b: ["v", "g", "n"], n: ["b", "h", "m"], m: ["n", "j"],
  };

  for (let i = 0; i < name.length; i++) {
    const c = name[i].toLowerCase();
    for (const sub of (keyboard[c] || [])) {
      add(name.slice(0, i) + sub + name.slice(i + 1) + "." + tld, "keyboard");
    }
  }

  // 4. Character duplication
  for (let i = 0; i < name.length; i++) {
    add(name.slice(0, i) + name[i] + name[i] + name.slice(i + 1) + "." + tld, "duplication");
  }

  // 5. Character insertion
  const alpha = "abcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i <= name.length; i++) {
    for (const c of alpha) {
      add(name.slice(0, i) + c + name.slice(i) + "." + tld, "insertion");
    }
  }

  // 6. Homograph (look-alike characters)
  const homoglyphs: Record<string, string[]> = {
    a: ["а", "ɑ", "α"], b: ["Ь", "ƅ"], c: ["с", "ϲ"], d: ["ԁ", "ɗ"],
    e: ["е", "ẹ", "ё"], g: ["ɡ"], h: ["һ"], i: ["і", "ı", "1", "l"],
    k: ["κ"], l: ["1", "i", "ⅼ"], m: ["rn"], n: ["ո"], o: ["о", "0", "ο"],
    p: ["р", "ρ"], q: ["ԛ"], s: ["ѕ", "5"], t: ["τ"], u: ["υ", "ц"],
    w: ["ω", "vv"], x: ["х", "×"], y: ["у", "ý"], z: ["ᴢ"],
  };

  for (let i = 0; i < name.length; i++) {
    const c = name[i].toLowerCase();
    for (const hg of (homoglyphs[c] || [])) {
      add(name.slice(0, i) + hg + name.slice(i + 1) + "." + tld, "homograph");
    }
  }

  // 7. TLD swaps
  const altTlds = ["com", "net", "org", "io", "co", "info", "biz", "xyz", "app", "dev", "me", "cc", "ly"];
  for (const alt of altTlds) {
    if (alt !== tld) add(name + "." + alt, "tld-swap");
  }

  // 8. Hyphenation
  for (let i = 1; i < name.length; i++) {
    add(name.slice(0, i) + "-" + name.slice(i) + "." + tld, "hyphenation");
  }

  // Limit total to avoid excessive DNS queries
  return variants.slice(0, 200);
}

// ── Check if variants are registered ────────────────────

export async function checkTyposquats(
  domain: string,
  options: { maxCheck?: number; concurrency?: number } = {}
): Promise<TyposquatResult> {
  const maxCheck = options.maxCheck || 100;
  const concurrency = options.concurrency || 10;
  const variants = generateVariants(domain).slice(0, maxCheck);
  const results: DomainVariant[] = [];

  for (let i = 0; i < variants.length; i += concurrency) {
    const batch = variants.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (v) => {
        const { stdout } = await execFileNoThrow("dig", ["+short", v.domain, "A"], { timeoutMs: 3000 });
        const ip = stdout.trim().split("\n")[0]?.trim();
        const registered = !!ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip);

        return {
          ...v,
          registered,
          ip: registered ? ip : undefined,
          suspicious: registered, // Any registered look-alike is suspicious
        };
      })
    );
    results.push(...batchResults);
  }

  const registered = results.filter(r => r.registered);

  return {
    originalDomain: domain,
    variants: results,
    registered,
    stats: {
      generated: variants.length,
      checked: results.length,
      registered: registered.length,
      suspicious: registered.length,
    },
    timestamp: new Date().toISOString(),
  };
}
