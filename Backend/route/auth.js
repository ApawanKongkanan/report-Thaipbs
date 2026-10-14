
const express = require("express");
const { sql, dbConfig } = require("../config/db");
const bcrypt = require("bcrypt");
const rateLimit = require("express-rate-limit");

const router = express.Router();

// ========================================
// 1. RATE LIMITING
// ========================================

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "ลองเข้าสู่ระบบหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่",
  },
});

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "ลงทะเบียนหลายครั้งเกินไป กรุณาลองใหม่ภายหลัง",
  },
});

// ========================================
// 2. VALIDATION HELPERS
// ========================================

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function isValidText(value, maxLength) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= maxLength
  );
}

function normalizePhone(value) {
  if (typeof value !== "string") return "";

  let phone = value.replace(/\D/g, "");

  // รองรับเบอร์ที่เขียนเป็นรหัสประเทศ 66
  if (phone.startsWith("66") && phone.length === 11) {
    phone = "0" + phone.slice(2);
  }

  return phone;
}

function normalizeThaiId(identity) {
  if (typeof identity !== "string") {
    return "";
  }

  const value = identity.trim();

  // รับได้ทั้งแบบมีขีดและไม่มีขีด
  if (!/^[0-9-]+$/.test(value)) {
    return "";
  }

  const id = value.replace(/-/g, "");

  // ต้องมีตัวเลข 13 หลัก
  if (!/^\d{13}$/.test(id)) {
    return "";
  }

  return id;
}

function extractThaiId(value) {
  if (typeof value !== "string") return "";

  const match = value.match(
    /บัตรประชาชน\s*:\s*([0-9\s-]{13,25})/
  );

  if (!match) return "";

  const id = match[1].replace(/\D/g, "");

  return id.length === 13 ? id : "";
}

function isValidThaiId(identity) {
    const id = normalizeThaiId(identity);

    if (!/^\d{13}$/.test(id)) {
        return false;
    }

    let sum = 0;

    for (let i = 0; i < 12; i++) {
        sum += Number(id[i]) * (13 - i);
    }

    const checkDigit = (11 - (sum % 11)) % 10;

    return checkDigit === Number(id[12]);
}

function isValidUsername(username) {
  return (
    typeof username === "string" &&
    /^(?=.*[a-z])[a-z0-9._]{4,20}$/.test(username)
  );
}

function isValidRegisterPassword(password) {
  return (
    typeof password === "string" &&
    password.length >= 8 &&
    password.length <= 64 &&
    !/\s/.test(password) &&
    Buffer.byteLength(password, "utf8") <= 72 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /[0-9]/.test(password)
  );
}

function isValidLoginPassword(password) {
  return (
    typeof password === "string" &&
    password.length > 0 &&
    password.trim().length > 0 &&
    Buffer.byteLength(password, "utf8") <= 72
  );
}

function invalidCredentials(res) {
  return res.status(401).json({
    success: false,
    message: "ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง",
  });
}

function normalizeThaiPhone(phone) {
  if (typeof phone !== "string") {
    return null;
  }

  const value = phone.trim();

  // ต้องเป็นรูปแบบ 080-000-0000 เท่านั้น
  if (!/^0[689]\d-\d{3}-\d{4}$/.test(value)) {
    return null;
  }

  return value.replace(/-/g, "");
}

// ========================================
// 3. REGISTER
// POST /api/register
//
// Body:
// {
//   "phone": "0966851040",
//   "identity": "เลขบัตรประชาชน 13 หลัก",
//   "username": "testuser01",
//   "password": "TestPass123"
// }
//
// เชื่อมบัญชีกับ People เดิมเท่านั้น
// ========================================

router.post("/register", registerLimiter, async (req, res) => {
  if (!isPlainObject(req.body)) {
    return res.status(400).json({
      success: false,
      message: "รูปแบบข้อมูลไม่ถูกต้อง",
    });
  }

  const { phone, identity, username, password } = req.body;

  const normalizedPhone = normalizePhone(phone);
  const normalizedIdentity = normalizeThaiId(identity);
  const normalizedUsername =
    typeof username === "string"
      ? username.trim().toLowerCase()
      : "";

  if (!/^0\d{9}$/.test(normalizedPhone)) {
    return res.status(400).json({
      success: false,
      message: "กรุณากรอกเบอร์โทรศัพท์ 10 หลักให้ถูกต้อง",
    });
  }

  if (!isValidThaiId(normalizedIdentity)) {
    return res.status(400).json({
      success: false,
      message: "กรุณากรอกเลขประจำตัวประชาชน 13 หลักให้ถูกต้อง",
    });
  }

  if (!isValidUsername(normalizedUsername)) {
    return res.status(400).json({
      success: false,
      message:
        "ชื่อผู้ใช้ต้องมี 4-20 ตัว ใช้ a-z, 0-9, จุด หรือ underscore และต้องมีตัวอักษรภาษาอังกฤษตัวพิมพ์เล็ก",
    });
  }

  if (!isValidRegisterPassword(password)) {
    return res.status(400).json({
      success: false,
      message:
        "รหัสผ่านต้องมีอย่างน้อย 8 ตัว มีตัวพิมพ์เล็ก ตัวพิมพ์ใหญ่ และตัวเลข โดยห้ามมีช่องว่าง",
    });
  }

  let transaction;
  let transactionFinished = false;

  try {
    const pool = await sql.connect(dbConfig);

    transaction = new sql.Transaction(pool);

    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    // 1. ตรวจสอบ username ซ้ำ
    const accountResult = await new sql.Request(transaction)
      .input("account", sql.NVarChar(100), normalizedUsername)
      .query(`
        SELECT TOP (1) people_id
        FROM dbo.People WITH (UPDLOCK, HOLDLOCK)
        WHERE LOWER(people_account) = @account
      `);

    if (accountResult.recordset.length > 0) {
      await transaction.rollback();
      transactionFinished = true;

      return res.status(409).json({
        success: false,
        message: "ชื่อผู้ใช้นี้มีอยู่แล้ว",
      });
    }

    // 2. ค้นหาบุคคลด้วยเบอร์โทรศัพท์
    // รองรับขีดและช่องว่างในเบอร์ที่บันทึกไว้
    const peopleResult = await new sql.Request(transaction)
      .input("phone", sql.NVarChar(30), normalizedPhone)
      .query(`
        SELECT
          people_id,
          people_phone,
          people_identity,
          people_account,
          people_password_hash
        FROM dbo.People WITH (UPDLOCK, HOLDLOCK)
        WHERE REPLACE(
                REPLACE(
                  LTRIM(RTRIM(people_phone)),
                  '-', ''
                ),
                ' ', ''
              ) = @phone
      `);

    // 3. ตรวจเลขบัตรจากข้อความใน people_identity
    const matches = peopleResult.recordset.filter((person) => {
      return extractThaiId(person.people_identity) === normalizedIdentity;
    });

    // ต้องตรงกับบุคคลเพียงหนึ่งรายการเท่านั้น
    if (matches.length !== 1) {
      await transaction.rollback();
      transactionFinished = true;

      return res.status(400).json({
        success: false,
        message:
          "ไม่สามารถยืนยันข้อมูลได้ กรุณาตรวจสอบข้อมูลหรือติดต่อเจ้าหน้าที่",
      });
    }

    const person = matches[0];

    // 4. ห้ามเขียนทับบัญชีเดิม
    if (
      person.people_account !== null ||
      person.people_password_hash !== null
    ) {
      await transaction.rollback();
      transactionFinished = true;

      return res.status(409).json({
        success: false,
        message:
          "ข้อมูลนี้มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบหรือติดต่อเจ้าหน้าที่",
      });
    }

    // 5. Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 6. อัปเดตแถว People เดิม ไม่ INSERT แถวใหม่
    const updateResult = await new sql.Request(transaction)
      .input("id", sql.Int, person.people_id)
      .input("account", sql.NVarChar(100), normalizedUsername)
      .input("passwordHash", sql.NVarChar(255), hashedPassword)
      .query(`
        UPDATE dbo.People
        SET
          people_account = @account,
          people_password_hash = @passwordHash
        WHERE people_id = @id
          AND people_account IS NULL
          AND people_password_hash IS NULL
      `);

    if (updateResult.rowsAffected[0] !== 1) {
      await transaction.rollback();
      transactionFinished = true;

      return res.status(409).json({
        success: false,
        message:
          "ไม่สามารถสร้างบัญชีได้ กรุณาลองใหม่หรือติดต่อเจ้าหน้าที่",
      });
    }

    await transaction.commit();
    transactionFinished = true;

    return res.status(201).json({
      success: true,
      message: "ลงทะเบียนสำเร็จ",
    });
  } catch (err) {
    if (transaction && !transactionFinished) {
      try {
        await transaction.rollback();
      } catch (_) {
        // Transaction อาจสิ้นสุดไปแล้ว
      }
    }

    console.error("Register Error:", err.message);

    return res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการลงทะเบียน",
    });
  }
});

// ========================================
// 4. LOGIN
// POST /api/login
// Body: { username, password, role }
// role: relative หรือ admin
// ========================================

router.post("/login", loginLimiter, async (req, res) => {
  if (!isPlainObject(req.body)) {
    return res.status(400).json({
      success: false,
      message: "รูปแบบข้อมูลไม่ถูกต้อง",
    });
  }

  const { username, password, role } = req.body;

  if (!isValidText(username, 100)) {
    return res.status(400).json({
      success: false,
      message: "กรุณากรอกชื่อผู้ใช้งาน",
    });
  }

  if (!isValidLoginPassword(password)) {
    return res.status(400).json({
      success: false,
      message: "กรุณากรอกรหัสผ่านให้ถูกต้อง",
    });
  }

  if (role !== "admin" && role !== "relative") {
    return res.status(400).json({
      success: false,
      message: "ประเภทผู้ใช้ไม่ถูกต้อง",
    });
  }

  try {
    const pool = await sql.connect(dbConfig);

    let result;
    const usernameValue =
      role === "relative"
        ? username.trim().toLowerCase()
        : username.trim();

    if (role === "admin") {
      result = await pool
        .request()
        .input("user", sql.NVarChar(100), usernameValue)
        .query(`
          SELECT TOP (2)
            staff_id AS id,
            staff_name AS name,
            staff_password_hash AS password
          FROM dbo.Staff
          WHERE RTRIM(staff_account) = @user
        `);
    } else {
      // Login ด้วย username เท่านั้น
      // ไม่ใช้เลข 4 ตัวท้ายของเบอร์โทรศัพท์เป็น password
      result = await pool
        .request()
        .input("user", sql.NVarChar(100), usernameValue)
        .query(`
          SELECT TOP (2)
            people_id AS id,
            people_name AS name,
            people_password_hash AS password
          FROM dbo.People
          WHERE LOWER(people_account) = @user
        `);
    }

    if (result.recordset.length !== 1) {
      return invalidCredentials(res);
    }

    const user = result.recordset[0];

    if (
      typeof user.password !== "string" ||
      !/^\$2[aby]\$\d{2}\$/.test(user.password)
    ) {
      return invalidCredentials(res);
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return invalidCredentials(res);
    }


await new Promise((resolve, reject) => {
  req.session.regenerate((err) => {
    if (err) return reject(err);
    resolve();
  });
});

// เก็บข้อมูลผู้ใช้ที่ Backend ตรวจสอบแล้วใน Session
req.session.user = {
  user_id: user.id,
  name: user.name,
  role,
};

await new Promise((resolve, reject) => {
  req.session.save((err) => {
    if (err) return reject(err);
    resolve();
  });
});

return res.status(200).json({
  success: true,
  message: "เข้าสู่ระบบสำเร็จ",
  user: {
    user_id: user.id,
    name: user.name,
    role,
  },
});

  } catch (err) {
    console.error("Login Error:", err.message);

    return res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการเข้าสู่ระบบ",
    });
  }
});

router.get("/session", (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({
      success: false,
      authenticated: false,
      message: "กรุณาเข้าสู่ระบบก่อนใช้งาน",
    });
  }

  return res.status(200).json({
    success: true,
    authenticated: true,
    user: req.session.user,
  });
});


router.post("/logout", (req, res) => {
  if (!req.session) {
    return res.status(200).json({
      success: true,
      message: "ออกจากระบบเรียบร้อยแล้ว",
    });
  }

  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: "ออกจากระบบไม่สำเร็จ",
      });
    }

    res.clearCookie("thaipbs.sid", {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });

    return res.status(200).json({
      success: true,
      message: "ออกจากระบบเรียบร้อยแล้ว",
    });
  });
});


module.exports = router;
