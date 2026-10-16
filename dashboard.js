
let allRows = [];
let currentPeriod = "month";
let showDeleted = false;
let editingObject = null;
let editFiles = [];
let pendingConfirm = null;
let actualSheetName = "";
let customStartDate = null;
let customEndDate = null;
let currentPage = 1;
const PAGE_SIZE = 20;

const PERIOD_LABELS = {
  day: "วันนี้",
  month: "เดือนนี้",
  "3months": "3 เดือนล่าสุด",
  "6months": "6 เดือนล่าสุด",
  "9months": "9 เดือนล่าสุด",
  year: "1 ปีล่าสุด",
  custom: "กำหนดเอง"
};

const STATUS_META = {
  "เสร็จแล้ว": { icon: "🟢", cls: "success" },
  "กำลังดำเนินการ": { icon: "🔵", cls: "info" },
  "รอดำเนินการ": { icon: "🟠", cls: "warning" }
};

const HIDDEN_STATUS_VALUES = new Set(["มีปัญหา", "อื่น ๆ"]);

document.addEventListener("DOMContentLoaded", async () => {
  initThaiDatePickers();
  initCustomPeriod();
  document.querySelectorAll(".period-tabs button").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".period-tabs button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentPeriod = btn.dataset.period;
      currentPage = 1;
      document.getElementById("customPeriodBox")?.classList.toggle("hidden", currentPeriod !== "custom");
      if (currentPeriod === "custom" && (!customStartDate || !customEndDate)) {
        setDefaultCustomPeriod();
      }
      render();
    };
  });

  document.getElementById("search").addEventListener("input", () => { currentPage = 1; render(); });
  initStatusSelectors();
  document.getElementById("statusFilter").addEventListener("change", () => { currentPage = 1; render(); });

  const toggleChartsBtn = document.getElementById("toggleChartsBtn");
  if (toggleChartsBtn) {
    toggleChartsBtn.onclick = () => {
      const section = document.getElementById("chartsSection");
      const isHidden = section.classList.toggle("hidden");
      toggleChartsBtn.setAttribute("aria-expanded", String(!isHidden));
      toggleChartsBtn.textContent = isHidden
        ? "📊 แสดงกราฟและสรุปเชิงภาพ"
        : "📉 ซ่อนกราฟและสรุปเชิงภาพ";
    };
  }
  document.getElementById("refreshBtn").onclick = load;
  document.getElementById("excelBtn").onclick = openGoogleSheet;
  // document.getElementById("exportBtn").onclick = () => exportExcel(false);
  document.getElementById("settingsBtn").onclick = () => chrome.runtime.openOptionsPage();

  document.getElementById("deletedToggleBtn").onclick = () => {
    showDeleted = !showDeleted;
    updateDeletedButton();
    render();
  };

  document.getElementById("modalCloseBtn").onclick = closeEditModal;
  document.getElementById("cancelEditBtn").onclick = closeEditModal;
  document.querySelectorAll("[data-close-modal]").forEach(el => el.onclick = closeEditModal);
  document.getElementById("editForm").addEventListener("submit", saveEdit);
  document.getElementById("editEvidenceFiles").addEventListener("change", onEditFilesSelected);
  document.getElementById("editTimePeriod").addEventListener("change", updateEditCustomTimeVisibility);
  ["editCustomStartTime", "editCustomEndTime"].forEach(id => {
    document.getElementById(id).addEventListener("input", event => {
      event.target.value = normalizeEditTimeInput(event.target.value);
    });
  });
  setEditCustomTimeDefaults(false);

  document.getElementById("confirmCancelBtn").onclick = closeConfirm;
  document.getElementById("confirmOkBtn").onclick = runConfirm;

  await load();
});

function initThaiDatePickers() {
  if (typeof createThaiDatePicker === "function") {
    document.querySelectorAll(".thai-date-field").forEach(el => createThaiDatePicker(el));
  }
}

function initStatusSelectors() {
  const options = ["", ...STATUS_OPTIONS];
  const filter = document.getElementById("statusFilter");
  const edit = document.getElementById("editStatus");
  if (filter) {
    const current = filter.value;
    filter.innerHTML = options.map(value =>
      value ? `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>` : `<option value="">ทุกสถานะ</option>`
    ).join("");
    filter.value = options.includes(current) ? current : "";
  }
  if (edit) {
    const current = edit.value;
    edit.innerHTML = STATUS_OPTIONS.map(value =>
      `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`
    ).join("");
    edit.value = STATUS_OPTIONS.includes(current) ? current : STATUS_OPTIONS[0];
  }
}

async function openGoogleSheet() {
  try {
    const settings = await getSettings();
    if (!settings.spreadsheetId) throw new Error("กรุณาตั้งค่า Google Spreadsheet ID ก่อน");

    // Use the actual sheet resolved by ensureWorkLogSheet, including the V3.7
    // legacy A:O sheet that is migrated to V3.8 P:T columns.
    const setup = await ensureWorkLogSheet(settings.spreadsheetId, settings.sheetName);
    const sheet = setup.sheet || {};
    const gid = sheet.properties?.sheetId;
    const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(settings.spreadsheetId)}/edit${gid !== undefined ? `#gid=${gid}` : ""}`;

    if (chrome.tabs?.create) {
      await chrome.tabs.create({ url });
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  } catch (error) {
    console.error(error);
    showStatus(error.message || "เปิด Google Sheet ไม่สำเร็จ", "error");
  }
}

function showStatus(message, type = "success") {
  const el = document.getElementById("dashboardStatus");
  el.textContent = message;
  el.className = `toast ${type}`;
  clearTimeout(showStatus.timer);
  showStatus.timer = setTimeout(() => el.className = "toast hidden", 5000);
}

function updateDeletedButton() {
  const btn = document.getElementById("deletedToggleBtn");
  const toolbar = document.querySelector(".dashboard-toolbar");
  const maincarddelete = document.querySelector(".maincard");
  btn.textContent = showDeleted ? "↩️ กลับงานปกติ" : "🗄️ งานที่ลบ";
  btn.classList.toggle("danger-outline", showDeleted);
  toolbar?.classList.toggle("deleted-mode", showDeleted);
  maincarddelete?.classList.toggle("deleted-mode", showDeleted);
  document.querySelector(".dashboard-v38")?.classList.toggle("deleted-mode", showDeleted);
  currentPage = 1;
}

async function load() {
  try {
    const settings = await getSettings();
    if (!settings.spreadsheetId) throw new Error("กรุณาตั้งค่า Google Spreadsheet ID ก่อน");

    const setup = await ensureWorkLogSheet(settings.spreadsheetId, settings.sheetName);
    const actualSheet = setup.actualSheetName || settings.sheetName;
    actualSheetName = actualSheet;
    const result = await getSheetValues(settings.spreadsheetId, `${actualSheet}!A2:T`);

    const rawRows = Array.isArray(result.values) ? result.values : [];
    allRows = rawRows
      .map((row, index) => ({ row, sheetRow: index + 2 }))
      .filter(item => Array.isArray(item.row) && item.row.some((v, i) => i < 15 && String(v ?? "").trim()))
      .map(item => toSheetRowObject(item.row, item.sheetRow));

    render();

    if (setup.warning) showStatus(setup.warning, "success");
    else if (setup.migratedHeaders) showStatus("อัปเดตคอลัมน์ V3.8 สำหรับ Soft Delete / ปีงบประมาณแล้ว", "success");
  } catch (error) {
    console.error(error);
    showStatus(error.message || "โหลดข้อมูลไม่สำเร็จ", "error");
  }
}

function rowDate(obj) {
  const text = String(obj["วันที่"] || "").trim();
  const parts = text.split(/[\/.-]/);
  if (parts.length === 3) {
    let day = Number(parts[0]);
    let month = Number(parts[1]);
    let year = Number(parts[2]);
    if (year > 2400) year -= 543;
    if (day && month && year) return new Date(year, month - 1, day, 12);
  }

  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 12);

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateToInput(date) {
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getDateOnly(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
}

function initCustomPeriod() {
  const start = new Date();
  const end = new Date();
  setCustomPeriod(start, end, false);
  document.getElementById("applyCustomPeriodBtn")?.addEventListener("click", () => {
    const startValue = document.getElementById("customStart").value;
    const endValue = document.getElementById("customEnd").value;
    const error = document.getElementById("customPeriodError");
    const a = parseIsoDate(startValue);
    const b = parseIsoDate(endValue);
    if (!a || !b) {
      error.textContent = "กรุณาเลือกวันที่เริ่มและวันที่สิ้นสุด";
      return;
    }
    if (b < a) {
      error.textContent = "วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่ม";
      return;
    }
    customStartDate = a;
    customEndDate = b;
    error.textContent = "";
    currentPeriod = "custom";
    currentPage = 1;
    document.querySelectorAll(".period-tabs button").forEach(btn => btn.classList.toggle("active", btn.dataset.period === "custom"));
    document.getElementById("customPeriodBox")?.classList.remove("hidden");
    render();
  });
}

function setDefaultCustomPeriod() {
  const now = getDateOnly(new Date());
  setCustomPeriod(now, now, false);
}

function setCustomPeriod(start, end, rerender = true) {
  customStartDate = getDateOnly(start);
  customEndDate = getDateOnly(end);
  setThaiDateValue("customStart", customStartDate);
  setThaiDateValue("customEnd", customEndDate);
  if (rerender) render();
}

function parseIsoDate(value) {
  const m = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  return Number.isNaN(d.getTime()) ? null : d;
}

function inPeriod(date, period) {
  if (!date) return false;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (period === "day") {
    return date >= today && date < new Date(today.getTime() + 86400000);
  }
  if (period === "month") {
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  }
  if (period === "custom") {
    if (!customStartDate || !customEndDate) return false;
    const d = getDateOnly(date);
    return d >= customStartDate && d <= customEndDate;
  }

  const months = period === "3months" ? 3 : period === "6months" ? 6 : period === "9months" ? 9 : 12;
  const start = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
  return date >= start;
}

function isDeleted(o) {
  return String(o["RecordStatus"] || "ACTIVE").toUpperCase() === "DELETED";
}

function getVisibleObjects() {
  return allRows.filter(o => showDeleted ? isDeleted(o) : !isDeleted(o));
}

function render() {
  const visible = getVisibleObjects();
  const filtered = visible.filter(o => inPeriod(rowDate(o), currentPeriod));

  const search = document.getElementById("search").value.trim().toLowerCase();
  const status = document.getElementById("statusFilter").value;

  const searched = filtered.filter(o => {
    if (status && o["สถานะ"] !== status) return false;
    if (!search) return true;
    return Object.values(o).join(" ").toLowerCase().includes(search);
  });

  const done = filtered.filter(o => o["สถานะ"] === "เสร็จแล้ว").length;
  const progress = filtered.filter(o => o["สถานะ"] === "กำลังดำเนินการ").length;
  const pending = filtered.filter(o => o["สถานะ"] === "รอดำเนินการ").length;
  const files = filtered.reduce((sum, o) => sum + (Number(o["จำนวนไฟล์"]) || 0), 0);

  document.getElementById("totalJobs").textContent = filtered.length.toLocaleString("th-TH");
  document.getElementById("doneJobs").textContent = done.toLocaleString("th-TH");
  document.getElementById("progressJobs").textContent = progress.toLocaleString("th-TH");
  document.getElementById("pendingJobs").textContent = pending.toLocaleString("th-TH");
  document.getElementById("totalFiles").textContent = files.toLocaleString("th-TH");

  const customLabel = currentPeriod === "custom" && customStartDate && customEndDate
    ? ` • ${formatThaiDate(customStartDate)} - ${formatThaiDate(customEndDate)}`
    : "";
  document.getElementById("periodLabel").textContent =
    `${showDeleted ? "งานที่ลบ • " : ""}${PERIOD_LABELS[currentPeriod]}${customLabel} • ${getFiscalPeriodLabel(new Date())}`;
  document.getElementById("summaryLabel").textContent = `${filtered.length.toLocaleString("th-TH")} งาน`;
  document.getElementById("tableHint").textContent =
    `${searched.length.toLocaleString("th-TH")} รายการ${showDeleted ? " • รายการที่ลบแบบ Soft Delete" : ""}`;
  document.getElementById("tableTitle").textContent =
    showDeleted ? "🗄️ งานที่ลบ — กู้คืนได้" : "📋 รายการงาน";

  renderBars(filtered);
  renderLineChart(filtered);
  renderStatusPie(filtered);
  renderFiscalInfo(filtered);
  renderTable(searched);
}

function getGrouping(rows) {
  const groups = new Map();

  for (const o of rows) {
    const date = rowDate(o);
    if (!date) continue;

    let key, label, sortKey;

    if (currentPeriod === "day") {
      const time = String(o["ช่วงเวลา"] || "").trim();
      key = time || "ไม่ระบุช่วงเวลา";
      label = key;
      sortKey = key;
    } else if (currentPeriod === "month") {
      key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      label = String(date.getDate()).padStart(2, "0");
      sortKey = key;
    } else if (currentPeriod === "custom") {
      const spanDays = customStartDate && customEndDate
        ? Math.ceil((customEndDate - customStartDate) / 86400000) + 1
        : 1;
      if (spanDays <= 31) {
        key = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
        label = `${String(date.getDate()).padStart(2,"0")}/${String(date.getMonth()+1).padStart(2,"0")}`;
      } else {
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        label = `${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear() + 543}`;
      }
      sortKey = key;
    } else {
      key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      label = `${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear() + 543}`;
      sortKey = key;
    }

    if (!groups.has(key)) groups.set(key, { label, count: 0, sortKey });
    groups.get(key).count++;
  }

  return [...groups.values()].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

function renderBars(rows) {
  const container = document.getElementById("bars");
  const entries = getGrouping(rows);

  if (!entries.length) {
    container.innerHTML = `<div class="empty">ไม่มีข้อมูลในช่วงเวลานี้</div>`;
    return;
  }

  const max = Math.max(...entries.map(e => e.count), 1);
  container.innerHTML = entries.map(e => `
    <div class="bar-item">
      <span title="${escapeHtml(e.label)}">${escapeHtml(e.label)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(e.count / max) * 100}%"></div></div>
      <b>${e.count.toLocaleString("th-TH")}</b>
    </div>
  `).join("");
}

function renderLineChart(rows) {
  const container = document.getElementById("lineChart");
  const entries = getGrouping(rows);
  if (!entries.length) {
    container.innerHTML = `<div class="empty">ไม่มีข้อมูลในช่วงเวลานี้</div>`;
    return;
  }

  const width = 760, height = 220, padL = 42, padR = 16, padT = 20, padB = 42;
  const max = Math.max(...entries.map(e => e.count), 1);
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const step = entries.length === 1 ? innerW / 2 : innerW / (entries.length - 1);

  const points = entries.map((e, i) => {
    const x = entries.length === 1 ? padL + innerW / 2 : padL + i * step;
    const y = padT + innerH - (e.count / max) * innerH;
    return { ...e, x, y };
  });

  const polyline = points.map(p => `${p.x},${p.y}`).join(" ");
  const area = `${padL},${padT + innerH} ${polyline} ${padL + innerW},${padT + innerH}`;
  const labelStep = Math.max(1, Math.ceil(entries.length / 8));

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" class="line-svg" role="img" aria-label="กราฟแนวโน้มจำนวนงาน">
      <line x1="${padL}" y1="${padT + innerH}" x2="${padL + innerW}" y2="${padT + innerH}" class="chart-axis"/>
      <polygon points="${area}" class="chart-area"/>
      <polyline points="${polyline}" class="chart-line" fill="none"/>
      ${points.map(p => `<circle cx="${p.x}" cy="${p.y}" r="4" class="chart-dot"><title>${escapeHtml(p.label)}: ${p.count}</title></circle>`).join("")}
      ${points.filter((_, i) => i % labelStep === 0 || i === points.length - 1)
        .map(p => `<text x="${p.x}" y="${height - 14}" class="chart-label" text-anchor="middle">${escapeHtml(p.label)}</text>`).join("")}
    </svg>
  `;
}

function renderStatusPie(rows) {
  const counts = {};
  rows.forEach(o => {
    const status = String(o["สถานะ"] || "").trim();
    if (!STATUS_OPTIONS.includes(status) || HIDDEN_STATUS_VALUES.has(status)) return;
    counts[status] = (counts[status] || 0) + 1;
  });

  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  const pie = document.getElementById("statusPie");
  const legend = document.getElementById("statusLegend");

  if (!total) {
    pie.style.background = "conic-gradient(#e4e7ec 0 100%)";
    pie.querySelector("span").textContent = "0%";
    legend.innerHTML = `<div class="empty">ไม่มีข้อมูล</div>`;
    document.getElementById("statusSummary").textContent = "0 งาน";
    return;
  }

  let start = 0;
  const segments = [];
  entries.forEach(([status, count], index) => {
    const end = start + (count / total) * 100;
    segments.push(`${pieColor(index)} ${start}% ${end}%`);
    start = end;
  });
  pie.style.background = `conic-gradient(${segments.join(",")})`;
  pie.querySelector("span").textContent = `${Math.round((entries[0][1] / total) * 100)}%`;

  legend.innerHTML = entries.map(([status, count], index) => `
    <div class="legend-row">
      <span><i class="legend-dot" style="background:${pieColor(index)}"></i>${escapeHtml(status)}</span>
      <b>${count.toLocaleString("th-TH")} (${Math.round(count / total * 100)}%)</b>
    </div>
  `).join("");

  document.getElementById("statusSummary").textContent =
    `${total.toLocaleString("th-TH")} งาน • ${entries.length} สถานะ`;
}

function pieColor(index) {
  const colors = ["#2563eb", "#12b76a", "#f79009", "#f04438", "#7a5af8", "#667085", "#0e9384"];
  return colors[index % colors.length];
}

function getFiscalPeriodLabel(date) {
  const fy = getFiscalYear(date);
  return `${fy} • ${getQuarter(date)}`;
}

function renderFiscalInfo(rows) {
  const container = document.getElementById("fiscalInfo");
  const groups = {};

  rows.forEach(o => {
    const date = rowDate(o);
    if (!date) return;
    const fy = o["ปีงบประมาณ"] || o["FiscalYear"] || getFiscalYear(date);
    const q = o["ไตรมาส"] || getQuarter(date);
    const key = `${fy}|${q}`;
    groups[key] = (groups[key] || 0) + 1;
  });

  const entries = Object.entries(groups);
  if (!entries.length) {
    container.innerHTML = `<div class="empty">ไม่มีข้อมูล</div>`;
    return;
  }

  container.innerHTML = entries.map(([key, count]) => {
    const [fy, q] = key.split("|");
    return `<div class="fiscal-row"><span>ปีงบประมาณ ${escapeHtml(fy)} <b>${escapeHtml(q)}</b></span><strong>${count.toLocaleString("th-TH")}</strong></div>`;
  }).join("");
}

function statusBadge(status) {
  const meta = STATUS_META[status];
  if (!meta) return `<span class="status-pill muted-status">—</span>`;
  return `<span class="status-pill ${meta.cls}">${meta.icon} ${escapeHtml(status)}</span>`;
}

function renderTable(rows) {
  const tbody = document.getElementById("workRows");
  const pagination = document.getElementById("pagination");
  const sortedRows = rows.slice().sort((a, b) => (b._rowNumber || 0) - (a._rowNumber || 0));
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  currentPage = Math.min(Math.max(currentPage, 1), totalPages);

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty">ไม่พบข้อมูล</td></tr>`;
    renderPagination(0, 1);
    return;
  }

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageRows = sortedRows.slice(start, start + PAGE_SIZE);
  tbody.innerHTML = pageRows.map(o => {
    const actions = showDeleted
      ? `<button class="table-action restore" data-action="restore" data-row="${o._rowNumber}">↩️ กู้คืน</button>`
      : `<button class="table-action edit" data-action="edit" data-row="${o._rowNumber}">✏️ แก้ไข</button>
         <button class="table-action delete" data-action="delete" data-row="${o._rowNumber}">🗑️ ลบ</button>`;

    return `
      <tr class="${showDeleted ? "deleted-row" : ""}">
        <td>${escapeHtml(o["วันที่"])}</td>
        <td>${escapeHtml(o["ช่วงเวลา"])}</td>
        <td>${escapeHtml(o["ประเภทงาน"])}</td>
        <td>
          <strong>${escapeHtml(o["ชื่องาน"])}</strong>
          <div class="small">${escapeHtml(o["รายละเอียด"]).slice(0, 130)}</div>
        </td>
        <td>
          ${statusBadge(o["สถานะ"])}
          <div class="small">${o["DriveFolderURL"] && Number(o["จำนวนไฟล์"]) !== 0 ? `<a class="small-link" href="${escapeHtml(o["DriveFolderURL"])}" target="_blank" rel="noopener">📂 เปิดโฟลเดอร์</a>` : ""}</div>
        </td>
        <td>${escapeHtml(o["จำนวนไฟล์"] || "0")}</td>
        <td><div class="table-actions">${actions}</div></td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll("[data-action]").forEach(btn => {
    btn.onclick = () => {
      const row = Number(btn.dataset.row);
      const obj = allRows.find(o => o._rowNumber === row);
      if (!obj) return;
      if (btn.dataset.action === "edit") openEditModal(obj);
      if (btn.dataset.action === "delete") askDelete(obj);
      if (btn.dataset.action === "restore") askRestore(obj);
    };
  });

  renderPagination(sortedRows.length, totalPages);
}

function renderPagination(totalItems, totalPages) {
  const el = document.getElementById("pagination");
  if (!el) return;
  if (!totalItems) { el.innerHTML = ""; return; }

  const from = (currentPage - 1) * PAGE_SIZE + 1;
  const to = Math.min(currentPage * PAGE_SIZE, totalItems);
  const buttons = [];
  buttons.push(`<button class="page-btn" data-page="prev" ${currentPage === 1 ? "disabled" : ""}>‹ ก่อนหน้า</button>`);

  const windowSize = 5;
  let start = Math.max(1, currentPage - Math.floor(windowSize / 2));
  let end = Math.min(totalPages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);
  for (let p = start; p <= end; p++) {
    buttons.push(`<button class="page-btn ${p === currentPage ? "active" : ""}" data-page="${p}">${p.toLocaleString("th-TH")}</button>`);
  }
  buttons.push(`<button class="page-btn" data-page="next" ${currentPage === totalPages ? "disabled" : ""}>ถัดไป ›</button>`);

  el.innerHTML = `<div class="pagination-info">แสดง ${from.toLocaleString("th-TH")}–${to.toLocaleString("th-TH")} จาก ${totalItems.toLocaleString("th-TH")} รายการ</div><div class="pagination-buttons">${buttons.join("")}</div>`;
  el.querySelectorAll(".page-btn").forEach(btn => {
    btn.onclick = () => {
      const value = btn.dataset.page;
      if (value === "prev") currentPage--;
      else if (value === "next") currentPage++;
      else currentPage = Number(value);
      render();
      document.querySelector(".maincard")?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
  });
}

function rowToSheetArray(o) {
  return HEADERS.map(h => o[h] ?? "");
}

function normalizeEditTimeInput(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function isValidEditTime(value) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));
}

function getCurrentHourTimeDefaults() {
  const now = new Date();
  const startHour = now.getHours();
  const endHour = Math.min(startHour + 1, 23);
  return {
    start: `${String(startHour).padStart(2, "0")}:00`,
    end: `${String(endHour).padStart(2, "0")}:00`
  };
}

function setEditCustomTimeDefaults(force = false) {
  const startEl = document.getElementById("editCustomStartTime");
  const endEl = document.getElementById("editCustomEndTime");
  if (!startEl || !endEl) return;
  if (!force && startEl.value && endEl.value) return;
  const defaults = getCurrentHourTimeDefaults();
  startEl.value = defaults.start;
  endEl.value = defaults.end;
}

function updateEditCustomTimeVisibility() {
  const isCustom = document.getElementById("editTimePeriod").value === "กำหนดเอง";
  document.getElementById("editCustomTimeBox").classList.toggle("hidden", !isCustom);
  if (isCustom) setEditCustomTimeDefaults(false);
}

function setEditTimePeriod(value) {
  const select = document.getElementById("editTimePeriod");
  const startEl = document.getElementById("editCustomStartTime");
  const endEl = document.getElementById("editCustomEndTime");
  const text = String(value || "").trim();
  const standard = ["08:00 - 12:00", "13:00 - 17:00", "ล่วงเวลา (OT)"];

  // ถ้าใน Google Sheets ไม่มีข้อมูลช่วงเวลาเลย ให้ใช้เวลาปัจจุบัน
  // เป็นค่าเริ่มต้นของ "กำหนดเอง" แต่ถ้ามีข้อมูลเดิม ต้องรักษาค่าเดิมไว้เสมอ
  if (!text) {
    select.value = "กำหนดเอง";
    setEditCustomTimeDefaults(true);
    updateEditCustomTimeVisibility();
    return;
  }

  if (standard.includes(text)) {
    select.value = text;
    startEl.value = "";
    endEl.value = "";
  } else {
    select.value = "กำหนดเอง";
    const match = text.match(/^\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*$/);
    if (match) {
      // มีเวลาเดิมใน Sheet: แสดงเวลาเดิม ไม่ใช้เวลาปัจจุบันมาทับ
      startEl.value = match[1].padStart(5, "0");
      endEl.value = match[2].padStart(5, "0");
    } else {
      // มีข้อความช่วงเวลาแต่รูปแบบไม่ใช่ custom ที่รองรับ ให้คงข้อความเดิม
      // ไว้สำหรับการตรวจสอบ/แก้ไข แทนการทับด้วยเวลาปัจจุบัน
      startEl.value = "";
      endEl.value = "";
    }
  }
  updateEditCustomTimeVisibility();
}

function getEditSelectedTimePeriod() {
  const value = document.getElementById("editTimePeriod").value;
  if (value !== "กำหนดเอง") {
    if (!value) throw new Error("กรุณาเลือกช่วงเวลา");
    return value;
  }
  const start = document.getElementById("editCustomStartTime").value;
  const end = document.getElementById("editCustomEndTime").value;
  if (!isValidEditTime(start) || !isValidEditTime(end)) {
    throw new Error("กรุณาระบุเวลาในรูปแบบ 24 ชั่วโมง HH:mm เช่น 13:00");
  }
  if (start >= end) throw new Error("เวลาสิ้นสุดต้องมากกว่าเวลาเริ่ม");
  return `${start} - ${end}`;
}

async function openEditModal(obj) {
  editingObject = obj;
  editFiles = [];
  document.getElementById("editRowNumber").value = obj._rowNumber;
  setThaiDateValue("editDate", rowDate(obj));
  setEditTimePeriod(obj["ช่วงเวลา"] || "");
  document.getElementById("editCategory").value = obj["ประเภทงาน"] || "";
  document.getElementById("editTaskName").value = obj["ชื่องาน"] || "";
  document.getElementById("editDetails").value = obj["รายละเอียด"] || "";
  const editStatus = String(obj["สถานะ"] || "").trim();
  document.getElementById("editStatus").value = STATUS_OPTIONS.includes(editStatus) ? editStatus : STATUS_OPTIONS[0];
  document.getElementById("editWorkUrl").value = obj["WorkURL"] || "";

  openModal("editModal");
  document.getElementById("editFiles").innerHTML = `<div class="loading">กำลังโหลดไฟล์แนบ...</div>`;

  try {
    if (!obj["DriveFolderID"]) {
      editFiles = [];
    } else {
      editFiles = (await getDriveTaskFiles(obj["DriveFolderID"]))
        .filter(f => f.mimeType !== "application/vnd.google-apps.folder");
    }
    renderEditFiles();
  } catch (error) {
    document.getElementById("editFiles").innerHTML =
      `<div class="notice warning">โหลดไฟล์แนบไม่ได้: ${escapeHtml(error.message)}</div>`;
  }
}

function truncateFileName(name, maxLength = 50) {
  const text = String(name || "");
  if (text.length <= maxLength) return text;
  // Keep the visible text at exactly maxLength characters, including the ellipsis.
  return `${text.slice(0, Math.max(1, maxLength - 3))}...`;
}

function renderEditFiles() {
  const list = document.getElementById("editFiles");
  document.getElementById("editFileCount").textContent = `${editFiles.length} ไฟล์`;
  if (!editFiles.length) {
    list.innerHTML = `<div class="empty compact">ยังไม่มีไฟล์แนบ</div>`;
    return;
  }

  list.innerHTML = editFiles.map(file => `
    <div class="edit-file-row">
      <div class="file-icon">📄</div>
      <div class="file-meta">
        <strong class="attachment-name" title="${escapeHtml(file.name)}">${escapeHtml(truncateFileName(file.name, 50))}</strong>
        <small>${formatBytes(Number(file.size || 0))}</small>
      </div>
      ${file.webViewLink ? `<a href="${escapeHtml(file.webViewLink)}" target="_blank" rel="noopener">เปิด</a>` : ""}
      <button type="button" class="remove-attachment" data-file="${escapeHtml(file.id)}" data-name="${escapeHtml(file.name)}">🗑️</button>
    </div>
  `).join("");

  list.querySelectorAll(".remove-attachment").forEach(btn => {
    btn.onclick = async () => {
      if (!editingObject) return;
      const file = editFiles.find(f => f.id === btn.dataset.file);
      if (!file) return;

      if (!confirm(`ย้ายไฟล์ "${file.name}" ไปยัง Archive ของงานนี้หรือไม่?`)) return;

      try {
        const archiveFolder = await getOrCreateDriveFolder("_ARCHIVE_ATTACHMENTS", editingObject["DriveFolderID"]);
        await archiveDriveFile(file.id, file.parents || [], archiveFolder.id);
        editFiles = editFiles.filter(f => f.id !== file.id);
        renderEditFiles();
        showStatus(`ย้ายไฟล์ "${file.name}" ไป Archive แล้ว`, "success");
      } catch (error) {
        showStatus(error.message || "จัดการไฟล์ไม่สำเร็จ", "error");
      }
    };
  });
}

async function onEditFilesSelected(event) {
  const files = [...event.target.files];
  event.target.value = "";
  if (!files.length || !editingObject?.["DriveFolderID"]) return;

  try {
    const settings = await getSettings();
    const max = Math.max(1, Number(settings.maxFilesPerTask || 20));
    if (editFiles.length + files.length > max) {
      throw new Error(`ไฟล์แนบต่อหนึ่งงานได้ไม่เกิน ${max} ไฟล์`);
    }

    for (const file of files) {
      await uploadFileToDrive(file, editingObject["DriveFolderID"]);
    }

    editFiles = await getDriveTaskFiles(editingObject["DriveFolderID"]);
    editFiles = editFiles.filter(f => f.mimeType !== "application/vnd.google-apps.folder");
    editingObject["จำนวนไฟล์"] = editFiles.length;
    renderEditFiles();
    showStatus(`เพิ่มไฟล์ ${files.length} ไฟล์แล้ว`, "success");
  } catch (error) {
    showStatus(error.message || "อัปโหลดไฟล์ไม่สำเร็จ", "error");
  }
}

async function saveEdit(event) {
  event.preventDefault();
  if (!editingObject) return;

  const btn = document.getElementById("saveEditBtn");
  btn.disabled = true;
  btn.textContent = "กำลังบันทึก...";

  try {
    const settings = await getSettings();
    const date = parseIsoDate(document.getElementById("editDate").value);
    if (!date || Number.isNaN(date.getTime())) throw new Error("วันที่ไม่ถูกต้อง");

    editingObject["วันที่"] = formatThaiDate(date);
    editingObject["ช่วงเวลา"] = getEditSelectedTimePeriod();
    editingObject["ประเภทงาน"] = document.getElementById("editCategory").value.trim();
    editingObject["ชื่องาน"] = document.getElementById("editTaskName").value.trim();
    editingObject["รายละเอียด"] = document.getElementById("editDetails").value.trim();
    editingObject["สถานะ"] = document.getElementById("editStatus").value;
    editingObject["DriveFolderURL"] = editingObject["DriveFolderID"]
      ? `https://drive.google.com/drive/folders/${editingObject["DriveFolderID"]}`
      : "";
    editingObject["WorkURL"] = document.getElementById("editWorkUrl").value.trim();
    editingObject["Timestamp"] = new Date().toLocaleString("th-TH");
    const { month, year } = getThaiMonthYear(date);
    editingObject["เดือน"] = month;
    editingObject["ไตรมาส"] = getQuarter(date);
    editingObject["ปี"] = year;
    editingObject["ปีงบประมาณ"] = getFiscalYear(date);
    editingObject["FiscalYear"] = getFiscalYear(date);
    editingObject["RecordStatus"] = "ACTIVE";
    editingObject["DeletedAt"] = editingObject["DeletedAt"] || "";

    if (editingObject["DriveFolderID"]) {
      await updateDriveFile(editingObject["DriveFolderID"], {
        name: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}_${sanitizeFileName(editingObject["ชื่องาน"]).slice(0, 100)}_${editingObject["WorkID"]}`
      });
    }

    // Re-count only real files, excluding archive subfolders.
    if (editingObject["DriveFolderID"]) {
      const files = await getDriveTaskFiles(editingObject["DriveFolderID"]);
      editingObject["จำนวนไฟล์"] = files.filter(f =>
        f.mimeType !== "application/vnd.google-apps.folder"
      ).length;
    }

    await updateWorkLogRow(
      settings.spreadsheetId,
      actualSheetName || settings.sheetName,
      editingObject._rowNumber,
      rowToSheetArray(editingObject)
    );

    closeEditModal();
    showStatus("บันทึกการแก้ไขเรียบร้อยแล้ว", "success");
    await load();
  } catch (error) {
    console.error(error);
    showStatus(error.message || "บันทึกการแก้ไขไม่สำเร็จ", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "💾 บันทึก";
  }
}

function setConfirmButton(type) {
  const btn = document.getElementById("confirmOkBtn");
  if (type === "restore") {
    btn.textContent = "↩️ ยืนยันกู้คืน";
    btn.classList.remove("danger");
    btn.classList.add("success");
  } else {
    btn.textContent = "🗑️ ยืนยันลบ";
    btn.classList.remove("success");
    btn.classList.add("danger");
  }
}

function askDelete(obj) {
  pendingConfirm = { type: "delete", obj };
  setConfirmButton("delete");
  document.getElementById("confirmTitle").textContent = "⚠️ ยืนยันการลบงาน";
  document.getElementById("confirmMessage").innerHTML =
    `งาน: <strong>${escapeHtml(obj["ชื่องาน"])}</strong><br><br>` +
    `การลบจะนำงานออกจาก Dashboard หลัก และย้ายโฟลเดอร์งานไป <strong>_ARCHIVE</strong> โดยไม่ลบข้อมูลจาก Google Drive ถาวร`;
  openModal("confirmModal");
}

function askRestore(obj) {
  pendingConfirm = { type: "restore", obj };
  setConfirmButton("restore");
  document.getElementById("confirmTitle").textContent = "↩️ ยืนยันการกู้คืนงาน";
  document.getElementById("confirmMessage").innerHTML =
    `ต้องการกู้คืนงาน <strong>${escapeHtml(obj["ชื่องาน"])}</strong> กลับเข้าสู่ Dashboard หลักหรือไม่?`;
  openModal("confirmModal");
}

async function runConfirm() {
  if (!pendingConfirm) return;
  const action = pendingConfirm;
  const btn = document.getElementById("confirmOkBtn");
  btn.disabled = true;

  try {
    const settings = await getSettings();
    if (action.type === "delete") {
      await softDeleteTask(settings, action.obj);
      showStatus("ลบงานแบบ Soft Delete แล้ว • ข้อมูลยังอยู่ใน Archive", "success");
    } else {
      await restoreTask(settings, action.obj);
      showStatus("กู้คืนงานเรียบร้อยแล้ว", "success");
    }
    closeConfirm();
    await load();
  } catch (error) {
    console.error(error);
    showStatus(error.message || "ดำเนินการไม่สำเร็จ", "error");
  } finally {
    btn.disabled = false;
  }
}

async function softDeleteTask(settings, obj) {
  if (!obj["DriveFolderID"]) throw new Error("งานนี้ไม่มี DriveFolderID สำหรับ Archive");

  const folder = await getDriveFile(obj["DriveFolderID"], "id,name,mimeType,parents,webViewLink");
  const originalParent = obj["OriginalParentID"] || folder.parents?.[0] || settings.driveFolderId;
  const archiveRoot = await getOrCreateArchiveFolder(settings.driveFolderId);

  await moveDriveFileToFolder(folder.id, archiveRoot.id, folder.parents || []);

  obj["RecordStatus"] = "DELETED";
  obj["DeletedAt"] = new Date().toLocaleString("th-TH");
  obj["OriginalParentID"] = originalParent;

  await updateWorkLogRow(settings.spreadsheetId, actualSheetName || settings.sheetName, obj._rowNumber, rowToSheetArray(obj));
}

async function restoreTask(settings, obj) {
  if (!obj["DriveFolderID"]) throw new Error("งานนี้ไม่มี DriveFolderID");

  const folder = await getDriveFile(obj["DriveFolderID"], "id,name,mimeType,parents,webViewLink");
  const targetParent = obj["OriginalParentID"] || settings.driveFolderId;

  await moveDriveFileToFolder(folder.id, targetParent, folder.parents || []);

  obj["RecordStatus"] = "ACTIVE";
  obj["DeletedAt"] = "";

  await updateWorkLogRow(settings.spreadsheetId, actualSheetName || settings.sheetName, obj._rowNumber, rowToSheetArray(obj));
}

function openModal(id) {
  document.getElementById(id).classList.remove("hidden");
  document.getElementById(id).setAttribute("aria-hidden", "false");
}

function closeEditModal() {
  editingObject = null;
  editFiles = [];
  document.getElementById("editModal").classList.add("hidden");
  document.getElementById("editModal").setAttribute("aria-hidden", "true");
}

function closeConfirm() {
  pendingConfirm = null;
  const btn = document.getElementById("confirmOkBtn");
  btn.textContent = "🗑️ ยืนยันลบ";
  btn.classList.remove("success");
  btn.classList.add("danger");
  document.getElementById("confirmModal").classList.add("hidden");
  document.getElementById("confirmModal").setAttribute("aria-hidden", "true");
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}

async function exportExcel(openAfter = false) {
  try {
    const rows = getVisibleObjects().filter(o => inPeriod(rowDate(o), currentPeriod));
    if (!rows.length) throw new Error("ไม่มีข้อมูลสำหรับ Export ในช่วงเวลานี้");

    const search = document.getElementById("search").value.trim().toLowerCase();
    const status = document.getElementById("statusFilter").value;
    const filtered = rows.filter(o => {
      if (status && o["สถานะ"] !== status) return false;
      if (!search) return true;
      return Object.values(o).join(" ").toLowerCase().includes(search);
    });

    if (!filtered.length) throw new Error("ไม่มีข้อมูลหลังจากใช้ตัวกรองปัจจุบัน");

    const workbook = buildXlsxWorkbook(
      `WorkLog_${currentPeriod}_${showDeleted ? "Deleted" : "Active"}`,
      filtered
    );
    const blob = new Blob([workbook], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });

    const filename = `WorkLog_${currentPeriod}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    await downloadExcelBlob(blob, filename, openAfter);
    showStatus(openAfter ? "สร้าง Excel แล้ว • กำลังเปิดไฟล์..." : "Export Excel เรียบร้อยแล้ว", "success");
  } catch (error) {
    console.error(error);
    showStatus(error.message || "Export Excel ไม่สำเร็จ", "error");
  }
}

async function downloadExcelBlob(blob, filename, openAfter) {
  if (!chrome.downloads?.download) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return;
  }

  const url = URL.createObjectURL(blob);
  const id = await new Promise((resolve, reject) => {
    chrome.downloads.download({
      url,
      filename,
      saveAs: true
    }, downloadId => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(downloadId);
    });
  });

  const cleanup = () => URL.revokeObjectURL(url);
  if (!openAfter) {
    setTimeout(cleanup, 30000);
    return;
  }

  const listener = delta => {
    if (delta.id !== id || !delta.state || delta.state.current !== "complete") return;
    chrome.downloads.onChanged.removeListener(listener);
    try { chrome.downloads.open(id); } catch {}
    cleanup();
  };
  chrome.downloads.onChanged.addListener(listener);
}

// Minimal XLSX writer: creates a valid OOXML workbook using STORE ZIP entries.
// No external CDN/library is required, so it works in a Manifest V3 extension.
function buildXlsxWorkbook(sheetName, objects) {
  const headers = HEADERS;
  const rows = [headers, ...objects.map(rowToSheetArray)];
  const safeSheet = escapeXml(sheetName.slice(0, 31) || "WorkLog");

  const sheetRows = rows.map((row, r) => {
    const cells = row.map((value, c) => {
      const ref = `${columnName(c + 1)}${r + 1}`;
      const text = String(value ?? "");
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
    }).join("");
    return `<row r="${r + 1}">${cells}</row>`;
  }).join("");

  const files = [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${safeSheet}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`],
    ["xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>${sheetRows}</sheetData>
</worksheet>`]
  ];

  return zipStore(files);
}

function columnName(number) {
  let name = "";
  while (number > 0) {
    const rem = (number - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    number = Math.floor((number - 1) / 26);
  }
  return name;
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
    .replace(/\r/g, "&#13;")
    .replace(/\n/g, "&#10;");
}

function zipStore(entries) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  for (const [name, content] of entries) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x800, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    localParts.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);

    offset += local.length;
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((s, p) => s + p.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralOffset, true);
  ev.setUint16(20, 0, true);

  return [...localParts, ...centralParts, end];
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function openConfirm() {}
