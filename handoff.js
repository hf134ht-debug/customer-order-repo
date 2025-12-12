/* =========================================================
   handoff.js  店員用 受け渡し（v1骨格）
   - 3/6件切替
   - 自動更新（10/30/60秒・差分判定・非表示タブ停止）
   - フィルタ（単一）
   - 並び順（受付/経過/手動rank）
   - カードタップでPOS風編集（数量変更＋品目追加）
   - 完了/キャンセル
========================================================= */

const qs = (s, el=document) => el.querySelector(s);
const qsa = (s, el=document) => [...el.querySelectorAll(s)];
const yen = (n) => "¥" + (Number(n||0)).toLocaleString("ja-JP");
const escapeHtml = (s)=>String(s ?? "").replace(/[&<>"']/g, (c)=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));

function setMsg(type, text) {
  const area = qs("#msgArea");
  if (!text) { area.innerHTML = ""; return; }
  const cls = type==="err" ? "msg err" : "msg";
  area.innerHTML = `<div class="${cls}">${escapeHtml(text).replace(/\n/g,"<br>")}</div>`;
}
function setModalMsg(type, text) {
  const area = qs("#mMsg");
  if (!text) { area.innerHTML = ""; return; }
  const cls = type==="err" ? "msg err" : "msg";
  area.innerHTML = `<div class="${cls}">${escapeHtml(text).replace(/\n/g,"<br>")}</div>`;
}

async function apiGet(params) {
  const url = new URL(GAS_WEB_APP_URL);
  Object.entries(params).forEach(([k,v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { method:"GET" });
  return await res.json();
}
async function apiPost(payload) {
  const res = await fetch(GAS_WEB_APP_URL, {
    method:"POST",
    headers:{ "Content-Type":"text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });
  return await res.json();
}

/* ===== state ===== */
let autoEnabled = false;
let timer = null;
let lastMaxUpdatedAt = "";
let products = [];         // staff用商品（追加用）
let productsLoaded = false;

let currentOrdersMain = [];
let currentOrdersOther = [];

let editingOrder = null;   // {order_id,...}
let draftItems = [];       // modal用 items

/* ===== controls ===== */
const elView = qs("#viewMode");
const elSort = qs("#sortMode");
const elFilter = qs("#filterMode");
const elAutoInt = qs("#autoInterval");
const elBtnAuto = qs("#btnAuto");

function getLimit() {
  const v = Number(elView.value || 3);
  return (v === 6) ? 6 : 3;
}
function isCompact() { return getLimit() === 6; }

/* ===== auto refresh ===== */
function stopAuto() {
  autoEnabled = false;
  elBtnAuto.textContent = "自動更新：OFF";
  if (timer) clearInterval(timer);
  timer = null;
}
function startAuto() {
  autoEnabled = true;
  elBtnAuto.textContent = "自動更新：ON";
  if (timer) clearInterval(timer);

  const sec = Number(elAutoInt.value || 30);
  timer = setInterval(() => {
    if (document.visibilityState !== "visible") return; // 背景タブ停止
    refresh({ silent:true });
  }, sec * 1000);
}

qs("#btnAuto").addEventListener("click", () => {
  autoEnabled ? stopAuto() : startAuto();
});
qs("#btnRefresh").addEventListener("click", () => refresh({ silent:false }));
elView.addEventListener("change", () => refresh({ silent:false }));
elSort.addEventListener("change", () => refresh({ silent:false }));
elFilter.addEventListener("change", () => refresh({ silent:false }));
elAutoInt.addEventListener("change", () => { if (autoEnabled) startAuto(); });

document.addEventListener("visibilitychange", () => {
  // 戻ってきた時に最新化
  if (document.visibilityState === "visible" && autoEnabled) refresh({ silent:true });
});

/* ===== render ===== */
function renderAll() {
  const list = qs("#orderList");
  list.innerHTML = "";

  const compact = isCompact();
  currentOrdersMain.forEach(o => list.appendChild(renderCard(o, compact)));

  if (!currentOrdersMain.length) {
    list.innerHTML = `<div class="msg">受付中の注文はありません。</div>`;
  }

  // count pill: pending total
  const totalCount = currentOrdersMain.length + currentOrdersOther.length;
  qs("#countPill").textContent = `${totalCount}件`;

  // others
  qs("#othersSummary").textContent = `その他の注文（${currentOrdersOther.length}件）`;
  const others = qs("#othersList");
  others.innerHTML = "";

  if (!currentOrdersOther.length) {
    others.innerHTML = `<div class="muted" style="padding:10px 0;">その他はありません。</div>`;
    return;
  }

  currentOrdersOther.forEach(o => {
    const row = document.createElement("div");
    row.className = "otherRow";
    row.innerHTML = `
      <div>
        <div style="font-weight:900;">No.${Number(o.display_no||0)}</div>
        <div class="muted">経過 ${Number(o.elapsed_min||0)} 分</div>
      </div>
      <div class="muted">${yen(o.total)}</div>
    `;
    row.addEventListener("click", () => openEditor(o));
    others.appendChild(row);
  });
}

function renderCard(o, compact) {
  const el = document.createElement("div");
  el.className = "card" + (compact ? " compact" : "");

  const items = Array.isArray(o.items) ? o.items : [];
  const lines = items.length
    ? items.map(it => {
        const name = escapeHtml(it.product_name_at_sale);
        const qty = Number(it.qty||0);
        const lt  = yen(Number(it.line_total||0));
        return `<li>${name} × ${qty}（${lt}）</li>`;
      }).join("")
    : `<li class="muted">内訳がありません（データ不整合）</li>`;

  const lockNote = (String(o.lock_state||"none") === "staff_edit")
    ? `<div class="muted"><span class="dangerText">編集中</span>（別端末の可能性）</div>`
    : "";

  el.innerHTML = `
    <div class="row">
      <div>
        <div class="name">No.${Number(o.display_no||0)}</div>
        <div class="muted">経過 ${Number(o.elapsed_min||0)} 分 / ${escapeHtml(o.created_at||"")}</div>
        ${lockNote}
      </div>
      <div class="price">${yen(o.total)}</div>
    </div>

    <div class="divider"></div>

    <div><b>内訳</b></div>
    <ul class="list">${lines}</ul>

    <div class="actions">
      <button class="btn btnOk" data-act="handed">受け渡し完了</button>
      <button class="btn btnDanger" data-act="cancel">キャンセル</button>
    </div>
  `;

  // カードタップで編集（ボタンは除外）
  el.addEventListener("click", (ev) => {
    const t = ev.target;
    if (t && t.closest && t.closest("button")) return;
    openEditor(o);
  });

  el.querySelector('[data-act="handed"]').addEventListener("click", async (ev) => {
    ev.stopPropagation();
    await completeOrder(o.order_id);
  });
  el.querySelector('[data-act="cancel"]').addEventListener("click", async (ev) => {
    ev.stopPropagation();
    await cancelOrder(o.order_id);
  });

  return el;
}

/* ===== data ===== */
async function loadProductsOnce() {
  if (productsLoaded) return;
  const json = await apiGet({ mode:"getProducts", scope:"staff" });
  if (!json.ok) throw new Error(json.error || "getProducts failed");
  products = Array.isArray(json.products) ? json.products : [];
  productsLoaded = true;
}

function rebuildFilterOptions(options) {
  // options: [{value,label}] 形式を想定
  const keep = elFilter.value || "";
  elFilter.innerHTML = `<option value="">フィルタ：全て</option>`;
  (options || []).forEach(opt => {
    const op = document.createElement("option");
    op.value = String(opt.value ?? "");
    op.textContent = String(opt.label ?? opt.value ?? "");
    elFilter.appendChild(op);
  });
  // 可能なら維持
  elFilter.value = keep;
}

/* ===== refresh ===== */
let refreshLock = false;

async function refresh({silent=false}={}) {
  if (refreshLock) return;
  refreshLock = true;

  if (!silent) setMsg("", "");
  qs("#orderList").innerHTML = `<div class="msg">読み込み中…</div>`;

  try {
    const limit = String(getLimit());
    const sort = String(elSort.value || "created");
    const filter = String(elFilter.value || "");

    // サーバー側が対応していれば差分判定が効く（未対応でもOK）
    const json = await apiGet({
      mode: "getPendingOrders",
      limit,
      sort,
      filter,
      since: lastMaxUpdatedAt || ""
    });

    if (!json.ok) throw new Error(json.error || "取得失敗");

    // 差分なし判定（サーバーがchanged返すならそれ優先）
    if (json.changed === false) {
      // 表示はそのまま（時間表示を変えたいならrefreshの頻度で更新してもOK）
      qs("#orderList").innerHTML = "";
      currentOrdersMain.forEach(o => qs("#orderList").appendChild(renderCard(o, isCompact())));
      refreshLock = false;
      return;
    }

    const main = Array.isArray(json.orders_main) ? json.orders_main : (Array.isArray(json.orders) ? json.orders : []);
    const other = Array.isArray(json.orders_other) ? json.orders_other : [];

    currentOrdersMain = main;
    currentOrdersOther = other;

    if (typeof json.max_updated_at === "string") {
      lastMaxUpdatedAt = json.max_updated_at;
    }

    // フィルタ候補（あれば）
    if (Array.isArray(json.filter_options)) rebuildFilterOptions(json.filter_options);

    renderAll();
    setMsg("", "");
  } catch (err) {
    qs("#orderList").innerHTML = "";
    setMsg("err", `取得できませんでした。\n詳細: ${String(err.message||err)}`);
  } finally {
    refreshLock = false;
  }
}

/* ===== modal editor ===== */
function showModal(show) {
  const ov = qs("#overlay");
  ov.classList.toggle("show", !!show);
  ov.setAttribute("aria-hidden", show ? "false" : "true");
}
qs("#mClose").addEventListener("click", async () => {
  await unlockEditingOrder();
  closeEditor();
});
qs("#overlay").addEventListener("click", async (ev) => {
  // 背景クリックで閉じる（モーダル本体は閉じない）
  if (ev.target.id === "overlay") {
    await unlockEditingOrder();
    closeEditor();
  }
});

function closeEditor() {
  editingOrder = null;
  draftItems = [];
  setModalMsg("", "");
  showModal(false);
}

async function lockEditingOrder(order_id) {
  // 既存のmodeを使う（GAS側で対応必須）
  try {
    const j = await apiPost({ mode:"staffSetLock", order_id, lock_state:"staff_edit" });
    if (!j.ok) throw new Error(j.error || "lock failed");
  } catch (e) {
    // ロック失敗でも編集はできるようにする（ただし注意表示）
    setModalMsg("err", "ロックに失敗しました（他端末と競合の可能性）。\n保存時に上書きになります。");
  }
}
async function unlockEditingOrder() {
  if (!editingOrder) return;
  try {
    await apiPost({ mode:"staffSetLock", order_id: editingOrder.order_id, lock_state:"none" });
  } catch {}
}

function normalizeDraftFromOrder(o) {
  const items = Array.isArray(o.items) ? o.items : [];
  // modal内では、必ず product_id を持つ形に寄せる
  return items.map(it => ({
    product_id: String(it.product_id || ""),
    product_name_at_sale: String(it.product_name_at_sale || ""),
    unit_price: Number(it.unit_price || 0),
    qty: Number(it.qty || 0),
  })).filter(x => x.qty > 0);
}

function calcDraftTotal() {
  return draftItems.reduce((sum, it) => sum + (Number(it.unit_price||0) * Number(it.qty||0)), 0);
}

function renderModal() {
  if (!editingOrder) return;

  qs("#mTitle").textContent = `No.${Number(editingOrder.display_no||0)} を編集`;
  qs("#mSub").textContent = `経過 ${Number(editingOrder.elapsed_min||0)} 分 / 注文ID: ${editingOrder.order_id}`;
  qs("#mTotal").textContent = yen(calcDraftTotal());

  // items
  const box = qs("#mItems");
  box.innerHTML = "";

  if (!draftItems.length) {
    box.innerHTML = `<div class="muted" style="padding:10px 0;">内訳が空です。下の「品目追加」から追加してください。</div>`;
  } else {
    draftItems.forEach((it, idx) => {
      const row = document.createElement("div");
      row.className = "itemRow";
      row.innerHTML = `
        <div>
          <div style="font-weight:900;">${escapeHtml(it.product_name_at_sale)}</div>
          <div class="muted">${yen(it.unit_price)} / 小計 ${yen(it.unit_price * it.qty)}</div>
        </div>
        <div class="qtyBox">
          <button class="qtyBtn" data-act="minus">-</button>
          <input class="qtyInp" inputmode="numeric" value="${it.qty}">
          <button class="qtyBtn" data-act="plus">+</button>
        </div>
        <div class="right">
          <button class="btn" style="padding:10px 10px;" data-act="del">削除</button>
        </div>
      `;

      const inp = row.querySelector(".qtyInp");
      row.querySelector('[data-act="minus"]').addEventListener("click", () => {
        it.qty = Math.max(0, Number(it.qty||0) - 1);
        if (it.qty === 0) draftItems.splice(idx, 1);
        renderModal();
      });
      row.querySelector('[data-act="plus"]').addEventListener("click", () => {
        it.qty = Number(it.qty||0) + 1;
        renderModal();
      });
      row.querySelector('[data-act="del"]').addEventListener("click", () => {
        draftItems.splice(idx, 1);
        renderModal();
      });
      inp.addEventListener("change", () => {
        const v = Math.max(0, Math.floor(Number(inp.value||0)));
        if (!v) draftItems.splice(idx, 1);
        else it.qty = v;
        renderModal();
      });

      box.appendChild(row);
    });
  }

  // products search
  const key = String(qs("#mSearch").value || "").trim().toLowerCase();
  const out = qs("#mProds");
  out.innerHTML = "";

  const filtered = products
    .filter(p => p && p.is_active !== false)
    .filter(p => {
      const name = String(p.name||"").toLowerCase();
      return key ? name.includes(key) : true;
    })
    .slice(0, 12);

  if (!filtered.length) {
    out.innerHTML = `<div class="muted" style="padding:10px 0;">該当なし</div>`;
  } else {
    filtered.forEach(p => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "prodBtn";
      b.innerHTML = `
        <div>${escapeHtml(p.name)}</div>
        <div class="muted">${yen(p.price)}</div>
      `;
      b.addEventListener("click", () => {
        addProductToDraft(p);
      });
      out.appendChild(b);
    });
  }
}

function addProductToDraft(p) {
  const pid = String(p.product_id || "");
  if (!pid) return;

  const existing = draftItems.find(x => x.product_id === pid);
  if (existing) {
    existing.qty += 1;
  } else {
    draftItems.push({
      product_id: pid,
      product_name_at_sale: String(p.name || ""),
      unit_price: Number(p.price || 0),
      qty: 1,
    });
  }
  renderModal();
}

async function openEditor(order) {
  try {
    setModalMsg("", "");
    editingOrder = order;
    draftItems = normalizeDraftFromOrder(order);

    showModal(true);
    await loadProductsOnce();
    await lockEditingOrder(order.order_id);

    renderModal();
    qs("#mSearch").focus();
  } catch (err) {
    setModalMsg("err", `編集画面を開けませんでした。\n詳細: ${String(err.message||err)}`);
  }
}

qs("#mSearch").addEventListener("input", () => {
  if (!editingOrder) return;
  renderModal();
});

/* ===== save / complete / cancel from modal ===== */
async function saveDraft() {
  if (!editingOrder) return;

  setModalMsg("", "");
  const btn = qs("#mSave");
  btn.disabled = true;
  btn.textContent = "保存中…";

  try {
    // 注文の明細を「丸ごと」送る（自由度が高い）
    const payload = {
      mode: "updateOrderItems",
      order_id: editingOrder.order_id,
      actor: "staff",
      items: draftItems.map(it => ({
        product_id: it.product_id,
        product_name_at_sale: it.product_name_at_sale,
        unit_price: it.unit_price,
        qty: it.qty
      }))
    };

    const json = await apiPost(payload);
    if (!json.ok) throw new Error(json.error || "保存失敗");

    // 保存後、一覧を更新
    await unlockEditingOrder();
    closeEditor();
    await refresh({ silent:true });

  } catch (err) {
    setModalMsg("err", `保存できませんでした。\n詳細: ${String(err.message||err)}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "保存";
  }
}

async function completeOrder(order_id) {
  if (!confirm("受け渡し完了にします。よろしいですか？")) return;

  setMsg("", "");
  try {
    const json = await apiPost({ mode:"staffMarkHanded", order_id, actor:"staff" });
    if (!json.ok) throw new Error(json.error || "失敗");
    if (editingOrder && editingOrder.order_id === order_id) {
      await unlockEditingOrder();
      closeEditor();
    }
    await refresh({ silent:true });
  } catch (err) {
    setMsg("err", `完了できませんでした。\n詳細: ${String(err.message||err)}`);
  }
}

async function cancelOrder(order_id) {
  if (!confirm("この注文をキャンセルします。よろしいですか？")) return;

  setMsg("", "");
  try {
    const json = await apiPost({ mode:"cancelOrder", order_id, actor:"staff" });
    if (!json.ok) throw new Error(json.error || "失敗");
    if (editingOrder && editingOrder.order_id === order_id) {
      await unlockEditingOrder();
      closeEditor();
    }
    await refresh({ silent:true });
  } catch (err) {
    setMsg("err", `キャンセルできませんでした。\n詳細: ${String(err.message||err)}`);
  }
}

qs("#mSave").addEventListener("click", saveDraft);
qs("#mHanded").addEventListener("click", async () => {
  if (!editingOrder) return;
  await completeOrder(editingOrder.order_id);
});
qs("#mCancel").addEventListener("click", async () => {
  if (!editingOrder) return;
  await cancelOrder(editingOrder.order_id);
});

/* ===== init ===== */
(async function init(){
  if (!GAS_WEB_APP_URL.includes("script.google.com")) {
    setMsg("err", "GAS_WEB_APP_URL が未設定です。");
    return;
  }
  await refresh({ silent:false });
})();
