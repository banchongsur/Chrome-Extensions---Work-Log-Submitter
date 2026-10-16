/*
 * Google authentication for Work Log Manager V3.
 *
 * Important:
 * - This version does NOT use chrome.identity.getAuthToken().
 * - It uses chrome.identity.launchWebAuthFlow(), so it does not depend on
 *   the user being signed in to the Chrome browser profile.
 * - First connection obtains an OAuth authorization code with PKCE and stores
 *   the refresh token locally. Access tokens are refreshed automatically.
 *
 * Google OAuth client setup for this flow:
 * - Use an OAuth client that supports the extension redirect URI.
 * - Register the redirect URI shown by getGoogleRedirectUri() in Google Cloud.
 * - The extension ID must remain stable during development/installation.
 */

const GOOGLE_OAUTH = Object.freeze({
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  scopes: [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
  ],
  redirectPath: "oauth2",
  tokenSafetySeconds: 60
});

function getGoogleClientId() {
  const clientId = chrome.runtime.getManifest()?.oauth2?.client_id || "";
  if (!clientId || clientId.includes("YOUR_CLIENT_ID")) {
    throw new Error(
      "ยังไม่ได้ตั้งค่า Google OAuth Client ID ใน manifest.json (oauth2.client_id)\n\n" +
      "สำหรับ Load unpacked ให้สร้าง OAuth Client ประเภท Web application " +
      "และเพิ่ม Authorized redirect URI ที่แสดงใน Settings"
    );
  }
  return clientId;
}

async function getGoogleClientSecret() {
  const data = await chrome.storage.local.get("googleOAuthConfig");
  return String(data.googleOAuthConfig?.clientSecret || "").trim();
}

async function saveGoogleClientSecret(clientSecret) {
  await chrome.storage.local.set({
    googleOAuthConfig: {
      clientSecret: String(clientSecret || "").trim()
    }
  });
}

function getGoogleRedirectUri() {
  // This URI must be registered exactly in the Google Cloud
  // OAuth client of type "Web application".
  return chrome.identity.getRedirectURL(GOOGLE_OAUTH.redirectPath);
}

function randomBase64Url(bytes = 32) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sha256Base64Url(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function getStoredOAuth() {
  const data = await chrome.storage.local.get("googleOAuth");
  return data.googleOAuth || {};
}

async function saveStoredOAuth(oauth) {
  await chrome.storage.local.set({ googleOAuth: oauth });
}

async function clearStoredOAuth() {
  await chrome.storage.local.remove("googleOAuth");
}

async function exchangeAuthorizationCode(code, codeVerifier) {
  const clientSecret = await getGoogleClientSecret();
  if (!clientSecret) {
    throw new Error(
      "Google Client Secret ยังไม่ได้ตั้งค่า\n\n" +
      "ไปที่ Settings > Google Login แล้วกรอก Client Secret จาก Google Cloud"
    );
  }

  const params = new URLSearchParams({
    client_id: getGoogleClientId(),
    code,
    code_verifier: codeVerifier,
    redirect_uri: getGoogleRedirectUri(),
    grant_type: "authorization_code",
    client_secret: clientSecret
  });

  const response = await fetch(GOOGLE_OAUTH.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(
      data.error_description || data.error ||
      `Google OAuth token exchange failed (${response.status})`
    );
  }

  return data;
}

async function refreshAccessToken(refreshToken) {
  const clientSecret = await getGoogleClientSecret();
  if (!clientSecret) {
    throw new Error(
      "Google Client Secret ยังไม่ได้ตั้งค่า\n\n" +
      "ไปที่ Settings > Google Login แล้วกรอก Client Secret จาก Google Cloud"
    );
  }

  const params = new URLSearchParams({
    client_id: getGoogleClientId(),
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    client_secret: clientSecret
  });

  const response = await fetch(GOOGLE_OAUTH.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(
      data.error_description || data.error ||
      `Google OAuth refresh failed (${response.status})`
    );
  }

  const current = await getStoredOAuth();
  await saveStoredOAuth({
    ...current,
    accessToken: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000
  });

  return data.access_token;
}

async function connectGoogle() {
  const clientId = getGoogleClientId();
  const redirectUri = getGoogleRedirectUri();
  const state = randomBase64Url(24);
  const codeVerifier = randomBase64Url(48);
  const codeChallenge = await sha256Base64Url(codeVerifier);

  const authUrl = new URL(GOOGLE_OAUTH.authorizationEndpoint);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", GOOGLE_OAUTH.scopes.join(" "));
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("access_type", "offline");

  const stored = await getStoredOAuth();
  // Only force consent on the first connection. This makes reconnects much
  // less disruptive while still allowing the user to change accounts.
  if (!stored.refreshToken) {
    authUrl.searchParams.set("prompt", "consent");
  }

  let redirectedUrl;
  try {
    redirectedUrl = await chrome.identity.launchWebAuthFlow({
      url: authUrl.toString(),
      interactive: true
    });
  } catch (error) {
    throw new Error(
      `ไม่สามารถเปิดหน้าล็อกอิน Google ได้: ${error?.message || error}`
    );
  }

  if (!redirectedUrl) {
    throw new Error("Google OAuth ไม่ได้ส่งผลลัพธ์กลับมายัง Extension");
  }

  const resultUrl = new URL(redirectedUrl);
  const returnedState = resultUrl.searchParams.get("state");
  const error = resultUrl.searchParams.get("error");
  const errorDescription = resultUrl.searchParams.get("error_description");

  if (error) {
    throw new Error(
      `Google ไม่อนุญาตการเชื่อมต่อ: ${errorDescription || error}`
    );
  }

  if (returnedState !== state) {
    throw new Error("Google OAuth state ไม่ตรงกัน จึงยกเลิกเพื่อความปลอดภัย");
  }

  const code = resultUrl.searchParams.get("code");
  if (!code) throw new Error("Google OAuth ไม่พบ authorization code");

  const token = await exchangeAuthorizationCode(code, codeVerifier);
  const old = await getStoredOAuth();
  const oauth = {
    ...old,
    accessToken: token.access_token,
    expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000,
    refreshToken: token.refresh_token || old.refreshToken || "",
    scope: token.scope || GOOGLE_OAUTH.scopes.join(" "),
    connectedAt: old.connectedAt || new Date().toISOString()
  };

  await saveStoredOAuth(oauth);
  return oauth;
}

async function getOAuthToken(interactive = true) {
  const oauth = await getStoredOAuth();
  const now = Date.now();
  const usableUntil = Number(oauth.expiresAt || 0) -
    GOOGLE_OAUTH.tokenSafetySeconds * 1000;

  if (oauth.accessToken && usableUntil > now) {
    return oauth.accessToken;
  }

  if (oauth.refreshToken) {
    try {
      return await refreshAccessToken(oauth.refreshToken);
    } catch (error) {
      // The refresh token can be revoked/expired. Force a fresh consent only
      // when an interactive operation is allowed.
      await clearStoredOAuth();
      if (!interactive) {
        throw new Error("Google Login หมดอายุหรือถูกยกเลิก กรุณาเชื่อมต่อ Google ใหม่");
      }
    }
  }

  if (!interactive) {
    throw new Error("ยังไม่ได้เชื่อมต่อ Google กรุณาไปที่ Settings > เชื่อมต่อ Google");
  }

  const connected = await connectGoogle();
  if (!connected.accessToken) throw new Error("เชื่อมต่อ Google ไม่สำเร็จ");
  return connected.accessToken;
}

async function disconnectGoogle() {
  const oauth = await getStoredOAuth();
  if (oauth.accessToken) {
    try {
      await fetch(
        `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(oauth.accessToken)}`,
        { method: "POST" }
      );
    } catch {
      // Local credentials are still cleared even if revocation cannot be reached.
    }
  }
  await clearStoredOAuth();
}

async function getGoogleOAuthSetupInfo() {
  return {
    clientId: getGoogleClientId(),
    redirectUri: getGoogleRedirectUri(),
    clientSecretConfigured: Boolean(await getGoogleClientSecret())
  };
}

async function getGoogleConnectionStatus() {
  const oauth = await getStoredOAuth();
  const hasCredentials = Boolean(oauth.accessToken || oauth.refreshToken);
  if (!hasCredentials) return { connected: false };

  try {
    const token = await getOAuthToken(false);
    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) return { connected: false };

    return {
      connected: true,
      expiresAt: Number(oauth.expiresAt || 0),
      scope: oauth.scope || data.scope || "",
      email: data.email || ""
    };
  } catch {
    return { connected: false };
  }
}

async function googleFetch(url, options = {}, interactive = true) {
  let token = await getOAuthToken(interactive);
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${token}`);

  let response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    // Refresh/reconnect once, then retry the exact API request.
    const oauth = await getStoredOAuth();
    if (oauth.refreshToken) {
      try {
        token = await refreshAccessToken(oauth.refreshToken);
        headers.set("Authorization", `Bearer ${token}`);
        response = await fetch(url, { ...options, headers });
      } catch {
        await clearStoredOAuth();
      }
    }
  }

  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.json();
      detail = body?.error?.message || JSON.stringify(body);
    } catch {
      detail = await response.text().catch(() => "");
    }
    throw new Error(`Google API ${response.status}: ${detail || response.statusText}`);
  }

  return response;
}

async function getSpreadsheet(spreadsheetId) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId,properties(title),sheets(properties(sheetId,title,index))`;
  const response = await googleFetch(url);
  return response.json();
}

async function createSheetTab(spreadsheetId, title) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`;
  const response = await googleFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] })
  });
  return response.json();
}

async function getSheetValues(spreadsheetId, range) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`;
  const response = await googleFetch(url);
  return response.json();
}

async function updateSheetValues(spreadsheetId, range, values) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  const response = await googleFetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ range, majorDimension: "ROWS", values })
  });
  return response.json();
}

async function appendSheetValues(spreadsheetId, range, values) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const response = await googleFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ majorDimension: "ROWS", values })
  });
  return response.json();
}

async function batchUpdateSheetValues(spreadsheetId, data) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`;
  const response = await googleFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ valueInputOption: "USER_ENTERED", data })
  });
  return response.json();
}

function parseWorkDate(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  let y, m, d;
  let match = text.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (match) {
    y = Number(match[1]); m = Number(match[2]); d = Number(match[3]);
  } else {
    match = text.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
    if (!match) return null;
    d = Number(match[1]); m = Number(match[2]); y = Number(match[3]);
  }
  if (y > 2400) y -= 543;
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

async function repairFiscalQuarters(spreadsheetId, sheetName) {
  const result = await getSheetValues(spreadsheetId, `${sheetName}!B:P`);
  const rows = result.values || [];
  if (rows.length <= 1) return { checked: 0, updated: 0 };
  const updates = [];
  const monthYear = date => getThaiMonthYear(date).year;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const date = parseWorkDate(row[0]);
    if (!date) continue;
    const expectedYear = monthYear(date);
    const expectedQuarter = getQuarter(date);
    const expectedFiscal = getFiscalYear(date);
    if (String(row[12] ?? "").trim() !== expectedYear) updates.push({ range: `${sheetName}!N${i + 1}`, values: [[expectedYear]] });
    if (String(row[13] ?? "").trim() !== expectedQuarter) updates.push({ range: `${sheetName}!O${i + 1}`, values: [[expectedQuarter]] });
    if (String(row[14] ?? "").trim() !== expectedFiscal) updates.push({ range: `${sheetName}!P${i + 1}`, values: [[expectedFiscal]] });
  }
  if (updates.length) await batchUpdateSheetValues(spreadsheetId, updates);
  return { checked: rows.length - 1, updated: updates.length };
}

async function ensureWorkLogSheet(spreadsheetId, sheetName) {
  const spreadsheet = await getSpreadsheet(spreadsheetId);
  let sheet = spreadsheet.sheets?.find(s => s.properties?.title === sheetName);

  if (!sheet) {
    await createSheetTab(spreadsheetId, sheetName);
    const refreshed = await getSpreadsheet(spreadsheetId);
    sheet = refreshed.sheets?.find(s => s.properties?.title === sheetName);
  }

  if (!sheet) throw new Error(`ไม่สามารถสร้างแท็บ ${sheetName} ได้`);

  const valuesResult = await getSheetValues(spreadsheetId, `${sheetName}!A:T`);
  const rows = Array.isArray(valuesResult.values) ? valuesResult.values : [];
  const firstRow = rows[0] || [];

  if (firstRow.length === 0) {
    await updateSheetValues(spreadsheetId, `${sheetName}!A1:T1`, [HEADERS]);
    return { createdHeader: true, sheet, actualSheetName: sheetName };
  }

  if (!isLikelyHeaderRow(firstRow)) {
    const safeBase = `${sheetName}_WorkLog`;
    let candidate = safeBase;
    let index = 2;
    while (spreadsheet.sheets?.some(s => s.properties?.title === candidate)) {
      candidate = `${safeBase}_${index++}`;
    }

    await createSheetTab(spreadsheetId, candidate);
    await updateSheetValues(spreadsheetId, `${candidate}!A1:T1`, [HEADERS]);

    const refreshed = await getSpreadsheet(spreadsheetId);
    const newSheet = refreshed.sheets?.find(s => s.properties?.title === candidate);
    return {
      createdHeader: true,
      createdNewTab: true,
      sheet: newSheet,
      actualSheetName: candidate,
      warning: `แท็บ ${sheetName} มีข้อมูล/หัวตารางไม่ตรง จึงสร้างแท็บใหม่ชื่อ ${candidate} เพื่อป้องกันข้อมูลเดิม`
    };
  }

  const headerIndexMap = getHeaderIndexMap(firstRow);
  const canonicalHeader = HEADERS.join("\u0001");
  const currentHeader = HEADERS.map((_, i) => String(firstRow[i] ?? "").trim()).join("\u0001");
  const alreadyCanonical = currentHeader === canonicalHeader;

  if (!alreadyCanonical) {
    // Reorder the existing A:T data by header name instead of position. This
    // handles both the original V3.7 A:O layout and the previous V3.8 layout.
    const normalizedRows = [HEADERS];
    for (let i = 1; i < rows.length; i++) {
      const source = rows[i] || [];
      const normalized = normalizeSheetRowByHeaders(source, headerIndexMap);
      const date = parseWorkDate(normalized[1]);
      if (date) {
        normalized[1] = formatThaiDate(date);
        if (!String(normalized[15] ?? "").trim()) normalized[15] = getFiscalYear(date);
      }
      if (!String(normalized[16] ?? "").trim()) normalized[16] = "ACTIVE";
      normalizedRows.push(normalized);
    }
    await updateSheetValues(spreadsheetId, `${sheetName}!A1:T${Math.max(normalizedRows.length, 1)}`, normalizedRows);
    return {
      createdHeader: false,
      sheet,
      actualSheetName: sheetName,
      migratedHeaders: true,
      migratedRowCount: Math.max(0, normalizedRows.length - 1)
    };
  }

  // Header already uses the canonical order. Backfill management fields for
  // older rows without rewriting the whole sheet.
  const updates = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const date = parseWorkDate(row[1]);
    if (!date) continue;
    if (String(row[1] ?? "").trim() !== formatThaiDate(date)) updates.push({ range: `${sheetName}!B${i + 1}`, values: [[formatThaiDate(date)]] });
    if (!String(row[15] ?? "").trim()) updates.push({ range: `${sheetName}!P${i + 1}`, values: [[getFiscalYear(date)]] });
    if (!String(row[16] ?? "").trim()) updates.push({ range: `${sheetName}!Q${i + 1}`, values: [["ACTIVE"]] });
    if (!String(row[14] ?? "").trim()) updates.push({ range: `${sheetName}!O${i + 1}`, values: [[getQuarter(date)]] });
  }
  if (updates.length) await batchUpdateSheetValues(spreadsheetId, updates);

  return { createdHeader: false, sheet, actualSheetName: sheetName, migratedHeaders: false };
}

async function getDriveFile(fileId, fields = "id,name,mimeType,webViewLink,parents") {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(fields)}`;
  const response = await googleFetch(url);
  return response.json();
}

async function createDriveFolder(name, parentId) {
  const metadata = { name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] };
  const response = await googleFetch(
    "https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType,webViewLink,parents",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(metadata)
    }
  );
  return response.json();
}

async function findDriveFolder(name, parentId) {
  const q = [
    "trashed = false",
    "mimeType = 'application/vnd.google-apps.folder'",
    `name = '${String(name).replaceAll("'", "\\'")}'`,
    `'${parentId}' in parents`
  ].join(" and ");

  const url = `https://www.googleapis.com/drive/v3/files?${new URLSearchParams({
    q,
    fields: "files(id,name,mimeType,webViewLink,parents)",
    pageSize: "10"
  })}`;
  const response = await googleFetch(url);
  const data = await response.json();
  return data.files?.[0] || null;
}

async function getOrCreateDriveFolder(name, parentId) {
  const existing = await findDriveFolder(name, parentId);
  if (existing) return existing;
  return createDriveFolder(name, parentId);
}

async function uploadFileToDrive(file, parentId) {
  const token = await getOAuthToken(true);
  const metadata = { name: file.name, parents: [parentId] };
  const boundary = `-------worklog-${crypto.randomUUID()}`;
  const delimiter = `--${boundary}`;
  const closeDelimiter = `--${boundary}--`;

  const body = new Blob([
    delimiter + "\r\n",
    "Content-Type: application/json; charset=UTF-8\r\n\r\n",
    JSON.stringify(metadata) + "\r\n",
    delimiter + "\r\n",
    `Content-Type: ${file.type || "application/octet-stream"}\r\n\r\n`,
    file,
    "\r\n",
    closeDelimiter
  ]);

  let response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink,parents",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`
      },
      body
    }
  );

  if (response.status === 401) {
    const oauth = await getStoredOAuth();
    if (oauth.refreshToken) {
      try {
        const newToken = await refreshAccessToken(oauth.refreshToken);
        response = await fetch(
          "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink,parents",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${newToken}`,
              "Content-Type": `multipart/related; boundary=${boundary}`
            },
            body
          }
        );
      } catch {
        await clearStoredOAuth();
      }
    }
  }

  if (!response.ok) {
    let detail = "";
    try {
      const bodyJson = await response.json();
      detail = bodyJson?.error?.message || JSON.stringify(bodyJson);
    } catch {
      detail = await response.text().catch(() => "");
    }
    throw new Error(`Drive Upload ${response.status}: ${detail || response.statusText}`);
  }

  return response.json();
}


async function listDriveChildren(folderId) {
  const files = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken,files(id,name,mimeType,size,webViewLink,parents,createdTime,modifiedTime)",
      pageSize: "1000",
      orderBy: "name"
    });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await googleFetch(
      `https://www.googleapis.com/drive/v3/files?${params.toString()}`
    );
    const data = await response.json();
    files.push(...(data.files || []));
    pageToken = data.nextPageToken || "";
  } while (pageToken);
  return files;
}

async function updateDriveFile(fileId, metadata = {}) {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,webViewLink,parents`;
  const response = await googleFetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(metadata)
  });
  return response.json();
}

async function moveDriveFileToFolder(fileId, newParentId, oldParentIds = []) {
  const params = new URLSearchParams({
    addParents: newParentId,
    removeParents: oldParentIds.join(",")
  });
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${params.toString()}`;
  const response = await googleFetch(url, { method: "PATCH" });
  return response.json();
}

async function archiveDriveFile(fileId, currentParents, archiveFolderId) {
  return moveDriveFileToFolder(fileId, archiveFolderId, currentParents || []);
}

async function trashDriveFile(fileId) {
  return updateDriveFile(fileId, { trashed: true });
}

async function getOrCreateArchiveFolder(rootFolderId) {
  return getOrCreateDriveFolder("_ARCHIVE", rootFolderId);
}

async function getDriveTaskFiles(taskFolderId) {
  return listDriveChildren(taskFolderId);
}

async function getDriveParentIds(fileId) {
  const file = await getDriveFile(fileId, "id,name,mimeType,parents,webViewLink");
  return file.parents || [];
}

async function updateWorkLogRow(spreadsheetId, sheetName, rowNumber, rowValues) {
  return updateSheetValues(
    spreadsheetId,
    `${sheetName}!A${rowNumber}:T${rowNumber}`,
    [rowValues]
  );
}

async function testGoogleConnection(settings) {
  if (!settings.spreadsheetId) throw new Error("ยังไม่ได้ระบุ Google Spreadsheet ID");
  if (!settings.driveFolderId) throw new Error("ยังไม่ได้ระบุ Google Drive Folder ID");

  const spreadsheet = await getSpreadsheet(settings.spreadsheetId);
  const driveFolder = await getDriveFile(settings.driveFolderId);

  if (driveFolder.mimeType !== "application/vnd.google-apps.folder") {
    throw new Error("Drive ID ที่ระบุไม่ใช่โฟลเดอร์");
  }

  const sheetResult = await ensureWorkLogSheet(settings.spreadsheetId, settings.sheetName);
  const actualSheetName = sheetResult.actualSheetName || settings.sheetName;
  const quarterRepair = await repairFiscalQuarters(settings.spreadsheetId, actualSheetName);
  return {
    spreadsheetTitle: spreadsheet.properties?.title || "",
    driveFolderName: driveFolder.name || "",
    sheetName: actualSheetName,
    createdHeader: sheetResult.createdHeader,
    createdNewTab: sheetResult.createdNewTab || false,
    warning: sheetResult.warning || "",
    quarterRepair
  };
}
