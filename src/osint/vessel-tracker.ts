/**
 * Vessel/Ship Tracker — AIS maritime intelligence
 * 
 * ⚠ EXPERIMENTAL: This module depends on external free-tier services that may
 * be rate-limited, blocked, or unavailable. Results are not guaranteed.
 * Uses free public AIS data sources (no API key)
 */

export interface VesselInfo {
  mmsi: string;          // Maritime Mobile Service Identity
  imo?: string;          // IMO number
  name?: string;
  callsign?: string;
  type?: string;         // Cargo, Tanker, Passenger, etc.
  flag?: string;         // Country flag
  latitude?: number;
  longitude?: number;
  speed?: number;        // knots
  course?: number;       // degrees
  heading?: number;
  destination?: string;
  eta?: string;
  status?: string;       // Underway, Anchored, Moored, etc.
  length?: number;       // meters
  width?: number;
  draught?: number;
  lastUpdate?: string;
  source: string;
}

export interface VesselSearchResult {
  query: string;
  vessels: VesselInfo[];
  stats: { total: number };
  timestamp: string;
}

export interface PortActivity {
  port: string;
  vessels: VesselInfo[];
  arrivals: number;
  departures: number;
  timestamp: string;
}

// ── Vessel Search via Public AIS ────────────────────────

export async function searchVessel(query: string): Promise<VesselSearchResult> {
  const vessels: VesselInfo[] = [];

  // Source 1: VesselFinder free search (scrape public page)
  try {
    const response = await fetch(
      `https://www.vesselfinder.com/api/pub/search/v3?q=${encodeURIComponent(query)}`,
      {
        signal: AbortSignal.timeout(10000),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Panopticon/1.0)" },
      }
    );
    if (response.ok) {
      const data = await response.json();
      for (const v of (data || []).slice(0, 20)) {
        vessels.push({
          mmsi: String(v.mmsi || v.id || ""),
          imo: String(v.imo || ""),
          name: v.name || v.shipName,
          type: v.type || v.shipType,
          flag: v.flag || v.country,
          latitude: v.lat,
          longitude: v.lon,
          speed: v.speed,
          course: v.course,
          destination: v.destination,
          status: v.navStatus,
          source: "vesselfinder",
        });
      }
    }
  } catch {}

  // Source 2: MarineTraffic public search
  if (vessels.length === 0) {
    try {
      const response = await fetch(
        `https://www.marinetraffic.com/en/ais/index/search/all/keyword:${encodeURIComponent(query)}`,
        {
          signal: AbortSignal.timeout(10000),
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        }
      );
      if (response.ok) {
        const html = await response.text();
        // Extract vessel data from HTML/JSON embedded in page
        const dataMatch = html.match(/\"vessels\":\[([^\]]+)\]/);
        if (dataMatch) {
          try {
            const items = JSON.parse(`[${dataMatch[1]}]`);
            for (const v of items.slice(0, 10)) {
              vessels.push({
                mmsi: String(v.MMSI || ""),
                name: v.SHIPNAME,
                type: v.SHIPTYPE,
                flag: v.FLAG,
                latitude: v.LAT,
                longitude: v.LON,
                speed: v.SPEED,
                source: "marinetraffic",
              });
            }
          } catch {}
        }
      }
    } catch {}
  }

  return {
    query,
    vessels,
    stats: { total: vessels.length },
    timestamp: new Date().toISOString(),
  };
}

// ── MMSI Lookup ─────────────────────────────────────────

export async function lookupMmsi(mmsi: string): Promise<VesselInfo | null> {
  const clean = mmsi.replace(/[^0-9]/g, "");
  const result = await searchVessel(clean);
  return result.vessels.find(v => v.mmsi === clean) || result.vessels[0] || null;
}

// ── Vessels in Area ─────────────────────────────────────

export async function getVesselsInArea(
  latMin: number, lonMin: number, latMax: number, lonMax: number
): Promise<VesselSearchResult> {
  const vessels: VesselInfo[] = [];

  // Use AISHub or similar free AIS API if available
  // Fallback: use a known bounding box search
  try {
    const response = await fetch(
      `https://meri.digitraffic.fi/api/ais/v1/locations?from=${latMin},${lonMin}&to=${latMax},${lonMax}`,
      { signal: AbortSignal.timeout(15000) }
    );
    if (response.ok) {
      const data = await response.json();
      for (const feature of (data.features || []).slice(0, 50)) {
        const p = feature.properties || {};
        const coords = feature.geometry?.coordinates || [];
        vessels.push({
          mmsi: String(p.mmsi || ""),
          name: p.name,
          speed: p.sog,
          course: p.cog,
          heading: p.heading,
          latitude: coords[1],
          longitude: coords[0],
          status: getNavStatus(p.navStat),
          lastUpdate: p.timestampExternal ? new Date(p.timestampExternal).toISOString() : undefined,
          source: "digitraffic-fi",
        });
      }
    }
  } catch {}

  return {
    query: `area:${latMin},${lonMin}-${latMax},${lonMax}`,
    vessels,
    stats: { total: vessels.length },
    timestamp: new Date().toISOString(),
  };
}

function getNavStatus(code: number): string {
  const statuses: Record<number, string> = {
    0: "Under way using engine", 1: "At anchor", 2: "Not under command",
    3: "Restricted manoeuvrability", 4: "Constrained by draught",
    5: "Moored", 6: "Aground", 7: "Engaged in fishing",
    8: "Under way sailing", 14: "AIS-SART (active)", 15: "Not defined",
  };
  return statuses[code] || `Unknown (${code})`;
}

// ── Port Analysis ───────────────────────────────────────

const MAJOR_PORTS: Record<string, { lat: number; lon: number; radius: number }> = {
  "SHANGHAI": { lat: 31.23, lon: 121.47, radius: 0.3 },
  "SINGAPORE": { lat: 1.26, lon: 103.84, radius: 0.2 },
  "ROTTERDAM": { lat: 51.95, lon: 4.48, radius: 0.2 },
  "LOS_ANGELES": { lat: 33.73, lon: -118.27, radius: 0.2 },
  "HONG_KONG": { lat: 22.28, lon: 114.17, radius: 0.2 },
  "BUSAN": { lat: 35.10, lon: 129.04, radius: 0.2 },
  "HAMBURG": { lat: 53.54, lon: 9.97, radius: 0.15 },
  "TOKYO": { lat: 35.63, lon: 139.77, radius: 0.2 },
  "DUBAI": { lat: 25.27, lon: 55.29, radius: 0.2 },
  "LONDON": { lat: 51.50, lon: 0.05, radius: 0.15 },
};

export async function getPortActivity(portName: string): Promise<PortActivity> {
  const port = MAJOR_PORTS[portName.toUpperCase().replace(/\s+/g, "_")];
  if (!port) {
    return { port: portName, vessels: [], arrivals: 0, departures: 0, timestamp: new Date().toISOString() };
  }

  const result = await getVesselsInArea(
    port.lat - port.radius, port.lon - port.radius,
    port.lat + port.radius, port.lon + port.radius
  );

  const moored = result.vessels.filter(v => v.status?.includes("Moored") || v.status?.includes("anchor")).length;

  return {
    port: portName,
    vessels: result.vessels,
    arrivals: moored,
    departures: result.vessels.length - moored,
    timestamp: new Date().toISOString(),
  };
}
