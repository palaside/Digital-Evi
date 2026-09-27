/**
 * ==========================================================================
 * PERMANENT SHA-256 FORENSIC CACHE ENGINE (SSOT)
 * Memory + LocalStorage Dual-Tier Caching for 0ms Zero-Latency Retrieval
 * ==========================================================================
 */

import type { SlipExtraction } from "@/schemas/slip.schema";

const CACHE_STORAGE_KEY = "digital_evidence_sha256_cache_v1";

// In-Memory Fast Tier
const memoryCache = new Map<string, SlipExtraction>();

/**
 * Compute SHA-256 Hash of an ArrayBuffer in browser native crypto
 */
export async function computeFileSha256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digestBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(digestBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Get cached extraction result by SHA-256 hash (0ms retrieval)
 */
export function getCachedSlip(sha256: string): SlipExtraction | null {
  if (!sha256) return null;

  // 1. Check memory cache
  if (memoryCache.has(sha256)) {
    return memoryCache.get(sha256)!;
  }

  // 2. Check localStorage cache
  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem(`${CACHE_STORAGE_KEY}_${sha256}`);
      if (stored) {
        const parsed = JSON.parse(stored) as SlipExtraction;
        memoryCache.set(sha256, parsed);
        return parsed;
      }
    } catch {
      // Ignore storage errors
    }
  }

  return null;
}

/**
 * Store extraction result associated with SHA-256 hash
 */
export function setCachedSlip(sha256: string, data: SlipExtraction): void {
  if (!sha256 || !data) return;

  // Store in memory
  memoryCache.set(sha256, data);

  // Store in localStorage
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(`${CACHE_STORAGE_KEY}_${sha256}`, JSON.stringify(data));
    } catch {
      // Ignore quota exceeded
    }
  }
}
