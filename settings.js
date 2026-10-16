document.addEventListener("DOMContentLoaded", async () => {
  const settings = await getSettings();

  document.getElementById("spreadsheetId").value = settings.spreadsheetId || "";
  document.getElementById("sheetName").value = settings.sheetName || "WorkLog";
  document.getElementById("driveFolderId").value = settings.driveFolderId || "";
  document.getElementById("folderStructure").value = settings.folderStructure || "year-month-task";
  document.getElementById("maxFilesPerTask").value = settings.maxFilesPerTask || 20;

  document.getElementById("headerPreview").innerHTML =
    HEADERS.map((h, i) => `<span><b>${String.fromCharCode(65+i)}</b> ${escapeHtml(h)}</span>`).join("");

  document.getElementById("saveBtn").onclick = save;
  document.getElementById("testBtn").onclick = test;
  document.getElementById("connectGoogleBtn").onclick = connectGoogleFromSettings;
  document.getElementById("disconnectGoogleBtn").onclick = disconnectGoogleFromSettings;

  const setupInfo = await getGoogleOAuthSetupInfo();
  const oauthConfig = await chrome.storage.local.get("googleOAuthConfig");
  document.getElementById("clientSecret").value = oauthConfig.googleOAuthConfig?.clientSecret || "";
  document.getElementById("oauthRedirectUri").textContent = setupInfo.redirectUri;
  document.getElementById("copyRedirectBtn").onclick = async () => {
    try {
      await navigator.clipboard.writeText(setupInfo.redirectUri);
      showStatus("คัดลอก Redirect URI แล้ว", "success");
    } catch {
      showStatus("คัดลอกไม่ได้ กรุณาคลุมข้อความแล้ว Copy", "error");
    }
  };

  await refreshOAuthStatus();
});

async function refreshOAuthStatus() {
  const box = document.getElementById("oauthStatus");
  const state = document.getElementById("oauthState");
  const detail = document.getElementById("oauthDetail");
  const connectBtn = document.getElementById("connectGoogleBtn");
  const disconnectBtn = document.getElementById("disconnectGoogleBtn");

  try {
    const status = await getGoogleConnectionStatus();
    if (status.connected) {
      box.className = "oauth-status connected";
      state.textContent = "✅ เชื่อมต่อ Google แล้ว";
      detail.textContent = status.email ? `บัญชี: ${status.email}` : "พร้อมใช้งาน Sheets และ Drive";
      connectBtn.textContent = "🔄 เชื่อมต่อใหม่";
      disconnectBtn.classList.remove("hidden");
    } else {
      box.className = "oauth-status disconnected";
      state.textContent = "ยังไม่ได้เชื่อมต่อ Google";
      detail.textContent = "กดปุ่มเพื่อเข้าสู่ระบบและอนุญาต Sheets + Drive";
      connectBtn.textContent = "🔗 เชื่อมต่อ Google";
      disconnectBtn.classList.add("hidden");
    }
  } catch (error) {
    box.className = "oauth-status disconnected";
    state.textContent = "⚠️ ยังตรวจสอบสถานะไม่ได้";
    detail.textContent = error.message || "ตรวจสอบสถานะ Google ไม่สำเร็จ";
  }
}

async function connectGoogleFromSettings() {
  const button = document.getElementById("connectGoogleBtn");
  button.disabled = true;
  button.textContent = "กำลังเชื่อมต่อ...";
  showStatus("กำลังเปิดหน้า Google Login...", "success");

  try {
    const clientSecret = document.getElementById("clientSecret").value.trim();
    if (!clientSecret) {
      throw new Error("กรุณากรอก Google OAuth Client Secret ก่อนเชื่อมต่อ");
    }
    await saveGoogleClientSecret(clientSecret);
    await connectGoogle();
    await refreshOAuthStatus();
    showStatus("เชื่อมต่อ Google สำเร็จ • ครั้งต่อไปไม่ต้อง Login Chrome", "success");
  } catch (error) {
    console.error(error);
    showStatus(error.message || "เชื่อมต่อ Google ไม่สำเร็จ", "error");
    await refreshOAuthStatus();
  } finally {
    button.disabled = false;
  }
}

async function disconnectGoogleFromSettings() {
  if (!confirm("ต้องการยกเลิกการเชื่อมต่อ Google ของ Extension นี้หรือไม่?")) return;
  try {
    await disconnectGoogle();
    await refreshOAuthStatus();
    showStatus("ยกเลิกการเชื่อมต่อ Google แล้ว", "success");
  } catch (error) {
    showStatus(error.message || "ยกเลิกการเชื่อมต่อไม่สำเร็จ", "error");
  }
}

function showStatus(message, type = "success") {
  const el = document.getElementById("status");
  el.textContent = message;
  el.className = `toast ${type}`;
}

function readForm() {
  return {
    spreadsheetId: parseGoogleId(document.getElementById("spreadsheetId").value),
    sheetName: document.getElementById("sheetName").value.trim() || "WorkLog",
    driveFolderId: parseGoogleId(document.getElementById("driveFolderId").value),
    folderStructure: document.getElementById("folderStructure").value,
    maxFilesPerTask: Math.min(
      100,
      Math.max(1, Number(document.getElementById("maxFilesPerTask").value) || 20)
    )
  };
}

async function save() {
  try {
    const settings = readForm();

    if (!settings.spreadsheetId) throw new Error("กรุณาระบุ Google Spreadsheet ID");
    if (!settings.driveFolderId) throw new Error("กรุณาระบุ Google Drive Folder ID");

    await saveSettings(settings);
    await saveGoogleClientSecret(document.getElementById("clientSecret").value);
    showStatus("บันทึกการตั้งค่าแล้ว กำลังตรวจสอบ Google...", "success");

    const result = await testGoogleConnection(settings);

    if (result.sheetName && result.sheetName !== settings.sheetName) {
      settings.sheetName = result.sheetName;
      await saveSettings(settings);
      document.getElementById("sheetName").value = settings.sheetName;
    }

    const repairText = result.quarterRepair?.updated
      ? ` • ปรับไตรมาสเดิม ${result.quarterRepair.updated} รายการ`
      : "";
    if (result.warning) {
      showStatus(`บันทึกสำเร็จ • ${result.warning}${repairText}`, "success");
    } else if (result.createdHeader) {
      showStatus(`เชื่อมต่อสำเร็จ • สร้างหัวตารางใน ${result.sheetName} แล้ว${repairText}`, "success");
    } else {
      showStatus(`เชื่อมต่อสำเร็จ • ${result.sheetName} พร้อมใช้งาน${repairText}`, "success");
    }

    document.getElementById("spreadsheetId").value = settings.spreadsheetId;
    document.getElementById("driveFolderId").value = settings.driveFolderId;
  } catch (error) {
    console.error(error);
    showStatus(error.message || "ไม่สามารถบันทึกการตั้งค่า", "error");
  }
}

async function test() {
  try {
    const settings = readForm();
    if (!settings.spreadsheetId || !settings.driveFolderId) {
      throw new Error("กรุณากรอก Spreadsheet ID และ Drive Folder ID ก่อน");
    }

    await saveGoogleClientSecret(document.getElementById("clientSecret").value);
    showStatus("กำลังตรวจสอบ...", "success");
    const result = await testGoogleConnection(settings);

    if (result.sheetName && result.sheetName !== settings.sheetName) {
      settings.sheetName = result.sheetName;
      await saveSettings(settings);
      document.getElementById("sheetName").value = settings.sheetName;
    }

    const repairText = result.quarterRepair?.updated
      ? ` • ปรับไตรมาสเดิม ${result.quarterRepair.updated} รายการ`
      : "";
    if (result.warning) {
      showStatus(`เชื่อมต่อได้ • ${result.warning}${repairText}`, "success");
    } else if (result.createdHeader) {
      showStatus(`เชื่อมต่อได้ • ระบบสร้างหัวตารางให้อัตโนมัติแล้ว${repairText}`, "success");
    } else {
      showStatus(`เชื่อมต่อได้ • Sheet: ${result.sheetName} • Drive: ${result.driveFolderName}${repairText}`, "success");
    }
  } catch (error) {
    console.error(error);
    showStatus(error.message || "ตรวจสอบไม่สำเร็จ", "error");
  }
}