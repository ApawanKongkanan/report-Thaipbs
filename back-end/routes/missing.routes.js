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
    const pool = await sql.connect(dbConfig);
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      // --- 1. รับข้อมูลจาก Body ---
      const {
        missing_title, missing_name, gender, birthday, age, race,
        id_number, id_type, // สำหรับ IdentityDocument
        missing_reason, priority,
        owner_name, owner_phone, relation_to_missing,
        missing_date, missing_time, missing_place,
        postal_code, province, district, subdistrict,
        hair_styles, hair_color, height_cm, skin_color, body_shape,
        police_station_name, ps_phone, // สำหรับ PoliceStation
        inform_channels,
        role 
      } = req.body;

      // --- 2. Phase 1: Hard-coded Staff Data ---
      // กำหนดค่าสมมติให้เป็นเจ้าหน้าที่ระบบกลาง ID 1
      const STAFF_ID_DEFAULT = 1; 
      const STAFF_NAME_DEFAULT = 'เจ้าหน้าที่ศูนย์รับแจ้ง (System)';

      const initialStatus = (role === 'admin') ? 'รับแจ้ง' : 'รอรับเรื่อง';

      // --- 3. Insert MissingPerson ---
      const personResult = await transaction.request()
        .input("m_title", sql.NVarChar, missing_title)
        .input("m_name", sql.NVarChar, missing_name)
        .input("gender", sql.NVarChar, gender)
        .input("bday", sql.Date, birthday)
        .input("age", sql.Int, age)
        .input("race", sql.NVarChar, race)
        .query(`INSERT INTO MissingPerson (missing_title, missing_name, gender, birthday, age, race) 
                OUTPUT INSERTED.missingperson_id VALUES (@m_title, @m_name, @gender, @bday, @age, @race)`);
      const mp_id = personResult.recordset[0].missingperson_id;

      // --- 4. Insert IdentityDocument ---
      if (id_number) {
        await transaction.request()
          .input("num", sql.NVarChar, id_number)
          .input("type", sql.NVarChar, id_type || "บัตรประชาชน")
          .input("mp_id", sql.Int, mp_id)
          .query(`INSERT INTO IdentityDocument (id_number, id_type, missingperson_id) VALUES (@num, @type, @mp_id)`);
      }

      // --- 5. Insert CaseOwner & Phone ---
      const ownerResult = await transaction.request()
        .input("oname", sql.NVarChar, owner_name)
        .query(`INSERT INTO CaseOwner (owner_title, owner_name) OUTPUT INSERTED.owner_id VALUES (N'ไม่ระบุ', @oname)`);
      const owner_id = ownerResult.recordset[0].owner_id;
      if (owner_phone) {
        await transaction.request().input("oid", sql.Int, owner_id).input("p", sql.NVarChar, owner_phone)
          .query(`INSERT INTO CaseOwner_Phone (owner_id, owner_phone) VALUES (@oid, @p)`);
      }

      // --- 6. Insert PoliceStation ---
      const psResult = await transaction.request()
        .input("psn", sql.NVarChar, police_station_name || "ไม่ระบุ")
        .input("psp", sql.NVarChar, province)
        .input("pst", sql.NVarChar, ps_phone || "ไม่ระบุ")
        .query(`INSERT INTO PoliceStation (police_station_name, police_station_province, police_station_phone) 
                OUTPUT INSERTED.police_station_id VALUES (@psn, @psp, @pst)`);
      const ps_id = psResult.recordset[0].police_station_id;

      // --- 7. จัดการไฟล์และ JSON ---
      const imageFile = req.files?.image_url?.[0];
      const imageUrl = imageFile ? `http://localhost:3000/uploads/${imageFile.filename}` : "no-image.jpg";
      const lastSeenJSON = JSON.stringify({ missing_date, missing_time, postal_code, province, district, subdistrict, missing_place });
      const characteristicsJSON = JSON.stringify({ hair_styles, hair_color, height_cm, skin_color, body_shape, image_url: imageUrl });

      // --- 8. Insert MissingCase (ใช้ Staff Hard-coded) ---
      const caseResult = await transaction.request()
        .input("priority", sql.NVarChar, priority)
        .input("reason", sql.NVarChar, missing_reason)
        .input("status", sql.NVarChar, initialStatus)
        .input("ls", sql.NVarChar, lastSeenJSON)
        .input("chars", sql.NVarChar, characteristicsJSON)
        .input("chan", sql.NVarChar, inform_channels || "หน้าเว็บ")
        .input("notice", sql.NVarChar, "ไม่มีรายละเอียด")
        .input("rel", sql.NVarChar, relation_to_missing || "ไม่ระบุ")
        .input("staff_id", sql.Int, STAFF_ID_DEFAULT) // <--- ใส่ Hard-coded ID
        .input("owner_id", sql.Int, owner_id)
        .input("mp_id", sql.Int, mp_id)
        .input("ps_id", sql.Int, ps_id)
        .query(`INSERT INTO MissingCase (priority, latest_status, missing_reason, staff_id, latest_last_seen_at, first_last_seen_at, latest_characteristics, relation_to_missing, inform_channels, notice, owner_id, missingperson_id, police_station_id) 
                OUTPUT INSERTED.case_id VALUES (@priority, @status, @reason, @staff_id, @ls, @ls, @chars, @rel, @chan, @notice, @owner_id, @mp_id, @ps_id)`);
      const case_id = caseResult.recordset[0].case_id;

      // --- 9. Insert StatusLog (ใช้ Staff Name Hard-coded) ---
      const logResult = await transaction.request()
        .input("case_id", sql.Int, case_id)
        .input("status", sql.NVarChar, initialStatus)
        .input("logged_by", sql.NVarChar, STAFF_NAME_DEFAULT) // <--- ใส่ Hard-coded Name
        .query(`INSERT INTO StatusLog (case_id, description, case_status, logged_by) 
                OUTPUT INSERTED.log_id VALUES (@case_id, N'บันทึกรับแจ้งครั้งแรก', @status, @logged_by)`);
      const log_id = logResult.recordset[0].log_id;

      // --- 10. Insert Character Log ---
      await transaction.request()
        .input("lid", sql.Int, log_id).input("img", sql.NVarChar, imageUrl)
        .input("skin", sql.NVarChar, skin_color || "ไม่ระบุ").input("shape", sql.NVarChar, body_shape || "ไม่ระบุ")
        .input("hs", sql.NVarChar, hair_styles || "ไม่ระบุ").input("hc", sql.NVarChar, hair_color || "ไม่ระบุ").input("h", sql.Int, height_cm || 0)
        .query(`INSERT INTO Missingperson_Character_Log (log_id, image_url, skin_color, body_shape, hair_styles, hair_color, height_cm) 
                VALUES (@lid, @img, @skin, @shape, @hs, @hc, @h)`);

      // --- 11. Insert Last_Seen_Log ---
      await transaction.request()
        .input("lid", sql.Int, log_id).input("d", sql.Date, missing_date).input("t", sql.NVarChar, missing_time)
        .input("p", sql.NVarChar, missing_place || "ไม่ระบุ").input("sub", sql.NVarChar, subdistrict || "ไม่ระบุ")
        .input("dist", sql.NVarChar, district || "ไม่ระบุ").input("prov", sql.NVarChar, province || "ไม่ระบุ")
        .query(`INSERT INTO Last_Seen_Log (log_id, missing_date, missing_time, missing_place, subdistrict, district, province) 
                VALUES (@lid, @d, @t, @p, @sub, @dist, @prov)`);

      await transaction.commit();
      res.status(201).json({ success: true, message: "บันทึกสำเร็จ" });

    } catch (err) {
      if (transaction) await transaction.rollback();
      console.error("POST ERROR:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);


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
          mc.latest_status,
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

/*========== UPDATE STATUS ==========*/
router.put("/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const pool = await sql.connect(dbConfig);

    await pool.request()
      .input("id", sql.Int, id)
      .input("status", sql.NVarChar, status)
      .query(`
        UPDATE MissingCase
        SET latest_status = @status
        WHERE case_id = @id
      `);

    res.json({
      success: true,
      message: "อัปเดตสถานะสำเร็จ"
    });

  } catch (err) {
    console.error("STATUS ERROR:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/*========== DELETE (Phase 1) ==========*/
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params; // case_id
    const pool = await sql.connect(dbConfig);
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      // 1. หา log_id ทั้งหมดที่ผูกกับ case_id นี้ก่อน
      const logData = await transaction.request()
        .input("case_id_find", sql.Int, id) // ใช้ชื่อตัวแปรที่ต่างกันเพื่อความชัดเจน
        .query(`SELECT log_id FROM StatusLog WHERE case_id = @case_id_find`);
      
      const logIds = logData.recordset.map(row => row.log_id);

      // ถ้ามี Log ให้ทำการลบตารางลูกของ Log ก่อน
      if (logIds.length > 0) {
        const idList = logIds.join(',');

        // ลบข้อมูลลักษณะเด่นที่ผูกกับ log_id
        await transaction.request()
          .query(`DELETE FROM Missingperson_Character_Log WHERE log_id IN (${idList})`);
        
        // ลบข้อมูลสถานที่ที่ผูกกับ log_id
        await transaction.request()
          .query(`DELETE FROM Last_Seen_Log WHERE log_id IN (${idList})`);

        // ลบตัวแม่ของประวัติ (StatusLog)
        await transaction.request()
          .query(`DELETE FROM StatusLog WHERE log_id IN (${idList})`);
      }

      // 2. ลบ ReportedTips (ถ้ามี)
      await transaction.request()
        .input("case_id_tips", sql.Int, id)
        .query(`DELETE FROM ReportedTips WHERE case_id = @case_id_tips`);

      // 3. ลบตัวคดีหลัก (MissingCase) เป็นลำดับสุดท้าย
      await transaction.request()
        .input("case_id_main", sql.Int, id)
        .query(`DELETE FROM MissingCase WHERE case_id = @case_id_main`);

      await transaction.commit();
      res.json({ success: true, message: `ลบข้อมูลคดี ID ${id} และประวัติที่เกี่ยวข้องทั้งหมดเรียบร้อยแล้ว` });

    } catch (err) {
      if (transaction) await transaction.rollback();
      throw err;
    }

  } catch (err) {
    console.error("DELETE ERROR:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});



module.exports = router;