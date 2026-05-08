const express = require("express");
const router = express.Router();
const { sql, dbConfig } = require("../config/db");

// --- 1. สมัครสมาชิก (Register) ---
router.post("/register", async (req, res) => {
    try {
        const { username, password } = req.body;
        const pool = await sql.connect(dbConfig);
        
        await pool.request()
            .input("user", sql.NVarChar, username)
            .input("pass", sql.NVarChar, password)
            .query(`
  INSERT INTO Users
  (
    username,
    password_hash
  )
  VALUES
  (
    @user,
    @pass
  )
`);

        res.status(201).json({ success: true, message: "ลงทะเบียนสำเร็จ" });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- 2. เข้าสู่ระบบ (Login) ---
router.post("/login", async (req, res) => {
    try {
        const { username, password } = req.body;
        const pool = await sql.connect(dbConfig);

        const result = await pool.request()
            .input("user", sql.NVarChar, username)
            .input("pass", sql.NVarChar, password)
            .query(`
  SELECT
    user_id,
    username
  FROM Users
  WHERE username = @user
    AND password_hash = @pass
`);

        if (result.recordset.length > 0) {
            res.json({ success: true, user: result.recordset[0] });
        } else {
            res.status(401).json({ success: false, message: "Username หรือ Password ไม่ถูกต้อง" });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;