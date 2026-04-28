// Framework สำหรับสร้าง Web Server บน Node.js
const express = require("express");
// อนุญาตให้ Frontend เรียก API จากคนละ port / domain ได้
const cors = require("cors");
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

const upload = multer({ storage: storage });
const missingRoutes = require("./routes/missing.routes");
const reportRoutes = require('./routes/report.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
//สร้าง Web Server ขึ้นมา
const app = express();
//เปิดให้ frontend เรียก API ได้
app.use(cors());
//ให้ server อ่าน JSON จาก request body ได้
app.use(express.json());

app.use("/uploads", express.static("uploads"));

// test
app.get("/", (req, res) => {
  res.send("API is running");
});

// เชื่อม route
app.use("/api/missing-persons", missingRoutes);
app.use('/api/reports', reportRoutes);           // สำหรับจัดการเบาะแส
app.use('/api/dashboard', dashboardRoutes);     // สำหรับจัดการหน้า Dashboard

app.listen(3000, () => {
  console.log("Server running at http://localhost:3000");
});