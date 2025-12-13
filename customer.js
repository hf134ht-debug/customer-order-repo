/************ GAS Web App URL（customer.html から渡す） ************/
const GAS_WEB_APP_URL = (window.GAS_WEB_APP_URL || "").trim();
/*******************************************************************/

const LS_LAST_ORDER_ID = "pos_last_order_id";

let products = [];
let qtyMap = {};        // product_id -> qty
let detailCache = {};   // product_id -> detail obj
let loading = { products:false, checkout:false, my:false };
let submitToken = null; // ★二重送信対策：送信中は同じtokenを使う

// ★強化：通信失敗→再送でも同じ注文になるように、sessionStorage に一時保存
const SUBMIT_TOKEN_KEY = "pos_submit_token";
const SUBMIT_TOKEN_TS_KEY = "pos_submit_token_ts";
const SUBMIT_TOKEN_TTL_MS = 2 * 60 * 1000; // 2分だけ有効

function loadSubmitToken() {
  try {
    const t = (sessionStorage.getItem(SUBMIT_TOKEN_KEY) || "").trim();
    const ts = Number(sessionStorage.getItem(SUBMIT_TOKEN_TS_KEY) || "0");
    if (!t || !ts) return null;
    if (Date.now() - ts > SUBMIT_TOKEN_TTL_MS) {
      clearSubmitToken();
      return null;
    }
    return t;
  } catch { return null; }
}

function saveSubmitToken(t) {
  try {
    sessionStorage.setItem(SUBMIT_TOKEN_KEY, t);
    sessionStorage.setItem(SUBMIT_TOKEN_TS_KEY, String(Date.now()));
  } catch {}
}

function clearSubmitToken() {
  submitToken = null;
  try {
    sessionStorage.removeItem(SUBMIT_TOKEN_KEY);
    sessionStorage.removeItem(SUBMIT_TOKEN_TS_KEY);
  } catch {}
}

let editOrderId = null;
let editOriginalItems = null;

const yen = (n) => "¥" + (Number(n||0)).toLocaleString("ja-JP");
const uuid = () => {
  const a = crypto.getRandomValues(new Uint8Array(16));
  a[6] = (a[6] & 0x0f) | 0x40;
  a[8] = (a[8] & 0x3f) | 0x80;
  const h = [...a].map(x=>x.toString(16).padStart(2,"0")).join("");
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
};
const qs = (s, el=document) => el.querySelector(s);

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, (c)=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

function setMsg(type, text) {
  const area = qs("#msgArea");
  if (!area) return;
  if (!text) { area.innerHTML = ""; return; }
  const cls = type === "err" ? "msg err" : type === "ok" ? "msg ok" : "msg";
  area.innerHTML = `<div class="${cls}">${escapeHtml(text).replace(/\n/g,"<br>")}</div>`;
}

function showEditBanner(text) {
  const b = qs("#editBanner");
  if (!b) return;
  if (!text) { b.style.display = "none"; b.textContent = ""; return; }
  b.style.display = "";
  b.textContent = text;
}

function updateBottomButtons() {
  const isEditing = !!editOrderId;
  qs("#btnCheckout").textContent = isEditing ? "変更を保存" : "注文確定";
  qs("#btnClear").disabled = isEditing;
  qs("#btnEditCancel").style.display = isEditing ? "" : "none";
}

function calcTotal() {
  let total = 0;
  for (const p of products) {
    const q = Number(qtyMap[p.product_id] || 0);
    if (q > 0) total += q * Number(p.price || 0);
  }
  return total;
}

function updateTotals() {
  const total = calcTotal();
  qs("#totalTop").textContent = `合計 ${yen(total)}`;
  qs("#totalBottom").textContent = `合計 ${yen(total)}`;
  updateBottomButtons();
  return total;
}

function buildOrderItemsFromState() {
  const items = [];
  for (const p of products) {
    const q = Number(qtyMap[p.product_id] || 0);
    if (q > 0) items.push({ product_id: p.product_id, qty: q, name: p.name, unit_price: p.price, line_total: q * p.price });
  }
  return items;
}

function setView(which) {
  const isPos = which === "pos";
  qs("#viewPos").style.display = isPos ? "" : "none";
  qs("#viewMy").style.display = isPos ? "none" : "";
  qs("#tabPos").classList.toggle("active", isPos);
  qs("#tabMy").classList.toggle("active", !isPos);

  qs("#btnCheckout").disabled = !isPos;
  qs("#btnClear").disabled = !isPos || !!editOrderId;

  if (!isPos) qs("#btnEditCancel").style.display = "none";
}

// ===== UI filter state（検索 / 売切非表示 / 表示密度）=====
const uiState = {
  query: "",
  hideSoldOut: false,
  density: 3, // 3=標準(1列) / 6=コンパクト(2列)
};

function normalize_(s){ return String(s || "").trim().toLowerCase(); }

function isCompact_(){
  // densitySel が 3 / 6 の想定
  return Number(uiState.density || 3) >= 6;
}

function applyDensity_() {
  const grid = qs("#productList");
  if (!grid) return;

  grid.style.display = "grid";
  if (isCompact_()) {
    grid.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
    grid.style.gap = "10px";
    document.body.classList.add("isDense");
  } else {
    grid.style.gridTemplateColumns = "minmax(0, 1fr)";
    grid.style.gap = "12px";
    document.body.classList.remove("isDense");
  }
}

function filterProducts_(list){
  let arr = Array.isArray(list) ? list : [];
  const q = normalize_(uiState.query);

  if (uiState.hideSoldOut) arr = arr.filter(p => !p.is_sold_out);
  if (q) {
    arr = arr.filter(p => {
      const hay = `${p.name || ""} ${p.product_id || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }
  return arr;
}

function bindPosControlsOnce_(){
  if (window.__posControlsBound) return;
  window.__posControlsBound = true;

  const search  = qs("#searchInput");
  const density = qs("#densitySel");
  const hide    = qs("#hideSoldOut");

  // 入力が重くならないように軽いデバウンス
  let t = null;
  const rerenderSoon = () => {
    clearTimeout(t);
    t = setTimeout(() => renderProductList(), 50);
  };

  if (search) {
    search.addEventListener("input", () => {
      uiState.query = search.value || "";
      rerenderSoon();
    });
  }
  if (density) {
    density.addEventListener("change", () => {
      uiState.density = Number(density.value || 3);
      applyDensity_();
      renderProductList();
    });
  }
  if (hide) {
    hide.addEventListener("change", () => {
      uiState.hideSoldOut = !!hide.checked;
      renderProductList();
    });
  }

  applyDensity_();
  bindProductListEventsOnce_(); // ★重要：イベントを1回だけ付ける
}

// ===== 高速化：商品リストのイベントは“1回だけ”付ける（デリゲーション）=====
function bindProductListEventsOnce_(){
  if (window.__productListBound) return;
  window.__productListBound = true;

  const list = qs("#productList");
  if (!list) return;

  list.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;

    const card = btn.closest(".itemCard");
    if (!card) return;

    const pid = card.dataset.pid;
    if (!pid) return;

    // 売切は何もしない（見た目は出すが操作不可）
    const p = products.find(x => x.product_id === pid);
    if (p && p.is_sold_out) return;

    const act = btn.dataset.act;

    // +/- 処理
    if (act === "minus" || act === "plus") {
      const input = card.querySelector(".qtyInput");
      if (!input) return;

      const cur = Number(input.value || 0);
      const next = act === "minus" ? Math.max(0, cur - 1) : Math.max(0, cur + 1);

      input.value = String(next);
      qtyMap[pid] = next;
      updateTotals();
      return;
    }

    // 詳細トグル
    if (act === "detail") {
      const panel = card.querySelector(".detailPanel");
      const chev = btn.querySelector(".chev");
      if (!panel) return;

      const open = panel.classList.contains("open");
      if (open) {
        panel.classList.remove("open");
        panel.style.display = "none";
        if (chev) chev.textContent = "▼";
        return;
      }

      // コンパクト時：他の詳細を閉じる（ズレ事故防止）
      if (isCompact_()) {
        list.querySelectorAll(".detailPanel.open").forEach(pn => {
          pn.classList.remove("open");
          pn.style.display = "none";
        });
        list.querySelectorAll(".detailToggleBtn .chev").forEach(ch => (ch.textContent = "▼"));
      }

      panel.classList.add("open");
      panel.style.display = "block";
      if (chev) chev.textContent = "▲";

      await ensureProductDetailLoaded(pid, panel);
      return;
    }
  });

  list.addEventListener("input", (e) => {
    const input = e.target.closest("input.qtyInput");
    if (!input) return;

    const card = input.closest(".itemCard");
    if (!card) return;

    const pid = card.dataset.pid;
    if (!pid) return;

    const p = products.find(x => x.product_id === pid);
    if (p && p.is_sold_out) return;

    const v = Math.max(0, Number(input.value || 0));
    qtyMap[pid] = v;
    updateTotals();
  });
}

// ---------- Products ----------
async function loadProducts() {
  loading.products = true;
  setMsg("", "");
  qs("#productsLoading").style.display = "";
  qs("#productList").innerHTML = "";

  try {
    const json = await apiGet({ mode:"getProducts" });
    if (!json.ok) throw new Error(json.error || "商品取得に失敗しました。");
    products = (json.products || []).filter(p => !!p.product_id);

    // qtyMap 初期化
    if (!Object.keys(qtyMap || {}).length) {
      qtyMap = {};
      products.forEach(p => (qtyMap[p.product_id] = 0));
    } else {
      products.forEach(p => { if (qtyMap[p.product_id] == null) qtyMap[p.product_id] = 0; });
    }

    bindPosControlsOnce_();
    renderProductList();
    updateTotals();

    qs("#productsLoading").style.display = "none";
  } catch (err) {
    qs("#productsLoading").style.display = "none";
    setMsg("err", `商品を読み込めませんでした。\n詳細: ${String(err.message || err)}`);
  } finally {
    loading.products = false;
  }
}

function renderProductList() {
  const listEl = qs("#productList");
  listEl.innerHTML = "";

  applyDensity_();
  const view = filterProducts_(products);

  if (!view.length) {
    listEl.innerHTML = `<div class="msg">該当する商品がありません</div>`;
    return;
  }

  view.forEach(p => {
    const sold = !!p.is_sold_out;
    const card = document.createElement("div");
    card.className = "itemCard" + (sold ? " soldout" : "");
    card.dataset.pid = p.product_id;

    const currentQty = Number(qtyMap[p.product_id] || 0);

    // 販売中は表示しない（売切のときだけバッジ）
    const soldBadge = sold ? `<span class="soldBadge">売切</span>` : "";

    card.innerHTML = `
      <div class="row">
        <div>
          <div class="name">${escapeHtml(p.name)} ${soldBadge}</div>
          <div class="muted">${escapeHtml(p.product_id)}</div>
        </div>
        <div class="price">${yen(p.price)}</div>
      </div>

      <div class="row" style="margin-top:10px;">
        <div class="qty">
          <button class="btn btnGhost btnMinus" ${sold ? "disabled":""}>−</button>
          <input class="qtyInput" type="number" min="0" value="${currentQty}" ${sold ? "disabled":""}/>
          <button class="btn btnGhost btnPlus" ${sold ? "disabled":""}>＋</button>
        </div>
        <button class="btn detailToggleBtn" ${sold ? "disabled":""}>
          詳細 <span class="chev">▼</span>
        </button>
      </div>

      <div class="detailPanel" style="display:none;"></div>
    `;

    const minus = card.querySelector(".btnMinus");
    const plus  = card.querySelector(".btnPlus");
    const input = card.querySelector(".qtyInput");
    const btn   = card.querySelector(".detailToggleBtn");
    const panel = card.querySelector(".detailPanel");

    if (!sold) {
      minus.addEventListener("click", () => {
        const v = Math.max(0, Number(input.value||0) - 1);
        input.value = v;
        qtyMap[p.product_id] = v;
        updateTotals();
      });
      plus.addEventListener("click", () => {
        const v = Math.max(0, Number(input.value||0) + 1);
        input.value = v;
        qtyMap[p.product_id] = v;
        updateTotals();
      });
      input.addEventListener("input", () => {
        const v = Math.max(0, Number(input.value||0));
        qtyMap[p.product_id] = v;
        updateTotals();
      });

      btn.addEventListener("click", async () => {
        const open = panel.classList.contains("open");

        // コンパクト時は「開ける前に他を閉じる」→ズレ事故防止
        if (!open && isDense_()) {
          listEl.querySelectorAll(".detailPanel.open").forEach(pn => {
            pn.classList.remove("open");
            pn.style.display = "none";
          });
          listEl.querySelectorAll(".itemCard.detailOpen").forEach(c => c.classList.remove("detailOpen"));
          listEl.querySelectorAll(".detailToggleBtn .chev").forEach(ch => ch.textContent = "▼");
        }

        if (open) {
          panel.classList.remove("open");
          panel.style.display = "none";
          btn.querySelector(".chev").textContent = "▼";
          card.classList.remove("detailOpen");
          return;
        }

        panel.classList.add("open");
        panel.style.display = "block";
        btn.querySelector(".chev").textContent = "▲";

        if (isDense_()) card.classList.add("detailOpen"); // 2列ぶん→全幅に

        await ensureProductDetailLoaded(p.product_id, panel);
      });
    }

    listEl.appendChild(card); // ← 絶対ここ（クリックの中に入れない）
  });
}


// ---------- Detail ----------
async function ensureProductDetailLoaded(productId, panelEl) {
  const cached = detailCache[productId];
  if (cached && (String(cached.description || "").trim() || String(cached.image_url || "").trim() || String(cached.video_url || "").trim())) {
    renderDetailPanel(panelEl, cached);
    return;
  }

  panelEl.innerHTML = `<div class="muted">読み込み中…</div>`;

  try {
    const json = await apiGet({ mode:"getProductDetail", product_id: productId });
    if (!json.ok) throw new Error(json.error || "詳細取得に失敗しました。");

    const p = json.product;
    if (!p) {
      panelEl.innerHTML = `<div class="msg err">詳細が取得できませんでした（productが空）。</div>`;
      return;
    }

    detailCache[productId] = p;
    renderDetailPanel(panelEl, p);
  } catch (err) {
    panelEl.innerHTML = `<div class="msg err">詳細を読み込めませんでした。<br>詳細: ${escapeHtml(String(err.message||err))}</div>`;
  }
}

function toYoutubeEmbed(url) {
  const u = String(url||"").trim();
  if (!u) return "";
  try {
    const x = new URL(u);
    if (x.hostname.includes("youtu.be")) {
      const id = x.pathname.replace("/","").trim();
      return id ? `https://www.youtube.com/embed/${id}` : "";
    }
    if (x.hostname.includes("youtube.com")) {
      const id = x.searchParams.get("v");
      return id ? `https://www.youtube.com/embed/${id}` : "";
    }
    return "";
  } catch { return ""; }
}

function renderDetailPanel(panelEl, d) {
  const desc = String(d.description || "").trim();
  const img  = String(d.image_url || "").trim();
  const vid  = String(d.video_url || "").trim();
  const yEmbed = toYoutubeEmbed(vid);

  panelEl.innerHTML = `
    ${desc ? `<div class="desc">${escapeHtml(desc)}</div>` : `<div class="muted">説明はありません</div>`}
    ${img ? `<img class="img" loading="lazy" src="${escapeHtml(img)}" alt="商品画像">` : ``}
    ${vid ? `
      <div class="videoWrap">
        <button class="btn" data-video-btn="1">▶ 動画を見る</button>
        <div data-video-area="1"></div>
        <div class="muted small">${escapeHtml(vid)}</div>
      </div>` : ``}
  `;

  const btn = panelEl.querySelector('[data-video-btn="1"]');
  if (btn) {
    btn.addEventListener("click", () => {
      const area = panelEl.querySelector('[data-video-area="1"]');
      if (yEmbed) {
        area.innerHTML = `<iframe src="${escapeHtml(yEmbed)}" allowfullscreen></iframe>`;
      } else {
        area.innerHTML = `<div class="msg">埋め込み非対応です。<br><a href="${escapeHtml(vid)}" target="_blank" rel="noopener">リンクを開く</a></div>`;
      }
      btn.disabled = true;
      btn.textContent = "表示中";
    });
  }
}

// ---------- Checkout ----------
async function checkoutFlow() {
  setMsg("", "");
  showEditBanner("");

  const items = buildOrderItemsFromState();
  const total = updateTotals();

  if (items.length === 0) {
    setMsg("err", "商品が選択されていません。数量を入力してください。");
    return;
  }

  const lines = items.map(it => `<li>${escapeHtml(it.name)} × ${it.qty}（${yen(it.line_total)}）</li>`).join("");

  openModal({
    title: "この内容で注文しますか？",
    bodyHtml: `
      <div class="kv"><div>合計</div><div>${yen(total)}</div></div>
      <div class="divider"></div>
      <div><b>内訳</b></div>
      <ul class="list">${lines}</ul>
    `,
    actions: [
      { label:"戻る", className:"btn", onClick: () => closeModal() },
      { label:"注文する", className:"btn btnPrimary", onClick: async () => {
          closeModal();
          await doCreateOrder(items);
        }
      },
    ]
  });
}

async function doCreateOrder(items) {
  if (loading.checkout) return;
  loading.checkout = true;
  qs("#btnCheckout").disabled = true;

  submitToken = submitToken || loadSubmitToken() || uuid();
  saveSubmitToken(submitToken);

  openModal({ title:"送信中…", bodyHtml:`<div class="msg">注文を送信しています…</div>`, actions:[] });

  try {
    const json = await apiPost({
      mode: "createOrder",
      source: "customer",
      client_token: submitToken,
      items: items.map(x => ({ product_id: x.product_id, qty: x.qty })),
    });
    if (!json.ok) throw new Error(json.error || "注文の送信に失敗しました。");

    const order = json.order;
    localStorage.setItem(LS_LAST_ORDER_ID, order.order_id);

    try {
      const u = new URL(location.href);
      u.searchParams.set("order_id", order.order_id);
      history.replaceState(null, "", u.toString());
    } catch {}

    clearSubmitToken();

    qtyMap = Object.fromEntries(products.map(p => [p.product_id, 0]));
    renderProductList();
    updateTotals();

    openModal({
      title: "ご注文ありがとうございました",
      bodyHtml: `
        <div class="muted" style="text-align:center;">受付番号</div>
        <div class="bigNo">No.${Number(order.display_no||0)}</div>
        <div class="kv"><div>合計</div><div>${yen(order.total)}</div></div>
        <div class="divider"></div>
        <div class="muted">注文ID（控え）</div>
        <div class="small">${escapeHtml(order.order_id)}</div>
        <div class="muted" style="margin-top:8px;">②注文確認で内容の変更ができます。</div>
      `,
      actions: [
        { label:"閉じる", className:"btn", onClick: () => closeModal() },
        { label:"②で確認する", className:"btn btnPrimary", onClick: async () => {
            closeModal();
            qs("#orderIdInput").value = order.order_id;
            setView("my");
            await loadMyOrder(order.order_id);
          }
        },
      ]
    });

  } catch (err) {
    closeModal();
    setMsg("err", `注文を送信できませんでした。\n詳細: ${String(err.message || err)}\n\n※通信が不安定な場合は、もう一度「注文確定」を押してください（同じ注文として再送されます）。`);
  } finally {
    loading.checkout = false;
    qs("#btnCheckout").disabled = false;
  }
}

async function saveEditOrder() {
  setMsg("", "");

  const items = buildOrderItemsFromState();
  if (items.length === 0) {
    setMsg("err", "商品が選択されていません。");
    return;
  }

  openModal({
    title: "変更を保存しますか？",
    bodyHtml: `<div class="msg">この内容で注文を更新します。</div>`,
    actions: [
      { label:"戻る", className:"btn", onClick: () => closeModal() },
      { label:"保存する", className:"btn btnPrimary", onClick: async () => {
          closeModal();
          try {
            openModal({ title:"保存中…", bodyHtml:`<div class="msg">保存しています…</div>`, actions:[] });

            const json = await apiPost({
              mode: "updateOrderItems",
              order_id: editOrderId,
              actor: "customer",
              items: items.map(x => ({ product_id: x.product_id, qty: x.qty }))
            });
            if (!json.ok) throw new Error(json.error || "保存に失敗しました。");

            closeModal();
            setMsg("ok", "変更を保存しました。");

            const oid = editOrderId;
            editOrderId = null;
            editOriginalItems = null;
            showEditBanner("");
            updateBottomButtons();

            setView("my");
            qs("#orderIdInput").value = oid;
            await loadMyOrder(oid);

          } catch (err) {
            closeModal();
            setMsg("err", `保存できませんでした。\n詳細: ${String(err.message || err)}`);
          }
        }
      }
    ]
  });
}

// ---------- My Order ----------
function statusText(status) {
  if (status === "pending") return "受付済み";
  if (status === "handed" || status === "auto_handed") return "受け渡し完了（変更不可）";
  if (status === "cancelled") return "キャンセル";
  return status || "";
}

async function loadMyOrder(orderId) {
  if (!orderId) return;
  loading.my = true;
  setMsg("", "");
  qs("#myOrderArea").innerHTML = `<div class="msg">読み込み中…</div>`;

  try {
    const json = await apiGet({ mode:"getMyOrder", order_id: orderId });
    if (!json.ok) throw new Error(json.error || "注文の取得に失敗しました。");
    renderMyOrder(json.order, json.items);

  } catch (err) {
    qs("#myOrderArea").innerHTML = `
      <div class="msg err">
        注文を取得できませんでした。<br>
        詳細: ${escapeHtml(String(err.message || err))}
      </div>
    `;
  } finally {
    loading.my = false;
  }
}

function renderMyOrder(order, items) {
  const editable = (order.status === "pending") && (order.lock_state !== "staff_edit");
  const locked = (order.lock_state === "staff_edit");

  const list = Array.isArray(items) ? items : [];
  const lines = list.length
    ? list.map(it => `<li>${escapeHtml(it.product_name_at_sale)} × ${Number(it.qty||0)}（${yen(Number(it.line_total||0))}）</li>`).join("")
    : `<li class="muted">内訳がありません（データ不整合）</li>`;

  const hint = locked ? "スタッフが内容を確認中です。しばらくしてからお試しください。" :
                editable ? "「変更」を押すと、①注文画面で数量を編集できます。" :
                "この注文は変更できません。";

  qs("#myOrderArea").innerHTML = `
    <div class="itemCard">
      <div class="row">
        <div>
          <div class="name">No.${Number(order.display_no||0)}</div>
          <div class="muted">状態：${escapeHtml(statusText(order.status))}</div>
        </div>
        <div class="price">${yen(order.total)}</div>
      </div>
      <div class="muted small" style="margin-top:6px;">注文ID：${escapeHtml(order.order_id)}</div>

      <div class="divider"></div>

      <div><b>内訳</b></div>
      <ul class="list">${lines}</ul>

      <div class="divider"></div>

      <div class="muted">${escapeHtml(hint)}</div>

      <div class="row" style="margin-top:12px; justify-content:flex-end;">
        <button class="btn btnDanger" id="btnCancel" ${editable ? "" : "disabled"}>キャンセル</button>
        <button class="btn btnPrimary" id="btnEdit" ${editable ? "" : "disabled"}>変更</button>
      </div>
    </div>
  `;

  qs("#btnEdit").addEventListener("click", async () => {
    if (!editable) return;

    editOrderId = order.order_id;
    editOriginalItems = JSON.parse(JSON.stringify(list));

    if (!products.length) await loadProducts();

    qtyMap = Object.fromEntries(products.map(p => [p.product_id, 0]));
    list.forEach(it => {
      if (qtyMap[it.product_id] != null) qtyMap[it.product_id] = Number(it.qty||0);
    });

    renderProductList();
    updateTotals();
    showEditBanner(`No.${Number(order.display_no||0)} を編集中です。数量を変更して「変更を保存」を押してください。`);

    setView("pos");
    setMsg("", "");
  });

  qs("#btnCancel").addEventListener("click", async () => {
    if (!editable) return;

    openModal({
      title: "キャンセルしますか？",
      bodyHtml: `<div class="msg err">この注文をキャンセルします。よろしいですか？</div>`,
      actions: [
        { label:"戻る", className:"btn", onClick: () => closeModal() },
        { label:"キャンセルする", className:"btn btnDanger", onClick: async () => {
          closeModal();
          await cancelMyOrder(order.order_id);
        } }
      ]
    });
  });
}

async function cancelMyOrder(orderId) {
  openModal({ title:"処理中…", bodyHtml:`<div class="msg">キャンセルしています…</div>`, actions:[] });

  try {
    const json = await apiPost({ mode:"cancelOrder", order_id: orderId });
    if (!json.ok) throw new Error(json.error || "キャンセルに失敗しました。");

    closeModal();
    setMsg("ok", "キャンセルしました。");
    await loadMyOrder(orderId);
  } catch (err) {
    closeModal();
    setMsg("err", `キャンセルできませんでした。\n詳細: ${String(err.message||err)}`);
  }
}

// ---------- UI ----------
qs("#tabPos").addEventListener("click", () => setView("pos"));
qs("#tabMy").addEventListener("click", () => setView("my"));

qs("#btnClear").addEventListener("click", () => {
  if (editOrderId) return;
  qtyMap = Object.fromEntries(products.map(p => [p.product_id, 0]));
  renderProductList();
  updateTotals();
  setMsg("", "");
});

// 編集キャンセル
qs("#btnEditCancel").addEventListener("click", async () => {
  if (!editOrderId) return;

  openModal({
    title: "変更をキャンセルしますか？",
    bodyHtml: `<div class="msg">編集内容を破棄して、注文確認画面に戻ります。</div>`,
    actions: [
      { label:"続ける", className:"btn", onClick: () => closeModal() },
      { label:"キャンセルする", className:"btn btnDanger", onClick: async () => {
          const oid = editOrderId;

          qtyMap = Object.fromEntries(products.map(p => [p.product_id, 0]));
          (editOriginalItems || []).forEach(it => {
            if (qtyMap[it.product_id] != null) qtyMap[it.product_id] = Number(it.qty||0);
          });

          editOrderId = null;
          editOriginalItems = null;
          showEditBanner("");
          updateTotals();
          renderProductList();

          closeModal();
          setView("my");
          qs("#orderIdInput").value = oid;
          await loadMyOrder(oid);
        }
      }
    ]
  });
});

qs("#btnCheckout").addEventListener("click", async () => {
  if (editOrderId) await saveEditOrder();
  else await checkoutFlow();
});

qs("#btnLoadMy").addEventListener("click", async () => {
  const id = qs("#orderIdInput").value.trim();
  if (!id) { setMsg("err", "注文IDを入力してください。"); return; }
  setView("my");
  await loadMyOrder(id);
});

qs("#btnLoadLast").addEventListener("click", async () => {
  const id = localStorage.getItem(LS_LAST_ORDER_ID) || "";
  if (!id) { setMsg("err", "直近の注文が見つかりませんでした。"); return; }
  qs("#orderIdInput").value = id;
  setView("my");
  await loadMyOrder(id);
});

/**
 * ★ヘッダーの「注文履歴」などが変な挙動になる対策
 * 共通の ui.js が “履歴画面へ遷移” みたいな挙動を持っていても、
 * customer画面では②(注文確認)に寄せて事故らせない。
 */
(function guardHeaderNav(){
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a,button,div");
    if (!a) return;
    const header = a.closest("header");
    if (!header) return;

    const t = (a.textContent || "").trim();
    if (!t) return;

    // 「注文履歴」「履歴」などを customer では②に寄せる
    if (t.includes("注文履歴") || (t === "履歴") || t.includes("history")) {
      e.preventDefault();
      e.stopPropagation();
      setView("my");
    }
  }, true);
})();

(async function init(){
  if (!GAS_WEB_APP_URL || !GAS_WEB_APP_URL.includes("script.google.com")) {
    setMsg("err", "GAS_WEB_APP_URL が未設定です。");
    qs("#productsLoading").style.display = "none";
    return;
  }

  await loadProducts();
  updateTotals();

  // ★URLパラメータから注文IDを受け取る（あれば②を開いて表示）
  const sp = new URLSearchParams(location.search);
  const oidFromUrl = (sp.get("order_id") || "").trim();
  if (oidFromUrl) {
    qs("#orderIdInput").value = oidFromUrl;
    setView("my");
    await loadMyOrder(oidFromUrl);
  }

  const last = localStorage.getItem(LS_LAST_ORDER_ID) || "";
  qs("#btnLoadLast").style.display = last ? "" : "none";
})();







