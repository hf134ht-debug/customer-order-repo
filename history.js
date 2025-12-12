const GAS_WEB_APP_URL = (window.GAS_WEB_APP_URL || "").trim();
const $ = (id) => document.getElementById(id);

function z(n){ return String(n).padStart(2,"0"); }
function ymd(d){ return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`; }

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])
  );
}

function badge(status) {
  const map = {
    pending: "🟡 pending",
    handed: "🟢 handed",
    auto_handed: "🔵 auto_handed",
    cancelled: "🔴 cancelled"
  };
  return map[status] || status;
}

function setQuickRange(days) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  $("fromDate").value = ymd(from);
  $("toDate").value = ymd(to);
}

async function loadOrders() {
  $("msg").textContent = "";
  $("list").textContent = "読み込み中...";

  const from = $("fromDate").value;
  const to = $("toDate").value;
  const status = $("status").value;

  const url = new URL(GAS_WEB_APP_URL);
  url.searchParams.set("mode", "getOrders");
  if (from) url.searchParams.set("from", from);
  if (to) url.searchParams.set("to", to);
  if (status) url.searchParams.set("status", status);

  try {
    const res = await fetch(url.toString());
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "getOrders failed");

    renderList(json.orders || []);
  } catch (e) {
    $("list").textContent = "";
    $("msg").textContent = "取得エラー: " + e.message;
  }
}

function renderList(orders) {
  if (!orders.length) {
    $("list").textContent = "該当なし";
    return;
  }

  $("list").innerHTML = orders.map(o => {
    const itemsHtml = (o.items || []).map(it => `
      <div class="row">
        <div>${escapeHtml(it.product_name_at_sale)} × ${Number(it.qty||0)}</div>
        <div>¥${Number(it.unit_price||0).toLocaleString()} / 小計 ¥${Number(it.line_total||0).toLocaleString()}</div>
      </div>
    `).join("");

    const handedView = o.handed_at_view ? escapeHtml(o.handed_at_view) : "-";

    return `
      <div class="card">
        <div class="row">
          <div>
            <div style="font-weight:700;">
              受付 #${escapeHtml(o.display_no)}　${badge(o.status)}
            </div>
            <div class="muted">
              作成: ${escapeHtml(o.created_at)} / 受渡: ${handedView}
            </div>
          </div>
          <div style="font-weight:700;">¥${Number(o.total||0).toLocaleString()}</div>
        </div>

        <details style="margin-top:8px;">
          <summary>内訳</summary>
          <div class="items">
            ${itemsHtml || "<div class='muted'>内訳なし</div>"}
          </div>
        </details>

        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">
          <button onclick="setStatus('${escapeHtml(o.order_id)}','handed')">handed</button>
          <button onclick="setStatus('${escapeHtml(o.order_id)}','pending')">pendingに戻す</button>
          <button onclick="setStatus('${escapeHtml(o.order_id)}','cancelled')">cancelled</button>
        </div>
      </div>
    `;
  }).join("");
}

async function setStatus(orderId, status) {
  if (!confirm(`注文 ${orderId} を ${status} に変更しますか？`)) return;

  try {
    const res = await fetch(GAS_WEB_APP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "updateOrderStatus",
        order_id: orderId,
        status
      })
    });

    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "update failed");

    await loadOrders();
  } catch (e) {
    alert("更新エラー: " + e.message);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setQuickRange(0);
  $("btnReload").addEventListener("click", loadOrders);
  $("btnToday").addEventListener("click", () => { setQuickRange(0); loadOrders(); });
  $("btn7days").addEventListener("click", () => { setQuickRange(6); loadOrders(); });
  loadOrders();
});
