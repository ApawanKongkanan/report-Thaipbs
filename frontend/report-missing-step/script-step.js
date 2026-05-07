const API_URL = "http://localhost:3000/api/missing-persons";
let postcodeData = [];

fetch("../data/postcode.json")
  .then(res => res.json())
  .then(data => { postcodeData = data; })
  .catch(err => console.error("โหลด postcode ไม่ได้", err));

let currentStep = 1;
const totalSteps = 5;

function showStep(step) {
  document.querySelectorAll(".step").forEach(s => s.classList.remove("active"));
  document.querySelector(`.step[data-step="${step}"]`)?.classList.add("active");
  document.getElementById("stepNumber").innerText = step;
  document.getElementById("prevBtn").style.visibility = step === 1 ? "hidden" : "visible";

  const nextBtn = document.getElementById("nextBtn");
  if (step === totalSteps) {
    nextBtn.innerText = "ส่งข้อมูล";
    nextBtn.classList.remove("btn-primary");
    nextBtn.classList.add("btn-success");
    generateSummary();
  } else {
    nextBtn.innerText = "ถัดไป";
    nextBtn.classList.remove("btn-success");
    nextBtn.classList.add("btn-primary");
  }

  const progressPercent = Math.round(((step - 1) / (totalSteps - 1)) * 100);
  const progressBar = document.getElementById("progressBar");
  progressBar.style.width = progressPercent + "%";
  progressBar.innerText = progressPercent + "%";
}

function validateCurrentStep() {
  const currentSection = document.querySelector(`.step[data-step="${currentStep}"]`);
  const inputs = currentSection.querySelectorAll("input, select, textarea");
  let isValid = true;

  inputs.forEach(input => {
    if (input.type === "file") return;
    if (input.name === "owner_phone" && !/^[0-9]{10}$/.test(input.value.trim())) {
      input.classList.add("is-invalid");
      isValid = false;
      return;
    }
    if (!input.checkValidity()) {
      input.classList.add("is-invalid");
      isValid = false;
    } else {
      input.classList.remove("is-invalid");
    }
  });

  if (!isValid) {
    const firstInvalid = currentSection.querySelector(":invalid");
    if (firstInvalid) firstInvalid.reportValidity();
  }
  return isValid;
}

async function nextStep() {
  if (!validateCurrentStep()) return;
  if (currentStep < totalSteps) {
    currentStep++;
    showStep(currentStep);
    return;
  }

  const confirmCheck = document.getElementById("confirmCheck");
  if (!confirmCheck.checked) {
    confirmCheck.reportValidity();
    return;
  }

  const form = document.getElementById("reportForm");
  const formData = new FormData(form);

  if (formData.get("relation_to_missing") === "other") {
    formData.set("relation_to_missing", formData.get("other_relationship") || "อื่น ๆ");
  }
  if (formData.get("inform_channels") === "other") {
    formData.set("inform_channels", formData.get("other_contact_channel") || "อื่น ๆ");
  }
  if (formData.get("hair_color") === "other") {
    formData.set("hair_color", formData.get("other_hair_color") || "อื่น ๆ");
  }
  if (!formData.get("police_station_province")) {
    formData.set("police_station_province", formData.get("province") || "");
  }

  const localCaseId = Date.now();
  const localCase = {
    case_id: localCaseId,
    owner_title: formData.get("owner_title"),
    owner_name: formData.get("owner_name"),
    owner_phone: formData.get("owner_phone"),
    relation_to_missing: formData.get("relation_to_missing"),
    inform_channels: formData.get("inform_channels"),
    missing_reason: formData.get("missing_reason"),
    priority: formData.get("priority"),
    missing_title: formData.get("missing_title"),
    missing_name: formData.get("missing_name"),
    gender: formData.get("gender"),
    birthday: formData.get("birthday"),
    age: formData.get("age"),
    race: formData.get("race"),
    id_type: formData.get("id_type"),
    id_number: formData.get("id_number"),
    missing_date: formData.get("missing_date"),
    missing_time: formData.get("missing_time"),
    missing_place: formData.get("missing_place"),
    postal_code: formData.get("postal_code"),
    subdistrict: formData.get("subdistrict"),
    district: formData.get("district"),
    province: formData.get("province"),
    skin_color: formData.get("skin_color"),
    body_shape: formData.get("body_shape"),
    hair_styles: formData.get("hair_styles"),
    hair_color: formData.get("hair_color"),
    height_cm: formData.get("height_cm"),
    police_station_name: formData.get("police_station_name"),
    police_station_province: formData.get("police_station_province"),
    ps_phone: formData.get("ps_phone"),
    latest_status: "รับเคส(บันทึกข้อมูลในระบบ)",
    created_at: new Date().toISOString()
  };

  let redirectId = localCaseId;

  try {
    const response = await fetch(API_URL, { method: "POST", body: formData });
    const result = await response.json();
    if (!response.ok) throw new Error("API error");
    redirectId = result?.data?.case_id || result?.case_id || localCaseId;
    alert("✅ ส่งข้อมูลเรียบร้อย");
  } catch (error) {
    const cases = getStoredCases();
    cases.push(localCase);
    saveStoredCases(cases);
    alert("✅ ส่งข้อมูลเรียบร้อย (บันทึกแบบ local)");
  }

  localStorage.setItem("isAdminLogin", "true");
  window.location.href = `../admin-case-detail.html?id=${redirectId}`;
}

function prevStep() {
  if (currentStep > 1) {
    currentStep--;
    showStep(currentStep);
  }
}

function generateSummary() {
  const data = new FormData(document.getElementById("reportForm"));
  const get = (name) => data.get(name) || "-";
  const relationshipText = get("relation_to_missing") === "other" ? get("other_relationship") : get("relation_to_missing");
  const contactChannelText = get("inform_channels") === "other" ? get("other_contact_channel") : get("inform_channels");
  const hairColorText = get("hair_color") === "other" ? get("other_hair_color") : get("hair_color");
  const image = data.get("image_url");
  const notice = data.get("notice");

  document.getElementById("summaryBox").innerHTML = `
    <div class="container bg-white p-3 rounded shadow-sm" style="max-width:900px">
      <h5 class="text-center mb-3">📄 สรุปข้อมูล</h5>
      <div class="row g-3">
        <div class="col-md-6">
          <div class="border rounded p-2 mb-2"><b>📌 การแจ้ง</b><div>หัวข้อ: ${get("missing_reason")}</div><div>ความเร่งด่วน: ${get("priority")}</div></div>
          <div class="border rounded p-2 mb-2"><b>👤 ผู้แจ้ง</b><div>${get("owner_title")} ${get("owner_name")}</div><div>ความสัมพันธ์: ${relationshipText}</div><div>โทร: ${get("owner_phone")}</div><div>ติดต่อผ่าน: ${contactChannelText}</div></div>
          <div class="border rounded p-2 mb-2"><b>📍 สถานที่หาย</b><div>วันที่: ${get("missing_date")}</div><div>เวลา: ${get("missing_time")}</div><div>สถานที่: ${get("missing_place")}</div><div>${get("subdistrict")} ${get("district")} ${get("province")} ${get("postal_code")}</div></div>
        </div>
        <div class="col-md-6">
          <div class="border rounded p-2 mb-2"><b>🧍 ผู้สูญหาย</b><div>${get("missing_title")} ${get("missing_name")}</div><div>เพศ: ${get("gender")}</div><div>เกิด: ${get("birthday")}</div><div>อายุ: ${get("age")}</div><div>สัญชาติ: ${get("race")}</div><div>${get("id_type")} : ${get("id_number")}</div></div>
          <div class="border rounded p-2 mb-2"><b>🧾 ลักษณะ</b><div>ผิว: ${get("skin_color")}</div><div>รูปร่าง: ${get("body_shape")}</div><div>ผม: ${get("hair_styles")} (${hairColorText})</div><div>สูง: ${get("height_cm")} cm</div></div>
          <div class="border rounded p-2 mb-2"><b>🚓 สถานีตำรวจ</b><div>${get("police_station_name")}</div><div>จังหวัด: ${get("province")}</div><div>เบอร์โทร: ${get("ps_phone")}</div><div>ใบแจ้งความ: ${notice && notice.size > 0 ? notice.name : "-"}</div></div>
        </div>
      </div>
      <div class="text-center mt-3"><b>รูปผู้สูญหาย</b><br>${image && image.size > 0 ? `<img src="${URL.createObjectURL(image)}" style="max-width:150px;border-radius:8px;margin-top:8px;">` : `<div>- ไม่มีรูป -</div>`}</div>
    </div>`;
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("nextBtn")?.addEventListener("click", nextStep);
  document.getElementById("prevBtn")?.addEventListener("click", prevStep);
  document.getElementById("pdfBtn")?.addEventListener("click", () => window.print());

  document.querySelectorAll(".postcode[name='postal_code']").forEach(postcodeInput => {
    postcodeInput.addEventListener("input", () => {
      const container = postcodeInput.closest(".row");
      const subdistrictInput = container?.querySelector(".subdistrict");
      const districtInput = container?.querySelector(".district");
      const provinceInput = container?.querySelector(".province");
      const code = postcodeInput.value.trim();
      if (!subdistrictInput || !districtInput || !provinceInput) return;
      if (code.length !== 5 || postcodeData.length === 0) {
        subdistrictInput.value = "";
        districtInput.value = "";
        provinceInput.value = "";
        return;
      }
      const match = postcodeData.find(item => String(item.zipcode).trim() === code);
      subdistrictInput.value = match?.subdistrict || "";
      districtInput.value = match?.district || "";
      provinceInput.value = match?.province || "";
    });
  });

  const relationshipSelect = document.getElementById("relationship");
  const otherBox = document.getElementById("otherRelationshipBox");
  const otherInput = document.getElementById("otherRelationship");
  relationshipSelect?.addEventListener("change", () => {
    const show = relationshipSelect.value === "other";
    otherBox.style.display = show ? "block" : "none";
    show ? otherInput.setAttribute("required", "true") : otherInput.removeAttribute("required");
    if (!show) otherInput.value = "";
  });

  const contactChannelSelect = document.getElementById("contactChannel");
  const otherContactBox = document.getElementById("otherContactChannelBox");
  const otherContactInput = document.getElementById("otherContactChannel");
  contactChannelSelect?.addEventListener("change", () => {
    const show = contactChannelSelect.value === "other";
    otherContactBox.style.display = show ? "block" : "none";
    show ? otherContactInput.setAttribute("required", "true") : otherContactInput.removeAttribute("required");
    if (!show) otherContactInput.value = "";
  });

  const hairColorSelect = document.getElementById("hairColor");
  const otherHairBox = document.getElementById("otherHairColorBox");
  const otherHairInput = document.getElementById("otherHairColor");
  hairColorSelect?.addEventListener("change", () => {
    const show = hairColorSelect.value === "other";
    otherHairBox.style.display = show ? "block" : "none";
    show ? otherHairInput.setAttribute("required", "true") : otherHairInput.removeAttribute("required");
    if (!show) otherHairInput.value = "";
  });

  showStep(currentStep);
});
