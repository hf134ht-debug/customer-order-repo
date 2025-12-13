const GAS_WEB_APP_URL = (window.GAS_WEB_APP_URL || "").trim();
const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])
  );
}

function msg(text, isErr=true){
  $("msg").textContent = text || "";
  $("msg").style.color = isErr ? "#c00" : "#0a7";
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

  const res = await fetch(GAS_WEB_APP_URL, {
    method: "POST",
    body: form
  });

  return await res.json();
}

let current = [];

async function load(){
  msg("");
  $("tbody").innerHTML = "<tr><td colspan='6'>読み込み中...</td></tr>";

  try{
    const json = await apiGet({ mode:"getProductsAdmin" });
    if(!json.ok) throw new Error(json.error || "getProductsAdmin failed");
    current = json.products || [];
    render();
  }catch(e){
    $("tbody").innerHTML = "";
    msg("取得エラー: " + e.message, true);
  }
}

function render(){
  if(!current.length){
    $("tbody").innerHTML = "<tr><td colspan='6'>商品がありません</td></tr>";
    return;
  }

  $("tbody").innerHTML = current.map(p => {
    const sold = !!p.sold_out;
    return `
      <tr data-id="${escapeHtml(p.product_id)}">
        <td>${escapeHtml(p.product_id)}</td>
        <td><input data-k="name" value="${escapeHtml(p.name)}"></td>
        <td><input data-k="price" type="number" value="${Number(p.price||0)}"></td>
        <td><input data-k="sort_order" type="number" value="${Number(p.sort_order||0)}"></td>
        <td>
          <span class="pill ${sold ? "on":"off"}">${sold ? "売切":"販売中"}</span>
        </td>
        <td>
          <div class="rowbtn">
            <button onclick="saveRow('${escapeHtml(p.product_id)}')">保存</button>
            <button onclick="toggleSoldOut('${escapeHtml(p.product_id)}', ${sold ? "false":"true"})">${sold ? "売切解除":"売切"}</button>
            <button onclick="delRow('${escapeHtml(p.product_id)}')">削除</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
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

window.saveRow = async function(productId){
  try{
    msg("");
    const p = readRow(productId);
    if(!p) throw new Error("row not found");
    const json = await apiPost({ mode:"upsertProduct", product:p });
    if(!json.ok) throw new Error(json.error || "save failed");
    msg("保存しました", false);
    await load();
  }catch(e){
    msg("保存エラー: " + e.message, true);
  }
};

window.toggleSoldOut = async function(productId, soldOut){
  try{
    msg("");
    const json = await apiPost({ mode:"setProductSoldOut", product_id:productId, sold_out:!!soldOut });
    if(!json.ok) throw new Error(json.error || "sold_out failed");
    msg("更新しました", false);
    await load();
  }catch(e){
    msg("更新エラー: " + e.message, true);
  }
};

window.delRow = async function(productId){
  if(!confirm(`${productId} を削除しますか？`)) return;
  try{
    msg("");
    const json = await apiPost({ mode:"deleteProduct", product_id:productId });
    if(!json.ok) throw new Error(json.error || "delete failed");
    msg("削除しました", false);
    await load();
  }catch(e){
    msg("削除エラー: " + e.message, true);
  }
};

async function addOrUpdate(){
  const id = String($("add_id").value || "").trim();
  if(!id){ msg("商品IDは必須です", true); return; }

  const p = {
    product_id: id,
    name: String($("add_name").value || "").trim(),
    price: Number($("add_price").value || 0),
    sort_order: Number($("add_sort").value || 0),
    description: String($("add_desc").value || ""),
    image_url: String($("add_img").value || ""),
    video_url: String($("add_vid").value || ""),
  };

  try{
    msg("");
    const json = await apiPost({ mode:"upsertProduct", product:p });
    if(!json.ok) throw new Error(json.error || "upsert failed");
    msg("保存しました", false);

    $("add_id").value = "";
    $("add_name").value = "";
    $("add_price").value = "";
    $("add_sort").value = "";

    await load();
  }catch(e){
    msg("保存エラー: " + e.message, true);
  }
}

async function resetSoldOutAll(){
  if(!confirm("売切を全解除しますか？")) return;
  try{
    msg("");
    const json = await apiPost({ mode:"resetAllSoldOut" });
    if(!json.ok) throw new Error(json.error || "reset failed");
    msg("全解除しました", false);
    await load();
  }catch(e){
    msg("全解除エラー: " + e.message, true);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  function renderOwnerShopState_(open){
  const el = document.getElementById("ownerShopState");
  if(!el) return;
  el.textContent = open ? "営業中" : "受付停止";
  el.style.color = open ? "#0a7" : "#c00";
}

async function loadOpsSettings_(){
  const s = await apiGet({ mode:"getSettings" });
  if(!s.ok) throw new Error(s.error || "getSettings failed");
  renderOwnerShopState_(!!s.settings.SHOP_OPEN);

  const autoMin = document.getElementById("autoMin");
  if(autoMin) autoMin.value = String(s.settings.AUTO_HANDOFF_MIN || 60);
}

document.addEventListener("DOMContentLoaded", async () => {
  try{
    await loadOpsSettings_();

    const t = document.getElementById("ownerToggleShop");
    if(t) t.addEventListener("click", async ()=>{
      const r = await apiPost({ mode:"toggleShopOpen" });
      if(r.ok) renderOwnerShopState_(!!r.SHOP_OPEN);
    });

    const save = document.getElementById("saveOps");
    if(save) save.addEventListener("click", async ()=>{
      const autoMin = Number(document.getElementById("autoMin")?.value || 60);
      const staffLimit = Number(document.getElementById("staffLimit")?.value || 6);

      const r = await apiPost({
        mode:"setSettings",
        settings:{
          AUTO_HANDOFF_MIN:autoMin,
        }
      });
      if(!r.ok) throw new Error(r.error || "setSettings failed");
      msg("設定を保存しました", false);
    });

  }catch(e){
    msg("設定取得エラー: " + e.message, true);
  }
});

  $("btnReload").addEventListener("click", load);
  $("btnAdd").addEventListener("click", addOrUpdate);
  $("btnResetSoldOut").addEventListener("click", resetSoldOutAll);
  load();
});





