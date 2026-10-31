const express = require("express");
const mariadb = require("mariadb");
const bcrypt = require("bcryptjs");
const session = require("express-session");

const app = express();
const pool = mariadb.createPool({ host: "10.200.210.117", port: 3306, user: "std13", password: "std13", database: "db_std13", connectionLimit: 5, dateStrings: true });
const PORT = 3113;
const SESSION_COOKIE = "market.sid";
const loginAttempts = new Map();
app.use(express.json({ limit: "32kb" }));
app.use(session({ name: SESSION_COOKIE, secret: "std13-classroom-session-secret-change-before-production", resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: "lax", secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 } }));
app.use(express.static("public"));

function sendError(res, status, code, message, fields = {}) { return res.status(status).json({ error: { code, message, fields } }); }
function validId(value) { return /^\d+$/.test(String(value)) && Number(value) > 0 && Number(value) <= 4294967295; }
function validDate(value) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false; const d = new Date(`${value}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value; }
function pageParams(query) { const page = /^\d+$/.test(query.page || "") ? Math.max(1, Number(query.page)) : 1; const limit = /^\d+$/.test(query.limit || "") ? Math.min(100, Math.max(1, Number(query.limit))) : 20; return { page, limit, offset: (page - 1) * limit }; }
function asyncRoute(fn) { return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next); }
function requireShop(req, res, next) { if (!req.session.shopId) return sendError(res, 401, "UNAUTHENTICATED", "กรุณาเข้าสู่ระบบ"); next(); }
async function getMarket(id) { if (!validId(id)) return null; const rows = await pool.query("SELECT id,name,description,address,map_image AS mapImage FROM markets WHERE id=? AND is_active=1", [Number(id)]); return rows[0] || null; }
async function initializeSchema() {
  const ddl = [
    `CREATE TABLE IF NOT EXISTS markets (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,name VARCHAR(150) NOT NULL,description TEXT NULL,address VARCHAR(255) NULL,map_image VARCHAR(255) NULL,is_active TINYINT(1) NOT NULL DEFAULT 1,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS shops (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,email VARCHAR(190) NOT NULL,password_hash VARCHAR(255) NOT NULL,name VARCHAR(150) NOT NULL,category VARCHAR(100) NOT NULL,description TEXT NULL,contact VARCHAR(150) NULL,is_active TINYINT(1) NOT NULL DEFAULT 1,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,UNIQUE KEY uq_shops_email(email)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS stalls (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,market_id INT UNSIGNED NOT NULL,stall_code VARCHAR(30) NOT NULL,map_x DECIMAL(7,4) NOT NULL DEFAULT 0,map_y DECIMAL(7,4) NOT NULL DEFAULT 0,status ENUM('available','unavailable') NOT NULL DEFAULT 'available',created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE KEY uq_stalls_market_code(market_id,stall_code),CONSTRAINT fk_stalls_market FOREIGN KEY(market_id) REFERENCES markets(id) ON DELETE RESTRICT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS bookings (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,shop_id INT UNSIGNED NOT NULL,stall_id INT UNSIGNED NOT NULL,booking_date DATE NOT NULL,status ENUM('pending','confirmed','cancelled') NOT NULL DEFAULT 'pending',created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,KEY ix_bookings_stall_date_status(stall_id,booking_date,status),KEY ix_bookings_shop_date(shop_id,booking_date),CONSTRAINT fk_bookings_shop FOREIGN KEY(shop_id) REFERENCES shops(id) ON DELETE RESTRICT,CONSTRAINT fk_bookings_stall FOREIGN KEY(stall_id) REFERENCES stalls(id) ON DELETE RESTRICT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ];
  for (const sql of ddl) await pool.query(sql);
}

async function seedInitialMarket() {
  const marketName = "ตลาดตัวอย่าง ตากหลาดนัด";
  let rows = await pool.query("SELECT id FROM markets WHERE name=? LIMIT 1", [marketName]);
  let marketId;
  if (rows.length) {
    marketId = Number(rows[0].id);
  } else {
    const result = await pool.query(
      "INSERT INTO markets (name,description,address,is_active) VALUES (?,?,?,1)",
      [marketName, "ตลาดตัวอย่างสำหรับทดลองใช้งาน ปรับข้อมูลและผังจริงก่อนเปิดให้ลูกค้า", "ข้อมูลสถานที่ตัวอย่าง"]
    );
    marketId = Number(result.insertId);
  }

  const stalls = [];
  for (let index = 0; index < 32; index += 1) {
    const row = Math.floor(index / 8);
    const column = index % 8;
    stalls.push([marketId, `A${String(index + 1).padStart(2, "0")}`, 8 + column * 12, 12 + row * 24]);
  }
  await pool.batch(
    "INSERT IGNORE INTO stalls (market_id,stall_code,map_x,map_y,status) VALUES (?,?,?,?, 'available')",
    stalls
  );
}

app.get("/api/health", asyncRoute(async (req, res) => { await pool.query("SELECT 1"); res.json({ data: { status: "ok", database: "connected" } }); }));
app.post("/api/auth/register", asyncRoute(async (req, res) => {
  const b = req.body || {}, email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  const fields = {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 190) fields.email = "อีเมลไม่ถูกต้อง";
  if (typeof b.password !== "string" || b.password.length < 8 || b.password.length > 128) fields.password = "รหัสผ่านต้องมี 8-128 ตัวอักษร";
  if (typeof b.shopName !== "string" || !b.shopName.trim() || b.shopName.trim().length > 150) fields.shopName = "กรุณากรอกชื่อร้านไม่เกิน 150 ตัวอักษร";
  if (typeof b.category !== "string" || !b.category.trim() || b.category.trim().length > 100) fields.category = "กรุณากรอกหมวดสินค้าไม่เกิน 100 ตัวอักษร";
  if (typeof (b.contact || "") !== "string" || (b.contact || "").length > 150) fields.contact = "ช่องทางติดต่อยาวเกินกำหนด";
  if (Object.keys(fields).length) return sendError(res, 400, "VALIDATION_ERROR", "กรุณาตรวจสอบข้อมูล", fields);
  const hash = await bcrypt.hash(b.password, 12);
  try {
    const result = await pool.query("INSERT INTO shops(email,password_hash,name,category,contact) VALUES(?,?,?,?,?)", [email, hash, b.shopName.trim(), b.category.trim(), (b.contact || "").trim()]);
    req.session.shopId = Number(result.insertId);
    res.status(201).json({ data: { id: Number(result.insertId), email, name: b.shopName.trim(), category: b.category.trim(), contact: (b.contact || "").trim() } });
  } catch (e) { if (e.code === "ER_DUP_ENTRY") return sendError(res, 409, "EMAIL_ALREADY_EXISTS", "อีเมลนี้ถูกใช้แล้ว"); throw e; }
}));
app.post("/api/auth/login", asyncRoute(async (req, res) => {
  const ip = req.ip, a = loginAttempts.get(ip) || { count: 0, until: 0 };
  if (a.until > Date.now() && a.count >= 10) return sendError(res, 429, "LOGIN_RATE_LIMIT", "พยายามเข้าสู่ระบบมากเกินไป กรุณารอสักครู่");
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "", password = typeof req.body?.password === "string" ? req.body.password : "";
  const rows = await pool.query("SELECT id,email,password_hash,name,category,description,contact,is_active FROM shops WHERE email=? LIMIT 1", [email]);
  const shop = rows[0];
  if (!shop || !(await bcrypt.compare(password, shop.password_hash))) { const entry = a.until > Date.now() ? a : { count: 0, until: Date.now() + 900000 }; entry.count++; loginAttempts.set(ip, entry); return sendError(res, 401, "INVALID_CREDENTIALS", "อีเมลหรือรหัสผ่านไม่ถูกต้อง"); }
  if (!shop.is_active) return sendError(res, 403, "ACCOUNT_DISABLED", "บัญชีนี้ถูกปิดใช้งาน");
  loginAttempts.delete(ip);
  req.session.regenerate(error => { if (error) return sendError(res, 500, "INTERNAL_ERROR", "เกิดข้อผิดพลาดภายในระบบ"); req.session.shopId = Number(shop.id); res.json({ data: { id: Number(shop.id), email: shop.email, name: shop.name, category: shop.category, description: shop.description, contact: shop.contact } }); });
}));
app.post("/api/auth/logout", requireShop, (req, res) => req.session.destroy(() => { res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: "lax" }); res.status(204).end(); }));
app.get("/api/auth/me", requireShop, asyncRoute(async (req, res) => { const rows = await pool.query("SELECT id,email,name,category,description,contact,is_active FROM shops WHERE id=?", [req.session.shopId]); if (!rows[0] || !rows[0].is_active) return sendError(res, 401, "UNAUTHENTICATED", "กรุณาเข้าสู่ระบบ"); res.json({ data: rows[0] }); }));

app.get("/api/markets", asyncRoute(async (req, res) => {
  const { page, limit, offset } = pageParams(req.query), q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "", like = `%${q}%`;
  const params = [q, like, like], count = await pool.query("SELECT COUNT(*) total FROM markets WHERE is_active=1 AND (?='' OR name LIKE ? OR address LIKE ?)", params);
  const rows = await pool.query("SELECT id,name,description,address FROM markets WHERE is_active=1 AND (?='' OR name LIKE ? OR address LIKE ?) ORDER BY id LIMIT ? OFFSET ?", [...params, limit, offset]);
  res.json({ data: rows, meta: { page, limit, total: Number(count[0].total) } });
}));
app.get("/api/markets/:marketId", asyncRoute(async (req, res) => { const market = await getMarket(req.params.marketId); if (!market) return sendError(res, 404, "MARKET_NOT_FOUND", "ไม่พบตลาดนี้"); res.json({ data: market }); }));
app.get("/api/markets/:marketId/map", asyncRoute(async (req, res) => {
  const market = await getMarket(req.params.marketId); if (!market) return sendError(res, 404, "MARKET_NOT_FOUND", "ไม่พบตลาดนี้");
  const date = req.query.date || new Date().toISOString().slice(0, 10); if (!validDate(date)) return sendError(res, 400, "VALIDATION_ERROR", "วันที่ต้องเป็น YYYY-MM-DD", { date: "วันที่ไม่ถูกต้อง" });
  const rows = await pool.query(`SELECT s.id,s.stall_code code,s.map_x x,s.map_y y,s.status stallStatus,b.id bookingId,sh.id shopId,sh.name shopName,sh.category shopCategory,sh.description shopDescription,sh.contact shopContact FROM stalls s LEFT JOIN bookings b ON b.stall_id=s.id AND b.booking_date=? AND b.status='confirmed' LEFT JOIN shops sh ON sh.id=b.shop_id AND sh.is_active=1 WHERE s.market_id=? ORDER BY s.stall_code`, [date, market.id]);
  const stalls = rows.map(r => ({ id: r.id, code: r.code, x: Number(r.x), y: Number(r.y), status: r.stallStatus === "unavailable" ? "unavailable" : r.bookingId ? "occupied" : "available", shop: r.bookingId && r.shopId ? { id: r.shopId, name: r.shopName, category: r.shopCategory, description: r.shopDescription, contact: r.shopContact } : null }));
  res.json({ data: { market, date, stalls } });
}));
app.get("/api/markets/:marketId/shops", asyncRoute(async (req, res) => {
  const market = await getMarket(req.params.marketId); if (!market) return sendError(res, 404, "MARKET_NOT_FOUND", "ไม่พบตลาดนี้");
  const date = req.query.date || new Date().toISOString().slice(0, 10); if (!validDate(date)) return sendError(res, 400, "VALIDATION_ERROR", "วันที่ไม่ถูกต้อง");
  const { page, limit, offset } = pageParams(req.query), q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "", category = typeof req.query.category === "string" ? req.query.category.trim().slice(0, 100) : "";
  const params = [market.id, date, q, `%${q}%`, `%${q}%`, `%${q}%`, category, category], where = "s.market_id=? AND b.booking_date=? AND b.status='confirmed' AND sh.is_active=1 AND (?='' OR sh.name LIKE ? OR sh.category LIKE ? OR sh.description LIKE ?) AND (?='' OR sh.category=?)";
  const count = await pool.query(`SELECT COUNT(*) total FROM bookings b JOIN stalls s ON s.id=b.stall_id JOIN shops sh ON sh.id=b.shop_id WHERE ${where}`, params);
  const rows = await pool.query(`SELECT sh.id,sh.name,sh.category,sh.description,sh.contact,s.stall_code stallCode FROM bookings b JOIN stalls s ON s.id=b.stall_id JOIN shops sh ON sh.id=b.shop_id WHERE ${where} ORDER BY sh.name LIMIT ? OFFSET ?`, [...params, limit, offset]);
  res.json({ data: rows, meta: { page, limit, total: Number(count[0].total) } });
}));
app.get("/api/markets/:marketId/shops/:shopId", asyncRoute(async (req, res) => {
  const market = await getMarket(req.params.marketId); if (!market) return sendError(res, 404, "MARKET_NOT_FOUND", "ไม่พบตลาดนี้");
  const date = req.query.date || new Date().toISOString().slice(0, 10); if (!validId(req.params.shopId)) return sendError(res, 404, "SHOP_NOT_FOUND", "ไม่พบร้านนี้"); if (!validDate(date)) return sendError(res, 400, "VALIDATION_ERROR", "วันที่ไม่ถูกต้อง");
  const rows = await pool.query("SELECT sh.id,sh.name,sh.category,sh.description,sh.contact,s.stall_code stallCode FROM bookings b JOIN stalls s ON s.id=b.stall_id JOIN shops sh ON sh.id=b.shop_id WHERE s.market_id=? AND sh.id=? AND b.booking_date=? AND b.status='confirmed' AND sh.is_active=1 LIMIT 1", [market.id, Number(req.params.shopId), date]);
  if (!rows[0]) return sendError(res, 404, "SHOP_NOT_FOUND", "ไม่พบร้านนี้ในตลาดและวันที่เลือก"); res.json({ data: rows[0] });
}));

app.get("/api/shops/me", requireShop, asyncRoute(async (req, res) => { const rows = await pool.query("SELECT id,email,name,category,description,contact FROM shops WHERE id=? AND is_active=1", [req.session.shopId]); if (!rows[0]) return sendError(res, 404, "SHOP_NOT_FOUND", "ไม่พบข้อมูลร้าน"); res.json({ data: rows[0] }); }));
app.patch("/api/shops/me", requireShop, asyncRoute(async (req, res) => {
  const allowed = ["name", "category", "description", "contact"], keys = Object.keys(req.body || {}), fields = {};
  if (!keys.length || keys.some(k => !allowed.includes(k))) fields.body = "ส่งได้เฉพาะ name, category, description, contact";
  for (const k of keys) { const max = k === "description" ? 5000 : k === "contact" || k === "name" ? 150 : 100, v = req.body[k]; if (typeof v !== "string" || v.length > max || (["name", "category"].includes(k) && !v.trim())) fields[k] = `ข้อมูล ${k} ไม่ถูกต้อง`; }
  if (Object.keys(fields).length) return sendError(res, 400, "VALIDATION_ERROR", "กรุณาตรวจสอบข้อมูล", fields);
  const assignments = keys.map(k => `${k}=?`).join(",");
  await pool.query(`UPDATE shops SET ${assignments} WHERE id=?`, [...keys.map(k => req.body[k].trim()), req.session.shopId]);
  const rows = await pool.query("SELECT id,email,name,category,description,contact FROM shops WHERE id=?", [req.session.shopId]); res.json({ data: rows[0] });
}));
app.get("/api/shops/me/bookings", requireShop, asyncRoute(async (req, res) => {
  const { page, limit, offset } = pageParams(req.query), status = typeof req.query.status === "string" ? req.query.status : "";
  if (status && !["pending", "confirmed", "cancelled"].includes(status)) return sendError(res, 400, "VALIDATION_ERROR", "สถานะไม่ถูกต้อง");
  if ((req.query.from && !validDate(req.query.from)) || (req.query.to && !validDate(req.query.to))) return sendError(res, 400, "VALIDATION_ERROR", "วันที่ไม่ถูกต้อง");
  const where = "b.shop_id=? AND (?='' OR b.status=?) AND (?='' OR b.booking_date>=?) AND (?='' OR b.booking_date<=?)", values = [req.session.shopId, status, status, req.query.from || "", req.query.from || "", req.query.to || "", req.query.to || ""];
  const count = await pool.query(`SELECT COUNT(*) total FROM bookings b WHERE ${where}`, values);
  const rows = await pool.query(`SELECT b.id,b.booking_date bookingDate,b.status,b.created_at createdAt,s.id stallId,s.stall_code stallCode,m.id marketId,m.name marketName FROM bookings b JOIN stalls s ON s.id=b.stall_id JOIN markets m ON m.id=s.market_id WHERE ${where} ORDER BY b.booking_date DESC,b.id DESC LIMIT ? OFFSET ?`, [...values, limit, offset]);
  res.json({ data: rows, meta: { page, limit, total: Number(count[0].total) } });
}));
app.post("/api/markets/:marketId/bookings", requireShop, asyncRoute(async (req, res) => {
  const market = await getMarket(req.params.marketId); if (!market) return sendError(res, 404, "MARKET_NOT_FOUND", "ไม่พบตลาดนี้");
  const { stallId, bookingDate } = req.body || {}; if (!validId(stallId) || !validDate(bookingDate)) return sendError(res, 400, "VALIDATION_ERROR", "กรุณาระบุแผงและวันที่ให้ถูกต้อง");
  let conn; try {
    conn = await pool.getConnection(); await conn.beginTransaction();
    const stalls = await conn.query("SELECT id,stall_code,status FROM stalls WHERE id=? AND market_id=? FOR UPDATE", [Number(stallId), market.id]);
    if (!stalls[0]) { await conn.rollback(); return sendError(res, 404, "STALL_NOT_FOUND", "ไม่พบแผงในตลาดนี้"); }
    if (stalls[0].status !== "available") { await conn.rollback(); return sendError(res, 409, "STALL_UNAVAILABLE", "แผงนี้ไม่เปิดให้จอง"); }
    const existing = await conn.query("SELECT id FROM bookings WHERE stall_id=? AND booking_date=? AND status IN ('pending','confirmed') LIMIT 1", [Number(stallId), bookingDate]);
    if (existing.length) { await conn.rollback(); return sendError(res, 409, "STALL_UNAVAILABLE", "แผงนี้ถูกจองแล้ว"); }
    const result = await conn.query("INSERT INTO bookings(shop_id,stall_id,booking_date,status) VALUES(?,?,?,'pending')", [req.session.shopId, Number(stallId), bookingDate]); await conn.commit();
    res.status(201).json({ data: { id: Number(result.insertId), marketId: Number(market.id), stallId: Number(stallId), stallCode: stalls[0].stall_code, bookingDate, status: "pending" } });
  } catch (e) { if (conn) await conn.rollback(); if (e.code === "ER_DUP_ENTRY") return sendError(res, 409, "STALL_UNAVAILABLE", "แผงนี้ถูกจองแล้ว"); throw e; } finally { if (conn) conn.release(); }
}));
app.get("/api/shops/me/bookings/:bookingId", requireShop, asyncRoute(async (req, res) => { if (!validId(req.params.bookingId)) return sendError(res, 404, "BOOKING_NOT_FOUND", "ไม่พบรายการจอง"); const rows = await pool.query("SELECT b.id,b.booking_date bookingDate,b.status,b.created_at createdAt,s.id stallId,s.stall_code stallCode,m.id marketId,m.name marketName FROM bookings b JOIN stalls s ON s.id=b.stall_id JOIN markets m ON m.id=s.market_id WHERE b.id=? AND b.shop_id=?", [Number(req.params.bookingId), req.session.shopId]); if (!rows[0]) return sendError(res, 404, "BOOKING_NOT_FOUND", "ไม่พบรายการจอง"); res.json({ data: rows[0] }); }));
app.patch("/api/shops/me/bookings/:bookingId/cancel", requireShop, asyncRoute(async (req, res) => { if (!validId(req.params.bookingId)) return sendError(res, 404, "BOOKING_NOT_FOUND", "ไม่พบรายการจอง"); const result = await pool.query("UPDATE bookings SET status='cancelled' WHERE id=? AND shop_id=? AND status='pending'", [Number(req.params.bookingId), req.session.shopId]); if (!result.affectedRows) { const rows = await pool.query("SELECT id FROM bookings WHERE id=? AND shop_id=?", [Number(req.params.bookingId), req.session.shopId]); if (!rows.length) return sendError(res, 404, "BOOKING_NOT_FOUND", "ไม่พบรายการจอง"); return sendError(res, 409, "BOOKING_CANNOT_BE_CANCELLED", "ยกเลิกได้เฉพาะรายการที่รอตรวจสอบ"); } res.json({ data: { id: Number(req.params.bookingId), status: "cancelled" } }); }));

app.use((req, res) => sendError(res, 404, "NOT_FOUND", "ไม่พบ endpoint นี้"));
app.use((error, req, res, next) => { if (res.headersSent) return next(error); console.error("Request failed:", error.code || error.message); return sendError(res, 500, "INTERNAL_ERROR", "เกิดข้อผิดพลาดภายในระบบ"); });
initializeSchema().then(seedInitialMarket).then(() => app.listen(PORT, () => console.log(`Server listening on port ${PORT}`))).catch(error => { console.error("Database initialization failed:", error.code || error.message); process.exitCode = 1; });
