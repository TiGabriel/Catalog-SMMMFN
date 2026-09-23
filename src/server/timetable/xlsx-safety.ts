/**
 * Defensive checks on an uploaded .xlsx BEFORE it is handed to the parser:
 * it must be a ZIP (OOXML) container, not too many entries, bounded total
 * uncompressed size (zip-bomb protection) and no VBA macro project.
 */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_UNCOMPRESSED = 25 * 1024 * 1024;
const MAX_ENTRIES = 300;

export type XlsxCheck = { ok: true } | { ok: false; message: string };

export function checkXlsxContainer(buf: Buffer): XlsxCheck {
  if (buf.length === 0) return { ok: false, message: "Fișierul este gol." };
  if (buf.length > MAX_UPLOAD_BYTES) return { ok: false, message: "Fișierul depășește 2 MB." };
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) return { ok: false, message: "Fișierul nu este un document Excel (.xlsx) valid." };

  // Locate the End Of Central Directory record (last 22..65557 bytes).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return { ok: false, message: "Fișierul Excel este deteriorat." };
  const entries = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (entries > MAX_ENTRIES) return { ok: false, message: "Fișierul Excel conține prea multe componente." };

  let p = cdOffset;
  let total = 0;
  let hasWorkbook = false;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) return { ok: false, message: "Fișierul Excel este deteriorat." };
    const uncompressed = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen).toLowerCase();
    total += uncompressed;
    if (name === "xl/workbook.xml") hasWorkbook = true;
    if (name.endsWith("vbaproject.bin") || name.endsWith(".bin") && name.includes("activex")) {
      return { ok: false, message: "Fișierele cu macro-uri sau controale ActiveX nu sunt acceptate." };
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (total > MAX_UNCOMPRESSED) return { ok: false, message: "Conținutul fișierului Excel este prea mare." };
  if (!hasWorkbook) return { ok: false, message: "Fișierul nu este un registru Excel (.xlsx)." };
  return { ok: true };
}
