const $ = (selector) => document.querySelector(selector);
const state = { markets: [], marketId: null, date: new Date().toISOString().slice(0, 10), map: [], shops: [], category: "ทั้งหมด", query: "" };
const marketSelect = $("#market-select"), shopList = $("#shop-list"), stallLayer = $("#stall-layer"), accountDialog = $("#account-dialog");
let toastTimer;

async function api(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || "เชื่อมต่อระบบไม่ได้");
  return payload?.data ?? payload;
}
function escapeHtml(value = "") { return String(value).replace(/[&<>\"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }
function showToast(message) { const toast = $("#toast"); toast.textContent = message; toast.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("show"), 3000); }
function setLoading(target, message) { target.innerHTML = `<div class="loading-state">${escapeHtml(message)}</div>`; }
function shopIcon(category = "") { return ({ "อาหาร": "🍜", "เครื่องดื่ม": "🥤", "ของหวาน": "🍰", "เสื้อผ้า": "👕", "งานคราฟต์": "🧺", "ของใช้": "🌼" })[category] || "✳"; }
function shopImage(category = "") { return ({ "อาหาร": "/images/shop-food.jpg", "เครื่องดื่ม": "/images/shop-drink.jpg", "ของหวาน": "/images/shop-dessert.jpg", "งานคราฟต์": "/images/shop-craft.jpg" })[category] || "/images/shop-food.jpg"; }
function shopForStall(id) { return state.map.find(stall => Number(stall.id) === Number(id))?.shop || null; }

async function loadMarkets() {
  const result = await api("/api/markets?limit=100"); state.markets = Array.isArray(result) ? result : (result.data || []);
  marketSelect.innerHTML = state.markets.length ? state.markets.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join("") : '<option value="">ยังไม่มีข้อมูลตลาด</option>';
  if (state.markets.length) { state.marketId = Number(state.markets[0].id); marketSelect.value = state.marketId; await loadMarket(); }
  else { $("#map-title").textContent = "ยังไม่มีตลาด"; setLoading(shopList, "ยังไม่มีตลาดให้แสดงผัง"); }
}
async function loadMarket() {
  if (!state.marketId) return;
  const market = await api(`/api/markets/${state.marketId}`); $("#map-title").textContent = market.name; $("#market-summary").textContent = market.address || "มีร้านค้าให้ค้นพบในตลาดวันนี้";
  $("#market-directions").href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(market.address || "อำเภอเมืองตาก จังหวัดตาก")}`;
  $(".brand > span:last-child").innerHTML = `${escapeHtml(market.name)}<small>${escapeHtml(market.address || "ตลาดของคนมีของ")}</small>`;
  $("#map-date").textContent = new Date(`${state.date}T12:00:00`).toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const result = await api(`/api/markets/${state.marketId}/map?date=${encodeURIComponent(state.date)}`); state.map = result.stalls || []; renderMap(); await loadShops();
}
function renderMap() {
  stallLayer.innerHTML = state.map.map((stall, i) => {
    const x = Number(stall.x) || 5 + (i % 8) * 12, y = Number(stall.y) || 15 + Math.floor(i / 8) * 22;
    const label = stall.shop?.name ? `<span>${escapeHtml(stall.shop.name)}</span>` : "";
    const description = stall.shop ? `ร้าน ${stall.shop.name}` : stall.status === "available" ? "ว่าง" : "ปิดใช้งาน";
    return `<button class="stall ${stall.status}" data-stall="${stall.id}" style="left:${Math.max(2, Math.min(96, x))}%;top:${Math.max(4, Math.min(90, y))}%" type="button" aria-label="แผง ${escapeHtml(stall.code)} ${escapeHtml(description)}" title="${escapeHtml(stall.shop?.name || description)}"><b>${escapeHtml(stall.code)}</b>${label}</button>`;
  }).join("");
  stallLayer.querySelectorAll(".stall").forEach(button => button.addEventListener("click", () => { const shop = shopForStall(button.dataset.stall); if (shop) openShop(shop.id); else showToast(button.classList.contains("available") ? "แผงนี้ยังไม่มีร้านค้าในวันที่เลือก" : "แผงนี้ปิดใช้งาน"); }));
}
async function loadShops() {
  if (!state.marketId) return; setLoading(shopList, "กำลังตามหาร้านเด็ด...");
  const params = new URLSearchParams({ date: state.date, q: state.query, limit: "100" }); if (state.category !== "ทั้งหมด") params.set("category", state.category);
  try { const result = await api(`/api/markets/${state.marketId}/shops?${params}`); state.shops = Array.isArray(result) ? result : (result.data || []); renderShops(); } catch (error) { setLoading(shopList, error.message); }
}
function renderShops() {
  $("#shop-count").textContent = state.shops.length;
  const categories = ["ทั้งหมด", ...new Set(state.map.map(s => s.shop?.category).filter(Boolean))];
  $("#categories").innerHTML = categories.map(c => `<button type="button" class="category-chip ${state.category === c ? "selected" : ""}" data-category="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join("");
  $("#categories").querySelectorAll("button").forEach(button => button.addEventListener("click", () => { state.category = button.dataset.category; loadShops(); }));
  if (!state.shops.length) { shopList.innerHTML = '<div class="empty-state"><span>✳</span><strong>ยังไม่เจอร้านที่ตามหา</strong><p>ลองเปลี่ยนคำค้น หรือเลือกหมวดอื่นดูนะ</p></div>'; return; }
  shopList.innerHTML = state.shops.map(s => `<button type="button" class="shop-row" data-shop="${s.id}" aria-label="กดดูรายละเอียดร้าน ${escapeHtml(s.name)}"><img class="shop-avatar-image" src="${shopImage(s.category)}" alt=""><span class="shop-info"><strong>${escapeHtml(s.name)}</strong><small>${escapeHtml(s.category || "ร้านค้า")}</small></span><span class="stall-code">${escapeHtml(s.stallCode)}</span><span class="row-arrow">กดดู ↗</span></button>`).join("");
  shopList.querySelectorAll("[data-shop]").forEach(button => button.addEventListener("click", () => openShop(button.dataset.shop)));
}
async function openShop(id) {
  try {
    const s = await api(`/api/markets/${state.marketId}/shops/${id}?date=${encodeURIComponent(state.date)}`);
    $("#shop-detail").innerHTML = `<img class="detail-photo" src="${shopImage(s.category)}" alt=""><p class="eyebrow">MEET THE MAKER · ${escapeHtml(s.stallCode)}</p><h2>${escapeHtml(s.name)}</h2><span class="detail-category">${escapeHtml(s.category || "ร้านค้า")}</span><p class="detail-description">${escapeHtml(s.description || "ร้านนี้กำลังเตรียมเรื่องราวดี ๆ มาเล่าให้คุณฟัง")}</p>${s.contact ? `<p class="detail-contact">ติดต่อร้าน <strong>${escapeHtml(s.contact)}</strong></p>` : ""}<button class="detail-map" id="focus-stall" type="button">ดูตำแหน่งแผง ${escapeHtml(s.stallCode)} บนแผนที่ ↗</button>`;
    const dialog = $("#shop-dialog"); dialog.showModal(); $("#focus-stall").addEventListener("click", () => { dialog.close(); const stall = state.map.find(item => item.shop?.id == id); const pin = stall && $(`[data-stall="${stall.id}"]`); pin?.scrollIntoView({ behavior: "smooth", block: "center" }); pin?.classList.add("focused"); setTimeout(() => pin?.classList.remove("focused"), 1600); });
  } catch (error) { showToast(error.message); }
}
function field(label, name, type = "text", required = false, value = "") { return `<label class="form-field">${label}<input name="${name}" type="${type}" ${required ? "required" : ""} value="${escapeHtml(value)}" autocomplete="${type === "password" ? "current-password" : name}"></label>`; }
function openAuth(mode = "login") {
  const register = mode === "register"; $("#account-title").textContent = register ? "เปิดร้านของคุณ" : "ยินดีต้อนรับกลับ"; $("#account-note").textContent = register ? "สมัครครั้งเดียว แล้วเริ่มต้นเดินทางไปกับตลาด" : "เข้าระบบเพื่อจัดการร้านและการจองของคุณ";
  $("#account-content").innerHTML = `<form id="auth-form" class="auth-form">${register ? field("ชื่อร้าน", "shopName", "text", true) + field("หมวดสินค้า", "category", "text", true) : ""}${field("อีเมล", "email", "email", true)}${field("รหัสผ่าน", "password", "password", true)}${register ? field("ช่องทางติดต่อ (ไม่บังคับ)", "contact") : ""}<p class="form-error" id="auth-error" role="alert"></p><button class="primary-button" type="submit">${register ? "สมัครเป็นร้านค้า" : "เข้าสู่ระบบ"} <span>↗</span></button></form><p class="form-switch">${register ? "มีบัญชีแล้ว?" : "ยังไม่มีบัญชี?"} <button type="button" id="switch-auth">${register ? "เข้าสู่ระบบ" : "สมัครร้านค้า"}</button></p><a class="customer-link" href="#market" id="customer-link">หรือกลับไปดูแผนผังตลาด</a>`;
  accountDialog.showModal(); $("#switch-auth").addEventListener("click", () => openAuth(register ? "login" : "register")); $("#customer-link").addEventListener("click", () => accountDialog.close());
  $("#auth-form").addEventListener("submit", async event => { event.preventDefault(); const form = new FormData(event.currentTarget), data = Object.fromEntries(form.entries()), button = event.currentTarget.querySelector("button[type=submit]"); button.disabled = true; button.textContent = "กำลังส่งข้อมูล..."; $("#auth-error").textContent = ""; try { await api(register ? "/api/auth/register" : "/api/auth/login", { method: "POST", body: JSON.stringify(data) }); await renderDashboard(); } catch (error) { $("#auth-error").textContent = error.message; button.disabled = false; button.textContent = register ? "สมัครเป็นร้านค้า" : "เข้าสู่ระบบ"; } });
}
async function renderDashboard() {
  try { const shop = await api("/api/auth/me"); $("#account-title").textContent = `สวัสดี, ${shop.name}`; $("#account-note").textContent = "จัดการร้านและติดตามการจองของคุณได้ที่นี่"; $("#account-content").innerHTML = `<div class="dashboard-tabs"><button class="tab active" data-tab="bookings">การจองของฉัน</button><button class="tab" data-tab="profile">ข้อมูลร้าน</button><button class="tab" data-tab="reserve">จองแผง</button></div><div id="dashboard-view"></div><button class="logout-button" id="logout">ออกจากระบบ</button>`; accountDialog.showModal(); document.querySelectorAll(".dashboard-tabs button").forEach(b => b.addEventListener("click", () => { $(".dashboard-tabs .active")?.classList.remove("active"); b.classList.add("active"); renderDashboardTab(b.dataset.tab, shop); })); $("#logout").addEventListener("click", async () => { try { await api("/api/auth/logout", { method: "POST" }); accountDialog.close(); showToast("ออกจากระบบแล้ว"); } catch (e) { showToast(e.message); } }); await renderDashboardTab("bookings", shop); } catch { openAuth("login"); }
}
async function renderDashboardTab(tab, shop) {
  const view = $("#dashboard-view");
  if (tab === "profile") {
    view.innerHTML = `<form id="profile-form" class="profile-form">${field("ชื่อร้าน", "name", "text", true, shop.name)}${field("หมวดสินค้า", "category", "text", true, shop.category)}<label class="form-field">รายละเอียด<textarea name="description" rows="3">${escapeHtml(shop.description || "")}</textarea></label>${field("ช่องทางติดต่อ", "contact", "text", false, shop.contact || "")}<p class="form-error" id="profile-error" role="alert"></p><button class="primary-button">บันทึกข้อมูล <span>↗</span></button></form>`;
    $("#profile-form").addEventListener("submit", async e => { e.preventDefault(); const button = e.currentTarget.querySelector("button"); button.disabled = true; try { const updated = await api("/api/shops/me", { method: "PATCH", body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget).entries())) }); Object.assign(shop, updated.data || updated); showToast("บันทึกข้อมูลร้านแล้ว"); } catch (error) { $("#profile-error").textContent = error.message; } finally { button.disabled = false; } });
  } else if (tab === "reserve") {
    const market = state.markets[0]; view.innerHTML = market ? `<p class="dashboard-help">เลือกแผงว่างจากรายการนี้เพื่อส่งคำขอจองให้ตลาดตรวจสอบ</p><label class="form-field">วันที่ต้องการจอง<input id="booking-date" type="date" value="${state.date}" min="${new Date().toISOString().slice(0, 10)}"></label><div id="available-stalls" class="available-stalls"></div>` : "ไม่พบตลาด";
    if (market) { $("#booking-date").addEventListener("change", async e => { state.date = e.target.value || state.date; await loadMarket(); renderDashboardTab("reserve", shop); }); $("#available-stalls").innerHTML = state.map.filter(s => s.status === "available").map(s => `<button type="button" class="available-stall" data-book-stall="${s.id}">แผง ${escapeHtml(s.code)} <span>จอง ↗</span></button>`).join("") || '<p class="dashboard-help">ไม่มีแผงว่างในวันที่เลือก</p>'; view.querySelectorAll("[data-book-stall]").forEach(button => button.addEventListener("click", async () => { if (!confirm(`ส่งคำขอจองแผงนี้ในวันที่ ${state.date} หรือไม่?`)) return; try { await api(`/api/markets/${state.marketId}/bookings`, { method: "POST", body: JSON.stringify({ stallId: Number(button.dataset.bookStall), bookingDate: state.date }) }); showToast("ส่งคำขอจองแล้ว"); await renderDashboardTab("bookings", shop); } catch (error) { showToast(error.message); await loadMarket(); } })); }
  } else {
    const result = await api("/api/shops/me/bookings?limit=50"), bookings = Array.isArray(result) ? result : (result.data || []);
    view.innerHTML = bookings.length ? `<div class="booking-list">${bookings.map(b => `<article class="booking-card"><span class="booking-stall">${escapeHtml(b.stallCode)}</span><div><strong>${escapeHtml(b.marketName)}</strong><small>${new Date(`${String(b.bookingDate).slice(0, 10)}T12:00:00`).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" })}</small></div><span class="booking-status ${b.status}">${b.status === "pending" ? "รอตรวจสอบ" : b.status === "confirmed" ? "ยืนยันแล้ว" : "ยกเลิก"}</span>${b.status === "pending" ? `<button class="cancel-booking" data-cancel="${b.id}" type="button">ยกเลิก</button>` : ""}</article>`).join("")}</div>` : '<div class="empty-bookings"><span>✳</span><p>ยังไม่มีรายการจอง</p><button class="text-button" id="go-reserve">เลือกแผงแรกของคุณ ↗</button></div>';
    view.querySelectorAll("[data-cancel]").forEach(button => button.addEventListener("click", async () => { if (!confirm("ยืนยันการยกเลิกคำขอจองนี้?")) return; try { await api(`/api/shops/me/bookings/${button.dataset.cancel}/cancel`, { method: "PATCH" }); showToast("ยกเลิกรายการแล้ว"); await renderDashboardTab("bookings", shop); } catch (e) { showToast(e.message); } })); $("#go-reserve")?.addEventListener("click", () => $("[data-tab=reserve]").click());
  }
}
marketSelect.addEventListener("change", () => { state.marketId = Number(marketSelect.value); loadMarket().catch(e => showToast(e.message)); });
$("#search").addEventListener("input", e => { state.query = e.target.value.trim(); clearTimeout(window.searchTimer); window.searchTimer = setTimeout(loadShops, 250); });
$("#clear-filter").addEventListener("click", () => { state.category = "ทั้งหมด"; state.query = ""; $("#search").value = ""; loadShops(); });
$("#map-reset").addEventListener("click", () => $("#map-viewport").scrollTo({ left: 0, top: 0, behavior: "smooth" }));
$("#open-account").addEventListener("click", renderDashboard); $("#seller-join").addEventListener("click", () => openAuth("register")); $("#close-account").addEventListener("click", () => accountDialog.close()); $("#close-shop").addEventListener("click", () => $("#shop-dialog").close());
document.addEventListener("keydown", e => { if (e.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) { e.preventDefault(); $("#search").focus(); } });
loadMarkets().catch(error => { setLoading(shopList, error.message); $("#market-summary").textContent = "ไม่สามารถโหลดข้อมูลตลาดได้"; });
