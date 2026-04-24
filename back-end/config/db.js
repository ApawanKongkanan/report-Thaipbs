const sql = require("mssql");
const dbConfig = {
  server: "DESKTOP-HP",
  database: "MissingPersonDB",
  user: "sa",
  password: "StrongPass123",
  port: 1433,
  options: {
    trustServerCertificate: true,
    enableArithAbort: true,
  },
};

module.exports = { sql, dbConfig };