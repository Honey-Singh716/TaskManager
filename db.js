require("dotenv").config();

const { Pool, types } = require("pg");

// Return PostgreSQL DATE columns (OID 1082) as exact YYYY-MM-DD strings without timezone conversion
types.setTypeParser(1082, (str) => str);

const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
});

module.exports = pool;