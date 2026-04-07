/**
 * Geospatial Intelligence — satellite data, geocoding, weather, natural disasters
 * Free APIs: Open-Meteo, Nominatim/OSM, NASA FIRMS, USGS earthquake
 */

export interface GeocodingResult {
  query: string;
  results: { name: string; lat: number; lon: number; country: string; type: string }[];
}

export interface WeatherResult {
  location: { lat: number; lon: number };
  current: { temp: number; windSpeed: number; weatherCode: number; description: string };
  timestamp: string;
}

export interface EarthquakeResult {
  location: { lat: number; lon: number; radius: number };
  events: EarthquakeEvent[];
  stats: { total: number; significant: number };
  timestamp: string;
}

export interface EarthquakeEvent {
  magnitude: number;
  place: string;
  time: string;
  depth: number;
  lat: number;
  lon: number;
  url: string;
  tsunami: boolean;
}

export interface FireHotspot {
  lat: number;
  lon: number;
  brightness: number;
  confidence: string;
  acqDate: string;
  satellite: string;
}

export interface SatelliteResult {
  location: { lat: number; lon: number; radius: number };
  fires: FireHotspot[];
  earthquakes: EarthquakeEvent[];
  weather: WeatherResult;
  timestamp: string;
}

// ── Geocoding (Nominatim/OSM — free) ────────────────────

export async function geocode(query: string): Promise<GeocodingResult> {
  const results: GeocodingResult["results"] = [];

  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5`,
      { signal: AbortSignal.timeout(10000), headers: { "User-Agent": "Panopticon-OSINT/1.0" } }
    );
    if (response.ok) {
      const data = await response.json();
      for (const item of data) {
        results.push({
          name: item.display_name,
          lat: parseFloat(item.lat),
          lon: parseFloat(item.lon),
          country: item.address?.country || "",
          type: item.type || item.osm_type || "",
        });
      }
    }
  } catch {}

  return { query, results };
}

// ── Reverse Geocoding ───────────────────────────────────

export async function reverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
      { signal: AbortSignal.timeout(10000), headers: { "User-Agent": "Panopticon-OSINT/1.0" } }
    );
    if (response.ok) {
      const data = await response.json();
      return data.display_name || `${lat}, ${lon}`;
    }
  } catch {}
  return `${lat}, ${lon}`;
}

// ── Weather (Open-Meteo — free, no key) ─────────────────

export async function getWeather(lat: number, lon: number): Promise<WeatherResult> {
  const result: WeatherResult = { location: { lat, lon }, current: { temp: 0, windSpeed: 0, weatherCode: 0, description: "" }, timestamp: new Date().toISOString() };

  try {
    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (response.ok) {
      const data = await response.json();
      const cw = data.current_weather;
      result.current = {
        temp: cw.temperature,
        windSpeed: cw.windspeed,
        weatherCode: cw.weathercode,
        description: weatherCodeToText(cw.weathercode),
      };
    }
  } catch {}

  return result;
}

function weatherCodeToText(code: number): string {
  const codes: Record<number, string> = {
    0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Foggy", 48: "Depositing rime fog", 51: "Light drizzle", 53: "Moderate drizzle",
    55: "Dense drizzle", 61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
    71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow", 80: "Slight rain showers",
    81: "Moderate rain showers", 82: "Violent rain showers", 95: "Thunderstorm",
  };
  return codes[code] || `Code ${code}`;
}

// ── Earthquakes (USGS — free, no key) ───────────────────

export async function getEarthquakes(
  lat: number, lon: number, radiusKm = 500, days = 30
): Promise<EarthquakeResult> {
  const events: EarthquakeEvent[] = [];

  try {
    const start = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];
    const response = await fetch(
      `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&latitude=${lat}&longitude=${lon}&maxradiuskm=${radiusKm}&starttime=${start}&minmagnitude=2.5&limit=50`,
      { signal: AbortSignal.timeout(15000) }
    );
    if (response.ok) {
      const data = await response.json();
      for (const feature of (data.features || [])) {
        const p = feature.properties;
        const coords = feature.geometry?.coordinates || [];
        events.push({
          magnitude: p.mag,
          place: p.place,
          time: new Date(p.time).toISOString(),
          depth: coords[2] || 0,
          lat: coords[1],
          lon: coords[0],
          url: p.url,
          tsunami: !!p.tsunami,
        });
      }
    }
  } catch {}

  return {
    location: { lat, lon, radius: radiusKm },
    events: events.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()),
    stats: { total: events.length, significant: events.filter(e => e.magnitude >= 5).length },
    timestamp: new Date().toISOString(),
  };
}

// ── NASA FIRMS Fire Hotspots (free, no key) ─────────────

export async function getFireHotspots(lat: number, lon: number, radiusKm = 100): Promise<FireHotspot[]> {
  const hotspots: FireHotspot[] = [];

  try {
    // NASA FIRMS provides CSV data for last 24h
    const response = await fetch(
      `https://firms.modaps.eosdis.nasa.gov/api/area/csv/PANOPTICON/VIIRS_SNPP_NRT/${lon - 1},${lat - 1},${lon + 1},${lat + 1}/1`,
      { signal: AbortSignal.timeout(15000) }
    );
    if (response.ok) {
      const csv = await response.text();
      const lines = csv.split("\n").slice(1); // Skip header
      for (const line of lines) {
        const cols = line.split(",");
        if (cols.length < 5) continue;
        hotspots.push({
          lat: parseFloat(cols[0]),
          lon: parseFloat(cols[1]),
          brightness: parseFloat(cols[2]),
          confidence: cols[8] || "nominal",
          acqDate: cols[5] || "",
          satellite: cols[cols.length - 2] || "VIIRS",
        });
      }
    }
  } catch {}

  return hotspots;
}

// ── Full Geospatial Intelligence ────────────────────────

export async function geospatialIntel(
  target: string | { lat: number; lon: number }
): Promise<SatelliteResult> {
  let lat: number, lon: number;

  if (typeof target === "string") {
    const geo = await geocode(target);
    if (geo.results.length === 0) throw new Error(`Could not geocode: ${target}`);
    lat = geo.results[0].lat;
    lon = geo.results[0].lon;
  } else {
    lat = target.lat;
    lon = target.lon;
  }

  const [fires, earthquakes, weather] = await Promise.all([
    getFireHotspots(lat, lon),
    getEarthquakes(lat, lon, 500, 30),
    getWeather(lat, lon),
  ]);

  return {
    location: { lat, lon, radius: 500 },
    fires,
    earthquakes: earthquakes.events,
    weather,
    timestamp: new Date().toISOString(),
  };
}
