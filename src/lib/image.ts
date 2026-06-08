import sharp from "sharp";

/** Named regions the agent can zoom into (a 3x3 grid plus halves, or the full map). */
export type Region =
  | "full"
  | "top-left"
  | "top-center"
  | "top-right"
  | "middle-left"
  | "center"
  | "middle-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right"
  | "left-half"
  | "right-half"
  | "top-half"
  | "bottom-half";

export const REGIONS: Region[] = [
  "full",
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
  "left-half",
  "right-half",
  "top-half",
  "bottom-half",
];

const clamp = (n: number) => Math.min(1, Math.max(0, n));

// Fractional bounding box {x0,y0,x1,y1} for each region.
function fractions(region: Region): { x0: number; y0: number; x1: number; y1: number } {
  const t = [0, 1 / 3, 2 / 3, 1];
  switch (region) {
    case "top-left": return { x0: t[0], y0: t[0], x1: t[1], y1: t[1] };
    case "top-center": return { x0: t[1], y0: t[0], x1: t[2], y1: t[1] };
    case "top-right": return { x0: t[2], y0: t[0], x1: t[3], y1: t[1] };
    case "middle-left": return { x0: t[0], y0: t[1], x1: t[1], y1: t[2] };
    case "center": return { x0: t[1], y0: t[1], x1: t[2], y1: t[2] };
    case "middle-right": return { x0: t[2], y0: t[1], x1: t[3], y1: t[2] };
    case "bottom-left": return { x0: t[0], y0: t[2], x1: t[1], y1: t[3] };
    case "bottom-center": return { x0: t[1], y0: t[2], x1: t[2], y1: t[3] };
    case "bottom-right": return { x0: t[2], y0: t[2], x1: t[3], y1: t[3] };
    case "left-half": return { x0: 0, y0: 0, x1: 0.5, y1: 1 };
    case "right-half": return { x0: 0.5, y0: 0, x1: 1, y1: 1 };
    case "top-half": return { x0: 0, y0: 0, x1: 1, y1: 0.5 };
    case "bottom-half": return { x0: 0, y0: 0.5, x1: 1, y1: 1 };
    default: return { x0: 0, y0: 0, x1: 1, y1: 1 };
  }
}

const TARGET = 1600; // magnify the crop so small text becomes legible

/**
 * Crop the image to a named region (with a little padding) and magnify it,
 * returning a PNG buffer. This is what lets the vision model actually read
 * small labels and table values on dense maps.
 */
export async function cropRegion(input: Buffer, region: Region): Promise<Buffer> {
  if (region === "full") {
    return sharp(input, { failOn: "none" })
      .resize({ width: TARGET, height: TARGET, fit: "inside", withoutEnlargement: false })
      .png()
      .toBuffer();
  }

  const meta = await sharp(input, { failOn: "none" }).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) {
    return sharp(input, { failOn: "none" }).png().toBuffer();
  }

  const f = fractions(region);
  const pad = 0.04;
  const left = clamp(f.x0 - pad);
  const top = clamp(f.y0 - pad);
  const right = clamp(f.x1 + pad);
  const bottom = clamp(f.y1 + pad);

  const L = Math.floor(left * W);
  const T = Math.floor(top * H);
  const cw = Math.max(1, Math.min(Math.ceil((right - left) * W), W - L));
  const ch = Math.max(1, Math.min(Math.ceil((bottom - top) * H), H - T));

  return sharp(input, { failOn: "none" })
    .extract({ left: L, top: T, width: cw, height: ch })
    .resize({ width: TARGET, height: TARGET, fit: "inside", withoutEnlargement: false })
    .png()
    .toBuffer();
}
