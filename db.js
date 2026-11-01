require("dotenv").config();

const { Pool, types } = require("pg");

// Return PostgreSQL DATE columns (OID 1082) as exact YYYY-MM-DD strings without timezone conversion
types.setTypeParser(1082, (str) => str);

const isLocal =
    !process.env.DATABASE_URL &&
    (!process.env.DB_HOST ||
        process.env.DB_HOST === "localhost" ||
        process.env.DB_HOST === "127.0.0.1");

// Determine SSL config:
// - If DB_SSL is explicitly set to "false", disable SSL
// - If local without DB_SSL="true", disable SSL
// - Otherwise enable SSL with rejectUnauthorized: false by default for cloud providers (Neon, Render, Heroku)
const sslConfig =
    process.env.DB_SSL === "false" || (isLocal && process.env.DB_SSL !== "true")
        ? false
        : {
              rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === "true"
          };

const poolConfig = process.env.DATABASE_URL
    ? {
          connectionString: process.env.DATABASE_URL,
          ssl: sslConfig
      }
    : {
          host: process.env.DB_HOST,
          port: Number(process.env.DB_PORT || 5432),
          database: process.env.DB_NAME,
          user: process.env.DB_USER,
          password: process.env.DB_PASSWORD,
          ssl: sslConfig
      };

const pool = new Pool(poolConfig);

pool.on("error", (err) => {
    console.error("Unexpected error on idle database client:", err.message);
});

module.exports = pool;
