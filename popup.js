let selectedFiles = [];
let autoCloseTimer = null;
let userActiveAfterSave = false;

document.addEventListener("DOMContentLoaded", async () => {
  initThaiDatePickers();
  initStatusOptions();
  const today = new Date();
  setThaiDateValue("workDate", today);
  setDefaultTimePeriod();
  setupCustomTime();

  document.getElementById("evidenceFiles").addEventListener("change", onFilesSelected);
  document.getElementById("workLogForm").addEventListener("submit", submitWork);
  document.getElementById("clearBtn").addEventListener("click", clearForm);
  document.getElementById("closeBtn").addEventListener("click", closeWorkLogWindow);

  // ถ้าผู้ใช้กลับมาใช้งานหลังบันทึกสำเร็จ ให้ยกเลิกการปิดอัตโนมัติ
  ["pointerdown", "keydown", "input", "change"].forEach(type => {
    document.addEventListener(type, () => {
      if (autoCloseTimer) {
        userActiveAfterSave = true;
        clearTimeout(autoCloseTimer);
        autoCloseTimer = null;
      }
    }, { passive: true });
  });

  document.getElementById("menuBtn").addEventListener("click", () => {
    document.getElementById("quickMenu").classList.toggle("hidden");
  });

  document.getElementById("timePeriod").addEventListener("change", updateCustomTimeVisibility);
  ["customStartTime", "customEndTime"].forEach(id => {
    document.getElementById(id).addEventListener("input", e => {
      e.target.value = normalizeTimeInput(e.target.value);
    });
  });

  document.getElementById("dashboardBtn").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD" });
  });

  document.getElementById("settingsBtn").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  const settings = await getSettings();
  if (!settings.spreadsheetId || !settings.driveFolderId) {
    showConfigWarning();
  }
});

function initStatusOptions() {
  const select = document.getElementById("status");
  if (!select) return;
  const current = select.value;
  select.innerHTML = STATUS_OPTIONS.map(value =>
    `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`
  ).join("");
  if (STATUS_OPTIONS.includes(current)) select.value = current;
}

function setDefaultTimePeriod() {
  const select = document.getElementById("timePeriod");
  const hour = new Date().getHours();

  if (hour >= 8 && hour < 13) {
    select.value = "08:00 - 12:00";
  } else if (hour >= 13 && hour < 17) {
    select.value = "13:00 - 17:00";
  } else {
    select.value = "ล่วงเวลา (OT)";
  }
}

function setupCustomTime() {
  const now = new Date();
  const start = `${String(now.getHours()).padStart(2, "0")}:00`;
  const endHour = Math.min(now.getHours() + 1, 23);
  const end = `${String(endHour).padStart(2, "0")}:00`;

  document.getElementById("customStartTime").value = start;
  document.getElementById("customEndTime").value = end;
  updateCustomTimeVisibility();
}

function updateCustomTimeVisibility() {
  const isCustom = document.getElementById("timePeriod").value === "กำหนดเอง";
  document.getElementById("customTimeBox").classList.toggle("hidden", !isCustom);
}

function normalizeTimeInput(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function isValid24HourTime(value) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));
}


function getSelectedTimePeriod() {
  const value = document.getElementById("timePeriod").value;
  if (value !== "กำหนดเอง") return value;

  const start = document.getElementById("customStartTime").value;
  const end = document.getElementById("customEndTime").value;
  if (!start || !end) throw new Error("กรุณาระบุเวลาเริ่มและเวลาสิ้นสุด");
  if (!isValid24HourTime(start) || !isValid24HourTime(end)) throw new Error("กรุณาระบุเวลาในรูปแบบ 24 ชั่วโมง HH:mm เช่น 13:00");
  if (start >= end) throw new Error("เวลาสิ้นสุดต้องมากกว่าเวลาเริ่ม");
  return `${start} - ${end}`;
}

function closeWorkLogWindow() {
  chrome.runtime.sendMessage({ type: "CLOSE_WORK_LOG_WINDOW" });
}

function scheduleAutoClose() {
  if (autoCloseTimer) clearTimeout(autoCloseTimer);
  userActiveAfterSave = false;
  autoCloseTimer = setTimeout(() => {
    autoCloseTimer = null;
    if (!userActiveAfterSave) closeWorkLogWindow();
  }, 5000);
}

function showConfigWarning() {
  const el = document.getElementById("configWarning");
  el.innerHTML = `ยังไม่ได้ตั้งค่า Google Sheet / Drive <button id="goSettings">เปิด Settings</button>`;
  el.classList.remove("hidden");
  document.getElementById("goSettings").onclick = () => chrome.runtime.openOptionsPage();
}

async function onFilesSelected(event) {
  const inputFiles = [...event.target.files];
  const settings = await getSettings();
  const max = Number(settings.maxFilesPerTask || 20);
  const merged = [...selectedFiles, ...inputFiles];

  const seen = new Set();
  selectedFiles = merged.filter(file => {
    const key = `${file.name}|${file.size}|${file.lastModified}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, max);

  event.target.value = "";
  renderFileList();
}
function renderFileList() {
  const list = document.getElementById("fileList");
  list.innerHTML = "";

  selectedFiles.forEach((file, index) => {
    const row = document.createElement("div");
    row.className = "file-row";
    row.innerHTML = `
      <div class="file-icon">📄</div>
      <div class="file-meta">
        <strong>${escapeHtml(file.name)}</strong>
        <small>${formatBytes(file.size)}</small>
      </div>
      <button type="button" class="remove-file" data-index="${index}">×</button>
    `;
    list.appendChild(row);
  });

  document.getElementById("fileCount").textContent = `${selectedFiles.length} ไฟล์`;

  list.querySelectorAll(".remove-file").forEach(btn => {
    btn.onclick = () => {
      selectedFiles.splice(Number(btn.dataset.index), 1);
      renderFileList();
    };
  });
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function setLoading(loading) {
  document.getElementById("submitBtn").disabled = loading;
  document.getElementById("clearBtn").disabled = loading;
  document.getElementById("submitText").textContent = loading ? "กำลังบันทึก..." : "💾 บันทึกงาน";
  document.getElementById("spinner").classList.toggle("hidden", !loading);
}

function toast(message, type = "success") {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.className = `toast ${type}`;
  setTimeout(() => el.className = "toast hidden", 5000);
}

function clearForm() {
  document.getElementById("workLogForm").reset();
  selectedFiles = [];
  renderFileList();
  const today = new Date();
  setThaiDateValue("workDate", today);
}

async function submitWork(event) {
  event.preventDefault();
  setLoading(true);

  try {
    const settings = await getSettings();
    if (!settings.spreadsheetId) throw new Error("กรุณาตั้งค่า Google Spreadsheet ID ใน Settings");
    if (!settings.driveFolderId) throw new Error("กรุณาตั้งค่า Google Drive Folder ID ใน Settings");

    const workDateValue = document.getElementById("workDate").value;
    if (!workDateValue) throw new Error("กรุณาระบุวันที่");

    const date = new Date(`${workDateValue}T12:00:00`);
    const workId = makeWorkId(date);
    const { month, year } = getThaiMonthYear(date);
    const timestamp = new Date().toLocaleString("th-TH");
    const category = document.getElementById("category").value.trim();
    const taskName = document.getElementById("taskName").value.trim();
    const details = document.getElementById("details").value.trim();
    const timePeriod = getSelectedTimePeriod();
    const status = document.getElementById("status").value;
    const workUrl = document.getElementById("workUrl").value.trim();

    // Prepare Sheet first. This creates the tab/header automatically if needed.
    const sheetSetup = await ensureWorkLogSheet(
      settings.spreadsheetId,
      settings.sheetName
    );
    const actualSheetName = sheetSetup.actualSheetName || settings.sheetName;

    // Create Drive folder hierarchy.
    let parentForTask = settings.driveFolderId;

    if (settings.folderStructure === "year-month-task" ||
        settings.folderStructure === "year-task") {
      const yearFolder = await getOrCreateDriveFolder(
        String(date.getFullYear()),
        settings.driveFolderId
      );
      parentForTask = yearFolder.id;

      if (settings.folderStructure === "year-month-task") {
        const monthFolder = await getOrCreateDriveFolder(
          `${String(date.getMonth()+1).padStart(2,"0")}-${date.toLocaleString("th-TH",{month:"long"})}`,
          yearFolder.id
        );
        parentForTask = monthFolder.id;
      }
    }

    const taskFolder = await createDriveFolder(
      `${workDateValue}_${sanitizeFileName(taskName).slice(0, 100)}_${workId}`,
      parentForTask
    );

    // Upload evidence files sequentially so the user can trust the progress.
    const uploaded = [];
    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      document.getElementById("submitText").textContent =
        `กำลังอัปโหลด ${i + 1}/${selectedFiles.length}...`;

      const result = await uploadFileToDrive(file, taskFolder.id);
      uploaded.push(result);
    }

    const driveUrl =
      taskFolder.webViewLink ||
      `https://drive.google.com/drive/folders/${taskFolder.id}`;

    const row = [
      workId,
      formatThaiDate(date),
      timePeriod,
      category,
      taskName,
      details,
      status,
      uploaded.length,
      taskFolder.id,
      driveUrl,
      "Google Account",
      timestamp,
      month,
      year,
      getQuarter(date),
      getFiscalYear(date),
      "ACTIVE",
      "",
      parentForTask,
      workUrl
    ];

    await appendSheetValues(
      settings.spreadsheetId,
      `${actualSheetName}!A:T`,
      [row]
    );

    toast(
      sheetSetup.warning
        ? `บันทึกข้อมูลงานเรียบร้อยแล้ว แต่ ${sheetSetup.warning}`
        : `บันทึกข้อมูลงานเรียบร้อยแล้ว • ${uploaded.length} ไฟล์`,
      "success"
    );

    clearForm();
    scheduleAutoClose();
  } catch (error) {
    console.error(error);
    toast(error.message || "เกิดข้อผิดพลาด", "error");
  } finally {
    setLoading(false);
  }
}
