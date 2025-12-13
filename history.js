const GAS_WEB_APP_URL = (window.GAS_WEB_APP_URL || "").trim();
const $ = (id) => document.getElementById(id);

const DOW = ["日","月","火","水","木","金","土"];

function z(n){ return String(n).padStart(2,"0"); }
function ymd(d){ return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`; }
function ym(d){ return `${d.getFullYear()}-${z(d.getMonth()+1)}`; }

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])
  );
}

function statusJa(st){
  const m = {
    pending: "待ち",
    handed: "完了",
    auto_handed: "自動完了",
    cancelled: "取消"
  };
  return m[st] || st;
}

// 秒を消して見やすく：
// "2025-12-13 06:52:01" → "2025/12/13 06:52"
function formatNoSeconds(dtStr){
  if(!dtStr) return "";
  let s = String(dtStr).trim();

  // 形式ゆれ吸収
  s = s.replace("T"," ").replace(/-/g,"/");

  // 秒があるなら削る
  s = s.replace(/(\d{1,2}:\d{2}):\d{2}/, "$1");

  return s;
}

let viewMonth = new Date();
let hasDaysSet = {};     // "YYYY-MM-DD" => true
let selectedDay = new Date();

async function fetchMonthDays(monthStr){
  const url = new URL(GAS_WEB_APP_URL);
  url.searchParams.set("mode","getOrdersMonthDays");
  url.searchParams.set("month", monthStr);

  const res = await fetch(url.toString());
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "getOrdersMonthDays failed");

  hasDaysSet = {};
  (json.days || []).forEach(d => { hasDaysSet[d] = true; });
}

function renderCalendar(){
  $("calTitle").textContent = `${viewMonth.getFullYear()} / ${z(viewMonth.getMonth()+1)}`;
  $("calDow").innerHTML = DOW.map(x => `<div class="dow">${x}</div>`).join("");

  const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const startDow = first.getDay();
  const start = new Date(first);
  start.setDate(first.getDate() - startDow);

  const todayStr = ymd(new Date());
  const selStr = ymd(selectedDay);

  let html = "";
  for(let i=0;i<42;i++){
    const d = new Date(start);
    d.setDate(start.getDate()+i);

    const dStr = ymd(d);
    const inMonth = d.getMonth() === viewMonth.getMonth();
    const has = !!hasDaysSet[dStr];

    // 重要：選択日は has より強く見せる
    const cls = [
      "day",
      inMonth ? "" : "off",
      (!inMonth ? "" : (dStr === selStr ? "sel" : (has ? "has" : ""))),
      dStr === todayStr ? "today" : ""
    ].filter(Boolean).join(" ");

    html += `<div class="${cls}" data-date="${dStr}">
      <div>${d.getDate()}</div>
      ${(!inMonth ? "" : (has ? `<div class="dot"></div>` : ""))}
    </div>`;
  }
  $("calGrid").innerHTML = html;

  $("calGrid").querySelectorAll(".day").forEach(el => {
    el.addEventListener("click", async () => {
      if (el.classList.contains("off")) {
        // 月外でも押せるが、月移動してから選択
        const dStr = el.getAttribute("data-date");
        const d = new Date(dStr + "T00:00:00");
        viewMonth = new Date(d.getFullYear(), d.getMonth(), 1);
        await loadMonthAndRender(false);
        selectedDay = d;
      } else {
        const dStr = el.getAttribute("data-date");
        selectedDay = new Date(dStr + "T00:00:00");
      }

      const s = ymd(selectedDay);
      $("pickedLabel").textContent = `選択日：${s}`;
      await loadDayOrders(s);
      renderCalendar();
    });
  });
}

async function loadDayOrders(dayStr){
  $("msg").textContent = "";
  $("list").textContent = "読み込み中...";

  const url = new URL(GAS_WEB_APP_URL);
  url.searchParams.set("mode","getOrders");
  url.searchParams.set("from", dayStr);
  url.searchParams.set("to", dayStr);

  try{
    const res = await fetch(url.toString());
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "getOrders failed");
    renderList(json.orders || []);
  }catch(e){
    $("list").textContent = "";
    $("msg").textContent = "取得エラー: " + e.message;
  }
}

function renderList(orders){
  if(!orders.length){
    $("list").textContent = "この日の履歴はありません";
    return;
  }

  $("list").innerHTML = orders.map(o => {
    const itemsHtml = (o.items || []).map(it => `
      <div class="row">
        <div>${escapeHtml(it.product_name_at_sale)} × ${Number(it.qty||0)}</div>
        <div>¥${Number(it.line_total||0).toLocaleString()}</div>
      </div>
    `).join("");

    const created = formatNoSeconds(o.created_at);

    return `
      <div class="card">
        <div class="row">
          <div>
            <div style="font-weight:900;">
              #${escapeHtml(o.display_no)}
              <span class="st ${escapeHtml(o.status)}">${escapeHtml(statusJa(o.status))}</span>
            </div>
            <div class="sub">${escapeHtml(created)}</div>
          </div>
          <div style="font-weight:900;">¥${Number(o.total||0).toLocaleString()}</div>
        </div>

        <details style="margin-top:8px;">
          <summary>内訳</summary>
          <div class="items">${itemsHtml || "<div class='sub'>内訳なし</div>"}</div>
        </details>

        ${o.status !== "cancelled" ? `
          <div style="margin-top:10px;">
            <button class="btn-cancel" onclick="cancelOrder('${escapeHtml(o.order_id)}')">キャンセル</button>
          </div>
        ` : ``}
      </div>
    `;
  }).join("");
}

async function cancelOrder(orderId){
  if(!confirm(`注文 ${orderId} をキャンセルしますか？`)) return;

  try{
    const res = await fetch(GAS_WEB_APP_URL, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({
        mode:"updateOrderStatus",
        order_id: orderId,
        status:"cancelled"
      })
    });
    const json = await res.json();
    if(!json.ok) throw new Error(json.error || "cancel failed");

    const dStr = ymd(selectedDay);
    await loadMonthAndRender(true);
    await loadDayOrders(dStr);
  }catch(e){
    alert("キャンセル失敗: " + e.message);
  }
}

async function loadMonthAndRender(keepSelected){
  $("msg").textContent = "";
  const monthStr = ym(viewMonth);
  try{
    await fetchMonthDays(monthStr);

    if(!keepSelected){
      selectedDay = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
      $("pickedLabel").textContent = `選択日：${ymd(selectedDay)}`;
    }

    renderCalendar();
  }catch(e){
    $("msg").textContent = "カレンダー取得エラー: " + e.message;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const now = new Date();
  viewMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  selectedDay = now;
  $("pickedLabel").textContent = `選択日：${ymd(selectedDay)}`;

  $("prevMonth").addEventListener("click", async () => {
    viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth()-1, 1);
    await loadMonthAndRender(false);
    $("list").textContent = "";
  });

  $("nextMonth").addEventListener("click", async () => {
    viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth()+1, 1);
    await loadMonthAndRender(false);
    $("list").textContent = "";
  });

  await loadMonthAndRender(true);
  await loadDayOrders(ymd(selectedDay));
});
