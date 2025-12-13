const GAS_WEB_APP_URL = (window.GAS_WEB_APP_URL || "").trim();
const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])
  );
}

function nowStr_(){
  const d = new Date();
  const z = (n)=>String(n).padStart(2,"0");
  return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
}

function msg(text, isErr=true){
  const el = $("msg");
  if (!el) return;
  // ログとして積む（上が最新）
  const line = `[${nowStr_()}] ${text || ""}`;
  const prev = el.textContent ? el.textContent.trim() : "";
  el.textContent = prev ? (line + "\n" + prev) : line;
  el.style.color = isErr ? "#c00" : "#111"; // ログは黒基調
}

async function apiGet(params){
  const url = new URL(GAS_WEB_APP_URL);
  Object.keys(params).forEach(k => url.searchParams.set(k, params[k]));
  const res = await fetch(url.toString());
  return await res.json();
}

async function apiPost(body){
  const form = new URLSearchParams();
  Object.keys(body).forEach(k => {
    const v = body[k];
    form.set(k, (typeof v === "object") ? JSON.stringify(v) : String(v));
  });

  const res = await fetch(GAS_WEB_APP_URL, { method: "POST", body: form });
  return await res.json();
}

/* ===== products table ===== */
let current = [];

async function load(){
  const tbody = $("tbody");
  if (tbody) tbody.innerHTML = "<tr><td colspan='6'>読み込み中...</td></tr>";

  try{
    const json = await apiGet({ mode:"getProductsAdmin" });
    if(!json.ok) throw new Error(json.error || "getProductsAdmin failed");
    current = json.products || [];
    render();
  }catch(e){
    if (tbody) tbody.innerHTML = "";
    msg("取得エラー: " + (e?.message || String(e)), true);
  }
}

function render(){
  const tbody = $("tbody");
  if(!tbody) return;

  if(!current.length){
    tbody.innerHTML = "<tr><td colspan='6'>商品がありません</td></tr>";
    return;
  }

  const isMobile = window.matchMedia && window.matchMedia("(max-width: 760px)").matches;

  tbody.innerHTML = current.map(p => {
    const sold = !!p.sold_out;
    const pid = String(p.product_id || "");
    const pidEsc = escapeHtml(pid);

    // モバイル用の見出しラベル
    const L = (t)=> isMobile ? `<span class="cellLabel">${t}</span>` : "";

    return `
      <tr data-id="${pidEsc}">
        <td>
          ${isMobile ? `<div class="ownerIdLine">${pidEsc}</div>` : pidEsc}
        </td>

        <td>
          ${L("商品名")}
          <input data-k="name" value="${escapeHtml(p.name)}">
        </td>

        <td>
          ${L("価格")}
          <input data-k="price" type="number" value="${Number(p.price||0)}">
        </td>

        <td>
          ${L("表示順")}
          <input data-k="sort_order" type="number" value="${Number(p.sort_order||0)}">
        </td>

        <td>
          ${L("売切/販売中")}
          <div class="ownerBar" style="gap:10px;">
            <label class="toggle" style="position:relative;">
              <input class="soldToggle" type="checkbox" ${sold ? "checked":""} data-pid="${pidEsc}">
              <span class="track"><span class="knob"></span></span>
            </label>
            <span class="toggleText ${sold ? "off":"on"}">
              ${sold ? "売切" : "販売中"}
            </span>
          </div>
        </td>

        <td>
          ${L("操作")}
          <div class="rowbtn">
            <button class="btn" data-act="save" data-pid="${pidEsc}">保存</button>
            <button class="btn btnDanger" data-act="del" data-pid="${pidEsc}">削除</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  // 行内ボタン
  tbody.querySelectorAll('button[data-act="save"]').forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const pid = btn.getAttribute("data-pid");
      await saveRow(pid);
    });
  });
  tbody.querySelectorAll('button[data-act="del"]').forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const pid = btn.getAttribute("data-pid");
      await delRow(pid);
    });
  });

  // 売切トグル
  tbody.querySelectorAll(".soldToggle").forEach(chk=>{
    chk.addEventListener("change", async ()=>{
      const pid = chk.getAttribute("data-pid");
      const soldOut = chk.checked; // checked = 売切
      await setSoldOut_(pid, soldOut);
    });
  });
}

function readRow(productId){
  const tr = document.querySelector(`tr[data-id="${CSS.escape(productId)}"]`);
  if(!tr) return null;
  const get = (k) => tr.querySelector(`input[data-k="${k}"]`)?.value ?? "";
  return {
    product_id: productId,
    name: get("name"),
    price: Number(get("price") || 0),
    sort_order: Number(get("sort_order") || 0),
  };
}

async function saveRow(productId){
  try{
    const p = readRow(productId);
    if(!p) throw new Error("row not found");
    const json = await apiPost({ mode:"upsertProduct", product:p });
    if(!json.ok) throw new Error(json.error || "save failed");
    msg(`商品 ${productId} を保存しました`, false);
    await load();
  }catch(e){
    msg("保存エラー: " + (e?.message || String(e)), true);
  }
}

async function setSoldOut_(productId, soldOut){
  try{
    const json = await apiPost({ mode:"setProductSoldOut", product_id:productId, sold_out:!!soldOut });
    if(!json.ok) throw new Error(json.error || "sold_out failed");
    msg(`商品 ${productId} を ${soldOut ? "売切" : "販売中"} に変更`, false);
    await load();
  }catch(e){
    msg("更新エラー: " + (e?.message || String(e)), true);
    // 失敗時は表示を戻す
    await load();
  }
}

async function delRow(productId){
  if(!confirm(`${productId} を削除しますか？`)) return;
  try{
    const json = await apiPost({ mode:"deleteProduct", product_id:productId });
    if(!json.ok) throw new Error(json.error || "delete failed");
    msg(`商品 ${productId} を削除しました`, false);
    await load();
  }catch(e){
    msg("削除エラー: " + (e?.message || String(e)), true);
  }
}

async function addOrUpdate(){
  const id = String($("add_id")?.value || "").trim();
  if(!id){ msg("商品IDは必須です", true); return; }

  const p = {
    product_id: id,
    name: String($("add_name")?.value || "").trim(),
    price: Number($("add_price")?.value || 0),
    sort_order: Number($("add_sort")?.value || 0),
    description: String($("add_desc")?.value || ""),
    image_url: String($("add_img")?.value || ""),
    video_url: String($("add_vid")?.value || ""),
  };

  try{
    const json = await apiPost({ mode:"upsertProduct", product:p });
    if(!json.ok) throw new Error(json.error || "upsert failed");
    msg(`商品 ${id} を保存しました（追加/更新）`, false);

    $("add_id").value = "";
    $("add_name").value = "";
    $("add_price").value = "";
    $("add_sort").value = "";

    await load();
  }catch(e){
    msg("保存エラー: " + (e?.message || String(e)), true);
  }
}

async function resetSoldOutAll(){
  if(!confirm("売切を全解除しますか？")) return;
  try{
    const json = await apiPost({ mode:"resetAllSoldOut" });
    if(!json.ok) throw new Error(json.error || "reset failed");
    msg("売切を全解除しました", false);
    await load();
  }catch(e){
    msg("全解除エラー: " + (e?.message || String(e)), true);
  }
}

/* ===== shop toggle (営業/閉店) ===== */
function renderOwnerShopState_(open){
  const badge = $("ownerShopState");
  const sw = $("ownerShopToggle");
  if (badge){
    badge.textContent = open ? "営業中" : "受付停止";
    badge.classList.toggle("on", !!open);
    badge.classList.toggle("off", !open);
  }
  if (sw) sw.checked = !!open;
}

async function loadOpsSettings_(){
  const s = await apiGet({ mode:"getSettings" });
  if(!s.ok) throw new Error(s.error || "getSettings failed");
  renderOwnerShopState_(!!(s.settings && s.settings.SHOP_OPEN));
}

async function onShopToggleChange_(){
  const sw = $("ownerShopToggle");
  if(!sw) return;

  // いまの見た目（切り替え後）から、ユーザーが意図した状態を読む
  const wantOpen = !!sw.checked;

  // 現在状態をAPIで取り直して「差分」確認（安全）
  let currentOpen = false;
  try{
    const s = await apiGet({ mode:"getSettings" });
    if(s.ok) currentOpen = !!(s.settings && s.settings.SHOP_OPEN);
  }catch{}

  // 同じなら何もしない
  if (wantOpen === currentOpen){
    renderOwnerShopState_(currentOpen);
    return;
  }

  const actionLabel = wantOpen ? "開店（受付再開）" : "閉店（受付停止）";

  // ✅ 確認ログ（確認ダイアログ）
  const ok = confirm(`${actionLabel}に切り替えます。\nよろしいですか？`);
  if(!ok){
    // 取り消し → 元に戻す
    renderOwnerShopState_(currentOpen);
    msg(`キャンセル：${actionLabel}`, false);
    return;
  }

  try{
    // 既存API：toggleShopOpen（トグルなので一回叩く）
    const r = await apiPost({ mode:"toggleShopOpen" });
    if(!r.ok) throw new Error(r.error || "toggleShopOpen failed");
    renderOwnerShopState_(!!r.SHOP_OPEN);

    // ✅ 変更ログ（画面ログ）
    msg(`切替：${actionLabel}（結果：${r.SHOP_OPEN ? "営業中" : "受付停止"}）`, false);

  }catch(e){
    msg("切替エラー: " + (e?.message || String(e)), true);
    // 失敗 → 現在状態へ戻す
    renderOwnerShopState_(currentOpen);
  }
}

/* ===== init ===== */
document.addEventListener("DOMContentLoaded", async () => {
  if(!GAS_WEB_APP_URL || !GAS_WEB_APP_URL.includes("script.google.com")){
    msg("GAS_WEB_APP_URL が未設定です", true);
    return;
  }

  // shop state
  try{
    await loadOpsSettings_();
  }catch(e){
    msg("設定取得エラー: " + (e?.message || String(e)), true);
  }

  // bind shop toggle
  $("ownerShopToggle")?.addEventListener("change", onShopToggleChange_);

  // product controls
  $("btnReload")?.addEventListener("click", load);
  $("btnAdd")?.addEventListener("click", addOrUpdate);
  $("btnResetSoldOut")?.addEventListener("click", resetSoldOutAll);

  // initial load
  await load();
});
