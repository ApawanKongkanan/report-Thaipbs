const API_URL = "http://localhost:3000/api/missing-persons";
/*************************
 * LOAD POSTCODE DATA ใช้กับ auto-fill (จังหวัด/อำเภอ)
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
  document.querySelectorAll(".step")
    .forEach(s => s.classList.remove("active"));

  document
    .querySelector(`[data-step="${step}"]`)
    .classList.add("active");

  document.getElementById("stepNumber").innerText = step;

  const nextBtn = document.getElementById("nextBtn");
  const prevBtn = document.getElementById("prevBtn");

  // 🔹 ปุ่มย้อนกลับ
  if (step === 1) {
    prevBtn.style.visibility = "hidden";
  } else {
    prevBtn.style.visibility = "visible";
  }

  // 🔹 ปุ่มถัดไป / ยืนยัน
  if (step === totalSteps) {

    nextBtn.innerText = "ส่งข้อมูล";
    nextBtn.classList.remove("btn-primary");
    nextBtn.classList.add("btn-success");
  
    generateSummary(); // ⭐ สร้างหน้าสรุปข้อมูล
  
  } else {
  
    nextBtn.innerText = "ถัดไป";
    nextBtn.classList.remove("btn-success");
    nextBtn.classList.add("btn-primary");
  
  }
  // ================= UPDATE PROGRESS BAR =================
  const progressPercent = Math.round(((step - 1) / (totalSteps - 1)) * 100);
  const progressBar = document.getElementById("progressBar");

  if (progressBar) {
    progressBar.style.width = progressPercent + "%";
    progressBar.innerText = progressPercent + "%";
  }
}

async function nextStep() {

  const currentSection = document.querySelector(
    `.step[data-step="${currentStep}"]`
  );

  const inputs = currentSection.querySelectorAll("input, select, textarea");

  let isValid = true;

  inputs.forEach(input => {

    // ⭐ เช็กเบอร์โทรโดยเฉพาะ
    if (input.id === "phoneInput") {
      const phoneRegex = /^[0-9]{10}$/;
      if (!phoneRegex.test(input.value)) {
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
    currentSection.querySelector("input, select, textarea").reportValidity();
    return; // ❌ ห้ามไป Step ถัดไป
  }

  // ✅ ถ้าผ่าน validation
  if (currentStep < totalSteps) {
    currentStep++;
    showStep(currentStep);
  } 
  else {

    const confirmCheck = document.getElementById("confirmCheck");
  
    if (!confirmCheck.checked) {
      confirmCheck.classList.add("is-invalid");
      return;
    }
  
    confirmCheck.classList.remove("is-invalid");
  
    // ===========================
    // 📦 สร้าง FormData
    // ===========================
    const form = document.getElementById("reportForm");
    const formData = new FormData(form);
  
    try {
  
      const response = await fetch(API_URL, {
        method: "POST",
        body: formData
      });
  
      const result = await response.json();
  
      if (response.ok) {
        alert("✅ ส่งข้อมูลเรียบร้อย");
        window.location.reload();
      } else {
        alert("❌ เกิดข้อผิดพลาด");
        console.log(result);
      }
  
    } catch (error) {
      console.error(error);
      alert("❌ ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้");
    }
  
  }
}

function prevStep() {
  if (currentStep > 1) {
    currentStep--;
    showStep(currentStep);
  }
}

function generateSummary(){

  const form = document.getElementById("reportForm");
  const data = new FormData(form);

  const get = (name) => data.get(name) || "-";
const missingLocation = [
  get("missing_place"),
  get("subdistrict"),
  get("district"),
  get("province")
].filter(v => v && v !== "-").join(" ");
  const image = data.get("image_url");
  const hairColor = get("hair_color") === "other"
  ? get("other_hair_color")
  : get("hair_color");

  let html = `
  <div class="container bg-white p-3 rounded shadow-sm" style="max-width:900px">

    <h5 class="text-center mb-3">📄 สรุปข้อมูล</h5>

    <div class="row g-3">

      <!-- LEFT -->
      <div class="col-md-6">

      <div class="border rounded p-2 mb-2">
      <b>📌 การแจ้ง</b>
      <div><span class="fw-semibold">ประเภท:</span> ${get("report_type")}</div>
      <div><span class="fw-semibold">หัวข้อ:</span> ${get("report_topic")}</div>
      <div><span class="fw-semibold">ความเร่งด่วน:</span> ${get("priority")}</div>
    </div>

        <div class="border rounded p-2 mb-2">
          <b>👤 ผู้แจ้ง</b>
          <div>${get("owner_title")} ${get("owner_name")}</div>
          <div>ความสัมพันธ์: ${get("relationship")}</div>
          <div>โทร: ${get("owner_phone")}</div>
          <div>ที่อยู่: ${get("owner_address")}</div>
          <div>
  ต.${get("owner_subdistrict")} อ.${get("owner_district")} จ.${get("owner_province")} ${get("owner_postcode")}
</div>
        </div>

        <div class="border rounded p-2 mb-2">
  <b>📍 สถานที่หาย</b>

  <div><span class="fw-semibold">📅 วันที่:</span> ${get("missing_date")}</div>
  <div><span class="fw-semibold">⏰ เวลา:</span> ${get("missing_time")}</div>
  <div><span class="fw-semibold">📌 สถานที่:</span> ${get("missing_place")}</div>

  <div>
    <span class="fw-semibold">📍 ที่อยู่:</span>
    ${get("missing_subdistrict")} 
    ${get("missing_district")} 
    ${get("missing_province")} 
    ${get("missing_postcode")}
  </div>

</div>

      </div>

      <!-- RIGHT -->
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
          <div>ผม: ${get("hair_styles")} (${hairColor})</div>
          <div>สูง: ${get("height_cm")} cm</div>
        </div>

        <div class="border rounded p-2 mb-2">
          <b>🚓 สถานีตำรวจ</b>
          <div>${get("police_station_name")}</div>
          <div>${get("police_station_province")}</div>
          <div>${get("police_station_phone")}</div>
        </div>

      </div>

    </div>

    <!-- IMAGE -->
    <div class="text-center mt-2">
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

  document.getElementById("nextBtn").addEventListener("click", nextStep);
document.getElementById("prevBtn").addEventListener("click", prevStep);

const postcodeInputs = document.querySelectorAll(".postcode");

postcodeInputs.forEach(postcodeInput => {

  postcodeInput.addEventListener("input", () => {

    const container = postcodeInput.closest(".row");

    const subdistrictInput = container.querySelector(".subdistrict");
    const districtInput = container.querySelector(".district");
    const provinceInput = container.querySelector(".province");

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
   HAIR COLOR - OTHER
========================= */

const hairColorSelect = document.getElementById("hairColor");
const otherHairBox = document.getElementById("otherHairColorBox");
const otherHairInput = document.getElementById("otherHairColor");

if (hairColorSelect && otherHairBox && otherHairInput) {

  hairColorSelect.addEventListener("change", () => {

    if (hairColorSelect.value === "other") {
      otherHairBox.style.display = "block";
      otherHairInput.setAttribute("required","true");
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

if(pdfBtn){
  pdfBtn.addEventListener("click", () => {
    window.print();
  });
}

showStep(currentStep);
});

// เรียก API ตอนโหลดหน้าเว็บ
async function loadMissingPersons() {

  try {

    const response = await fetch("http://localhost:3000/api/missing-persons/missing");

    const data = await response.json();

    const container = document.getElementById("missingList");

    container.innerHTML = "";

    data.forEach(person => {

      const card = `
        <div class="card">

          <div class="name">
            ${person.missing_title} ${person.missing_name}
          </div>

          <div>เพศ : ${person.gender}</div>
          <div>อายุ : ${person.age}</div>
          <div>เชื้อชาติ : ${person.race}</div>

        </div>
      `;

      container.innerHTML += card;

    });

  } catch (error) {

    console.error("โหลดข้อมูลไม่ได้", error);

  }

}

loadMissingPersons();