// ============================================================
// 工程經費(標案) 分頁：六都及全國交通標案分類彙整 —— 互動圖表與篩選
// 資料來源：data/tenders.data.js（由 scripts/build_tenders.py 產生）
// 與獨立頁面 tenders.html 共用同一份資料，但本模組僅聚焦於
// 「依縣市／分類／機關層級等維度可自由切換圖表彙總」，
// 逐筆資料查詢與匯出仍以 tenders.html 為主。
// ============================================================
const Tenders = (() => {
  const GROUP_DIMS = {
    performLocCounty: { label: '履約地點縣市', get: r => r.performLocCounty || '（查無比對結果）' },
    category:         { label: '分類',         get: r => r.category || '（未分類）' },
    region:           { label: '機關所屬地區', get: r => r.region || '（未知）' },
    govLevel:         { label: '政府層級',     get: r => r.govLevel || '（未知）' },
    subsidized:       { label: '是否受機關補助', get: r => r.subsidized || '（未知）' },
  };

  let state = {
    chartType: 'bar-amount',
    groupDim: 'performLocCounty',
    activeCats: null, // Set，初始化時填入全部分類
    county: '', region: '', year: '', relevance: '相關', subsidized: '', keyword: '',
  };

  function data() { return window.TENDERS; }

  function fmtAmt(n) { return (n === null || n === undefined || isNaN(n)) ? '—' : Number(n).toLocaleString('zh-Hant'); }
  function fmtYi(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return (n / 1e8).toFixed(2) + ' 億元';
  }

  function filteredRecords() {
    const D = data();
    if (!D) return [];
    const kw = state.keyword.trim().toLowerCase();
    return D.records.filter(r => {
      if (state.activeCats && !state.activeCats.has(r.category)) return false;
      if (state.county && r.performLocCounty !== state.county) return false;
      if (state.region && r.region !== state.region) return false;
      if (state.year && String(r.awardYear) !== state.year) return false;
      if (state.relevance && r.relevance !== state.relevance) return false;
      if (state.subsidized && r.subsidized !== state.subsidized) return false;
      if (kw) {
        const hay = ((r.agency || '') + ' ' + (r.title || '')).toLowerCase();
        if (hay.indexOf(kw) === -1) return false;
      }
      return true;
    });
  }

  // ---------------- KPI ----------------

  function renderKpi(rows) {
    const totalAmount = rows.reduce((s, r) => s + (r.totalAmount || 0), 0);
    const counties = new Set(rows.map(r => r.performLocCounty).filter(Boolean));
    const cats = new Set(rows.map(r => r.category));
    const cards = [
      { label: '符合篩選標案筆數', value: Util.fmtNum(rows.length) },
      { label: '總決標金額', value: fmtYi(totalAmount), sub: fmtAmt(totalAmount) + ' 元' },
      { label: '平均決標金額', value: rows.length ? fmtAmt(Math.round(totalAmount / rows.length)) : '—', sub: '元／筆' },
      { label: '涵蓋縣市數（有履約地點者）', value: Util.fmtNum(counties.size) },
      { label: '涵蓋分類數', value: Util.fmtNum(cats.size) },
    ];
    document.getElementById('tenderKpiRow').innerHTML = cards.map(c => `
      <div class="kpi-card">
        <div class="label">${c.label}</div>
        <div class="value">${c.value}</div>
        ${c.sub ? `<div class="sub">${c.sub}</div>` : ''}
      </div>
    `).join('');
  }

  // ---------------- 圖表 ----------------

  function groupRows(rows, dimKey) {
    const dim = GROUP_DIMS[dimKey];
    const amtMap = Util.sumBy(rows, dim.get, r => r.totalAmount || 0);
    const cntMap = Util.countBy(rows, dim.get);
    const keys = [...cntMap.keys()];
    return keys.map(k => ({ key: k, amount: amtMap.get(k) || 0, count: cntMap.get(k) || 0 }));
  }

  function groupRowsByYear(rows) {
    const amtMap = Util.sumBy(rows, r => r.awardYear ?? '（無日期）', r => r.totalAmount || 0);
    const cntMap = Util.countBy(rows, r => r.awardYear ?? '（無日期）');
    const years = [...cntMap.keys()].filter(y => y !== '（無日期）').sort((a, b) => a - b);
    return years.map(y => ({ key: y, amount: amtMap.get(y) || 0, count: cntMap.get(y) || 0 }));
  }

  let lastGroupRows = [];

  function renderChart(rows) {
    const dimKey = state.groupDim;
    const dimLabel = GROUP_DIMS[dimKey].label;
    const noteEl = document.getElementById('tenderChartNote');

    if (state.chartType === 'line-year') {
      const yearRows = groupRowsByYear(rows);
      lastGroupRows = yearRows.map(r => ({ key: '民國' + r.key + '年', amount: r.amount, count: r.count }));
      Charts.upsert('tenderChart', {
        type: 'line',
        data: {
          labels: yearRows.map(r => '民國' + r.key + '年'),
          datasets: [{ label: '總決標金額（元）', data: yearRows.map(r => r.amount), borderColor: Util.seriesColor(0), backgroundColor: Util.seriesColor(0), tension: .25, borderWidth: 2, pointRadius: 3 }],
        },
        options: {
          responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => '總決標金額：' + fmtAmt(ctx.parsed.y) + ' 元' } } },
          scales: {
            x: { ticks: { color: Util.chartTextColor() }, grid: { display: false } },
            y: { beginAtZero: true, ticks: { color: Util.chartTextColor(), callback: v => fmtYi(v) }, grid: { color: Util.chartGridColor() } },
          },
        },
      });
      noteEl.textContent = '依「決標年度(民國)」彙總目前篩選條件下的總決標金額；「分組維度」選單於折線圖模式下不作用（固定依年度）。';
      return;
    }

    const grouped = groupRows(rows, dimKey).sort((a, b) => (state.chartType === 'bar-count' ? b.count - a.count : b.amount - a.amount));
    lastGroupRows = grouped;
    const topN = grouped.length > 15 ? grouped.slice(0, 15) : grouped;
    const restAmount = grouped.slice(15).reduce((s, r) => s + r.amount, 0);
    const restCount = grouped.slice(15).reduce((s, r) => s + r.count, 0);

    if (state.chartType === 'pie-amount') {
      let arr = topN.slice();
      if (restAmount > 0 || restCount > 0) arr = arr.concat([{ key: '其他', amount: restAmount, count: restCount }]);
      Charts.upsert('tenderChart', {
        type: 'doughnut',
        data: {
          labels: arr.map(r => String(r.key)),
          datasets: [{ data: arr.map(r => r.amount), backgroundColor: arr.map((_, i) => Util.seriesColor(i)) }],
        },
        options: {
          responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
          plugins: {
            legend: { position: 'right', labels: { color: Util.chartTextColor(), boxWidth: 12, font: { size: 11 } } },
            tooltip: { callbacks: { label: ctx => `${ctx.label}：${fmtAmt(ctx.parsed)} 元` } },
          },
        },
      });
      noteEl.textContent = `依「${dimLabel}」分組之總決標金額占比（前 15 名以外合併為「其他」）。`;
      return;
    }

    // bar-amount / bar-count
    const metricKey = state.chartType === 'bar-count' ? 'count' : 'amount';
    const metricLabel = state.chartType === 'bar-count' ? '標案件數' : '總決標金額（元）';
    Charts.upsert('tenderChart', {
      type: 'bar',
      data: {
        labels: topN.map(r => String(r.key)),
        datasets: [{ label: metricLabel, data: topN.map(r => r[metricKey]), backgroundColor: Util.seriesColor(0), borderRadius: 4 }],
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => metricLabel + '：' + (metricKey === 'amount' ? fmtAmt(ctx.parsed.x) + ' 元' : Util.fmtNum(ctx.parsed.x)) } },
        },
        scales: {
          x: { beginAtZero: true, ticks: { color: Util.chartTextColor(), callback: v => metricKey === 'amount' ? fmtYi(v) : v }, grid: { color: Util.chartGridColor() } },
          y: { ticks: { color: Util.chartTextColor(), font: { size: 10.5 } }, grid: { display: false } },
        },
      },
    });
    noteEl.textContent = topN.length < grouped.length
      ? `依「${dimLabel}」分組，僅顯示前 15 名（實際共 ${grouped.length} 組）。`
      : `依「${dimLabel}」分組，共 ${grouped.length} 組。`;
  }

  // ---------------- 分組彙總表 ----------------

  function renderGroupTable(rows) {
    const dimLabel = GROUP_DIMS[state.groupDim].label;
    const totalAmount = rows.reduce((s, r) => s + (r.totalAmount || 0), 0);
    document.getElementById('tenderTableSummary').textContent =
      `符合條件共 ${Util.fmtNum(rows.length)} 筆，總決標金額合計 ${fmtAmt(totalAmount)} 元`;

    const groupedForTable = (state.chartType === 'line-year' ? groupRowsByYear(rows).map(r => ({ key: '民國' + r.key + '年', amount: r.amount, count: r.count })) : groupRows(rows, state.groupDim))
      .sort((a, b) => b.amount - a.amount);

    const table = document.getElementById('tenderGroupTable');
    if (!groupedForTable.length) {
      table.innerHTML = '<tbody><tr><td>目前篩選條件下沒有符合的資料</td></tr></tbody>';
      return;
    }
    const dimColLabel = state.chartType === 'line-year' ? '決標年度' : dimLabel;
    table.innerHTML =
      '<thead><tr><th>' + dimColLabel + '</th><th>標案件數</th><th>總決標金額（元）</th><th>占篩選總額比例</th></tr></thead>' +
      '<tbody>' + groupedForTable.map(r => `
        <tr>
          <td>${r.key}</td>
          <td>${Util.fmtNum(r.count)}</td>
          <td>${fmtAmt(r.amount)}</td>
          <td>${totalAmount > 0 ? Util.fmtPct(r.amount / totalAmount) : '—'}</td>
        </tr>
      `).join('') + '</tbody>';
  }

  // ---------------- CSV 匯出 ----------------

  function exportCsv() {
    const rows = filteredRecords();
    if (!rows.length) { alert('目前篩選條件下沒有符合的標案可以匯出'); return; }
    const cols = [
      { key: 'category', label: '分類' }, { key: 'agency', label: '機關名稱' }, { key: 'tenderNo', label: '標案案號' },
      { key: 'title', label: '標案名稱' }, { key: 'awardDate', label: '決標日期' }, { key: 'totalAmount', label: '總決標金額' },
      { key: 'performLocCounty', label: '履約地點縣市' }, { key: 'region', label: '機關所屬地區' }, { key: 'govLevel', label: '政府層級' },
      { key: 'relevance', label: '相關性' }, { key: 'subsidized', label: '是否受機關補助' }, { key: 'subsidyAmount', label: '補助金額' },
    ];
    const csv = Util.toCsv(rows, cols);
    Util.downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `交通標案篩選結果_${Date.now()}.csv`);
  }

  // ---------------- 篩選 UI ----------------

  function refreshCountyOptions() {
    const D = data();
    const sel = document.getElementById('tdCounty');
    const counties = Array.from(new Set(D.records.map(r => r.performLocCounty).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-Hant'));
    sel.innerHTML = '<option value="">全部縣市</option>' + counties.map(c => `<option value="${c}">${c}</option>`).join('');
  }
  function refreshRegionOptions() {
    const D = data();
    const sel = document.getElementById('tdRegion');
    const regions = Array.from(new Set(D.records.map(r => r.region).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-Hant'));
    sel.innerHTML = '<option value="">全部地區</option>' + regions.map(c => `<option value="${c}">${c}</option>`).join('');
  }
  function refreshYearOptions() {
    const D = data();
    const sel = document.getElementById('tdYear');
    const years = Array.from(new Set(D.records.map(r => r.awardYear).filter(y => y != null))).sort((a, b) => a - b);
    sel.innerHTML = '<option value="">全部年度</option>' + years.map(y => `<option value="${y}">民國${y}年</option>`).join('');
  }

  function renderCategoryChips() {
    const D = data();
    const el = document.getElementById('tdCategoryChips');
    el.innerHTML = D.meta.categories.map(c => `<button class="chip${state.activeCats.has(c) ? ' active' : ''}" data-cat="${c}">${c}</button>`).join('');
    el.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const cat = chip.dataset.cat;
        if (state.activeCats.has(cat)) state.activeCats.delete(cat); else state.activeCats.add(cat);
        renderCategoryChips();
        render();
      });
    });
  }

  function setupControls() {
    const D = data();
    if (!D) return;
    state.activeCats = new Set(D.meta.categories);

    renderCategoryChips();
    refreshCountyOptions();
    refreshRegionOptions();
    refreshYearOptions();
    document.getElementById('tdRelevance').value = state.relevance;
    document.getElementById('tdSubsidized').value = state.subsidized;

    document.getElementById('tdChartType').addEventListener('change', e => { state.chartType = e.target.value; render(); });
    document.getElementById('tdGroupDim').addEventListener('change', e => { state.groupDim = e.target.value; render(); });
    document.getElementById('tdCounty').addEventListener('change', e => { state.county = e.target.value; render(); });
    document.getElementById('tdRegion').addEventListener('change', e => { state.region = e.target.value; render(); });
    document.getElementById('tdYear').addEventListener('change', e => { state.year = e.target.value; render(); });
    document.getElementById('tdRelevance').addEventListener('change', e => { state.relevance = e.target.value; render(); });
    document.getElementById('tdSubsidized').addEventListener('change', e => { state.subsidized = e.target.value; render(); });
    document.getElementById('tdKeyword').addEventListener('input', e => { state.keyword = e.target.value; render(); });

    document.getElementById('tdResetBtn').addEventListener('click', () => {
      state = Object.assign(state, { chartType: 'bar-amount', groupDim: 'performLocCounty', county: '', region: '', year: '', relevance: '相關', subsidized: '', keyword: '' });
      state.activeCats = new Set(D.meta.categories);
      document.getElementById('tdChartType').value = state.chartType;
      document.getElementById('tdGroupDim').value = state.groupDim;
      document.getElementById('tdCounty').value = '';
      document.getElementById('tdRegion').value = '';
      document.getElementById('tdYear').value = '';
      document.getElementById('tdRelevance').value = state.relevance;
      document.getElementById('tdSubsidized').value = '';
      document.getElementById('tdKeyword').value = '';
      renderCategoryChips();
      render();
    });
    document.getElementById('tdExportCsv').addEventListener('click', exportCsv);
  }

  function render() {
    const D = data();
    const el = document.getElementById('tenderKpiRow');
    if (!el) return;
    if (!D) {
      el.innerHTML = '<div class="kpi-card"><div class="label">資料載入失敗</div><div class="value">—</div><div class="sub">找不到 data/tenders.data.js，請確認已執行 scripts/build_tenders.py。</div></div>';
      return;
    }
    const rows = filteredRecords();
    renderKpi(rows);
    renderChart(rows);
    renderGroupTable(rows);
  }

  function init() {
    if (!window.TENDERS) { render(); return; }
    setupControls();
    render();
  }

  return { init, render };
})();
