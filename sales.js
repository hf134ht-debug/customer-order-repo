<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>売上集計</title>

  <!-- ✅ 統一CSS -->
  <link rel="stylesheet" href="./ui.css?v=1">

  <script>
    window.GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbzeeGTJKZXHsVEw8DMz_QahMsnbqAUzDM3D_9mnv1LpVRxIitpL0F3xlCTwKUjV0OURzQ/exec";
  </script>
</head>

<body>
  <!-- ✅ 共通ヘッダー -->
  <header class="appHeader">
    <div class="wrap">
      <div class="headRow">
        <div class="brandTitle">SALES</div>

        <nav class="topNav">
          <a class="navItem" href="./staff_handoff.html">受け渡し</a>
          <a class="navItem" href="./history.html">履歴</a>
          <a class="navItem active" href="./sales.html">売上</a>
          <a class="navItem" href="./owner.html">設定</a>
        </nav>
      </div>
    </div>
  </header>

  <main class="wrap">
    <div class="grid">

      <!-- ✅ カレンダー -->
      <section class="card salesCalCard cal-wrap">
        <div class="salesCalHead cal-head">
          <button class="btn" id="prevMonth">←</button>
          <div class="salesCalTitle cal-title" id="calTitle"></div>
          <button class="btn" id="nextMonth">→</button>
        </div>

        <div class="salesLegend legend">
          <div class="lg"><span class="sw has"></span>売上あり</div>
          <div class="lg"><span class="sw sel"></span>選択中</div>
          <div class="lg"><span class="sw off"></span>月外</div>
        </div>

        <!-- ✅ sales.js が .cal-grid / .dow / .day を使うので維持 -->
        <div class="cal-grid" id="calDow"></div>
        <div class="cal-grid" id="calGrid"></div>

        <div class="picked" id="pickedLabel"></div>
        <div class="msg" id="msg"></div>
      </section>

      <!-- ✅ 期間集計 -->
      <section class="card salesRangeCard box">
        <div class="sectionTitle" style="margin:0 0 10px;">期間集計</div>

        <div class="salesRangeRow">
          <button class="btn" id="btnThisWeek">今週</button>
          <button class="btn" id="btnThisMonth">今月</button>

          <div class="salesDateBox">
            <div class="muted">From</div>
            <input id="rangeFrom" type="date">
          </div>
          <div class="salesDateBox">
            <div class="muted">To</div>
            <input id="rangeTo" type="date">
          </div>

          <button class="btn" id="btnApplyRange">この期間で集計</button>
        </div>

        <div class="salesRangeRow" style="margin-top:10px;">
          <span class="salesLabel">ランキング並び：</span>
          <button class="btn" id="sortBySales">売上順</button>
          <button class="btn" id="sortByQty">数量順</button>
          <button class="btn" id="btnCopyTSV">CSV出力（Sheets貼付）</button>
        </div>

        <div id="rangeSummary" style="margin-top:10px;"></div>
        <div id="rangeRanking" style="margin-top:10px;"></div>
      </section>

      <!-- ✅ 日別サマリー（cards） -->
      <section id="cards" class="salesCards cards"></section>

      <!-- ✅ 商品別内訳 -->
      <section class="card box">
        <div class="sectionTitle" style="margin:0 0 6px;">商品別内訳</div>
        <div class="sub">数量 / 売上（上位から表示）</div>
        <div id="breakdown"></div>
      </section>

    </div>
  </main>

  <script src="./sales.js"></script>
  <script src="./ui.js?v=1"></script>
</body>
</html>
