import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { MapRow, MessageRow } from "./schema";

/** Make text safe for pdf-lib's standard (WinAnsi) fonts: map fancy punctuation, drop the rest. */
function sanitizeWinAnsi(s: string): string {
  return s
    .replace(/[        ]/g, " ")
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[•·●▪]/g, "-")
    .replace(/[✅❌✔✖]/g, "")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ""); // strip remaining non-ASCII
}

type ImgType = "png" | "jpg" | "gif";

function imageKind(mime: string): ImgType | null {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  if (mime === "image/gif") return "gif";
  return null;
}

/** Read intrinsic pixel dimensions for PNG/JPEG without extra libraries. */
function imageSize(buf: Buffer, mime: string): { width: number; height: number } | null {
  try {
    if (mime === "image/png") {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (mime === "image/jpeg" || mime === "image/jpg") {
      let i = 2;
      while (i < buf.length) {
        if (buf[i] !== 0xff) {
          i++;
          continue;
        }
        const marker = buf[i + 1];
        // Start Of Frame markers carry the dimensions.
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
  } catch {
    /* ignore — fall back to default size */
  }
  return null;
}

function metaLines(map: MapRow): string[] {
  return [
    `Title: ${map.title}`,
    `Source file: ${map.fileName}`,
    `Generated: ${new Date().toLocaleString()}`,
  ];
}

// ----------------------------- Word (.docx) -----------------------------

export async function buildDocx(
  map: MapRow,
  msgs: MessageRow[],
  imageBytes: Buffer | null,
): Promise<Buffer> {
  const children: Paragraph[] = [];

  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: "National Inland Waterways Authority", bold: true, size: 28 }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [new TextRun({ text: "Map Analysis Report", size: 24, color: "555555" })],
    }),
  );

  for (const line of metaLines(map)) {
    children.push(new Paragraph({ children: [new TextRun({ text: line, size: 20 })] }));
  }

  // Embed the map image if we can size it.
  const kind = imageBytes ? imageKind(map.mimeType) : null;
  if (imageBytes && kind) {
    const size = imageSize(imageBytes, map.mimeType) ?? { width: 800, height: 600 };
    const maxW = 540;
    const scale = Math.min(1, maxW / size.width);
    children.push(
      new Paragraph({
        spacing: { before: 200, after: 200 },
        children: [
          new ImageRun({
            type: kind,
            data: imageBytes,
            transformation: {
              width: Math.round(size.width * scale),
              height: Math.round(size.height * scale),
            },
          }),
        ],
      }),
    );
  }

  if (map.analysis) {
    children.push(
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Map Analysis")] }),
    );
    for (const para of map.analysis.split("\n").filter(Boolean)) {
      children.push(new Paragraph({ children: [new TextRun({ text: para, size: 22 })] }));
    }
  }

  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 200 },
      children: [new TextRun("Questions & Findings")],
    }),
  );
  if (msgs.length === 0) {
    children.push(new Paragraph({ children: [new TextRun({ text: "No conversation yet.", italics: true, size: 22 })] }));
  }
  for (const m of msgs) {
    const label = m.role === "assistant" ? "Assistant" : "Question";
    children.push(
      new Paragraph({
        spacing: { before: 120 },
        children: [new TextRun({ text: `${label}:`, bold: true, size: 22 })],
      }),
    );
    for (const para of m.content.split("\n").filter(Boolean)) {
      children.push(new Paragraph({ children: [new TextRun({ text: para, size: 22 })] }));
    }
  }

  const doc = new Document({ sections: [{ children }] });
  return Buffer.from(await Packer.toBuffer(doc));
}

// ------------------------------- PDF -------------------------------

export async function buildPdf(
  map: MapRow,
  msgs: MessageRow[],
  imageBytes: Buffer | null,
): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const A4 = { w: 595, h: 842 };
  const margin = 50;
  const maxW = A4.w - margin * 2;

  let page = pdf.addPage([A4.w, A4.h]);
  let y = A4.h - margin;

  const newPage = () => {
    page = pdf.addPage([A4.w, A4.h]);
    y = A4.h - margin;
  };

  const write = (text: string, opts: { size?: number; bold?: boolean; color?: [number, number, number] } = {}) => {
    const size = opts.size ?? 11;
    const f = opts.bold ? bold : font;
    const color = opts.color ?? [0.1, 0.1, 0.1];
    for (const rawLine of sanitizeWinAnsi(text).split("\n")) {
      const words = rawLine.split(" ");
      let line = "";
      const flush = () => {
        if (y < margin + size) newPage();
        page.drawText(line, { x: margin, y, size, font: f, color: rgb(...color) });
        y -= size + 5;
      };
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (f.widthOfTextAtSize(test, size) > maxW && line) {
          flush();
          line = word;
        } else {
          line = test;
        }
      }
      flush();
    }
  };

  write("National Inland Waterways Authority", { size: 16, bold: true });
  write("Map Analysis Report", { size: 12, color: [0.3, 0.3, 0.3] });
  y -= 6;
  for (const line of metaLines(map)) write(line, { size: 10, color: [0.3, 0.3, 0.3] });
  y -= 6;

  // Embed image (PNG/JPEG only).
  if (imageBytes) {
    try {
      const embedded =
        map.mimeType === "image/png"
          ? await pdf.embedPng(imageBytes)
          : map.mimeType === "image/jpeg" || map.mimeType === "image/jpg"
            ? await pdf.embedJpg(imageBytes)
            : null;
      if (embedded) {
        const scale = Math.min(1, maxW / embedded.width);
        const w = embedded.width * scale;
        const h = embedded.height * scale;
        if (y - h < margin) newPage();
        y -= h;
        page.drawImage(embedded, { x: margin, y, width: w, height: h });
        y -= 14;
      }
    } catch {
      /* unsupported image — skip */
    }
  }

  if (map.analysis) {
    write("Map Analysis", { size: 13, bold: true });
    write(map.analysis, { size: 11 });
    y -= 6;
  }

  write("Questions & Findings", { size: 13, bold: true });
  if (msgs.length === 0) write("No conversation yet.", { size: 11, color: [0.4, 0.4, 0.4] });
  for (const m of msgs) {
    write(`${m.role === "assistant" ? "Assistant" : "Question"}:`, { size: 11, bold: true });
    write(m.content, { size: 11 });
    y -= 4;
  }

  return Buffer.from(await pdf.save());
}

// ----------------- Agent-composed report (title + body text) -----------------

function detectImage(buf: Buffer): { type: ImgType; mime: string } | null {
  if (buf.length > 3 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e)
    return { type: "png", mime: "image/png" };
  if (buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8)
    return { type: "jpg", mime: "image/jpeg" };
  return null;
}

const isHeadingLine = (t: string) => /^[^-\s].{0,60}:$/.test(t);

/** Build Word + PDF from a title and a plain-text body the AI composed. */
export async function buildReport(
  title: string,
  body: string,
  imageBytes: Buffer | null,
): Promise<{ docx: Buffer; pdf: Buffer }> {
  const det = imageBytes ? detectImage(imageBytes) : null;

  // ---- DOCX ----
  const children: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "National Inland Waterways Authority", bold: true, size: 28 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [new TextRun({ text: title, size: 26, color: "1d4e89" })],
    }),
    new Paragraph({
      spacing: { after: 160 },
      children: [new TextRun({ text: `Generated: ${new Date().toLocaleString()}`, size: 18, color: "888888" })],
    }),
  ];
  if (imageBytes && det) {
    const size = imageSize(imageBytes, det.mime) ?? { width: 800, height: 600 };
    const scale = Math.min(1, 540 / size.width);
    children.push(
      new Paragraph({
        spacing: { after: 200 },
        children: [
          new ImageRun({
            type: det.type,
            data: imageBytes,
            transformation: {
              width: Math.round(size.width * scale),
              height: Math.round(size.height * scale),
            },
          }),
        ],
      }),
    );
  }
  for (const raw of body.split("\n")) {
    const t = raw.trimEnd();
    if (!t) {
      children.push(new Paragraph({ children: [new TextRun("")] }));
      continue;
    }
    children.push(
      new Paragraph({ children: [new TextRun({ text: t, size: 22, bold: isHeadingLine(t) })] }),
    );
  }
  const docx = Buffer.from(await Packer.toBuffer(new Document({ sections: [{ children }] })));

  // ---- PDF ----
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const A4 = { w: 595, h: 842 };
  const margin = 50;
  const maxW = A4.w - margin * 2;
  let page = pdf.addPage([A4.w, A4.h]);
  let y = A4.h - margin;
  const newPage = () => {
    page = pdf.addPage([A4.w, A4.h]);
    y = A4.h - margin;
  };
  const write = (
    text: string,
    opts: { size?: number; bold?: boolean; color?: [number, number, number] } = {},
  ) => {
    const size = opts.size ?? 11;
    const f = opts.bold ? bold : font;
    const color = opts.color ?? [0.1, 0.1, 0.1];
    for (const rawLine of sanitizeWinAnsi(text).split("\n")) {
      const words = rawLine.split(" ");
      let line = "";
      const flush = () => {
        if (y < margin + size) newPage();
        page.drawText(line, { x: margin, y, size, font: f, color: rgb(...color) });
        y -= size + 5;
      };
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (f.widthOfTextAtSize(test, size) > maxW && line) {
          flush();
          line = word;
        } else {
          line = test;
        }
      }
      flush();
    }
  };
  write("National Inland Waterways Authority", { size: 16, bold: true });
  write(title, { size: 13, bold: true, color: [0.11, 0.31, 0.54] });
  write(`Generated: ${new Date().toLocaleString()}`, { size: 9, color: [0.5, 0.5, 0.5] });
  y -= 6;
  if (imageBytes && det) {
    try {
      const emb =
        det.type === "png" ? await pdf.embedPng(imageBytes) : await pdf.embedJpg(imageBytes);
      const scale = Math.min(1, maxW / emb.width);
      const w = emb.width * scale;
      const h = emb.height * scale;
      if (y - h < margin) newPage();
      y -= h;
      page.drawImage(emb, { x: margin, y, width: w, height: h });
      y -= 14;
    } catch {
      /* skip unsupported image */
    }
  }
  for (const raw of body.split("\n")) {
    const t = raw.trimEnd();
    if (!t) {
      y -= 6;
      continue;
    }
    write(t, { size: 11, bold: isHeadingLine(t) });
  }
  const pdfBuf = Buffer.from(await pdf.save());

  return { docx, pdf: pdfBuf };
}
