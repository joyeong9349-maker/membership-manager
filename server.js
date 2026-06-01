const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const port = Number(process.env.PORT || 8080);
const host = "0.0.0.0";
const root = __dirname;
const dataDir = process.env.MEMBERSHIP_DATA_DIR ? path.resolve(process.env.MEMBERSHIP_DATA_DIR) : path.join(root, "data");
const encryptedDataFile = path.join(dataDir, "membership-data.enc.json");
const legacyDataFile = path.join(dataDir, "membership-data.json");
const headUser = process.env.MEMBERSHIP_ADMIN_USER || "admin";
const headPassword = process.env.MEMBERSHIP_ADMIN_PASSWORD || process.env.MEMBERSHIP_PASSWORD || "2468";
const dataSecret = process.env.MEMBERSHIP_DATA_SECRET || headPassword;
const sessions = new Map();

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

function createId() {
  return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizePhone(phone) {
  return String(phone || "").replace(/[^0-9]/g, "");
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("base64")) {
  const hash = crypto.scryptSync(String(password), salt, 32).toString("base64");
  return { salt, hash };
}

function verifyPassword(password, user) {
  if (!user?.passwordHash || !user?.salt) return false;
  const expected = Buffer.from(user.passwordHash, "base64");
  const actual = crypto.scryptSync(String(password), user.salt, 32);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function createHeadAccount() {
  const password = hashPassword(headPassword);
  return {
    id: createId(),
    username: headUser,
    displayName: "Head Manager",
    role: "head",
    status: "approved",
    passwordHash: password.hash,
    salt: password.salt,
    createdAt: new Date().toISOString(),
  };
}

function createSeedData() {
  return normalizeState({
    members: [
      {
        id: createId(),
        name: "김서연",
        phone: "010-1234-7788",
        birthday: "1992-05-31",
        points: 6200,
        purchases: [{ id: createId(), amount: 124000, points: 6200, memo: "정기 구매", date: new Date().toISOString() }],
        coupons: [],
      },
      {
        id: createId(),
        name: "박민준",
        phone: "010-8821-4400",
        birthday: "1988-11-09",
        points: 15850,
        purchases: [{ id: createId(), amount: 317000, points: 15850, memo: "VIP 패키지", date: new Date().toISOString() }],
        coupons: [],
      },
    ],
    audit: [],
    users: [createHeadAccount()],
  });
}

function normalizeState(state) {
  const next = {
    members: Array.isArray(state?.members) ? state.members : [],
    audit: Array.isArray(state?.audit) ? state.audit : [],
    users: Array.isArray(state?.users) ? state.users : [],
  };

  if (!next.users.some((user) => user.username === headUser && user.role === "head")) {
    next.users.unshift(createHeadAccount());
  }

  next.members = next.members.map((member) => ({
    id: member.id || createId(),
    name: member.name || "",
    phone: member.phone || "",
    birthday: member.birthday || "",
    email: member.email || "",
    notes: member.notes || "",
    points: Number(member.points || 0),
    purchases: Array.isArray(member.purchases) ? member.purchases : [],
    coupons: Array.isArray(member.coupons) ? member.coupons : [],
  }));

  next.audit = next.audit.map((entry) => {
    if (typeof entry === "string") {
      return { id: createId(), date: new Date().toISOString(), actor: "system", action: entry };
    }
    return { id: entry.id || createId(), date: entry.date || new Date().toISOString(), actor: entry.actor || "system", action: entry.action || "" };
  }).slice(0, 80);

  return next;
}

function publicState(state, session) {
  return {
    members: state.members,
    audit: state.audit,
    users: session.role === "head"
      ? state.users.map(({ passwordHash, salt, ...user }) => user)
      : [],
  };
}

function publicMember(member) {
  return {
    id: member.id,
    name: member.name,
    phone: member.phone,
    birthday: member.birthday,
    email: member.email,
    points: member.points,
    coupons: member.coupons,
    tier: member.points >= 15000 ? "Diamond" : member.points >= 5000 ? "Gold" : "Silver",
  };
}

function addAudit(state, session, action) {
  state.audit = [{
    id: createId(),
    date: new Date().toISOString(),
    actor: session?.username || "system",
    action,
  }, ...state.audit].slice(0, 80);
}

function send(res, status, body, contentType = "text/plain; charset=utf-8", headers = {}) {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    ...headers,
  });
  res.end(body);
}

function sendJson(res, status, data, headers = {}) {
  send(res, status, JSON.stringify(data), "application/json; charset=utf-8", headers);
}

function isValidState(value) {
  return value && Array.isArray(value.members) && Array.isArray(value.audit);
}

function makeKey(salt) {
  return crypto.scryptSync(dataSecret, salt, 32);
}

function encryptState(state) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", makeKey(salt), iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(normalizeState(state)), "utf8")), cipher.final()]);
  return {
    version: 2,
    algorithm: "aes-256-gcm",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: ciphertext.toString("base64"),
  };
}

function decryptState(payload) {
  const salt = Buffer.from(payload.salt, "base64");
  const iv = Buffer.from(payload.iv, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  const ciphertext = Buffer.from(payload.data, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", makeKey(salt), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const state = JSON.parse(plaintext.toString("utf8"));
  if (!isValidState(state)) throw new Error("Invalid data file");
  return normalizeState(state);
}

async function ensureDataFile() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(encryptedDataFile);
    return;
  } catch {
    try {
      const legacyState = JSON.parse(await fs.readFile(legacyDataFile, "utf8"));
      if (isValidState(legacyState)) {
        await writeState(legacyState);
        return;
      }
    } catch {
      // Create a new encrypted store below.
    }
    await writeState(createSeedData());
  }
}

async function readState() {
  await ensureDataFile();
  return decryptState(JSON.parse(await fs.readFile(encryptedDataFile, "utf8")));
}

async function writeState(state) {
  const safeState = normalizeState(state);
  await fs.mkdir(dataDir, { recursive: true });
  const tempFile = `${encryptedDataFile}.tmp`;
  await fs.writeFile(tempFile, `${JSON.stringify(encryptState(safeState), null, 2)}\n`, "utf8");
  await fs.rename(tempFile, encryptedDataFile);
}

async function readRequestJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 5_000_000) throw new Error("Request body too large");
  }
  return JSON.parse(body || "{}");
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || "").split(";").map((item) => item.trim().split("=")).filter(([key, value]) => key && value));
}

function getSession(req) {
  const token = parseCookies(req).membership_session;
  if (!token) return null;
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + 1000 * 60 * 60 * 8;
  return session;
}

function requireSession(req, res) {
  const session = getSession(req);
  if (session) return session;
  sendJson(res, 401, { error: "Login required" });
  return null;
}

function requireHead(req, res) {
  const session = requireSession(req, res);
  if (!session) return null;
  if (session.role !== "head") {
    sendJson(res, 403, { error: "Head manager permission required" });
    return null;
  }
  return session;
}

function requireStaff(req, res) {
  const session = requireSession(req, res);
  if (!session) return null;
  if (!["head", "manager"].includes(session.role)) {
    sendJson(res, 403, { error: "Manager permission required" });
    return null;
  }
  return session;
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/session" && req.method === "GET") {
    const session = getSession(req);
    sendJson(res, 200, { loggedIn: Boolean(session), user: session?.username || null, role: session?.role || null, memberId: session?.memberId || null });
    return true;
  }

  if (url.pathname === "/api/register-user" && req.method === "POST") {
    const body = await readRequestJson(req);
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const displayName = String(body.displayName || username).trim();
    if (!username || password.length < 4) {
      sendJson(res, 400, { error: "Invalid account" });
      return true;
    }
    const state = await readState();
    if (state.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
      sendJson(res, 409, { error: "Username already exists" });
      return true;
    }
    const hashed = hashPassword(password);
    state.users.push({
      id: createId(),
      username,
      displayName,
      role: "manager",
      status: "pending",
      passwordHash: hashed.hash,
      salt: hashed.salt,
      createdAt: new Date().toISOString(),
    });
    addAudit(state, { username }, "관리자 계정 승인을 요청했습니다.");
    await writeState(state);
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (url.pathname === "/api/public/member-signup" && req.method === "POST") {
    const body = await readRequestJson(req);
    const state = await readState();
    const member = {
      id: createId(),
      name: String(body.name || "").trim(),
      phone: String(body.phone || "").trim(),
      birthday: String(body.birthday || ""),
      email: String(body.email || "").trim(),
      notes: "QR 직접 가입",
      points: 0,
      purchases: [],
      coupons: [],
    };
    if (!member.name || !member.phone) {
      sendJson(res, 400, { error: "Name and phone are required" });
      return true;
    }
    state.members.unshift(member);
    addAudit(state, { username: "customer-qr" }, `${member.name} 고객이 QR로 직접 가입했습니다.`);
    await writeState(state);
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (url.pathname === "/api/customer-login" && req.method === "POST") {
    const body = await readRequestJson(req);
    const phone = normalizePhone(body.phone);
    const state = await readState();
    const member = state.members.find((item) => normalizePhone(item.phone) === phone && (!body.name || item.name.trim() === String(body.name).trim()));
    if (!member) {
      sendJson(res, 401, { error: "Member not found" });
      return true;
    }
    const token = crypto.randomBytes(32).toString("base64url");
    sessions.set(token, { memberId: member.id, username: `customer:${member.name}`, role: "customer", expiresAt: Date.now() + 1000 * 60 * 60 * 8 });
    addAudit(state, { username: `customer:${member.name}` }, "고객 화면에 로그인했습니다.");
    await writeState(state);
    sendJson(res, 200, { ok: true, member: publicMember(member) }, {
      "Set-Cookie": `membership_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`,
    });
    return true;
  }

  if (url.pathname === "/api/login" && req.method === "POST") {
    const body = await readRequestJson(req);
    const state = await readState();
    const user = state.users.find((item) => item.username.toLowerCase() === String(body.username || "").trim().toLowerCase());
    if (!user || user.status !== "approved" || !verifyPassword(body.password, user)) {
      sendJson(res, 401, { error: "Invalid username or password" });
      return true;
    }
    const token = crypto.randomBytes(32).toString("base64url");
    sessions.set(token, { userId: user.id, username: user.username, role: user.role, expiresAt: Date.now() + 1000 * 60 * 60 * 8 });
    addAudit(state, { username: user.username }, "로그인했습니다.");
    await writeState(state);
    sendJson(res, 200, { ok: true, user: user.username, role: user.role }, {
      "Set-Cookie": `membership_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`,
    });
    return true;
  }

  if (url.pathname === "/api/logout" && req.method === "POST") {
    const token = parseCookies(req).membership_session;
    if (token) sessions.delete(token);
    sendJson(res, 200, { ok: true }, { "Set-Cookie": "membership_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" });
    return true;
  }

  if (url.pathname === "/api/state" && req.method === "GET") {
    const session = requireStaff(req, res);
    if (!session) return true;
    sendJson(res, 200, publicState(await readState(), session));
    return true;
  }

  if (url.pathname === "/api/state" && req.method === "POST") {
    const session = requireStaff(req, res);
    if (!session) return true;
    const body = await readRequestJson(req);
    const state = await readState();
    state.members = Array.isArray(body.state?.members) ? body.state.members : state.members;
    if (body.action) addAudit(state, session, String(body.action));
    await writeState(state);
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (url.pathname === "/api/customer/me" && req.method === "GET") {
    const session = requireSession(req, res);
    if (!session) return true;
    if (session.role !== "customer") {
      sendJson(res, 403, { error: "Customer session required" });
      return true;
    }
    const state = await readState();
    const member = state.members.find((item) => item.id === session.memberId);
    if (!member) {
      sendJson(res, 404, { error: "Member not found" });
      return true;
    }
    sendJson(res, 200, { member: publicMember(member) });
    return true;
  }

  if (url.pathname === "/api/customer/redeem-coupon" && req.method === "POST") {
    const session = requireSession(req, res);
    if (!session) return true;
    if (session.role !== "customer") {
      sendJson(res, 403, { error: "Customer session required" });
      return true;
    }
    const body = await readRequestJson(req);
    const state = await readState();
    const member = state.members.find((item) => item.id === session.memberId);
    const coupon = member?.coupons.find((item) => item.id === body.couponId);
    if (!member || !coupon) {
      sendJson(res, 404, { error: "Coupon not found" });
      return true;
    }
    if (coupon.usedAt) {
      sendJson(res, 409, { error: "Coupon already used" });
      return true;
    }
    coupon.usedAt = new Date().toISOString();
    coupon.status = "used";
    addAudit(state, { username: `customer:${member.name}` }, `${member.name} 고객이 ${coupon.name} 쿠폰을 사용 완료 처리했습니다.`);
    await writeState(state);
    sendJson(res, 200, { ok: true, member: publicMember(member) });
    return true;
  }

  if (url.pathname === "/api/users/update" && req.method === "POST") {
    const session = requireHead(req, res);
    if (!session) return true;
    const body = await readRequestJson(req);
    const state = await readState();
    const user = state.users.find((item) => item.id === body.userId);
    if (!user) {
      sendJson(res, 404, { error: "User not found" });
      return true;
    }
    if (body.status) user.status = body.status;
    if (body.role) user.role = body.role;
    addAudit(state, session, `${user.username} 계정을 ${user.status}/${user.role} 상태로 변경했습니다.`);
    await writeState(state);
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}

async function handleStatic(res, url) {
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.resolve(root, `.${requestedPath}`);
  if (!filePath.startsWith(root) || filePath.startsWith(dataDir)) {
    send(res, 403, "Forbidden");
    return;
  }
  try {
    send(res, 200, await fs.readFile(filePath), types[path.extname(filePath)] || "application/octet-stream");
  } catch {
    send(res, 404, "Not found");
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  handleApi(req, res, url)
    .then((handled) => (handled ? undefined : handleStatic(res, url)))
    .catch((error) => {
      console.error(error);
      sendJson(res, 500, { error: "Server error" });
    });
});

server.listen(port, host, () => {
  console.log(`Membership manager is running at http://localhost:${port}`);
  console.log(`Encrypted data file: ${encryptedDataFile}`);
});

module.exports = server;
