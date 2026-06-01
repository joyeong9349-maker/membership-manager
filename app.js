const POINT_RATE = 0.05;
const tierRules = [
  { name: "Silver", min: 0 },
  { name: "Gold", min: 5000 },
  { name: "Diamond", min: 15000 },
];

let state = { members: [], audit: [], users: [] };
let selectedMemberId = null;
let loggedIn = false;
let currentUser = null;
let currentRole = null;
let isSaving = false;
let cameraStream = null;

const $ = (selector) => document.querySelector(selector);
const els = {
  loginScreen: $("#loginScreen"),
  customerSignupScreen: $("#customerSignupScreen"),
  loginForm: $("#loginForm"),
  loginUsername: $("#loginUsername"),
  loginPassword: $("#loginPassword"),
  loginMessage: $("#loginMessage"),
  showAccountRequestBtn: $("#showAccountRequestBtn"),
  showCustomerSignupBtn: $("#showCustomerSignupBtn"),
  customerSignupForm: $("#customerSignupForm"),
  backToLoginBtn: $("#backToLoginBtn"),
  signupMessage: $("#signupMessage"),
  accountDialog: $("#accountDialog"),
  accountRequestForm: $("#accountRequestForm"),
  accountRequestMessage: $("#accountRequestMessage"),
  lockStatus: $("#lockStatus"),
  pinInput: $("#pinInput"),
  unlockBtn: $("#unlockBtn"),
  lockBtn: $("#lockBtn"),
  memberForm: $("#memberForm"),
  purchaseForm: $("#purchaseForm"),
  memberName: $("#memberName"),
  memberPhone: $("#memberPhone"),
  memberBirthday: $("#memberBirthday"),
  purchaseMember: $("#purchaseMember"),
  purchaseAmount: $("#purchaseAmount"),
  purchaseMemo: $("#purchaseMemo"),
  memberGrid: $("#memberGrid"),
  memberDetail: $("#memberDetail"),
  searchInput: $("#searchInput"),
  birthdayCouponBtn: $("#birthdayCouponBtn"),
  customCouponBtn: $("#customCouponBtn"),
  receiptBtn: $("#receiptBtn"),
  qrBtn: $("#qrBtn"),
  exportBtn: $("#exportBtn"),
  auditList: $("#auditList"),
  totalMembers: $("#totalMembers"),
  totalPoints: $("#totalPoints"),
  monthSales: $("#monthSales"),
  couponCount: $("#couponCount"),
  accountPanel: $("#accountPanel"),
  userList: $("#userList"),
  memberEditDialog: $("#memberEditDialog"),
  memberEditForm: $("#memberEditForm"),
  couponDialog: $("#couponDialog"),
  couponForm: $("#couponForm"),
  couponMember: $("#couponMember"),
  receiptDialog: $("#receiptDialog"),
  receiptForm: $("#receiptForm"),
  receiptMember: $("#receiptMember"),
  receiptVideo: $("#receiptVideo"),
  receiptCanvas: $("#receiptCanvas"),
  receiptText: $("#receiptText"),
  receiptAmount: $("#receiptAmount"),
  qrDialog: $("#qrDialog"),
  qrImage: $("#qrImage"),
  qrLink: $("#qrLink"),
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
  currentUser = session.user || null;
  currentRole = session.role || null;
  renderLogin();
  if (loggedIn) await loadStateFromServer();
}

async function login(username, password) {
  const result = await api("/api/login", { method: "POST", body: JSON.stringify({ username, password }) });
  loggedIn = true;
  currentUser = result.user || username;
  currentRole = result.role || "manager";
  els.pinInput.value = "";
  els.loginUsername.value = "";
  els.loginPassword.value = "";
  els.loginMessage.textContent = "";
  await loadStateFromServer();
  render();
}

async function logout() {
  await api("/api/logout", { method: "POST", body: "{}" });
  loggedIn = false;
  currentUser = null;
  currentRole = null;
  state = { members: [], audit: [], users: [] };
  selectedMemberId = null;
  render();
}

async function loadStateFromServer() {
  const nextState = await api("/api/state");
  state = {
    members: Array.isArray(nextState.members) ? nextState.members : [],
    audit: Array.isArray(nextState.audit) ? nextState.audit : [],
    users: Array.isArray(nextState.users) ? nextState.users : [],
  };
  if (!state.members.some((member) => member.id === selectedMemberId)) {
    selectedMemberId = state.members[0]?.id ?? null;
  }
}

async function saveStateToServer(action) {
  isSaving = true;
  renderSaveState();
  try {
    await api("/api/state", {
      method: "POST",
      body: JSON.stringify({ state: { members: state.members }, action }),
    });
  } finally {
    isSaving = false;
    renderSaveState();
  }
}

async function withServerSave(action, work) {
  try {
    await loadStateFromServer();
    work();
    render();
    await saveStateToServer(action);
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
    els.memberGrid.innerHTML = '<p class="empty-copy">서버에 연결할 수 없습니다.</p>';
  }
}

function formatWon(value) {
  return `${Number(value || 0).toLocaleString("ko-KR")}원`;
}

function formatPoints(value) {
  return `${Number(value || 0).toLocaleString("ko-KR")}P`;
}

function formatDate(value) {
  return new Date(value).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
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
  return Math.min(100, Math.round(((points - current.min) / (next.min - current.min)) * 100));
}

function requireLogin() {
  if (loggedIn) return true;
  els.loginMessage.textContent = "먼저 로그인해 주세요.";
  renderLogin();
  return false;
}

function renderLogin() {
  const signupMode = new URLSearchParams(location.search).get("signup") === "1";
  els.customerSignupScreen.classList.toggle("hidden", !signupMode || loggedIn);
  els.loginScreen.classList.toggle("hidden", signupMode || loggedIn);
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
  renderUsers();
}

function renderSaveState() {
  if (!loggedIn) {
    els.lockStatus.textContent = "로그인이 필요합니다.";
    return;
  }
  els.lockStatus.textContent = isSaving ? "암호화해서 서버에 저장 중입니다..." : `${currentUser} (${currentRole === "head" ? "헤드 관리자" : "관리자"}) 로그인`;
}

function renderStats() {
  const now = new Date();
  const monthSales = state.members.flatMap((member) => member.purchases).reduce((total, purchase) => {
    const date = new Date(purchase.date);
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() ? total + Number(purchase.amount) : total;
  }, 0);
  els.totalMembers.textContent = state.members.length.toLocaleString("ko-KR");
  els.totalPoints.textContent = formatPoints(state.members.reduce((total, member) => total + Number(member.points), 0));
  els.monthSales.textContent = formatWon(monthSales);
  els.couponCount.textContent = state.members.reduce((total, member) => total + member.coupons.length, 0).toLocaleString("ko-KR");
}

function optionHtml(member) {
  return `<option value="${member.id}">${escapeHtml(member.name)} (${getTier(member.points).name})</option>`;
}

function renderMemberOptions() {
  const options = state.members.map(optionHtml).join("");
  els.purchaseMember.innerHTML = options;
  els.couponMember.innerHTML = options;
  els.receiptMember.innerHTML = options;
}

function renderMembers() {
  const query = els.searchInput.value.trim().toLowerCase();
  const members = state.members.filter((member) => `${member.name} ${member.phone} ${member.email || ""}`.toLowerCase().includes(query));
  els.memberGrid.innerHTML = "";
  members.forEach((member) => {
    const card = $("#memberCardTemplate").content.firstElementChild.cloneNode(true);
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
  if (!members.length) els.memberGrid.innerHTML = '<p class="empty-copy">검색된 회원이 없습니다.</p>';
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
      <p>${escapeHtml(member.phone)} · ${escapeHtml(member.email || "이메일 없음")}</p>
    </div>
    <div class="detail-metrics">
      <div class="metric"><span>보유 포인트</span><strong>${formatPoints(member.points)}</strong></div>
      <div class="metric"><span>누적 구매</span><strong>${formatWon(purchaseTotal)}</strong></div>
      <div class="metric"><span>다음 승급</span><strong>${next ? formatPoints(next.min - member.points) : "최고 등급"}</strong></div>
      <div class="metric"><span>쿠폰</span><strong>${member.coupons.length}장</strong></div>
    </div>
    <div class="detail-button-row">
      <button class="secondary-button" data-edit="${member.id}">프로필 수정</button>
      <button class="secondary-button" data-coupon="${member.id}">쿠폰 발급</button>
    </div>
    <section class="detail-section">
      <h3>구매이력</h3>
      <ul class="history-list">${member.purchases.length ? member.purchases.map(renderPurchase).join("") : "<li><span>구매이력이 없습니다.</span></li>"}</ul>
    </section>
    <section class="detail-section">
      <h3>쿠폰</h3>
      <ul class="coupon-list">${member.coupons.length ? member.coupons.map(renderCoupon).join("") : "<li><span>발급된 쿠폰이 없습니다.</span></li>"}</ul>
    </section>
    <button class="danger-button" data-delete="${member.id}">회원 삭제</button>
  `;
  els.memberDetail.querySelector("[data-edit]").addEventListener("click", () => openMemberEdit(member.id));
  els.memberDetail.querySelector("[data-coupon]").addEventListener("click", () => openCoupon(member.id));
  els.memberDetail.querySelector("[data-delete]").addEventListener("click", () => deleteMember(member.id));
}

function renderPurchase(purchase) {
  const origin = purchase.source ? ` · ${escapeHtml(purchase.source)}` : "";
  return `<li><strong>${formatWon(purchase.amount)} · ${formatPoints(purchase.points)} 적립</strong><span>${new Date(purchase.date).toLocaleDateString("ko-KR")} ${escapeHtml(purchase.memo || "메모 없음")}${origin}</span></li>`;
}

function renderCoupon(coupon) {
  const expire = coupon.expire ? ` · 만료 ${coupon.expire}` : "";
  return `<li><strong>${escapeHtml(coupon.name)}</strong><span>${escapeHtml(coupon.value || "")} · ${coupon.code}${expire}</span></li>`;
}

function renderAudit() {
  els.auditList.innerHTML = state.audit.map((entry) => `<li><strong>${escapeHtml(entry.actor || "system")}</strong><br>${escapeHtml(entry.action || "")}<br><span>${formatDate(entry.date)}</span></li>`).join("");
}

function renderUsers() {
  els.accountPanel.classList.toggle("hidden", currentRole !== "head");
  if (currentRole !== "head") return;
  els.userList.innerHTML = state.users.map((user) => `
    <div class="user-row">
      <div><strong>${escapeHtml(user.username)}</strong><span>${escapeHtml(user.displayName || "")} · ${user.role} · ${user.status}</span></div>
      <div class="user-actions">
        <button class="secondary-button" data-user="${user.id}" data-status="approved" data-role="${user.role}">승인</button>
        <button class="secondary-button" data-user="${user.id}" data-status="${user.status}" data-role="head">헤드 권한</button>
        <button class="danger-button compact-danger" data-user="${user.id}" data-status="blocked" data-role="${user.role}">차단</button>
      </div>
    </div>
  `).join("");
  els.userList.querySelectorAll("[data-user]").forEach((button) => {
    button.addEventListener("click", () => updateUser(button.dataset.user, button.dataset.status, button.dataset.role));
  });
}

async function updateUser(userId, status, role) {
  await api("/api/users/update", { method: "POST", body: JSON.stringify({ userId, status, role }) });
  await safeRefresh();
}

function openMemberEdit(id) {
  const member = state.members.find((item) => item.id === id);
  if (!member) return;
  $("#editName").value = member.name;
  $("#editPhone").value = member.phone;
  $("#editBirthday").value = member.birthday || "";
  $("#editEmail").value = member.email || "";
  $("#editNotes").value = member.notes || "";
  els.memberEditForm.dataset.memberId = id;
  els.memberEditDialog.showModal();
}

function openCoupon(id = selectedMemberId) {
  if (id) els.couponMember.value = id;
  $("#couponName").value = "";
  $("#couponValue").value = "";
  $("#couponExpire").value = "";
  els.couponDialog.showModal();
}

async function deleteMember(id) {
  if (!requireLogin()) return;
  const member = state.members.find((item) => item.id === id);
  if (!member || !confirm(`${member.name} 회원을 삭제할까요?`)) return;
  await withServerSave(`${member.name} 회원을 삭제했습니다.`, () => {
    state.members = state.members.filter((item) => item.id !== id);
    selectedMemberId = state.members[0]?.id ?? null;
  });
}

async function issueBirthdayCoupons() {
  if (!requireLogin()) return;
  await withServerSave("생일 쿠폰 자동 발급을 실행했습니다.", () => {
    const today = new Date();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    state.members.forEach((member) => {
      const alreadyIssued = member.coupons.some((coupon) => coupon.type === "birthday" && coupon.date?.startsWith(String(today.getFullYear())));
      if (member.birthday?.slice(5, 7) === month && !alreadyIssued) {
        member.coupons.push({ id: createId(), type: "birthday", name: "생일 축하 10% 할인", value: "10% 할인", code: `BD-${today.getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`, date: today.toISOString().slice(0, 10) });
      }
    });
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

function parseReceiptText(text) {
  const amounts = [...text.matchAll(/(?:₩|KRW)?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,})/g)]
    .map((match) => Number(match[1].replaceAll(",", "")))
    .filter((value) => value >= 100);
  return amounts.length ? Math.max(...amounts) : "";
}

async function startCamera() {
  cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
  els.receiptVideo.srcObject = cameraStream;
}

function captureReceipt() {
  const canvas = els.receiptCanvas;
  canvas.width = els.receiptVideo.videoWidth || 640;
  canvas.height = els.receiptVideo.videoHeight || 480;
  canvas.getContext("2d").drawImage(els.receiptVideo, 0, 0, canvas.width, canvas.height);
  els.receiptText.value = `${els.receiptText.value}\n[영수증 이미지 촬영됨: ${new Date().toLocaleString("ko-KR")}]`.trim();
}

function stopCamera() {
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = null;
}

function showQr() {
  const signupUrl = `${location.origin}${location.pathname}?signup=1`;
  els.qrLink.value = signupUrl;
  els.qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(signupUrl)}`;
  els.qrDialog.showModal();
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

els.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.loginMessage.textContent = "로그인 중입니다...";
  try {
    await login(els.loginUsername.value.trim(), els.loginPassword.value);
  } catch {
    els.loginMessage.textContent = "아이디 또는 비밀번호가 맞지 않거나 승인 대기 중입니다.";
  }
});

els.unlockBtn.addEventListener("click", () => login("admin", els.pinInput.value).catch(() => alert("로그인할 수 없습니다.")));
els.lockBtn.addEventListener("click", () => logout().catch(() => { loggedIn = false; render(); }));
els.showAccountRequestBtn.addEventListener("click", () => els.accountDialog.showModal());
els.showCustomerSignupBtn.addEventListener("click", () => { history.pushState(null, "", "?signup=1"); renderLogin(); });
els.backToLoginBtn.addEventListener("click", () => { history.pushState(null, "", location.pathname); renderLogin(); });

els.accountRequestForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/register-user", {
      method: "POST",
      body: JSON.stringify({
        displayName: $("#requestDisplayName").value,
        username: $("#requestUsername").value,
        password: $("#requestPassword").value,
      }),
    });
    els.accountRequestMessage.textContent = "신청되었습니다. 헤드 관리자 승인을 기다려 주세요.";
  } catch (error) {
    els.accountRequestMessage.textContent = error.message;
  }
});

els.customerSignupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/public/member-signup", {
      method: "POST",
      body: JSON.stringify({ name: $("#signupName").value, phone: $("#signupPhone").value, birthday: $("#signupBirthday").value, email: $("#signupEmail").value }),
    });
    els.signupMessage.textContent = "가입이 완료되었습니다.";
    els.customerSignupForm.reset();
  } catch (error) {
    els.signupMessage.textContent = error.message;
  }
});

els.memberForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!requireLogin()) return;
  const member = { id: createId(), name: els.memberName.value.trim(), phone: els.memberPhone.value.trim(), birthday: els.memberBirthday.value, email: "", notes: "", points: 0, purchases: [], coupons: [] };
  await withServerSave(`${member.name} 회원을 등록했습니다.`, () => {
    state.members.unshift(member);
    selectedMemberId = member.id;
  });
  els.memberForm.reset();
});

els.memberEditForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = els.memberEditForm.dataset.memberId;
  await withServerSave(`${$("#editName").value} 회원 프로필을 수정했습니다.`, () => {
    const member = state.members.find((item) => item.id === id);
    if (!member) return;
    member.name = $("#editName").value.trim();
    member.phone = $("#editPhone").value.trim();
    member.birthday = $("#editBirthday").value;
    member.email = $("#editEmail").value.trim();
    member.notes = $("#editNotes").value.trim();
  });
  els.memberEditDialog.close();
});

els.purchaseForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!requireLogin()) return;
  const memberId = els.purchaseMember.value;
  const amount = Number(els.purchaseAmount.value);
  const memo = els.purchaseMemo.value.trim();
  await withServerSave(`구매 ${formatWon(amount)}를 저장했습니다.`, () => addPurchase(memberId, amount, memo, "수기 입력"));
  els.purchaseForm.reset();
});

function addPurchase(memberId, amount, memo, source) {
  const member = state.members.find((item) => item.id === memberId);
  if (!member) return;
  const beforeTier = getTier(member.points).name;
  const points = Math.floor(amount * POINT_RATE);
  member.points += points;
  member.purchases.unshift({ id: createId(), amount, points, memo, source, date: new Date().toISOString() });
  const afterTier = getTier(member.points).name;
  if (beforeTier !== afterTier) member.notes = `${member.notes || ""}\n${afterTier} 자동 승급`.trim();
  selectedMemberId = member.id;
}

els.couponForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const memberId = els.couponMember.value;
  const couponName = $("#couponName").value.trim();
  await withServerSave(`${couponName} 쿠폰을 발급했습니다.`, () => {
    const member = state.members.find((item) => item.id === memberId);
    member?.coupons.unshift({ id: createId(), type: "custom", name: couponName, value: $("#couponValue").value.trim(), expire: $("#couponExpire").value, code: `CP-${Math.floor(100000 + Math.random() * 900000)}`, date: new Date().toISOString().slice(0, 10) });
    selectedMemberId = memberId;
  });
  els.couponDialog.close();
});

els.receiptForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const amount = Number(els.receiptAmount.value || parseReceiptText(els.receiptText.value));
  await withServerSave(`영수증으로 구매 ${formatWon(amount)}를 저장했습니다.`, () => addPurchase(els.receiptMember.value, amount, els.receiptText.value.trim(), "영수증 카메라"));
  stopCamera();
  els.receiptDialog.close();
});

els.receiptText.addEventListener("input", () => {
  const amount = parseReceiptText(els.receiptText.value);
  if (amount) els.receiptAmount.value = amount;
});

$("#startCameraBtn").addEventListener("click", () => startCamera().catch(() => alert("카메라 권한을 허용해 주세요.")));
$("#captureReceiptBtn").addEventListener("click", captureReceipt);
els.receiptDialog.addEventListener("close", stopCamera);
els.birthdayCouponBtn.addEventListener("click", issueBirthdayCoupons);
els.customCouponBtn.addEventListener("click", () => openCoupon());
els.receiptBtn.addEventListener("click", () => els.receiptDialog.showModal());
els.qrBtn.addEventListener("click", showQr);
$("#copyQrBtn").addEventListener("click", () => navigator.clipboard.writeText(els.qrLink.value));
els.exportBtn.addEventListener("click", exportData);
els.searchInput.addEventListener("input", renderMembers);

async function init() {
  render();
  try {
    await checkSession();
    render();
  } catch {
    els.loginMessage.textContent = "로그인하거나 고객 가입을 진행해 주세요.";
    renderLogin();
  }
  setInterval(() => {
    if (loggedIn && !isSaving && !document.hidden) safeRefresh();
  }, 5000);
}

init();
