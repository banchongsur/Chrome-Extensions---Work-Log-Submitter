// Work Log Manager V3.3 - background service worker
let workLogWindowId = null;

chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(["settings"]);
  if (!data.settings) {
    await chrome.storage.local.set({
      settings: {
        spreadsheetId: "",
        sheetName: "WorkLog",
        driveFolderId: "",
        folderStructure: "year-month-task",
        maxFilesPerTask: 20
      }
    });
  }
});

async function getWorkLogWindowPlacement() {
  const displays = await chrome.system.display.getInfo();
  const primary = displays.find(display => display.isPrimary) || displays[0];
  const area = primary?.workArea || primary?.bounds;

  // เปิดหน้าต่างไว้ทางขวากึ่งกลางจอ โดยเว้นขอบเล็กน้อย
  const width = Math.min(700, Math.max(560, area.width - 40));
  const height = Math.min(940, Math.max(700, area.height - 40));
  const left = Math.round(area.left + area.width - width - 24);
  const top = Math.round(area.top + Math.max(20, (area.height - height) / 2));

  return { left, top, width, height };
}

async function openWorkLogWindow() {
  try {
    const placement = await getWorkLogWindowPlacement();
    const windows = await chrome.windows.getAll({ populate: true });

    for (const win of windows) {
      const tab = (win.tabs || []).find(tab =>
        tab.url && tab.url === chrome.runtime.getURL("popup.html")
      );
      if (tab) {
        workLogWindowId = win.id;
        await chrome.windows.update(win.id, {
          focused: true,
          left: placement.left,
          top: placement.top,
          width: placement.width,
          height: placement.height
        });
        return;
      }
    }

    const win = await chrome.windows.create({
      url: chrome.runtime.getURL("popup.html"),
      type: "popup",
      left: placement.left,
      top: placement.top,
      width: placement.width,
      height: placement.height,
      focused: true
    });
    workLogWindowId = win.id;
  } catch (error) {
    console.error("เปิดหน้าบันทึกงานไม่สำเร็จ", error);
  }
}

chrome.action.onClicked.addListener(openWorkLogWindow);

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === workLogWindowId) workLogWindowId = null;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "OPEN_WORK_LOG") {
    openWorkLogWindow();
    return true;
  }

  if (message?.type === "CLOSE_WORK_LOG_WINDOW") {
    const windowId = sender?.tab?.windowId || workLogWindowId;
    if (windowId != null) {
      chrome.windows.remove(windowId).catch(() => {});
    }
    return true;
  }

  if (message?.type === "OPEN_DASHBOARD") {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
  }

  if (message?.type === "OPEN_SETTINGS") {
    chrome.runtime.openOptionsPage();
  }
});
