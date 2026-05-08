const APP_API = "http://localhost:3000/api/missing-persons";

const CASE_STATUS_FLOW = [
  "รับเคส(บันทึกข้อมูลในระบบ)",
  "กำลังตรวจสอบข้อมูล",
  "รอเอกสารเพิ่มเติม",
  "เอกสารครบ",
  "รอประชาสัมพันธ์",
  "รอติดตามผล",
  "ได้รับแจ้งเบาะแสใหม่",
  "พบตัวบุคคลแล้ว",
  "ยกเลิก",
  "เสียชีวิตแล้ว"
];

function getStoredCases() {
  return JSON.parse(localStorage.getItem("cases") || "[]");
}

function saveStoredCases(cases) {
  localStorage.setItem("cases", JSON.stringify(cases));
}

function getStoredTips() {
  return JSON.parse(localStorage.getItem("tips") || "[]");
}

function saveStoredTips(tips) {
  localStorage.setItem("tips", JSON.stringify(tips));
}

function getCaseId(item) {
  return item?.case_id ?? item?.id ?? "";
}

function getCaseImageUrl(item) {
  const raw =
    item?.image_url ||
    item?.image ||
    item?.photo ||
    item?.missing_image ||
    item?.image_path ||
    "";

  if (!raw) return "";

  if (raw.startsWith("data:image") || raw.startsWith("blob:") || raw.startsWith("http://") || raw.startsWith("https://")) {
    return raw;
  }

  if (raw.startsWith("/")) {
    return `http://localhost:3000${raw}`;
  }

  return `http://localhost:3000/${raw}`;
}

function normalizeStatus(status) {
  if (!status) return CASE_STATUS_FLOW[0];
  return status;
}

function getStatusMeta(status) {
  const value = normalizeStatus(status);
  const progressMap = {
    "รับเคส(บันทึกข้อมูลในระบบ)": 15,
    "กำลังตรวจสอบข้อมูล": 30,
    "รอเอกสารเพิ่มเติม": 45,
    "เอกสารครบ": 55,
    "รอประชาสัมพันธ์": 70,
    "รอติดตามผล": 80,
    "ได้รับแจ้งเบาะแสใหม่": 90,
    "พบตัวบุคคลแล้ว": 100,
    "ยกเลิก": 100,
    "เสียชีวิตแล้ว": 100
  };

  const badgeClassMap = {
    "รับเคส(บันทึกข้อมูลในระบบ)": "status-waiting",
    "กำลังตรวจสอบข้อมูล": "status-progress",
    "รอเอกสารเพิ่มเติม": "status-progress",
    "เอกสารครบ": "status-progress",
    "รอประชาสัมพันธ์": "status-progress",
    "รอติดตามผล": "status-progress",
    "ได้รับแจ้งเบาะแสใหม่": "status-progress",
    "พบตัวบุคคลแล้ว": "status-found",
    "ยกเลิก": "status-cancel",
    "เสียชีวิตแล้ว": "status-danger"
  };

  const progressClassMap = {
    "รับเคส(บันทึกข้อมูลในระบบ)": "bg-warning",
    "กำลังตรวจสอบข้อมูล": "bg-info",
    "รอเอกสารเพิ่มเติม": "bg-info",
    "เอกสารครบ": "bg-info",
    "รอประชาสัมพันธ์": "bg-primary",
    "รอติดตามผล": "bg-primary",
    "ได้รับแจ้งเบาะแสใหม่": "bg-primary",
    "พบตัวบุคคลแล้ว": "bg-success",
    "ยกเลิก": "bg-secondary",
    "เสียชีวิตแล้ว": "bg-danger"
  };

  return {
    value,
    progress: progressMap[value] || 15,
    badgeClass: badgeClassMap[value] || "status-default",
    progressClass: progressClassMap[value] || "bg-secondary"
  };
}

function isAdminLogin() {
  return localStorage.getItem("isAdminLogin") === "true";
}

function isFamilyLogin() {
  return localStorage.getItem("isFamilyLogin") === "true";
}

function clearFamilyAuth() {
  localStorage.removeItem("isFamilyLogin");
  localStorage.removeItem("familyCaseId");
  localStorage.removeItem("familyOwnerPhone");
}

function clearAdminAuth() {
  localStorage.removeItem("isAdminLogin");
  localStorage.removeItem("adminUsername");
}

function logoutAll(basePath = "") {
  clearAdminAuth();
  clearFamilyAuth();
  window.location.href = `${basePath}Homepage.html`;
}

function guardAdmin(basePath = "") {
  if (!isAdminLogin()) {
    window.location.href = `${basePath}login.html`;
  }
}

function renderNavbar({ mountId = "appNavbar", basePath = "", active = "" } = {}) {
  const mount = document.getElementById(mountId);
  if (!mount) return;

  const admin = isAdminLogin();
  const family = isFamilyLogin();

  let menu = `
    <li class="nav-item"><a class="nav-link ${active === "home" ? "active" : ""}" href="${basePath}Homepage.html">หน้าหลัก</a></li>
  `;

  if (family) {
    menu += `
      <li class="nav-item"><a class="nav-link ${active === "track" ? "active" : ""}" href="${basePath}track-case.html">ติดตามเคส</a></li>
    `;
  } else {
    menu += `
      <li class="nav-item"><a class="nav-link ${active === "report" ? "active" : ""}" href="${basePath}report-missing-step/report-missing-step.html">แจ้งคนหาย</a></li>
      <li class="nav-item"><a class="nav-link ${active === "tip" ? "active" : ""}" href="${basePath}tip-form.html">แจ้งเบาะแส</a></li>
      <li class="nav-item"><a class="nav-link ${active === "track" ? "active" : ""}" href="${basePath}track-case.html">ติดตามเคส</a></li>
      <li class="nav-item"><a class="nav-link ${active === "admin" ? "active" : ""}" href="${basePath}admin.html">สำหรับเจ้าหน้าที่</a></li>
    `;
    if (admin) {
      menu += `<li class="nav-item"><a class="nav-link ${active === "dashboard" ? "active" : ""}" href="${basePath}dashboard.html">สรุปภาพรวม</a></li>`;
    }
  }

  let authBtn = `<a href="${basePath}login.html" class="btn btn-outline-light rounded-pill"><i class="fa-solid fa-user"></i> เข้าสู่ระบบ</a>`;
  if (admin) {
    authBtn = `<button class="btn btn-outline-danger rounded-pill" onclick="logoutAll('${basePath}')">ออกจากระบบ</button>`;
  } else if (family) {
    authBtn = `<button class="btn btn-outline-light rounded-pill" onclick="logoutAll('${basePath}')">ออกจากระบบผู้ติดตาม</button>`;
  }

  mount.innerHTML = `
  <nav class="navbar navbar-expand-lg navbar-dark" style="background:#0b2c4d;">
    <div class="container-fluid">
      <a class="navbar-brand d-flex align-items-center gap-2" href="${basePath}Homepage.html">
        <img src="${basePath}LOGO ThaiPBS.png" height="40" alt="logo">
        <span class="fw-bold">ศูนย์ข้อมูลคนหาย</span>
      </a>
      <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#mainMenu">
        <span class="navbar-toggler-icon"></span>
      </button>
      <div class="collapse navbar-collapse justify-content-end" id="mainMenu">
        <ul class="navbar-nav align-items-lg-center gap-2">
          ${menu}
          <li class="nav-item ms-lg-3">${authBtn}</li>
        </ul>
      </div>
    </div>
  </nav>`;
}

async function fetchCaseList() {
  try {
    const res = await fetch(APP_API);
    const json = await res.json();
    return Array.isArray(json) ? json : (json.data || []);
  } catch {
    return getStoredCases();
  }
}

async function fetchCaseById(caseId) {
  try {
    const res = await fetch(`${APP_API}/${caseId}`);
    const json = await res.json();
    return json.data || json;
  } catch {
    return getStoredCases().find(item => String(getCaseId(item)) === String(caseId));
  }
}

async function updateCaseById(caseId, payload) {
  try {
    const res = await fetch(`${APP_API}/${caseId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch {
    const cases = getStoredCases();
    const index = cases.findIndex(item => String(getCaseId(item)) === String(caseId));
    if (index >= 0) {
      cases[index] = { ...cases[index], ...payload };
      saveStoredCases(cases);
    }
    return { success: true };
  }
}
