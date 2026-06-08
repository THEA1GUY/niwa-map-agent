/**
 * OpenStreetMap lookups — free, no API key.
 *  - Nominatim for geocoding (place name -> coordinates / existence check).
 *  - Overpass for real waterway data (rivers, lakes, dams) in an area.
 *
 * Used to VERIFY what the AI reads on a map and to fill in gaps.
 * Nominatim usage policy: identify with a User-Agent, keep volume modest.
 */

const NOMINATIM = "https://nominatim.openstreetmap.org";
const OVERPASS = "https://overpass-api.de/api/interpreter";
const UA = "NIWA-Map-Agent/1.0 (+https://niwa-map-agent.vercel.app)";

async function fetchWithTimeout(
  url: string,
  opts: RequestInit,
  ms: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

type Place = {
  name: string;
  lat: number;
  lon: number;
  type: string;
  bbox?: [number, number, number, number]; // south, west, north, east
};

async function geocode(query: string): Promise<Place[]> {
  const url = `${NOMINATIM}/search?q=${encodeURIComponent(query)}&format=jsonv2&limit=5`;
  const res = await fetchWithTimeout(
    url,
    { headers: { "User-Agent": UA, "Accept-Language": "en" } },
    8000,
  );
  if (!res.ok) return [];
  const data = (await res.json()) as Array<{
    display_name: string;
    lat: string;
    lon: string;
    class: string;
    type: string;
    boundingbox?: [string, string, string, string]; // south, north, west, east
  }>;
  return data.map((d) => ({
    name: d.display_name,
    lat: parseFloat(d.lat),
    lon: parseFloat(d.lon),
    type: `${d.class}/${d.type}`,
    bbox: d.boundingbox
      ? [
          parseFloat(d.boundingbox[0]),
          parseFloat(d.boundingbox[2]),
          parseFloat(d.boundingbox[1]),
          parseFloat(d.boundingbox[3]),
        ]
      : undefined,
  }));
}

/** Confirm a place/feature exists in OSM and return its real coordinates. */
export async function lookupPlace(query: string): Promise<string> {
  try {
    const places = await geocode(query);
    if (!places.length) {
      return `OpenStreetMap has no clear match for "${query}". It may be spelled differently, very local, or unmapped.`;
    }
    return (
      `OpenStreetMap matches for "${query}":\n` +
      places
        .slice(0, 3)
        .map(
          (p) =>
            `- ${p.name} (type: ${p.type}) at ${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`,
        )
        .join("\n")
    );
  } catch {
    return "OpenStreetMap lookup failed (network/timeout). Proceed without it.";
  }
}

/** List real rivers, lakes and dams in/around a named area, from OSM. */
export async function findWaterways(area: string): Promise<string> {
  try {
    const places = await geocode(area);
    if (!places.length) {
      return `OpenStreetMap could not locate "${area}", so no waterway data could be fetched.`;
    }
    const p = places[0];

    let south: number, west: number, north: number, east: number;
    if (p.bbox) {
      [south, west, north, east] = p.bbox;
    } else {
      const d = 0.3;
      south = p.lat - d;
      north = p.lat + d;
      west = p.lon - d;
      east = p.lon + d;
    }
    // Clamp the area so the Overpass query stays fast.
    const maxSpan = 1.2;
    if (north - south > maxSpan) {
      const c = (north + south) / 2;
      south = c - maxSpan / 2;
      north = c + maxSpan / 2;
    }
    if (east - west > maxSpan) {
      const c = (east + west) / 2;
      west = c - maxSpan / 2;
      east = c + maxSpan / 2;
    }
    const bbox = `${south},${west},${north},${east}`;

    const q =
      `[out:json][timeout:15];(` +
      `way["waterway"~"^(river|stream|canal)$"]["name"](${bbox});` +
      `relation["waterway"="river"]["name"](${bbox});` +
      `way["natural"="water"]["name"](${bbox});` +
      `node["man_made"~"^(dam|weir)$"]["name"](${bbox});` +
      `);out tags center 100;`;

    const res = await fetchWithTimeout(
      OVERPASS,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": UA,
        },
        body: `data=${encodeURIComponent(q)}`,
      },
      16000,
    );
    if (!res.ok) return `OpenStreetMap waterway query failed (status ${res.status}).`;

    const data = (await res.json()) as {
      elements: Array<{ tags?: Record<string, string> }>;
    };
    const rivers = new Set<string>();
    const lakes = new Set<string>();
    const dams = new Set<string>();
    for (const el of data.elements ?? []) {
      const t = el.tags ?? {};
      const name = t.name;
      if (!name) continue;
      if (t.waterway) rivers.add(name);
      else if (t.natural === "water") lakes.add(name);
      else if (t.man_made) dams.add(name);
    }
    const fmt = (s: Set<string>) =>
      s.size ? Array.from(s).slice(0, 40).join(", ") : "none found";

    return [
      `OpenStreetMap data around "${p.name}" (centre ~${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}):`,
      `Rivers/streams/canals: ${fmt(rivers)}`,
      `Lakes/water bodies: ${fmt(lakes)}`,
      `Dams/weirs: ${fmt(dams)}`,
    ].join("\n");
  } catch {
    return "OpenStreetMap waterway lookup failed (network/timeout). Proceed without it.";
  }
}
