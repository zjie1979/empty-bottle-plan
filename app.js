const STORAGE_KEY = "emptyBottlePlan.v1";
const CACHE_NOTE = "记录只保存在当前浏览器。";

const state = loadState();

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function defaultState() {
  return {
    items: [],
    wishes: [],
    history: []
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return {
      items: Array.isArray(parsed.items) ? parsed.items : [],
      wishes: Array.isArray(parsed.wishes) ? parsed.wishes : [],
      history: Array.isArray(parsed.history) ? parsed.history : []
    };
  } catch {
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function daysUntil(dateString) {
  if (!dateString) return 9999;
  const today = new Date(`${todayISO()}T00:00:00`);
  const target = new Date(`${dateString}T00:00:00`);
  return Math.ceil((target - today) / 86400000);
}

function priorityScore(item) {
  const expireDays = daysUntil(item.expire);
  let score = 0;
  if (expireDays <= 0) score += 120;
  else if (expireDays <= 7) score += 80;
  else if (expireDays <= 30) score += 35;
  if (item.opened) score += 30;
  score += Math.max(0, 12 - Number(item.qty || 0));
  return score;
}

function priorityLabel(item) {
  const expireDays = daysUntil(item.expire);
  if (expireDays < 0) return { text: "已过期，先处理", cls: "hot" };
  if (expireDays === 0) return { text: "今天到期", cls: "hot" };
  if (expireDays <= 7) return { text: `${expireDays}天内到期`, cls: "warn" };
  if (item.opened) return { text: "已开封", cls: "warn" };
  return { text: "库存", cls: "" };
}

function sortedItems() {
  return [...state.items].sort((a, b) => {
    const scoreDiff = priorityScore(b) - priorityScore(a);
    if (scoreDiff) return scoreDiff;
    return (a.createdAt || "").localeCompare(b.createdAt || "");
  });
}

function useOne(id) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;
  item.qty = Math.max(0, Number(item.qty || 0) - 1);
  item.updatedAt = new Date().toISOString();
  if (item.qty === 0) finishItem(id);
  else {
    state.history.unshift({
      id: uid(),
      type: "use",
      text: `用了 1 ${item.unit || "次"}：${item.name}`,
      at: new Date().toISOString()
    });
    saveState();
    render();
    showToast("已扣减一次。");
  }
}

function finishItem(id) {
  const index = state.items.findIndex((entry) => entry.id === id);
  if (index < 0) return;
  const [item] = state.items.splice(index, 1);
  state.history.unshift({
    id: uid(),
    type: "finish",
    text: `空瓶完成：${item.name}`,
    at: new Date().toISOString()
  });
  saveState();
  render();
  showToast("空瓶完成，先别急着补货。");
}

function deleteItem(id) {
  const index = state.items.findIndex((entry) => entry.id === id);
  if (index < 0) return;
  const [item] = state.items.splice(index, 1);
  state.history.unshift({
    id: uid(),
    type: "delete",
    text: `移出清单：${item.name}`,
    at: new Date().toISOString()
  });
  saveState();
  render();
  showToast("已移出清单。");
}

function pauseWish(id) {
  const wish = state.wishes.find((entry) => entry.id === id);
  if (!wish) return;
  wish.paused = true;
  wish.pausedAt = new Date().toISOString();
  state.history.unshift({
    id: uid(),
    type: "pause",
    text: `忍住没买：${wish.name}`,
    at: new Date().toISOString()
  });
  saveState();
  render();
  showToast("已记为忍住没买。");
}

function deleteWish(id) {
  state.wishes = state.wishes.filter((entry) => entry.id !== id);
  saveState();
  render();
}

function renderItemCard(item, mode = "normal") {
  const label = priorityLabel(item);
  const place = item.place ? `位置：${escapeHtml(item.place)} · ` : "";
  const expire = item.expire ? `到期：${item.expire}` : "未填到期日";
  const opened = item.opened ? " · 已开封" : "";
  return `
    <article class="item-card">
      <div class="item-head">
        <div class="item-title">
          <h3>${escapeHtml(item.name)}</h3>
          <span class="pill ${label.cls}">${label.text}</span>
        </div>
        <strong>${Number(item.qty || 0)}${escapeHtml(item.unit || "次")}</strong>
      </div>
      <p class="meta">${place}${expire}${opened} · ${escapeHtml(item.category)}</p>
      <div class="item-actions">
        <button class="action-button" type="button" data-use="${item.id}">用一次</button>
        <button class="action-button finish-button" type="button" data-finish="${item.id}">${mode === "focus" ? "今天用完" : "空瓶"}</button>
        <button class="delete-button" type="button" data-delete-item="${item.id}" aria-label="删除 ${escapeHtml(item.name)}">×</button>
      </div>
    </article>
  `;
}

function renderToday() {
  const list = $("#todayList");
  const items = sortedItems().slice(0, 5);
  if (!items.length) {
    list.innerHTML = `<div class="empty-state">还没有库存。先去“清单”加入家里已有的东西，再从这里挨着用。</div>`;
    return;
  }
  list.innerHTML = items.map((item) => renderItemCard(item, "focus")).join("");
}

function renderInventory() {
  const list = $("#inventoryList");
  const items = sortedItems();
  if (!items.length) {
    list.innerHTML = `<div class="empty-state">清单为空。只记录已经买回家的东西，不记录想买的东西。</div>`;
    return;
  }
  list.innerHTML = items.map((item) => renderItemCard(item)).join("");
}

function renderWishes() {
  const list = $("#wishList");
  if (!state.wishes.length) {
    list.innerHTML = `<div class="empty-state">想买时先写在这里。过 72 小时还需要，再决定。</div>`;
    return;
  }
  list.innerHTML = state.wishes.map((wish) => {
    const holdDays = Math.max(0, 3 - Math.floor((Date.now() - new Date(wish.createdAt).getTime()) / 86400000));
    const status = wish.paused ? "已忍住" : holdDays > 0 ? `再等${holdDays}天` : "可以复核";
    return `
      <article class="wish-card">
        <div class="wish-head">
          <div class="wish-title">
            <h3>${escapeHtml(wish.name)}</h3>
            <span class="pill ${wish.paused ? "" : "warn"}">${status}</span>
          </div>
          <button class="delete-button" type="button" data-delete-wish="${wish.id}" aria-label="删除 ${escapeHtml(wish.name)}">×</button>
        </div>
        <p class="meta">${wish.alt ? `先替代：${escapeHtml(wish.alt)}` : "先看看家里有没有相近的。"} · ${CACHE_NOTE}</p>
        ${wish.paused ? "" : `<button class="primary-button" type="button" data-pause="${wish.id}">我先不买了</button>`}
      </article>
    `;
  }).join("");
}

function renderReview() {
  const finished = state.history.filter((entry) => entry.type === "finish").length;
  const paused = state.history.filter((entry) => entry.type === "pause").length;
  const active = state.items.length;
  const target = Math.max(5, finished + active);
  const progress = Math.min(100, Math.round((finished / target) * 100));
  $("#reviewText").textContent = `已完成 ${finished} 个空瓶，${paused} 次把想买先放下。当前还有 ${active} 个库存，下一步就是少买、先用、用完再说。`;
  $("#progressFill").style.width = `${progress}%`;

  const list = $("#historyList");
  if (!state.history.length) {
    list.innerHTML = `<div class="empty-state">开始使用、空瓶或忍住没买后，这里会形成复盘记录。</div>`;
    return;
  }
  list.innerHTML = state.history.slice(0, 25).map((entry) => {
    const date = new Date(entry.at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    return `<div class="history-row">${date} · ${escapeHtml(entry.text)}</div>`;
  }).join("");
}

function renderSummary() {
  $("#todayCount").textContent = sortedItems().slice(0, 5).length;
  $("#doneCount").textContent = state.history.filter((entry) => entry.type === "finish").length;
  $("#pausedCount").textContent = state.history.filter((entry) => entry.type === "pause").length;
}

function render() {
  renderSummary();
  renderToday();
  renderInventory();
  renderWishes();
  renderReview();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 1800);
}

function addExamples() {
  if (state.items.length) {
    showToast("已有清单，示例没有重复加入。");
    return;
  }
  state.items.push(
    { id: uid(), name: "燕麦片", category: "食品", qty: 6, unit: "次", place: "厨房", expire: offsetDate(12), opened: true, createdAt: new Date().toISOString() },
    { id: uid(), name: "身体乳", category: "护肤", qty: 9, unit: "次", place: "卫生间", expire: "", opened: true, createdAt: new Date().toISOString() },
    { id: uid(), name: "冷冻水饺", category: "食品", qty: 4, unit: "顿", place: "冰箱", expire: offsetDate(5), opened: false, createdAt: new Date().toISOString() }
  );
  saveState();
  render();
  showToast("已加入示例，可直接删除。");
}

function offsetDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function bindEvents() {
  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      $$(".tab").forEach((entry) => entry.classList.toggle("is-active", entry === tab));
      $$(".panel").forEach((panel) => panel.classList.toggle("is-active", panel.dataset.panel === tab.dataset.tab));
    });
  });

  $("#itemForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    state.items.push({
      id: uid(),
      name: form.get("name").trim(),
      category: form.get("category"),
      qty: Number(form.get("qty")),
      unit: (form.get("unit") || "次").trim(),
      place: (form.get("place") || "").trim(),
      expire: form.get("expire"),
      opened: Boolean(form.get("opened")),
      createdAt: new Date().toISOString()
    });
    event.currentTarget.reset();
    $("#itemQty").value = 1;
    $("#itemUnit").value = "次";
    saveState();
    render();
    showToast("已加入清单。");
  });

  $("#wishForm").addEventListener("submit", (event) => {
    event.preventDefault();
    state.wishes.unshift({
      id: uid(),
      name: $("#wishName").value.trim(),
      alt: $("#wishAlt").value.trim(),
      paused: false,
      createdAt: new Date().toISOString()
    });
    event.currentTarget.reset();
    saveState();
    render();
    showToast("已加入冷静清单。");
  });

  document.body.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.use) useOne(button.dataset.use);
    if (button.dataset.finish) finishItem(button.dataset.finish);
    if (button.dataset.deleteItem) deleteItem(button.dataset.deleteItem);
    if (button.dataset.pause) pauseWish(button.dataset.pause);
    if (button.dataset.deleteWish) deleteWish(button.dataset.deleteWish);
  });

  $("#seedButton").addEventListener("click", addExamples);
  $("#backupButton").addEventListener("click", () => {
    $("#backupText").value = "";
    $("#backupDialog").showModal();
  });
  $("#exportButton").addEventListener("click", () => {
    $("#backupText").value = JSON.stringify(state, null, 2);
    $("#backupText").select();
    showToast("已生成备份文本。");
  });
  $("#importButton").addEventListener("click", () => {
    try {
      const data = JSON.parse($("#backupText").value);
      state.items = Array.isArray(data.items) ? data.items : [];
      state.wishes = Array.isArray(data.wishes) ? data.wishes : [];
      state.history = Array.isArray(data.history) ? data.history : [];
      saveState();
      render();
      showToast("已恢复。");
    } catch {
      showToast("备份文本格式不对。");
    }
  });
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").then((registration) => {
      registration.update();
    }).catch(() => {});
  });
}

bindEvents();
render();
