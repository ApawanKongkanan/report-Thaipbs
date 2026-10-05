const express = require("express");
const { sql, dbConfig } = require("../config/db");
const bcrypt = require("bcrypt");

const router = express.Router();

// ---------------- 1. สมัครสมาชิก ----------------
router.post("/register", async (req, res) => {
  try {
    const { people_title, people_name, people_account, people_phone, password } = req.body;

    if (!password) {
      return res.status(400).json({ success: false, error: "กรุณากรอกรหัสผ่าน" });
    }
    if (!people_account) {
      return res.status(400).json({ success: false, error: "กรุณากรอกบัญชีผู้ใช้" });
    }

    // people_id เป็น IDENTITY ฐานข้อมูลสร้างเอง ห้ามระบุ
    const hashedPassword = await bcrypt.hash(password, 10);

    const pool = await sql.connect(dbConfig);
    await pool
      .request()
      .input("title", sql.NVarChar, people_title)
      .input("name", sql.NVarChar, people_name)
      .input("account", sql.NVarChar, people_account)
      .input("phone", sql.NVarChar, people_phone)
      .input("pass", sql.NVarChar, hashedPassword).query(`
        INSERT INTO People
          (people_title, people_name, people_account, people_phone, people_identity, people_password_hash, people_created_at)
        VALUES
          (@title, @name, @account, @phone, N'ไม่ระบุ', @pass, GETDATE())
      `);

    // หมายเหตุ: ฟอร์มฝั่ง frontend ยังไม่มีช่องรหัสผ่าน ผู้แจ้งใหม่จะได้รหัสผ่าน default 'temp1234' (เข้ารหัส bcrypt แล้ว)
    res.status(201).json({ success: true, message: "ลงทะเบียนสำเร็จ" });
  } catch (err) {
    console.error("Register Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------- 2. เข้าสู่ระบบ ----------------
router.post("/login", async (req, res) => {
  try {
    const { username, password, role } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, error: "กรุณากรอกชื่อผู้ใช้งานและรหัสผ่าน" });
    }

    // รองรับทั้ง bcrypt (ค่าที่ขึ้นต้น $2 มาจากการสมัคร/สร้างเคสใหม่) และ plain text (บัญชีเก่า)
    async function checkPassword(plainText, stored) {
      if (typeof stored !== "string") return false;
      if (stored.startsWith("$2")) return bcrypt.compare(plainText, stored);
      return plainText === stored;
    }

    const pool = await sql.connect(dbConfig);

    // ประกาศด้วย let ที่ scope ของฟังก์ชัน เพื่อไม่ให้ตัวแปรถูก shadow ในบล็อก if
    let row = null;
    let isMatch = false;

    if (role === "admin") {
      const result = await pool
        .request()
        .input("user", sql.NVarChar, username).query(`
          SELECT staff_id AS id, staff_name AS name, staff_password_hash AS password, 'admin' AS role
          FROM Staff
          WHERE RTRIM(staff_account) = @user
        `);
      row = result.recordset[0];

      if (row) {
        isMatch = await checkPassword(password, row.password);
        if (isMatch) {
          return res.status(200).json({
            success: true,
            user: { user_id: row.id, name: row.name, role: "admin" },
          });
        }
        return res.status(401).json({ success: false, message: "รหัสผ่านไม่ถูกต้อง" });
      }
    } else if (role === "relative") {
      // ผู้แจ้ง login ด้วยเบอร์โทรศัพท์ — ตัดช่องโหว่เลข 4 ตัวท้ายทิ้ง
      const result = await pool
        .request()
        .input("phone", sql.NVarChar, username).query(`
          SELECT people_id AS id, people_name AS name, people_phone AS phone,
                 people_password_hash AS password, 'relative' AS role
          FROM People
          WHERE people_phone = @phone OR people_account = @phone
        `);
      row = result.recordset[0];

      if (row) {
        isMatch = await checkPassword(password, row.password);
        if (isMatch) {
          return res.status(200).json({
            success: true,
            user: { user_id: row.id, name: row.name, role: "relative" },
          });
        }
        return res.status(401).json({ success: false, message: "รหัสผ่านไม่ถูกต้อง" });
      }
      return res.status(401).json({ success: false, message: "ไม่พบข้อมูลบัญชีผู้ใช้งานนี้" });
    }

    // ไม่พบข้อมูล หรือ role ไม่ถูกต้อง
    return res.status(401).json({ success: false, message: "ชื่อผู้ใช้งาน หรือ รหัสผ่านไม่ถูกต้อง" });
  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
