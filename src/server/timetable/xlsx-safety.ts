import { inflateRawSync } from "node:zlib";

/**
 * Defensive checks on an uploaded .xlsx BEFORE it is handed to the parser:
 * - it must be a ZIP (OOXML) container with an Excel workbook part;
 * - bounded number of parts and no VBA macro / ActiveX binaries;
 * - zip-bomb protection: every part is actually inflated here with a hard
 *   output cap (declared sizes in the archive are not trusted).
 */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_UNCOMPRESSED = 25 * 1024 * 1024;
const MAX_ENTRIES = 300;

export type XlsxCheck = { ok: true } | { ok: false; message: string };

const DAMAGED = { ok: false as const, message: "Fișierul Excel este deteriorat." };

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
  if (eocd < 0) return DAMAGED;
  const entries = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (entries > MAX_ENTRIES) return { ok: false, message: "Fișierul Excel conține prea multe componente." };

  let p = cdOffset;
  let total = 0;
  let hasWorkbook = false;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) return DAMAGED;
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const declared = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen).toLowerCase();
    if (name === "xl/workbook.xml") hasWorkbook = true;
    if (name.endsWith("vbaproject.bin") || (name.includes("activex") && name.endsWith(".bin"))) {
      return { ok: false, message: "Fișierele cu macro-uri sau controale ActiveX nu sunt acceptate." };
    }
    if (declared > MAX_UNCOMPRESSED || total + declared > MAX_UNCOMPRESSED) {
      return { ok: false, message: "Conținutul fișierului Excel este prea mare." };
    }

    // Real size: inflate the part with an output cap.
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) return DAMAGED;
    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    if (dataStart + compressed > buf.length) return DAMAGED;
    let actual: number;
    if (method === 0) actual = compressed;
    else if (method === 8) {
      try {
        actual = inflateRawSync(buf.subarray(dataStart, dataStart + compressed), { maxOutputLength: MAX_UNCOMPRESSED - total }).length;
      } catch (e) {
        const tooBig = e instanceof RangeError || (e as { code?: string }).code === "ERR_BUFFER_TOO_LARGE";
        return tooBig ? { ok: false, message: "Conținutul fișierului Excel este prea mare." } : DAMAGED;
      }
    } else return DAMAGED;
    total += actual;
    if (total > MAX_UNCOMPRESSED) return { ok: false, message: "Conținutul fișierului Excel este prea mare." };
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (!hasWorkbook) return { ok: false, message: "Fișierul nu este un registru Excel (.xlsx)." };
  return { ok: true };
}
