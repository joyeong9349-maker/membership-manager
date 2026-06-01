const POINT_RATE = 0.05;

const tierRules = [
  { name: "Silver", min: 0 },
  { name: "Gold", min: 5000 },
  { name: "Diamond", min: 15000 },
];

let state = { members: [], audit: [] };
let selectedMemberId = null;
let loggedIn = false;
let isSaving = false;

const els = {
  loginScreen: document.querySelector("#loginScreen"),
  loginForm: document.querySelector("#loginForm"),
  loginPassword: document.querySelector("#loginPassword"),
  loginMessage: document.querySelector("#loginMessage"),
  lockStatus: document.querySelector("#lockStatus"),
  pinInput: document.querySelector("#pinInput"),
  unlockBtn: document.querySelector("#unlockBtn"),
  lockBtn: document.querySelector("#lockBtn"),
  memberForm: document.querySelector("#memberForm"),
  purchaseForm: document.querySelector("#purchaseForm"),
  memberName: document.querySelector("#memberName"),
  memberPhone: document.querySelector("#memberPhone"),
  memberBirthday: document.querySelector("#memberBirthday"),
  purchaseMember: document.querySelector("#purchaseMember"),
  purchaseAmount: document.querySelector("#purchaseAmount"),
  purchaseMemo: document.querySelector("#purchaseMemo"),
  memberGrid: document.querySelector("#memberGrid"),
  memberDetail: document.querySelector("#memberDetail"),
  searchInput: document.querySelector("#searchInput"),
  birthdayCouponBtn: document.querySelector("#birthdayCouponBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  auditList: document.querySelector("#auditList"),
  totalMembers: document.querySelector("#totalMembers"),
  totalPoints: document.querySelector("#totalPoints"),
  monthSales: document.querySelector("#monthSales"),
  couponCount: document.querySelector("#couponCount"),
};

function createId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });

  if (response.status === 401) {
    loggedIn = false;
    renderLogin();
    throw new Error("로그인이 필요합니다.");
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "서버 요청에 실패했습니다.");
  return data;
}

async function checkSession() {
  const session = await api("/api/session");
  loggedIn = Boolean(session.loggedIn);
  renderLogin();
  if (loggedIn) await loadStateFromServer();
}

async function login(password) {
  await api("/api/login", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
  loggedIn = true;
  els.pinInput.value = "";
  els.loginPassword.value = "";
  els.loginMessage.textContent = "";
  await loadStateFromServer();
  render();
}

async function logout() {
  await api("/api/logout", { method: "POST", body: "{}" });
  loggedIn = false;
  state = { members: [], audit: [] };
  selectedMemberId = null;
  render();
}

async function loadStateFromServer() {
  const nextState = await api("/api/state");
  if (!Array.isArray(nextState.members) || !Array.isArray(nextState.audit)) {
    throw new Error("서버 데이터 형식이 올바르지 않습니다.");
  }
  state = nextState;
  if (!state.members.some((member) => member.id === selectedMemberId)) {
    selectedMemberId = state.members[0]?.id ?? null;
  }
}

async function saveStateToServer() {
  isSaving = true;
  renderSaveState();
  try {
    await api("/api/state", {
      method: "POST",
      body: JSON.stringify(state),
    });
  } finally {
    isSaving = false;
    renderSaveState();
  }
}

function addAudit(message) {
  const stamp = new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
  state.audit = [`${stamp} ${message}`, ...state.audit].slice(0, 12);
}

function formatWon(value) {
  return `${Number(value).toLocaleString("ko-KR")}원`;
}

function formatPoints(value) {
  return `${Number(value).toLocaleString("ko-KR")}P`;
}

function getTier(points) {
  return [...tierRules].reverse().find((tier) => points >= tier.min) ?? tierRules[0];
}

function getNextTier(points) {
  return tierRules.find((tier) => points < tier.min) ?? null;
}

function getProgress(points) {
  const next = getNextTier(points);
  if (!next) return 100;
  const current = getTier(points);
  const range = next.min - current.min;
  return Math.min(100, Math.round(((points - current.min) / range) * 100));
}

function requireLogin() {
  if (loggedIn) return true;
  els.loginMessage.textContent = "먼저 로그인해 주세요.";
  renderLogin();
  return false;
}

function renderLogin() {
  els.loginScreen.classList.toggle("hidden", loggedIn);
  document.body.classList.toggle("locked", !loggedIn);
}

function render() {
  renderLogin();
  renderSaveState();
  renderStats();
  renderMemberOptions();
  renderMembers();
  renderDetail();
  renderAudit();
}

function renderSaveState() {
  if (!loggedIn) {
    els.lockStatus.textContent = "로그인이 필요합니다.";
    return;
  }
  els.lockStatus.textContent = isSaving ? "암호화해서 서버에 저장 중입니다..." : "로그인되어 있습니다.";
}

function renderStats() {
  const now = new Date();
  const monthSales = state.members.flatMap((member) => member.purchases).reduce((total, purchase) => {
    const date = new Date(purchase.date);
    const sameMonth = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    return sameMonth ? total + Number(purchase.amount) : total;
  }, 0);

  els.totalMembers.textContent = state.members.length.toLocaleString("ko-KR");
  els.totalPoints.textContent = formatPoints(state.members.reduce((total, member) => total + Number(member.points), 0));
  els.monthSales.textContent = formatWon(monthSales);
  els.couponCount.textContent = state.members.reduce((total, member) => total + member.coupons.length, 0).toLocaleString("ko-KR");
}

function renderMemberOptions() {
  els.purchaseMember.innerHTML = state.members
    .map((member) => `<option value="${member.id}">${escapeHtml(member.name)} (${getTier(member.points).name})</option>`)
    .join("");
}

function renderMembers() {
  const query = els.searchInput.value.trim().toLowerCase();
  const members = state.members.filter((member) => {
    const text = `${member.name} ${member.phone}`.toLowerCase();
    return text.includes(query);
  });

  els.memberGrid.innerHTML = "";

  members.forEach((member) => {
    const template = document.querySelector("#memberCardTemplate");
    const card = template.content.firstElementChild.cloneNode(true);
    const tier = getTier(member.points);
    card.classList.toggle("active", member.id === selectedMemberId);
    card.querySelector(".tier-badge").textContent = tier.name;
    card.querySelector(".tier-badge").classList.add(tier.name.toLowerCase());
    card.querySelector(".point-text").textContent = formatPoints(member.points);
    card.querySelector(".member-name").textContent = member.name;
    card.querySelector(".member-phone").textContent = member.phone;
    card.querySelector(".progress-fill").style.width = `${getProgress(member.points)}%`;
    card.addEventListener("click", () => {
      selectedMemberId = member.id;
      render();
    });
    els.memberGrid.appendChild(card);
  });

  if (!members.length) {
    els.memberGrid.innerHTML = '<p class="empty-copy">검색된 회원이 없습니다.</p>';
  }
}

function renderDetail() {
  const member = state.members.find((item) => item.id === selectedMemberId);
  if (!member) {
    els.memberDetail.className = "empty-detail";
    els.memberDetail.innerHTML = '<span class="icon user" aria-hidden="true"></span><p>회원을 선택하세요.</p>';
    return;
  }

  const tier = getTier(member.points);
  const next = getNextTier(member.points);
  const purchaseTotal = member.purchases.reduce((total, purchase) => total + Number(purchase.amount), 0);

  els.memberDetail.className = "";
  els.memberDetail.innerHTML = `
    <div class="detail-header">
      <span class="tier-badge ${tier.name.toLowerCase()}">${tier.name}</span>
      <h2>${escapeHtml(member.name)}</h2>
      <p>${escapeHtml(member.phone)} · 생일 ${member.birthday}</p>
    </div>
    <div class="detail-metrics">
      <div class="metric"><span>보유 포인트</span><strong>${formatPoints(member.points)}</strong></div>
      <div class="metric"><span>누적 구매</span><strong>${formatWon(purchaseTotal)}</strong></div>
      <div class="metric"><span>다음 승급</span><strong>${next ? formatPoints(next.min - member.points) : "최고 등급"}</strong></div>
      <div class="metric"><span>쿠폰</span><strong>${member.coupons.length}장</strong></div>
    </div>
    <section class="detail-section">
      <h3>구매이력</h3>
      <ul class="history-list">
        ${member.purchases.length ? member.purchases.map(renderPurchase).join("") : "<li><span>구매이력이 없습니다.</span></li>"}
      </ul>
    </section>
    <section class="detail-section">
      <h3>쿠폰</h3>
      <ul class="coupon-list">
        ${member.coupons.length ? member.coupons.map(renderCoupon).join("") : "<li><span>발급된 쿠폰이 없습니다.</span></li>"}
      </ul>
    </section>
    <button class="danger-button" data-delete="${member.id}">회원 삭제</button>
  `;

  els.memberDetail.querySelector("[data-delete]").addEventListener("click", () => deleteMember(member.id));
}

function renderPurchase(purchase) {
  const date = new Date(purchase.date).toLocaleDateString("ko-KR");
  return `<li><strong>${formatWon(purchase.amount)} · ${formatPoints(purchase.points)} 적립</strong><span>${date} ${escapeHtml(purchase.memo || "메모 없음")}</span></li>`;
}

function renderCoupon(coupon) {
  return `<li><strong>${escapeHtml(coupon.name)}</strong><span>${coupon.code} · ${coupon.date}</span></li>`;
}

function renderAudit() {
  els.auditList.innerHTML = state.audit.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

async function withServerSave(work) {
  try {
    await loadStateFromServer();
    work();
    render();
    await saveStateToServer();
    await loadStateFromServer();
    render();
  } catch (error) {
    alert(error.message || "서버 저장 중 문제가 생겼습니다.");
    await safeRefresh();
  }
}

async function safeRefresh() {
  try {
    if (loggedIn) {
      await loadStateFromServer();
      render();
    }
  } catch {
    els.memberGrid.innerHTML = '<p class="empty-copy">서버에 연결할 수 없습니다. 사이트 주소가 file:/// 이 아니라 http:// 로 열렸는지 확인해 주세요.</p>';
  }
}

async function deleteMember(id) {
  if (!requireLogin()) return;
  const member = state.members.find((item) => item.id === id);
  if (!member) return;
  if (!confirm(`${member.name} 회원을 삭제할까요?`)) return;

  await withServerSave(() => {
    state.members = state.members.filter((item) => item.id !== id);
    selectedMemberId = state.members[0]?.id ?? null;
    addAudit(`${member.name} 회원을 삭제했습니다.`);
  });
}

async function issueBirthdayCoupons() {
  if (!requireLogin()) return;

  await withServerSave(() => {
    const today = new Date();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const issued = [];

    state.members.forEach((member) => {
      const birthdayMonth = member.birthday.slice(5, 7);
      const alreadyIssued = member.coupons.some((coupon) => coupon.type === "birthday" && coupon.date.startsWith(String(today.getFullYear())));
      if (birthdayMonth === month && !alreadyIssued) {
        member.coupons.push({
          id: createId(),
          type: "birthday",
          name: "생일 축하 10% 할인",
          code: `BD-${today.getFullYear()}-${member.name.slice(0, 1)}${Math.floor(1000 + Math.random() * 9000)}`,
          date: today.toISOString().slice(0, 10),
        });
        issued.push(member.name);
      }
    });

    addAudit(issued.length ? `생일 쿠폰 ${issued.length}장을 발급했습니다.` : "새로 발급할 생일 쿠폰이 없습니다.");
  });
}

function exportData() {
  if (!requireLogin()) return;
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `membership-data-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

els.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.loginMessage.textContent = "로그인 중입니다...";
  try {
    await login(els.loginPassword.value);
  } catch {
    els.loginMessage.textContent = "비밀번호가 맞지 않거나 서버에 연결할 수 없습니다.";
  }
});

els.unlockBtn.addEventListener("click", async () => {
  try {
    await login(els.pinInput.value);
  } catch {
    alert("비밀번호가 맞지 않거나 서버에 연결할 수 없습니다.");
  }
});

els.lockBtn.addEventListener("click", () => {
  logout().catch(() => {
    loggedIn = false;
    render();
  });
});

els.memberForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!requireLogin()) return;

  const member = {
    id: createId(),
    name: els.memberName.value.trim(),
    phone: els.memberPhone.value.trim(),
    birthday: els.memberBirthday.value,
    points: 0,
    purchases: [],
    coupons: [],
  };

  await withServerSave(() => {
    state.members.unshift(member);
    selectedMemberId = member.id;
    addAudit(`${member.name} 회원을 등록했습니다.`);
  });
  els.memberForm.reset();
});

els.purchaseForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!requireLogin()) return;

  const memberId = els.purchaseMember.value;
  const amount = Number(els.purchaseAmount.value);
  const memo = els.purchaseMemo.value.trim();

  await withServerSave(() => {
    const member = state.members.find((item) => item.id === memberId);
    if (!member) return;
    const points = Math.floor(amount * POINT_RATE);
    const beforeTier = getTier(member.points).name;
    member.points += points;
    member.purchases.unshift({
      id: createId(),
      amount,
      points,
      memo,
      date: new Date().toISOString(),
    });
    const afterTier = getTier(member.points).name;
    addAudit(`${member.name} 구매 ${formatWon(amount)} 저장, ${formatPoints(points)} 적립.`);
    if (beforeTier !== afterTier) addAudit(`${member.name} 회원이 ${afterTier} 등급으로 자동 승급했습니다.`);
    selectedMemberId = member.id;
  });
  els.purchaseForm.reset();
});

els.searchInput.addEventListener("input", renderMembers);
els.birthdayCouponBtn.addEventListener("click", issueBirthdayCoupons);
els.exportBtn.addEventListener("click", exportData);

async function init() {
  render();
  try {
    await checkSession();
    render();
  } catch {
    els.loginMessage.textContent = "서버 주소로 열어야 로그인할 수 있습니다.";
    renderLogin();
  }

  setInterval(() => {
    if (loggedIn && !isSaving && !document.hidden) safeRefresh();
  }, 5000);
}

init();
