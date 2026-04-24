const express = require("express");
const router = express.Router();
const { sql, dbConfig } = require("../config/db");
const multer = require("multer");
const path = require("path");
// ===============================
// ตั้งค่า multer รับไฟล์ที่อัปโหลดจาก client
// ===============================
const storage = multer.diskStorage({
  //ทุกไฟล์ที่อัปโหลด → เก็บไว้ในโฟลเดอร์ uploads/
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});
//สร้างตัวจัดการ upload
const upload = multer({ storage: storage });

router.post("/",
  upload.fields([
    { name: "notice", maxCount: 1 },
    { name: "image_url", maxCount: 1 }
  ]),
  async (req, res) => {

  //รับข้อมูลจาก Frontend มาจาก name form
try {

    const {
    missing_title,
    missing_name,
    gender,
    birthday,
    age,
    race,

    missing_reason,
    priority,

    owner_title,
    owner_name,
    owner_phone,
    relation_to_missing,

    missing_date,
    missing_time,
    missing_place,

    postal_code,
    province,
    district,
    subdistrict,

    hair_styles,
    hair_color,
    height_cm,

    police_station_name,
    police_station_province,
    police_station_phone,
    latest_characteristics,
    inform_channels
  } = req.body;
//เชื่อมต่อ DB
    const pool = await sql.connect(dbConfig);
    // ================================
    // รวมข้อมูลสถานที่เป็น JSON
    // ================================
    const latestLastSeenJSON = JSON.stringify({
      missing_date,
      missing_time,
      postal_code,
      province,
      district,
      subdistrict,
      missing_place
    });
    // ===============================
    // Insert MissingPerson
    // ===============================

const personResult = await pool.request()
  .input("missing_title", sql.NVarChar, missing_title)
  .input("missing_name", sql.NVarChar, missing_name)
  .input("gender", sql.NVarChar, gender)
  .input("birthday", sql.Date, birthday)
  .input("age", sql.Int, age)
  .input("race", sql.NVarChar, race)

  .query(`
    INSERT INTO MissingPerson
    (
      missing_title,
      missing_name,
      gender,
      birthday,
      age,
      race
    )
    OUTPUT INSERTED.missingperson_id
    VALUES
    (
      @missing_title,
      @missing_name,
      @gender,
      @birthday,
      @age,
      @race
    )
  `);

const missingperson_id = personResult.recordset[0].missingperson_id;

     // ===============================
    // Insert CaseOwner ก่อน
    // ===============================
    const ownerResult = await pool.request()
      .input("owner_title", sql.NVarChar, "ไม่ระบุ")
      .input("owner_name", sql.NVarChar, owner_name)
      .query(`
        INSERT INTO CaseOwner (owner_title, owner_name)
        OUTPUT INSERTED.owner_id
        VALUES (@owner_title, @owner_name)
      `);
    const owner_id = ownerResult.recordset[0].owner_id;

    //console.log("owner_id =", owner_id);
    //console.log("owner_phone =", owner_phone);
//if (owner_phone) {
  await pool.request()
    .input("owner_id", sql.Int, owner_id)
    .input("owner_phone", sql.NVarChar, owner_phone)
    .query(`
      INSERT INTO CaseOwner_Phone (owner_id, owner_phone)
      VALUES (@owner_id, @owner_phone)
    `);
//}

//จัดการ birth_time
    /*let formattedTime = null;

    if (birth_time && /^\d{2}:\d{2}$/.test(birth_time)) {
      const [hours, minutes] = birth_time.split(":");
      formattedTime = new Date(1970, 0, 1, hours, minutes, 0);
    }
    */
    // ===============================
    // จัดการไฟล์รูป
    // ===============================
    let fileUrl = null;
// 🔥 ดึงไฟล์
const noticeFile = req.files?.notice?.[0];
const imageFile = req.files?.image_url?.[0];

// 🔥 สร้าง URL
const noticeUrl = noticeFile
  ? `http://localhost:3000/uploads/${noticeFile.filename}`
  : null;

const imageUrl = imageFile
  ? `http://localhost:3000/uploads/${imageFile.filename}`
  : null;

// 🔥 ใช้แทน notice
const noticeValue = noticeUrl || "ไม่มีรายละเอียด";


    // ===============================
    // Insert MissingCase
    // ===============================
    await pool.request()
      .input("priority", sql.NVarChar, priority)
      .input("missing_reason", sql.NVarChar, missing_reason)
      .input("latest_last_seen_at", sql.NVarChar, latestLastSeenJSON)
      .input("latest_characteristics", sql.NVarChar, latest_characteristics || "{}")
      .input("inform_channels", sql.NVarChar, inform_channels || "{}")
      .input("notice", sql.NVarChar, noticeValue)
      .input("relation_to_missing", sql.NVarChar, relation_to_missing || "ไม่ระบุ")
      // FK (ใช้ owner_id ที่ insert สด ๆ)
      .input("staff_id", sql.Int, 1)
      .input("owner_id", sql.Int, owner_id)
      .input("missingperson_id", sql.Int, missingperson_id)
      .input("police_station_id", sql.Int, 1)

      .query(`
        INSERT INTO MissingCase
        (
          priority,
          latest_status,
          missing_reason,
          staff_id,
          latest_last_seen_at,
          first_last_seen_at,
          latest_characteristics,
          inform_channels,
          notice,
          relation_to_missing,
          owner_id,
          missingperson_id,
          police_station_id
        )
        VALUES
        (
          @priority,
          N'รับแจ้ง',
          @missing_reason,
          @staff_id,
          @latest_last_seen_at,
          @latest_last_seen_at,
          @latest_characteristics,
          @inform_channels,
          @notice,
          @relation_to_missing,
          @owner_id,
          @missingperson_id,
          @police_station_id
        )
      `);


  
//ส่งผลลัพธ์กลับ
    res.status(201).json({
      message: "บันทึกข้อมูลสำเร็จ"
    });

  } catch (err) {
    console.error("DB Error:", err);
    res.status(500).json({
      message: "เกิดข้อผิดพลาด",
      error: err.message
    });
  }

});


/*========== GET/api/mising-case ==========*/
router.get("/", async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig);

    const result = await pool.request().query(`
      SELECT 
        mc.case_id,
        mp.missing_name,
        mp.gender,
        mp.age,
        mc.priority,
        mc.missing_reason,
        mc.notice
      FROM MissingCase mc
      JOIN MissingPerson mp 
        ON mc.missingperson_id = mp.missingperson_id
      ORDER BY mc.case_id DESC
    `);

    res.json({
      success: true,
      data: result.recordset
    });

  } catch (err) {
    console.error("GET ALL ERROR:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});



/*========== GET /api/missing-persons/:id ==========*/
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const pool = await sql.connect(dbConfig);

    const result = await pool.request()
      .input("id", sql.Int, id)
      .query(`
        SELECT 
          mc.case_id,
          mp.missing_name,
          mp.gender,
          mp.age,
          mp.race,

          mc.priority,
          mc.missing_reason,
          mc.notice,
          mc.latest_last_seen_at,
          mc.first_last_seen_at,
          mc.latest_characteristics,
          mc.inform_channels,
          mc.relation_to_missing

        FROM MissingCase mc

        JOIN MissingPerson mp 
          ON mc.missingperson_id = mp.missingperson_id

        WHERE mc.case_id = @id
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: "ไม่พบข้อมูล"
      });
    }

    res.json({
      success: true,
      data: result.recordset[0]
    });

  } catch (err) {
    console.error("GET BY ID ERROR:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/*========== PUT /api/missing-persons/:id ==========*/
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const {
      missing_name,
      gender,
      age,
      race,
      priority,
      missing_reason,
      relation_to_missing
    } = req.body;

    const pool = await sql.connect(dbConfig);

    // 🔥 หา missingperson_id ก่อน
    const find = await pool.request()
      .input("id", sql.Int, id)
      .query(`
        SELECT missingperson_id 
        FROM MissingCase 
        WHERE case_id = @id
      `);

    if (find.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: "ไม่พบข้อมูล"
      });
    }

    const missingperson_id = find.recordset[0].missingperson_id;

    // 🔥 update MissingPerson
    await pool.request()
      .input("missingperson_id", sql.Int, missingperson_id)
      .input("missing_name", sql.NVarChar, missing_name || "")
      .input("gender", sql.NVarChar, gender || "")
      .input("age", sql.Int, age || null)
      .input("race", sql.NVarChar, race || "")
      .query(`
        UPDATE MissingPerson
        SET 
          missing_name = @missing_name,
          gender = @gender,
          age = @age,
          race = @race
        WHERE missingperson_id = @missingperson_id
      `);

    // 🔥 update MissingCase
    await pool.request()
      .input("id", sql.Int, id)
      .input("priority", sql.NVarChar, priority || "")
      .input("missing_reason", sql.NVarChar, missing_reason || "")
      .input("relation_to_missing", sql.NVarChar, relation_to_missing || "ไม่ระบุ")
      .query(`
        UPDATE MissingCase
        SET 
          priority = @priority,
          missing_reason = @missing_reason,
          relation_to_missing = @relation_to_missing
        WHERE case_id = @id
      `);

    res.json({
      success: true,
      message: "อัปเดตข้อมูลสำเร็จ"
    });

  } catch (err) {
    console.error("PUT ERROR:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

module.exports = router;