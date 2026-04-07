/**
 * Flight Tracker — real-time aircraft tracking via OpenSky Network
 * Free API, no key needed (rate limited: 100 req/day unauthenticated)
 */

export interface FlightState {
  icao24: string;        // ICAO 24-bit transponder address
  callsign?: string;     // Flight callsign (e.g. "UAL123")
  originCountry: string;
  longitude?: number;
  latitude?: number;
  altitude?: number;     // meters
  velocity?: number;     // m/s
  heading?: number;      // degrees
  verticalRate?: number;
  onGround: boolean;
  lastContact: number;   // Unix timestamp
}

export interface FlightTrackResult {
  query: string;
  queryType: "callsign" | "icao24" | "area" | "airport" | "all";
  flights: FlightState[];
  stats: { total: number; airborne: number; grounded: number };
  timestamp: string;
}

export interface FlightRoute {
  icao24: string;
  callsign?: string;
  departureAirport?: string;
  arrivalAirport?: string;
  firstSeen: number;
  lastSeen: number;
}

export interface AirportFlights {
  airport: string;
  arrivals: FlightRoute[];
  departures: FlightRoute[];
  timestamp: string;
}

// ── OpenSky Network API ─────────────────────────────────

const OPENSKY_BASE = "https://opensky-network.org/api";

async function fetchOpenSky(endpoint: string): Promise<any> {
  const response = await fetch(`${OPENSKY_BASE}${endpoint}`, {
    signal: AbortSignal.timeout(15000),
    headers: { "User-Agent": "Panopticon-OSINT/1.0" },
  });
  if (!response.ok) return null;
  return response.json();
}

// ── Get All Live Flights ────────────────────────────────

export async function getAllFlights(): Promise<FlightTrackResult> {
  const data = await fetchOpenSky("/states/all");
  return parseStates("all", "all", data);
}

// ── Search by Callsign ──────────────────────────────────

export async function trackFlight(callsign: string): Promise<FlightTrackResult> {
  const clean = callsign.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  // OpenSky doesn't support callsign filter directly, so get all and filter
  const data = await fetchOpenSky("/states/all");
  if (!data?.states) return { query: clean, queryType: "callsign", flights: [], stats: { total: 0, airborne: 0, grounded: 0 }, timestamp: new Date().toISOString() };

  const filtered = { ...data, states: data.states.filter((s: any[]) => (s[1] || "").trim().toUpperCase().includes(clean)) };
  return parseStates(clean, "callsign", filtered);
}

// ── Search by Area (bounding box) ───────────────────────

export async function getFlightsInArea(
  lamin: number, lomin: number, lamax: number, lomax: number
): Promise<FlightTrackResult> {
  const data = await fetchOpenSky(`/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`);
  return parseStates(`${lamin},${lomin}-${lamax},${lomax}`, "area", data);
}

// ── Search by ICAO24 ────────────────────────────────────

export async function trackByIcao24(icao24: string): Promise<FlightTrackResult> {
  const clean = icao24.toLowerCase().replace(/[^a-f0-9]/g, "");
  const data = await fetchOpenSky(`/states/all?icao24=${clean}`);
  return parseStates(clean, "icao24", data);
}

// ── Airport Arrivals/Departures ─────────────────────────

export async function getAirportFlights(
  icaoCode: string,
  options: { begin?: number; end?: number } = {}
): Promise<AirportFlights> {
  const code = icaoCode.toUpperCase().replace(/[^A-Z]/g, "");
  const end = options.end || Math.floor(Date.now() / 1000);
  const begin = options.begin || end - 7200; // Last 2 hours

  const [arrivals, departures] = await Promise.all([
    fetchOpenSky(`/flights/arrival?airport=${code}&begin=${begin}&end=${end}`),
    fetchOpenSky(`/flights/departure?airport=${code}&begin=${begin}&end=${end}`),
  ]);

  return {
    airport: code,
    arrivals: (arrivals || []).map(parseRoute),
    departures: (departures || []).map(parseRoute),
    timestamp: new Date().toISOString(),
  };
}

// ── Flight History (by aircraft) ────────────────────────

export async function getFlightHistory(
  icao24: string,
  options: { begin?: number; end?: number } = {}
): Promise<FlightRoute[]> {
  const clean = icao24.toLowerCase().replace(/[^a-f0-9]/g, "");
  const end = options.end || Math.floor(Date.now() / 1000);
  const begin = options.begin || end - 86400; // Last 24 hours

  const data = await fetchOpenSky(`/flights/aircraft?icao24=${clean}&begin=${begin}&end=${end}`);
  return (data || []).map(parseRoute);
}

// ── Parsers ─────────────────────────────────────────────

function parseStates(query: string, queryType: FlightTrackResult["queryType"], data: any): FlightTrackResult {
  const flights: FlightState[] = [];

  for (const s of (data?.states || [])) {
    flights.push({
      icao24: s[0] || "",
      callsign: (s[1] || "").trim() || undefined,
      originCountry: s[2] || "",
      longitude: s[5],
      latitude: s[6],
      altitude: s[7] || s[13], // baro or geo altitude
      velocity: s[9],
      heading: s[10],
      verticalRate: s[11],
      onGround: !!s[8],
      lastContact: s[4] || 0,
    });
  }

  return {
    query,
    queryType,
    flights,
    stats: {
      total: flights.length,
      airborne: flights.filter(f => !f.onGround).length,
      grounded: flights.filter(f => f.onGround).length,
    },
    timestamp: new Date().toISOString(),
  };
}

function parseRoute(data: any): FlightRoute {
  return {
    icao24: data.icao24 || "",
    callsign: (data.callsign || "").trim() || undefined,
    departureAirport: data.estDepartureAirport,
    arrivalAirport: data.estArrivalAirport,
    firstSeen: data.firstSeen || 0,
    lastSeen: data.lastSeen || 0,
  };
}
