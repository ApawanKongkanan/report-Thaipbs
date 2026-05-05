// Framework สำหรับสร้าง Web Server บน Node.js
const express = require("express");
// อนุญาตให้ Frontend เรียก API จากคนละ port / domain ได้
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require('fs');

const uploadDir = 'uploads/';
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage: storage });
//สร้าง Web Server ขึ้นมา
const app = express();

//เปิดให้ frontend เรียก API ได้
app.use(cors());
//ให้ server อ่าน JSON จาก request body ได้
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// เชื่อมต่อ Frontend ของเพื่อน
// ชี้ไปที่โฟลเดอร์ front-end ที่อยู่นอกโฟลเดอร์ back-end
app.use("/uploads", express.static("uploads"));
app.use(express.static(path.join(__dirname, "../front-end")));

const missingRoutes = require("./routes/missing.routes");
const reportRoutes = require('./routes/report.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const authRoutes = require('./routes/auth'); 

app.use("/api/missing-persons", missingRoutes);
app.use('/api/reports', upload.any(),reportRoutes);           // สำหรับจัดการเบาะแส
app.use('/api/dashboard', dashboardRoutes);     // สำหรับจัดการหน้า Dashboard
app.use('/api/auth', authRoutes);

// ถ้าเปิดหน้าแรก http://localhost:3000
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../front-end/Homepage.html"));
});

app.listen(3000, () => {
  console.log("Server running at http://localhost:3000");
});