const DEFAULT_SETTINGS = {
  spreadsheetId: "",
  sheetName: "WorkLog",
  driveFolderId: "",
  folderStructure: "year-month-task",
  maxFilesPerTask: 20
};

const STATUS_OPTIONS = [
  "เสร็จแล้ว",
  "กำลังดำเนินการ",
  "รอดำเนินการ"
];

// Canonical V3.8 sheet order. Keep this list as the single source of truth
// for popup, dashboard, export and Google Sheets updates.
const HEADERS = [
  "WorkID",
  "วันที่",
  "ช่วงเวลา",
  "ประเภทงาน",
  "ชื่องาน",
  "รายละเอียด",
  "สถานะ",
  "จำนวนไฟล์",
  "DriveFolderID",
  "DriveFolderURL",
  "ผู้บันทึก",
  "Timestamp",
  "เดือน",
  "ปี",
  "ไตรมาส",
  "ปีงบประมาณ",
  "RecordStatus",
  "DeletedAt",
  "OriginalParentID",
  "WorkURL"
];

async function getSettings() {
  const data = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
}

async function saveSettings(settings) {
  await chrome.storage.local.set({
    settings: { ...DEFAULT_SETTINGS, ...settings }
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatThaiDate(date = new Date()) {
  return new Intl.DateTimeFormat("th-TH-u-ca-buddhist", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}


function parseThaiDate(value) {
  const text = String(value || "").trim();
  const m = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (!m) return null;
  let year = Number(m[3]);
  if (year >= 2400) year -= 543;
  const date = new Date(year, Number(m[2]) - 1, Number(m[1]), 12);
  if (date.getFullYear() !== year || date.getMonth() !== Number(m[2]) - 1 || date.getDate() !== Number(m[1])) return null;
  return date;
}

function formatThaiDateLong(date = new Date()) {
  return new Intl.DateTimeFormat("th-TH-u-ca-buddhist", {
    day: "numeric", month: "long", year: "numeric"
  }).format(date);
}

function getThaiMonthYear(date = new Date()) {
  const parts = new Intl.DateTimeFormat("th-TH-u-ca-buddhist", {
    month: "2-digit",
    year: "numeric"
  }).formatToParts(date);
  return {
    month: parts.find(p => p.type === "month")?.value || "",
    year: parts.find(p => p.type === "year")?.value || ""
  };
}

// Fiscal year quarter: October = Q1, January = Q2, April = Q3, July = Q4.
function getQuarter(date = new Date()) {
  const month = date.getMonth() + 1;
  if (month >= 10) return "Q1";
  if (month >= 1 && month <= 3) return "Q2";
  if (month >= 4 && month <= 6) return "Q3";
  return "Q4";
}

// Fiscal year: October 2026 = FY2027 (พ.ศ. 2570).
function getFiscalYear(date = new Date()) {
  const year = date.getFullYear();
  return String(year + (date.getMonth() >= 9 ? 1 : 0) + 543);
}

function toSheetRowObject(row, rowNumber = 0) {
  const obj = {};
  HEADERS.forEach((h, i) => obj[h] = row[i] ?? "");
  obj._rowNumber = rowNumber;
  return obj;
}

function makeWorkId(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `WL-${yyyy}${mm}${dd}-${random}`;
}

function sanitizeFileName(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim() || "งาน";
}

function parseGoogleId(value) {
  const text = String(value || "").trim();
  const match = text.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  const folder = text.match(/folders\/([a-zA-Z0-9_-]+)/);
  if (folder) return folder[1];
  return text;
}

function isLikelyHeaderRow(row) {
  if (!Array.isArray(row)) return false;
  const normalized = row.map(v => String(v ?? "").trim());
  const known = new Set([
    "WorkID", "วันที่", "ช่วงเวลา", "ประเภทงาน", "ชื่องาน", "รายละเอียด",
    "สถานะ", "จำนวนไฟล์", "DriveFolderID", "DriveFolderURL", "ผู้บันทึก",
    "Timestamp", "เดือน", "ปี", "ไตรมาส", "ปีงบประมาณ", "RecordStatus",
    "DeletedAt", "OriginalParentID", "WorkURL", "FiscalYear"
  ]);
  const hits = normalized.filter(v => known.has(v)).length;
  return hits >= 10 && normalized[0] === "WorkID";
}

function getHeaderIndexMap(headerRow) {
  const map = {};
  (headerRow || []).forEach((value, index) => {
    const key = String(value ?? "").trim();
    if (key && map[key] === undefined) map[key] = index;
  });
  // V3.8.0 briefly used FiscalYear as the 19th field. Accept it as an alias
  // while migrating to the canonical Thai header "ปีงบประมาณ".
  if (map["ปีงบประมาณ"] === undefined && map["FiscalYear"] !== undefined) {
    map["ปีงบประมาณ"] = map["FiscalYear"];
  }
  return map;
}

function normalizeSheetRowByHeaders(row, headerIndexMap) {
  return HEADERS.map(header => {
    const index = headerIndexMap[header];
    return index === undefined ? "" : (row[index] ?? "");
  });
}