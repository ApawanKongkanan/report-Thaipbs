const API_URL = "http://localhost:3000/api/missing-persons";

/*************************
 * LOAD POSTCODE DATA
 *************************/
let postcodeData = [];

fetch("../data/postcode.json")
  .then(res => res.json())
  .then(data => {
    postcodeData = data;
    console.log("📦 postcode loaded:", postcodeData.length);
  })
  .catch(err => {
    console.error("❌ โหลด postcode ไม่ได้", err);
  });

/*************************
 * STEP CONTROL
 *************************/
let currentStep = 1;
const totalSteps = 5;

function showStep(step) {
  document.querySelectorAll(".step").forEach(s => s.classList.remove("active"));

  const targetStep = document.querySelector(`.step[data-step="${step}"]`);
  if (targetStep) {
    targetStep.classList.add("active");
  }

  document.getElementById("stepNumber").innerText = step;

  const nextBtn = document.getElementById("nextBtn");
  const prevBtn = document.getElementById("prevBtn");

  if (step === 1) {
    prevBtn.style.visibility = "hidden";
  } else {
    prevBtn.style.visibility = "visible";
  }

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

  if (progressBar) {
    progressBar.style.width = progressPercent + "%";
    progressBar.innerText = progressPercent + "%";
  }
}

async function nextStep() {
  const currentSection = document.querySelector(`.step[data-step="${currentStep}"]`);
  const inputs = currentSection.querySelectorAll("input, select, textarea");

  let isValid = true;

  inputs.forEach(input => {
    if (input.type === "file") return;

    if (input.name === "owner_phone") {
      const phoneRegex = /^[0-9]{10}$/;
      if (!phoneRegex.test(input.value.trim())) {
        input.classList.add("is-invalid");
        isValid = false;
        return;
      }
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
    return;
  }

  if (currentStep < totalSteps) {
    currentStep++;
    showStep(currentStep);
    return;
  }

  const confirmCheck = document.getElementById("confirmCheck");

  if (!confirmCheck.checked) {
    confirmCheck.classList.add("is-invalid");
    confirmCheck.reportValidity();
    return;
  }

  confirmCheck.classList.remove("is-invalid");

  const form = document.getElementById("reportForm");
  const formData = new FormData(form);

  // ===== แปลงค่า other =====
  if (formData.get("relation_to_missing") === "other") {
    formData.set("relation_to_missing", formData.get("other_relationship") || "อื่น ๆ");
  }

  if (formData.get("inform_channels") === "other") {
    formData.set("inform_channels", formData.get("other_contact_channel") || "อื่น ๆ");
  }

  if (formData.get("hair_color") === "other") {
    formData.set("hair_color", formData.get("other_hair_color") || "อื่น ๆ");
  }

  formData.set("role", "user");

  if (!formData.get("police_station_province")) {
    formData.set("police_station_province", formData.get("province") || "");
  }

  // =========================
  // 🔥 ใช้ API + fallback
  // =========================
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      body: formData
    });

    const result = await response.json();

    if (response.ok) {
      alert("✅ ส่งข้อมูลเรียบร้อย (ใช้ API)");

      window.location.href = "../admin.html";
      return;
    }

    throw new Error("API error");

  } catch (error) {

    console.warn("⚠️ API ใช้ไม่ได้ → ใช้ localStorage แทน");

    // =========================
    // 🔥 fallback localStorage
    // =========================
    let cases = JSON.parse(localStorage.getItem("cases")) || [];

    const newCase = {
      id: Date.now(),
      name: formData.get("missing_name"),
      reason: formData.get("missing_reason"),
      priority: formData.get("priority"),
      createdAt: Date.now()
    };

    cases.push(newCase);

    localStorage.setItem("cases", JSON.stringify(cases));

    alert("✅ บันทึกข้อมูลเรียบร้อย (offline mode)");

    window.location.href = "../admin.html";
  }
}

function prevStep() {
  if (currentStep > 1) {
    currentStep--;
    showStep(currentStep);
  }
}

function generateSummary() {
  const form = document.getElementById("reportForm");
  const data = new FormData(form);

  const get = (name) => data.get(name) || "-";

  const relationshipText =
    get("relation_to_missing") === "other"
      ? get("other_relationship")
      : get("relation_to_missing");

  const contactChannelText =
    get("inform_channels") === "other"
      ? get("other_contact_channel")
      : get("inform_channels");

  const hairColorText =
    get("hair_color") === "other"
      ? get("other_hair_color")
      : get("hair_color");

  const image = data.get("image_url");
  const notice = data.get("notice");

  let html = `
  <div class="container bg-white p-3 rounded shadow-sm" style="max-width:900px">
    <h5 class="text-center mb-3">📄 สรุปข้อมูล</h5>

    <div class="row g-3">

      <div class="col-md-6">
        <div class="border rounded p-2 mb-2">
          <b>📌 การแจ้ง</b>
          <div><span class="fw-semibold">หัวข้อ:</span> ${get("missing_reason")}</div>
          <div><span class="fw-semibold">ความเร่งด่วน:</span> ${get("priority")}</div>
        </div>

        <div class="border rounded p-2 mb-2">
          <b>👤 ผู้แจ้ง</b>
          <div>${get("owner_name")}</div>
          <div>ความสัมพันธ์: ${relationshipText}</div>
          <div>โทร: ${get("owner_phone")}</div>
          <div>ติดต่อผ่าน: ${contactChannelText}</div>
        </div>

        <div class="border rounded p-2 mb-2">
          <b>📍 สถานที่หาย</b>
          <div><span class="fw-semibold">📅 วันที่:</span> ${get("missing_date")}</div>
          <div><span class="fw-semibold">⏰ เวลา:</span> ${get("missing_time")}</div>
          <div><span class="fw-semibold">📌 สถานที่:</span> ${get("missing_place")}</div>
          <div>
            <span class="fw-semibold">📍 พื้นที่:</span>
            ${get("subdistrict")}
            ${get("district")}
            ${get("province")}
            ${get("postal_code")}
          </div>
        </div>
      </div>

      <div class="col-md-6">
        <div class="border rounded p-2 mb-2">
          <b>🧍 ผู้สูญหาย</b>
          <div>${get("missing_title")} ${get("missing_name")}</div>
          <div>เพศ: ${get("gender")}</div>
          <div>เกิด: ${get("birthday")}</div>
          <div>อายุ: ${get("age")}</div>
          <div>สัญชาติ: ${get("race")}</div>
          <div>${get("id_type")} : ${get("id_number")}</div>
        </div>

        <div class="border rounded p-2 mb-2">
          <b>🧾 ลักษณะ</b>
          <div>ผิว: ${get("skin_color")}</div>
          <div>รูปร่าง: ${get("body_shape")}</div>
          <div>ผม: ${get("hair_styles")} (${hairColorText})</div>
          <div>สูง: ${get("height_cm")} cm</div>
        </div>

        <div class="border rounded p-2 mb-2">
          <b>🚓 สถานีตำรวจ</b>
          <div>${get("police_station_name")}</div>
          <div>จังหวัด: ${get("police_station_province") !== "-" ? get("police_station_province") : get("province")}</div>
          <div>เบอร์โทร: ${get("ps_phone")}</div>
          <div>ใบแจ้งความ: ${
            notice && notice.size > 0 ? notice.name : "-"
          }</div>
        </div>
      </div>

    </div>

    <div class="text-center mt-3">
      <b>รูปผู้สูญหาย</b><br>
      ${
        image && image.size > 0
          ? `<img src="${URL.createObjectURL(image)}" style="max-width:150px;border-radius:8px;margin-top:8px;">`
          : `<div>- ไม่มีรูป -</div>`
      }
    </div>
  </div>
  `;

  document.getElementById("summaryBox").innerHTML = html;
}

/*************************
 * POSTCODE AUTO FILL
 *************************/
document.addEventListener("DOMContentLoaded", () => {
  const nextBtn = document.getElementById("nextBtn");
  const prevBtn = document.getElementById("prevBtn");

  if (nextBtn) nextBtn.addEventListener("click", nextStep);
  if (prevBtn) prevBtn.addEventListener("click", prevStep);

  // postcode ของสถานที่พบเห็นครั้งสุดท้าย
  const postcodeInputs = document.querySelectorAll(".postcode[name='postal_code']");

  postcodeInputs.forEach(postcodeInput => {
    postcodeInput.addEventListener("input", () => {
      const container = postcodeInput.closest(".row");
      if (!container) return;

      const subdistrictInput = container.querySelector(".subdistrict");
      const districtInput = container.querySelector(".district");
      const provinceInput = container.querySelector(".province");

      if (!subdistrictInput || !districtInput || !provinceInput) return;

      const code = postcodeInput.value.trim();

      if (code.length !== 5 || postcodeData.length === 0) {
        subdistrictInput.value = "";
        districtInput.value = "";
        provinceInput.value = "";
        return;
      }

      const match = postcodeData.find(
        item => String(item.zipcode).trim() === code
      );

      if (match) {
        subdistrictInput.value = match.subdistrict;
        districtInput.value = match.district;
        provinceInput.value = match.province;
      } else {
        subdistrictInput.value = "";
        districtInput.value = "";
        provinceInput.value = "";
      }
    });
  });

  /* =========================
     RELATIONSHIP - OTHER
  ========================= */
  const relationshipSelect = document.getElementById("relationship");
  const otherBox = document.getElementById("otherRelationshipBox");
  const otherInput = document.getElementById("otherRelationship");

  if (relationshipSelect && otherBox && otherInput) {
    relationshipSelect.addEventListener("change", () => {
      if (relationshipSelect.value === "other") {
        otherBox.style.display = "block";
        otherInput.setAttribute("required", "true");
      } else {
        otherBox.style.display = "none";
        otherInput.removeAttribute("required");
        otherInput.value = "";
      }
    });
  }

  /* =========================
     CONTACT CHANNEL - OTHER
  ========================= */
  const contactChannelSelect = document.getElementById("contactChannel");
  const otherContactChannelBox = document.getElementById("otherContactChannelBox");
  const otherContactChannelInput = document.getElementById("otherContactChannel");

  if (contactChannelSelect && otherContactChannelBox && otherContactChannelInput) {
    contactChannelSelect.addEventListener("change", () => {
      if (contactChannelSelect.value === "other") {
        otherContactChannelBox.style.display = "block";
        otherContactChannelInput.setAttribute("required", "true");
      } else {
        otherContactChannelBox.style.display = "none";
        otherContactChannelInput.removeAttribute("required");
        otherContactChannelInput.value = "";
      }
    });
  }

  /* =========================
     HAIR COLOR - OTHER
  ========================= */
  const hairColorSelect = document.getElementById("hairColor");
  const otherHairBox = document.getElementById("otherHairColorBox");
  const otherHairInput = document.getElementById("otherHairColor");

  if (hairColorSelect && otherHairBox && otherHairInput) {
    hairColorSelect.addEventListener("change", () => {
      if (hairColorSelect.value === "other") {
        otherHairBox.style.display = "block";
        otherHairInput.setAttribute("required", "true");
      } else {
        otherHairBox.style.display = "none";
        otherHairInput.removeAttribute("required");
        otherHairInput.value = "";
      }
    });
  }

  /* =========================
     PRINT PDF
  ========================= */
  const pdfBtn = document.getElementById("pdfBtn");
  if (pdfBtn) {
    pdfBtn.addEventListener("click", () => {
      window.print();
    });
  }

  showStep(currentStep);
});