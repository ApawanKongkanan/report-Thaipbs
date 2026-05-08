const express = require("express");
const router = express.Router();
const { sql, dbConfig } = require("../config/db");
const multer = require("multer");
const path = require("path");
const storage = multer.diskStorage({

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
        owner_title,owner_name, owner_phone, owner_id_card,relation_to_missing,
        missing_date, missing_time, missing_place,
        postal_code, province, district, subdistrict,
        hair_styles, hair_color, height_cm, skin_color, body_shape,
        police_station_name, ps_phone, // สำหรับ PoliceStation
        inform_channels,
        user_id
      } = req.body;

      // --- 2. Phase 1: Hard-coded Staff Data ---
      // กำหนดค่าสมมติให้เป็นเจ้าหน้าที่ระบบกลาง ID 1
      // ===============================
      // ===============================
// AUTO CREATE RELATIVE ACCOUNT
// ===============================

// แปลง user_id ให้เป็น int
let finalUserId =
  user_id ? parseInt(user_id) : null;

// ตัด space เบอร์โทร
const cleanPhone =
  owner_phone
    ? owner_phone.trim()
    : null;

// ความสัมพันธ์ที่อนุญาตให้มี account ญาติ
const allowedRelations = [
  "บิดา / มารดา",
  "บุตร / ธิดา",
  "พี่ / น้อง",
  "ญาติ",
  "คู่สมรส / แฟน"
];

// เช็คว่าสามารถสร้าง account ได้ไหม
const canCreateUser =
  allowedRelations.includes(
    relation_to_missing?.trim()
  );

if (
  !finalUserId &&
  cleanPhone &&
  canCreateUser
) {

  // หา user จากเบอร์โทร
  const findUser = await transaction.request()

    .input("phone", sql.NVarChar, cleanPhone)

    .query(`
      SELECT user_id
      FROM Users
      WHERE username = @phone
    `);

  // ถ้ามีอยู่แล้ว
  if (findUser.recordset.length > 0) {

    finalUserId =
      findUser.recordset[0].user_id;

  } else {

    // ใช้ 4 ตัวท้ายบัตรประชาชนเป็นรหัสผ่าน
    const password = owner_id_card
      ? owner_id_card.slice(-4)
      : cleanPhone.slice(-4);

    // สร้าง account ญาติอัตโนมัติ
    const createUser = await transaction.request()

      .input("username", sql.NVarChar, cleanPhone)

      .input("password", sql.NVarChar, password)

      .query(`
        INSERT INTO Users
        (
          username,
          password_hash
        )
        OUTPUT INSERTED.user_id
        VALUES
        (
          @username,
          @password
        )
      `);

    finalUserId =
      createUser.recordset[0].user_id;

  }
}
      const STAFF_ID_DEFAULT = 1; 
      const STAFF_NAME_DEFAULT = 'เจ้าหน้าที่ศูนย์รับแจ้ง (System)';

      const initialStatus = 'กำลังตรวจสอบ';

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
        .input("otitle", sql.NVarChar, owner_title || "ไม่ระบุ")
        .input("oname", sql.NVarChar, owner_name)
        .input("uid", sql.Int, finalUserId)
        .query(`INSERT INTO CaseOwner (owner_title, owner_name, user_id) OUTPUT INSERTED.owner_id VALUES (@otitle, @oname, @uid)`);
      const owner_id = ownerResult.recordset[0].owner_id;
      if (owner_phone) {
        await transaction.request()
  .input("oid", sql.Int, owner_id)
  .input("p", sql.NVarChar, cleanPhone)
  .query(`
    INSERT INTO CaseOwner_Phone (owner_id, owner_phone)
    VALUES (@oid, @p)
  `);
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
      // ดึงไฟล์จากฟิลด์ notice และ image_url ที่รับมาจาก upload.fields
      const noticeFile = req.files?.notice?.[0];
      const imageFile = req.files?.image_url?.[0];

      // สร้าง URL สำหรับเก็บใน Database
      const noticeUrl = noticeFile ? `http://localhost:3000/uploads/${noticeFile.filename}` : "ไม่มีรายละเอียด";
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
        
        // แก้ไขบรรทัดนี้: เปลี่ยนจาก "ไม่มีรายละเอียด" เป็นตัวแปร noticeUrl ที่สร้างไว้ข้างบน
        .input("notice", sql.NVarChar, noticeUrl) 
        
        .input("rel", sql.NVarChar, relation_to_missing || "ไม่ระบุ")
        .input("staff_id", sql.Int, STAFF_ID_DEFAULT)
        .input("owner_id", sql.Int, owner_id)
        .input("mp_id", sql.Int, mp_id)
        .input("ps_id", sql.Int, ps_id)
        .input("uid", sql.Int, finalUserId)

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
    relation_to_missing,
    inform_channels,
    notice,
    owner_id,
    missingperson_id,
    police_station_id,
    user_id
  )
  OUTPUT INSERTED.case_id
  VALUES
  (
    @priority,
    @status,
    @reason,
    @staff_id,
    @ls,
    @ls,
    @chars,
    @rel,
    @chan,
    @notice,
    @owner_id,
    @mp_id,
    @ps_id,
    @uid
  )
`);
      const case_id = caseResult.recordset[0].case_id;

      // --- 9. Insert StatusLog (ใช้ Staff Name Hard-coded) ---
      const logResult = await transaction.request()
        .input("case_id", sql.Int, case_id)
        .input("status", sql.NVarChar, initialStatus)
        .input("logged_by", sql.NVarChar, STAFF_NAME_DEFAULT)
        
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
      res.status(201).json({ success: true, message: "บันทึกสำเร็จ", case_id: case_id});

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
    /*const result = await pool.request().query(`

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
*/
// แก้ใน API สำหรับดึงลิสต์รายการทั้งหมด
    // แก้ใน SQL Query ของ router.get("/")
const result = await pool.request().query(`
    SELECT
        mc.*,
        mp.missing_name, mp.gender, mp.age, mp.race,
        co.owner_title,
        co.owner_name,
        cp.owner_phone
    FROM MissingCase mc
    JOIN MissingPerson mp ON mc.missingperson_id = mp.missingperson_id
    JOIN CaseOwner co ON mc.owner_id = co.owner_id
    LEFT JOIN CaseOwner_Phone cp ON co.owner_id = cp.owner_id
    ORDER BY mc.case_id DESC  -- เปลี่ยนเป็น case_id แทน created_at
`);

      
const formattedData = result.recordset.map(item => {
    item.missing_person_image = null;
    if (item.latest_characteristics) {
        try {  
            const chars = JSON.parse(item.latest_characteristics);
            let rawImg = chars.image_url || "";
            item.missing_person_image = rawImg.startsWith('http')
                ? rawImg

                : `http://localhost:3000/uploads/${rawImg}`;
            item.skin_color = chars.skin_color || "-";
            item.body_shape = chars.body_shape || "-";
        } catch (e) {
           
            console.log("พบข้อมูลไม่ใช่ JSON ใน ID:", item.case_id);
            item.body_shape = item.latest_characteristics;
        }
    }
    
    if (item.latest_last_seen_at) {
        try {
            const ls = JSON.parse(item.latest_last_seen_at);
            item.province = ls.province || "-";
        } catch (e) {
            item.province = item.latest_last_seen_at; // ใส่ค่าดิบถ้าไม่ใช่ JSON
        }
    }

    item.status = item.latest_status || "กำลังตรวจสอบ";
    item.owner_phone = item.owner_phone || "-";
    item.gender = item.gender || "-";
    item.age = item.age || "-";
    return item;
});
      
        res.json({ success: true, data: formattedData });
    } catch (err) {
        console.error("GET LIST ERROR:", err);
        res.status(500).json({ success: false, error: err.message });
    }

});

/*========== GET CASE BY USER ID ==========*/
router.get("/user/:userId", async (req, res) => {

  try {

    const { userId } = req.params;

    const pool =
      await sql.connect(dbConfig);

    const result =
      await pool.request()

        .input("uid", sql.Int, userId)

        .query(`
          SELECT TOP 1
            mc.*,
            mp.missing_name,
            mp.gender,
            mp.age,
            mp.race,
            co.owner_name,
            cp.owner_phone

          FROM MissingCase mc

          JOIN MissingPerson mp
            ON mc.missingperson_id = mp.missingperson_id

          JOIN CaseOwner co
            ON mc.owner_id = co.owner_id

          LEFT JOIN CaseOwner_Phone cp
            ON co.owner_id = cp.owner_id

          WHERE mc.user_id = @uid

          ORDER BY mc.case_id DESC
        `);
if (result.recordset.length === 0) {

  return res.status(404).json({
    success: false,
    message: "ไม่พบข้อมูล"
  });

}

let item = result.recordset[0];

// ===============================
// ดึงเบาะแสล่าสุด
// ===============================

const tipsResult =
  await pool.request()

    .input("caseId", sql.Int, item.case_id)

    .query(`
      SELECT
        reporter_id,
        log_id
      FROM ReportedTips
      WHERE case_id = @caseId
    `);

item.tips =
  tipsResult.recordset || [];
    // parse image
    if (item.latest_characteristics) {

      try {

        const chars =
          JSON.parse(item.latest_characteristics);

        item.image_url =
          chars.image_url || null;

      } catch (e) {}

    }

    // parse location
    if (item.latest_last_seen_at) {

      try {

        const ls =
          JSON.parse(item.latest_last_seen_at);

        item.missing_date =
          ls.missing_date || "-";

        item.missing_time =
          ls.missing_time || "-";

        item.missing_place =
          ls.missing_place || "-";

        item.province =
          ls.province || "-";

      } catch (e) {}

    }

    res.json({
      success: true,
      data: item
    });

  } catch (err) {

    console.error(err);

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
                SELECT mc.*, mp.missing_name, mp.gender, mp.age, mp.race, mp.birthday,
                       co.owner_title,co.owner_name, cp.owner_phone, idd.id_number, idd.id_type,
                       ps.police_station_name, ps.police_station_phone, ps.police_station_province
                FROM MissingCase mc
                JOIN MissingPerson mp ON mc.missingperson_id = mp.missingperson_id
                JOIN CaseOwner co ON mc.owner_id = co.owner_id
                LEFT JOIN CaseOwner_Phone cp ON co.owner_id = cp.owner_id
                LEFT JOIN IdentityDocument idd ON mp.missingperson_id = idd.missingperson_id
                LEFT JOIN PoliceStation ps ON mc.police_station_id = ps.police_station_id
                WHERE mc.case_id = @id
            `);

        let item = result.recordset[0];
        if (item) {
           
            if (item.latest_characteristics) {
                try {
                    const chars = JSON.parse(item.latest_characteristics);
                    const fileName = (chars.image_url || "").split('/').pop();
                    const finalPath = fileName ? `uploads/${fileName}` : "no-image.jpg";
                    
                    item.image_url = finalPath;
                    item.missing_person_image = finalPath;
                    
                    
                    item.skin_color = chars.skin_color || "-";
                    item.body_shape = chars.body_shape || "-";
                    item.hair_styles = chars.hair_styles || "-";
                    item.hair_color = chars.hair_color || "-";
                    item.height_cm  = chars.height_cm || "-";
                } catch (e) { console.error("JSON Char Error:", e); }
            }

            if (item.latest_last_seen_at) {
                try {
                    const ls = JSON.parse(item.latest_last_seen_at);
                    item.missing_date = ls.missing_date || "-";
                    item.missing_time = ls.missing_time || "-";
                    item.missing_place = ls.missing_place || "-";
                    item.province = ls.province || "-";
                    item.district = ls.district || "-";
                    item.subdistrict = ls.subdistrict || "-";
                    item.postal_code = ls.postal_code || "-";
                } catch (e) { console.error("JSON Location Error:", e); }
            }

                if (item.notice) {
                    const reportFileName = item.notice.split(/[\\/]/).pop(); 
                    item.notice = `uploads/${reportFileName}`;
                }
       
            item.ps_phone = item.police_station_phone || "-";
            item.police_station_phone = item.police_station_phone || "-";
            item.owner_phone = item.owner_phone || "-";
            item.id_number = item.id_number || "-";
            item.id_type = item.id_type || "-";

            res.json({ success: true, data: item });
        } else {
            res.status(404).json({ success: false, message: "ไม่พบข้อมูล" });
        }
    } catch (err) {
        console.error("GET DETAIL ERROR:", err);
        res.status(500).json({ success: false, error: err.message });
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
    const { status, logged_by } = req.body;

    const pool = await sql.connect(dbConfig);

        // UPDATE STATUS จริง
    await pool.request()
      .input("id", sql.Int, id)
      .input("status", sql.NVarChar, status)
      .query(`
        UPDATE MissingCase
        SET latest_status = @status
        WHERE case_id = @id
      `);


await pool.request()
  .input("case_id", sql.Int, id)
  .input("status", sql.NVarChar, status)
  .input("by", sql.NVarChar, logged_by || "admin")
  .query(`
    INSERT INTO StatusLog
    (
      case_id,
      description,
      case_status,
      logged_by
    )
    VALUES
    (
      @case_id,
      N'อัปเดตสถานะเคส',
      @status,
      @by
    )
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


/*========== เปลี่ยนจาก DELETE เป็น UPDATE STATUS ==========*/
/*router.patch("/soft-delete/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await sql.connect(dbConfig);
        
        // เปลี่ยนสถานะเป็น 'ยกเลิกเคส' แทนการลบจริง
        await pool.request()
            .input("id", sql.Int, id)
            .query(`
                UPDATE MissingCase 
                SET latest_status = N'ยกเลิกเคส' 
                WHERE case_id = @id
            `);

        res.json({ success: true, message: "เปลี่ยนสถานะเคสเป็นยกเลิกเรียบร้อยแล้ว" });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});*/



module.exports = router;