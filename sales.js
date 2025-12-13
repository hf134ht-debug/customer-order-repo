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

// "2025-12-13 06:52:01" → "2025/12/13"
function formatDateOnly(dtStr){
  if(!dtStr) return "";
  let s = String(dtStr).trim().replace("T"," ").replace(/-/g,"/");
  return s.slice(0,10);
}

let viewMonth = new Date();
let hasDaysSet = {}; // "YYYY-MM-DD" => true
let selectedDay = new Date();

async function fetchMonthDays(monthStr){
  const url = new URL(GAS_WEB_APP_URL);
  url.searchParams.set("mode","getSalesMonthDays");
  url.searchParams.set("month", monthStr);

  const res = await fetch(url.toString());
  const json = await res.json();
  if(!json.ok) throw new Error(json.error || "getSalesMonthDays failed");

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

  const selStr = ymd(selectedDay);

  let html = "";
  for(let i=0;i<42;i++){
    const d = new Date(start);
    d.setDate(start.getDate()+i);

    const dStr = ymd(d);
    const inMonth = d.getMonth() === viewMonth.getMonth();
    const has = !!hasDaysSet[dStr];

    const cls = [
      "day",
      inMonth ? "" : "off",
      (!inMonth ? "" : (dStr === selStr ? "sel" : (has ? "has" : ""))),
    ].filter(Boolean).join(" ");

    html += `<div class="${cls}" data-date="${dStr}">
      <div>${d.getDate()}</div>
      ${(!inMonth ? "" : (has ? `<div class="dot"></div>` : ""))}
    </div>`;
  }
  $("calGrid").innerHTML = html;

  $("calGrid").querySelectorAll(".day").forEach(el => {
    el.addEventListener("click", async () => {
      const dStr = el.getAttribute("data-date");
      const d = new Date(dStr + "T00:00:00");

      // 月外クリック→その月へ移動
      if (d.getMonth() !== viewMonth.getMonth()){
        viewMonth = new Date(d.getFullYear(), d.getMonth(), 1);
        await loadMonthAndRender(false);
      }

      selectedDay = d;
      const s = ymd(selectedDay);
      $("pickedLabel").textContent = `選択日：${s}`;
      await loadDaySales(s);
      renderCalendar();
    });
  });
}

async function loadDaySales(dayStr){
  $("msg").textContent = "";
  $("cards").innerHTML = "";
  $("breakdown").textContent = "読み込み中...";

  const url = new URL(GAS_WEB_APP_URL);
  url.searchParams.set("mode","getSalesDay");
  url.searchParams.set("date", dayStr);

  try{
    const res = await fetch(url.toString());
    const json = await res.json();
    if(!json.ok) throw new Error(json.error || "getSalesDay failed");

    renderSales(json.summary, json.product_breakdown || []);
  }catch(e){
    $("breakdown").textContent = "";
    $("msg").textContent = "取得エラー: " + e.message;
  }
}

function renderSales(summary, breakdown){
  const total = Number(summary.total_sales || 0);
  const cnt = Number(summary.order_count || 0);
  const avg = Number(summary.avg_order_value || 0);

  $("cards").innerHTML = `
    <div class="card"><div class="k">合計売上</div><div class="v">¥${total.toLocaleString()}</div></div>
    <div class="card"><div class="k">注文数</div><div class="v">${cnt.toLocaleString()}件</div></div>
    <div class="card"><div class="k">平均客単価</div><div class="v">¥${Math.round(avg).toLocaleString()}</div></div>
  `;

  if(!breakdown.length){
    $("breakdown").textContent = "商品内訳なし";
    return;
  }

  $("breakdown").innerHTML = breakdown.map(x => `
    <div class="row">
      <div>
        <div style="font-weight:800;">${escapeHtml(x.name)}</div>
        <div class="sub">数量：${Number(x.qty||0).toLocaleString()}</div>
      </div>
      <div style="font-weight:900;">¥${Number(x.sales||0).toLocaleString()}</div>
    </div>
  `).join("");
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
let rangeData = null;
let rangeSort = "sales"; // "sales" or "qty"

function startOfWeek(d){
  const x = new Date(d);
  const day = x.getDay(); // 0..6
  x.setDate(x.getDate() - day); // 日曜始まり（必要なら月曜始まりに変えます）
  x.setHours(0,0,0,0);
  return x;
}
function endOfWeek(d){
  const s = startOfWeek(d);
  const e = new Date(s);
  e.setDate(e.getDate()+6);
  e.setHours(0,0,0,0);
  return e;
}
function startOfMonth(d){
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d){
  return new Date(d.getFullYear(), d.getMonth()+1, 0);
}

async function loadSalesRange(from, to){
  $("msg").textContent = "";
  const url = new URL(GAS_WEB_APP_URL);
  url.searchParams.set("mode","getSalesRange");
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);

  const res = await fetch(url.toString());
  const json = await res.json();
  if(!json.ok) throw new Error(json.error || "getSalesRange failed");

  rangeData = json;
  renderRange();
}

function renderRange(){
  if(!rangeData){
    $("rangeSummary").textContent = "";
    $("rangeRanking").textContent = "";
    return;
  }

  const s = rangeData.summary;
  $("rangeSummary").innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;">
      <div class="card"><div class="k">合計売上</div><div class="v">¥${Number(s.total_sales||0).toLocaleString()}</div></div>
      <div class="card"><div class="k">注文数</div><div class="v">${Number(s.order_count||0).toLocaleString()}件</div></div>
      <div class="card"><div class="k">平均客単価</div><div class="v">¥${Math.round(Number(s.avg_order_value||0)).toLocaleString()}</div></div>
    </div>
  `;

  const arr = (rangeData.product_breakdown || []).map(x=>({
    name: x.name,
    qty: Number(x.qty||0),
    sales: Number(x.sales||0)
  }));

  arr.sort((a,b)=>{
    if(rangeSort==="qty") return (b.qty-a.qty) || (b.sales-a.sales) || a.name.localeCompare(b.name);
    return (b.sales-a.sales) || (b.qty-a.qty) || a.name.localeCompare(b.name);
  });

  $("rangeRanking").innerHTML = `
    <div class="row" style="font-weight:900;">
      <div>商品名</div>
      <div style="display:flex;gap:18px;">
        <span>数量</span>
        <span>売上</span>
      </div>
    </div>
    ${arr.map(x=>`
      <div class="row">
        <div style="font-weight:800;">${escapeHtml(x.name)}</div>
        <div style="display:flex;gap:18px;font-weight:900;">
          <span>${x.qty.toLocaleString()}</span>
          <span>¥${x.sales.toLocaleString()}</span>
        </div>
      </div>
    `).join("")}
  `;
}

function buildTSV_(){
  if(!rangeData) return "";
  const from = rangeData.from;
  const to = rangeData.to;

  const arr = (rangeData.product_breakdown || []).map(x=>({
    name: x.name,
    qty: Number(x.qty||0),
    sales: Number(x.sales||0)
  }));

  arr.sort((a,b)=>{
    if(rangeSort==="qty") return (b.qty-a.qty) || (b.sales-a.sales) || a.name.localeCompare(b.name);
    return (b.sales-a.sales) || (b.qty-a.qty) || a.name.localeCompare(b.name);
  });

  const lines = [];
  lines.push(`期間\t${from}\t${to}`);
  lines.push(`商品名\t数量\t売上`);
  arr.forEach(x=>{
    lines.push(`${x.name}\t${x.qty}\t${x.sales}`);
  });
  return lines.join("\n");
}

async function copyTSV_(){
  const tsv = buildTSV_();
  if(!tsv){ alert("期間集計データがありません"); return; }
  await navigator.clipboard.writeText(tsv);
  alert("コピーしました（Sheetsに貼り付けできます）");
}

// DOMContentLoaded 内に追記してボタン配線
document.addEventListener("DOMContentLoaded", () => {
  const now = new Date();

  const btnW = document.getElementById("btnThisWeek");
  const btnM = document.getElementById("btnThisMonth");
  const btnA = document.getElementById("btnApplyRange");
  const sortS = document.getElementById("sortBySales");
  const sortQ = document.getElementById("sortByQty");
  const btnC = document.getElementById("btnCopyTSV");

  if (btnW) btnW.addEventListener("click", async ()=>{
    const s = startOfWeek(now), e = endOfWeek(now);
    const from = ymd(s), to = ymd(e);
    $("rangeFrom").value = from; $("rangeTo").value = to;
    await loadSalesRange(from,to); 
  });

  if (btnM) btnM.addEventListener("click", async ()=>{
    const s = startOfMonth(now), e = endOfMonth(now);
    const from = ymd(s), to = ymd(e);
    $("rangeFrom").value = from; $("rangeTo").value = to;
    await loadSalesRange(from,to);
  });

  if (btnA) btnA.addEventListener("click", async ()=>{
    const from = $("rangeFrom").value;
    const to = $("rangeTo").value;
    if(!from || !to){ alert("From/Toを選んでください"); return; }
    await loadSalesRange(from,to);
  });

  if (sortS) sortS.addEventListener("click", ()=>{ rangeSort="sales"; renderRange(); });
  if (sortQ) sortQ.addEventListener("click", ()=>{ rangeSort="qty"; renderRange(); });
  if (btnC) btnC.addEventListener("click", copyTSV_);
});

document.addEventListener("DOMContentLoaded", async () => {
  const now = new Date();
  viewMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  selectedDay = now;
  $("pickedLabel").textContent = `選択日：${ymd(selectedDay)}`;

  $("prevMonth").addEventListener("click", async () => {
    viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth()-1, 1);
    await loadMonthAndRender(false);
    $("cards").innerHTML = "";
    $("breakdown").textContent = "";
  });

  $("nextMonth").addEventListener("click", async () => {
    viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth()+1, 1);
    await loadMonthAndRender(false);
    $("cards").innerHTML = "";
    $("breakdown").textContent = "";
  });

  await loadMonthAndRender(true);
  await loadDaySales(ymd(selectedDay));

});
