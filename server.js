const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const port = Number(process.env.PORT || 8080);
const host = "0.0.0.0";
const root = __dirname;
const dataDir = path.join(root, "data");
const encryptedDataFile = path.join(dataDir, "membership-data.enc.json");
const legacyDataFile = path.join(dataDir, "membership-data.json");
const appPassword = process.env.MEMBERSHIP_PASSWORD || "2468";
const dataSecret = process.env.MEMBERSHIP_DATA_SECRET || appPassword;
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

function createSeedData() {
  return {
    members: [
      {
        id: createId(),
        name: "김서연",
        phone: "010-1234-7788",
        birthday: "1992-05-31",
        points: 6200,
        purchases: [
          { id: createId(), amount: 124000, points: 6200, memo: "정기 구매", date: new Date().toISOString() },
        ],
        coupons: [],
      },
      {
        id: createId(),
        name: "박민준",
        phone: "010-8821-4400",
        birthday: "1988-11-09",
        points: 15850,
        purchases: [
          { id: createId(), amount: 317000, points: 15850, memo: "VIP 패키지", date: new Date().toISOString() },
        ],
        coupons: [],
      },
    ],
    audit: ["암호화된 서버 저장소를 만들었습니다."],
  };
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
  const plaintext = Buffer.from(JSON.stringify(state), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    version: 1,
    algorithm: "aes-256-gcm",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
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
  return state;
}

async function ensureDataFile() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(encryptedDataFile);
    return;
  } catch {
    try {
      const legacyText = await fs.readFile(legacyDataFile, "utf8");
      const legacyState = JSON.parse(legacyText);
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
  const text = await fs.readFile(encryptedDataFile, "utf8");
  return decryptState(JSON.parse(text));
}

async function writeState(state) {
  if (!isValidState(state)) throw new Error("Invalid state");
  await fs.mkdir(dataDir, { recursive: true });
  const tempFile = `${encryptedDataFile}.tmp`;
  await fs.writeFile(tempFile, `${JSON.stringify(encryptState(state), null, 2)}\n`, "utf8");
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
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((item) => item.trim().split("="))
      .filter(([key, value]) => key && value)
  );
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
  if (getSession(req)) return true;
  sendJson(res, 401, { error: "Login required" });
  return false;
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/session" && req.method === "GET") {
    sendJson(res, 200, { loggedIn: Boolean(getSession(req)) });
    return true;
  }

  if (url.pathname === "/api/login" && req.method === "POST") {
    const body = await readRequestJson(req);
    if (body.password !== appPassword) {
      sendJson(res, 401, { error: "Invalid password" });
      return true;
    }

    const token = crypto.randomBytes(32).toString("base64url");
    sessions.set(token, { expiresAt: Date.now() + 1000 * 60 * 60 * 8 });
    sendJson(res, 200, { ok: true }, {
      "Set-Cookie": `membership_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`,
    });
    return true;
  }

  if (url.pathname === "/api/logout" && req.method === "POST") {
    const token = parseCookies(req).membership_session;
    if (token) sessions.delete(token);
    sendJson(res, 200, { ok: true }, {
      "Set-Cookie": "membership_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
    });
    return true;
  }

  if (url.pathname === "/api/state" && req.method === "GET") {
    if (!requireSession(req, res)) return true;
    sendJson(res, 200, await readState());
    return true;
  }

  if (url.pathname === "/api/state" && req.method === "POST") {
    if (!requireSession(req, res)) return true;
    const state = await readRequestJson(req);
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
    const data = await fs.readFile(filePath);
    send(res, 200, data, types[path.extname(filePath)] || "application/octet-stream");
  } catch {
    send(res, 404, "Not found");
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");

  handleApi(req, res, url)
    .then((handled) => {
      if (!handled) return handleStatic(res, url);
      return undefined;
    })
    .catch((error) => {
      console.error(error);
      sendJson(res, 500, { error: "Server error" });
    });
});

server.listen(port, host, () => {
  console.log(`Membership manager is running at http://localhost:${port}`);
  console.log(`Encrypted data file: ${encryptedDataFile}`);
  if (!process.env.MEMBERSHIP_PASSWORD || !process.env.MEMBERSHIP_DATA_SECRET) {
    console.log("Set MEMBERSHIP_PASSWORD and MEMBERSHIP_DATA_SECRET before public deployment.");
  }
});

module.exports = server;
