const express = require("express");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const XLSX = require("xlsx");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProd = process.env.NODE_ENV === "production";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}
if (!process.env.SESSION_SECRET) {
  console.error("SESSION_SECRET is required.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProd ? { rejectUnauthorized: false } : false
});

app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));

app.use(session({
  store: new pgSession({
    pool,
    tableName: "user_sessions",
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    maxAge: 1000 * 60 * 60 * 24 * 14
  }
}));



async function q(text, params = []) {
  return pool.query(text, params);
}

async function initDb() {
  const schema = require("fs").readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await q(schema);
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Authentication required." });
  next();
}

function money(v) {
  return Number(Number(v || 0).toFixed(2));
}

function monthBounds(offset = 0) {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + offset;
  const start = new Date(y, m, 1);
  const end = new Date(y, m + 1, 1);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10)
  };
}

function dateString(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function weekStart() {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function previousWeekStart() {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff - 7);
  return d.toISOString().slice(0, 10);
}

function validateAmount(amount) {
  return Number.isFinite(Number(amount)) && Number(amount) > 0 && Number(amount) <= 100000000;
}

// Setup: only available when no users exist.
app.get("/api/setup/status", async (req, res) => {
  try {
    const r = await q("SELECT COUNT(*)::int AS count FROM users");
    res.json({ needsSetup: r.rows[0].count === 0 });
  } catch (e) {
    res.status(500).json({ error: "Database unavailable." });
  }
});

app.post("/api/setup", async (req, res) => {
  const { name, email, password, currentBalance, monthlyCreditTarget, monthlyExpenseLimit, savingsTarget } = req.body;
  const client = await pool.connect();
  try {
    const count = await client.query("SELECT COUNT(*)::int AS count FROM users");
    if (count.rows[0].count > 0) return res.status(409).json({ error: "Initial setup has already been completed." });

    if (!name || !email || !password || password.length < 10) {
      return res.status(400).json({ error: "Name, email and a password of at least 10 characters are required." });
    }
    const hash = await bcrypt.hash(password, 12);
    await client.query("BEGIN");
    const u = await client.query(
      "INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id,name,email",
      [String(name).trim(), String(email).trim().toLowerCase(), hash]
    );
    await client.query(
      `INSERT INTO settings(user_id,current_balance,monthly_credit_target,monthly_expense_limit,savings_target)
       VALUES($1,$2,$3,$4,$5)`,
      [u.rows[0].id, money(currentBalance), money(monthlyCreditTarget), money(monthlyExpenseLimit), money(savingsTarget)]
    );
    await client.query("INSERT INTO user_presence(user_id) VALUES($1)", [u.rows[0].id]);
    await client.query("COMMIT");

    req.session.userId = u.rows[0].id;
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(500).json({ error: "Unable to complete setup." });
  } finally {
    client.release();
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const r = await q("SELECT * FROM users WHERE email=$1", [String(email || "").trim().toLowerCase()]);
    if (!r.rows[0] || !(await bcrypt.compare(String(password || ""), r.rows[0].password_hash))) {
      return res.status(401).json({ error: "Incorrect email or password." });
    }
    req.session.userId = r.rows[0].id;
    await q(
      `INSERT INTO user_presence(user_id,last_seen) VALUES($1,NOW())
       ON CONFLICT(user_id) DO UPDATE SET last_seen=NOW()`,
      [r.rows[0].id]
    );
    await q("INSERT INTO audit_logs(user_id,action) VALUES($1,$2)", [r.rows[0].id, "login"]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Login failed." });
  }
});

app.post("/api/auth/logout", requireAuth, async (req, res) => {
  const id = req.session.userId;
  await q("DELETE FROM user_presence WHERE user_id=$1", [id]).catch(() => {});
  await q("INSERT INTO audit_logs(user_id,action) VALUES($1,$2)", [id, "logout"]).catch(() => {});
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  const r = await q("SELECT id,name,email FROM users WHERE id=$1", [req.session.userId]);
  if (!r.rows[0]) return res.status(401).json({ error: "Session invalid." });
  await q(
    `INSERT INTO user_presence(user_id,last_seen) VALUES($1,NOW())
     ON CONFLICT(user_id) DO UPDATE SET last_seen=NOW()`,
    [req.session.userId]
  );
  res.json(r.rows[0]);
});

app.post("/api/presence", requireAuth, async (req, res) => {
  await q(
    `INSERT INTO user_presence(user_id,last_seen) VALUES($1,NOW())
     ON CONFLICT(user_id) DO UPDATE SET last_seen=NOW()`,
    [req.session.userId]
  );
  res.json({ ok: true });
});

app.get("/api/active-users", requireAuth, async (req, res) => {
  const r = await q(
    `SELECT u.id,u.name,u.email,p.last_seen
     FROM user_presence p JOIN users u ON u.id=p.user_id
     WHERE p.last_seen > NOW() - INTERVAL '5 minutes'
     ORDER BY p.last_seen DESC`
  );
  res.json(r.rows);
});

app.get("/api/settings", requireAuth, async (req, res) => {
  const r = await q("SELECT * FROM settings WHERE user_id=$1", [req.session.userId]);
  res.json(r.rows[0]);
});

app.put("/api/settings", requireAuth, async (req, res) => {
  const s = req.body;
  await q(
    `UPDATE settings SET current_balance=$1,monthly_credit_target=$2,monthly_expense_limit=$3,
     savings_target=$4,reminder_enabled=$5,reminder_time=$6,sound_enabled=$7,
     browser_notifications=$8,theme=$9,updated_at=NOW() WHERE user_id=$10`,
    [
      money(s.current_balance), money(s.monthly_credit_target), money(s.monthly_expense_limit),
      money(s.savings_target), !!s.reminder_enabled, String(s.reminder_time || "20:00"),
      !!s.sound_enabled, !!s.browser_notifications, s.theme === "light" ? "light" : "dark",
      req.session.userId
    ]
  );
  res.json({ ok: true });
});

app.post("/api/settings/balance", requireAuth, async (req, res) => {
  const newBalance = Number(req.body.balance);
  if (!Number.isFinite(newBalance)) return res.status(400).json({ error: "Invalid balance." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const old = await client.query("SELECT current_balance FROM settings WHERE user_id=$1 FOR UPDATE", [req.session.userId]);
    await client.query("UPDATE settings SET current_balance=$1,updated_at=NOW() WHERE user_id=$2", [money(newBalance), req.session.userId]);
    await client.query(
      "INSERT INTO balance_adjustments(user_id,old_balance,new_balance,reason) VALUES($1,$2,$3,$4)",
      [req.session.userId, old.rows[0].current_balance, money(newBalance), String(req.body.reason || "Manual balance adjustment")]
    );
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Unable to update balance." });
  } finally {
    client.release();
  }
});

app.post("/api/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 10) return res.status(400).json({ error: "New password must be at least 10 characters." });
  const u = await q("SELECT password_hash FROM users WHERE id=$1", [req.session.userId]);
  if (!u.rows[0] || !(await bcrypt.compare(String(currentPassword), u.rows[0].password_hash))) {
    return res.status(401).json({ error: "Current password is incorrect." });
  }
  const hash = await bcrypt.hash(newPassword, 12);
  await q("UPDATE users SET password_hash=$1 WHERE id=$2", [hash, req.session.userId]);
  res.json({ ok: true });
});

app.get("/api/expenses", requireAuth, async (req, res) => {
  const r = await q(
    `SELECT id,expense_date,expense_time,amount,category,description,payment_method,notes
     FROM expenses WHERE user_id=$1 ORDER BY expense_date DESC,expense_time DESC,id DESC`,
    [req.session.userId]
  );
  res.json(r.rows);
});

app.post("/api/expenses", requireAuth, async (req, res) => {
  const { date, time, amount, category, description, paymentMethod, notes } = req.body;
  if (!validateAmount(amount) || !category || !date) return res.status(400).json({ error: "Date, category and a valid amount are required." });

  const r = await q(
    `INSERT INTO expenses(user_id,expense_date,expense_time,amount,category,description,payment_method,notes)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.session.userId, date, time || null, money(amount), String(category), String(description || ""), String(paymentMethod || "UPI"), String(notes || "")]
  );
  res.json(r.rows[0]);
});

app.put("/api/expenses/:id", requireAuth, async (req, res) => {
  const { date, time, amount, category, description, paymentMethod, notes } = req.body;
  if (!validateAmount(amount) || !category || !date) return res.status(400).json({ error: "Invalid expense." });
  const r = await q(
    `UPDATE expenses SET expense_date=$1,expense_time=$2,amount=$3,category=$4,description=$5,
     payment_method=$6,notes=$7,updated_at=NOW()
     WHERE id=$8 AND user_id=$9 RETURNING *`,
    [date, time || null, money(amount), String(category), String(description || ""), String(paymentMethod || "UPI"), String(notes || ""), req.params.id, req.session.userId]
  );
  if (!r.rows[0]) return res.status(404).json({ error: "Expense not found." });
  res.json(r.rows[0]);
});

app.delete("/api/expenses/:id", requireAuth, async (req, res) => {
  const r = await q("DELETE FROM expenses WHERE id=$1 AND user_id=$2 RETURNING id", [req.params.id, req.session.userId]);
  if (!r.rows[0]) return res.status(404).json({ error: "Expense not found." });
  res.json({ ok: true });
});

app.get("/api/credits", requireAuth, async (req, res) => {
  const r = await q(
    `SELECT id,credit_date,amount,source,description FROM credits
     WHERE user_id=$1 ORDER BY credit_date DESC,id DESC`,
    [req.session.userId]
  );
  res.json(r.rows);
});

app.post("/api/credits", requireAuth, async (req, res) => {
  const { date, amount, source, description } = req.body;
  if (!validateAmount(amount) || !date || !source) return res.status(400).json({ error: "Date, source and valid amount are required." });
  const r = await q(
    `INSERT INTO credits(user_id,credit_date,amount,source,description)
     VALUES($1,$2,$3,$4,$5) RETURNING *`,
    [req.session.userId, date, money(amount), String(source), String(description || "")]
  );
  res.json(r.rows[0]);
});

app.delete("/api/credits/:id", requireAuth, async (req, res) => {
  const r = await q("DELETE FROM credits WHERE id=$1 AND user_id=$2 RETURNING id", [req.params.id, req.session.userId]);
  if (!r.rows[0]) return res.status(404).json({ error: "Credit not found." });
  res.json({ ok: true });
});

async function totalsFor(userId, start, end) {
  const e = await q("SELECT COALESCE(SUM(amount),0) AS total,COUNT(*)::int AS count FROM expenses WHERE user_id=$1 AND expense_date >= $2 AND expense_date < $3", [userId, start, end]);
  const c = await q("SELECT COALESCE(SUM(amount),0) AS total FROM credits WHERE user_id=$1 AND credit_date >= $2 AND credit_date < $3", [userId, start, end]);
  return { expenses: money(e.rows[0].total), count: e.rows[0].count, credits: money(c.rows[0].total) };
}

app.get("/api/dashboard", requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const settings = (await q("SELECT * FROM settings WHERE user_id=$1", [userId])).rows[0];
  const m = monthBounds(0);
  const pm = monthBounds(-1);
  const ws = weekStart();
  const pws = previousWeekStart();
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString().slice(0, 10);
  const today = dateString();

  const [month, prevMonth, week, prevWeek, todayTotals, cat, recent] = await Promise.all([
    totalsFor(userId, m.start, m.end),
    totalsFor(userId, pm.start, pm.end),
    totalsFor(userId, ws, tomorrow),
    totalsFor(userId, pws, ws),
    totalsFor(userId, today, tomorrow),
    q(`SELECT category,COALESCE(SUM(amount),0) AS total FROM expenses
       WHERE user_id=$1 AND expense_date >= $2 AND expense_date < $3
       GROUP BY category ORDER BY total DESC`, [userId,m.start,m.end]),
    q(`SELECT expense_date,category,description,amount,payment_method
       FROM expenses WHERE user_id=$1 ORDER BY expense_date DESC,expense_time DESC,id DESC LIMIT 8`, [userId])
  ]);

  const remaining = money(Number(settings.monthly_expense_limit) - month.expenses);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = Math.max(1, daysInMonth - now.getDate() + 1);
  const dailyRecommended = remaining > 0 ? money(remaining / daysLeft) : 0;

  res.json({
    settings,
    month, prevMonth, week, prevWeek, today: todayTotals,
    category: cat.rows.map(x => ({ category:x.category, total:money(x.total) })),
    recent: recent.rows,
    remaining,
    daysLeft,
    dailyRecommended,
    limitCrossed: Number(settings.monthly_expense_limit) > 0 && month.expenses > Number(settings.monthly_expense_limit)
  });
});

app.get("/api/statistics/weekly", requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const ws = weekStart();
  const r = await q(
    `SELECT expense_date,COALESCE(SUM(amount),0) AS total FROM expenses
     WHERE user_id=$1 AND expense_date >= $2 AND expense_date < ($2::date + INTERVAL '7 days')
     GROUP BY expense_date ORDER BY expense_date`,
    [userId, ws]
  );
  const out = [];
  for (let i=0;i<7;i++) {
    const d = new Date(ws + "T00:00:00");
    d.setDate(d.getDate()+i);
    const ds = d.toISOString().slice(0,10);
    const row = r.rows.find(x => String(x.expense_date).slice(0,10) === ds);
    out.push({ date: ds, total: row ? money(row.total) : 0 });
  }
  res.json(out);
});

app.get("/api/statistics/monthly", requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const months = [];
  for (let i=5;i>=0;i--) {
    const b = monthBounds(-i);
    const t = await totalsFor(userId,b.start,b.end);
    months.push({ month:b.start.slice(0,7), ...t });
  }
  res.json(months);
});

app.get("/api/export.xlsx", requireAuth, async (req, res) => {
  const uid = req.session.userId;
  const expenses = (await q(`SELECT expense_date AS "Date",expense_time AS "Time",category AS "Category",
    description AS "Description",amount AS "Amount",payment_method AS "Payment Method",notes AS "Notes"
    FROM expenses WHERE user_id=$1 ORDER BY expense_date,expense_time`, [uid])).rows;
  const credits = (await q(`SELECT credit_date AS "Date",source AS "Source",amount AS "Amount",description AS "Description"
    FROM credits WHERE user_id=$1 ORDER BY credit_date`, [uid])).rows;
  const monthly = (await q(`SELECT TO_CHAR(DATE_TRUNC('month',expense_date),'YYYY-MM') AS "Month",
    COALESCE(SUM(amount),0) AS "Total Expenses", COUNT(*) AS "Transactions"
    FROM expenses WHERE user_id=$1 GROUP BY 1 ORDER BY 1`, [uid])).rows;
  const categories = (await q(`SELECT category AS "Category",COALESCE(SUM(amount),0) AS "Total Amount",
    COUNT(*) AS "Transactions" FROM expenses WHERE user_id=$1 GROUP BY category ORDER BY 2 DESC`, [uid])).rows;
  const daily = (await q(`SELECT expense_date AS "Date",COALESCE(SUM(amount),0) AS "Total Expense",COUNT(*) AS "Transaction Count"
    FROM expenses WHERE user_id=$1 GROUP BY expense_date ORDER BY expense_date`, [uid])).rows;

  const wb = XLSX.utils.book_new();
  for (const [name, data] of [["Expense History",expenses],["Credits",credits],["Monthly Summary",monthly],["Category Summary",categories],["Daily Summary",daily]]) {
    const ws = XLSX.utils.json_to_sheet(data);
    ws["!cols"] = Object.keys(data[0] || {}).map(k => ({ wch: Math.max(14, Math.min(32, k.length + 4)) }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  const buffer = XLSX.write(wb, { type:"buffer", bookType:"xlsx" });
  res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="expense-tracker-${dateString()}.xlsx"`);
  res.send(buffer);
});

module.exports = { app, initDb };
