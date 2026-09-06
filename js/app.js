// ============================================================
// 主應用程式：UI 綁定與渲染調度
// ============================================================
(() => {
  let currentTab = 'overview';
  let tablePage = 1;
  const PAGE_SIZE = 50;

  // ---------------- 側邊欄篩選晶片 ----------------

  function renderYearChips() {
    const el = document.getElementById('yearChips');
    el.innerHTML = '';
    META.accidentYears.forEach(y => {
      const chip = document.createElement('button');
      chip.className = 'chip' + (State.filters.years.has(y) ? ' active' : '');
      chip.textContent = y + '年';
      chip.onclick = () => { State.toggleInSet('years', y); renderYearChips(); };
      el.appendChild(chip);
    });
  }

  function renderCountyChips() {
    const el = document.getElementById('countyChips');
    el.innerHTML = '';
    META.counties.forEach(c => {
      const chip = document.createElement('button');
      chip.className = 'chip' + (State.filters.counties.has(c) ? ' active' : '');
      chip.textContent = c;
      chip.onclick = () => { State.toggleInSet('counties', c); renderCountyChips(); };
      el.appendChild(chip);
    });
  }

  function renderGenericChips(elId, dimKey, filterKey, limit = 20) {
    const el = document.getElementById(elId);
    el.innerHTML = '';
    const values = State.uniqueValues(dimKey).slice(0, limit);
    values.forEach(v => {
      const chip = document.createElement('button');
      const active = State.filters[filterKey].has(v);
      chip.className = 'chip' + (active ? ' active' : '');
      chip.textContent = v;
      chip.onclick = () => { State.toggleInSet(filterKey, v); renderGenericChips(elId, dimKey, filterKey, limit); };
      el.appendChild(chip);
    });
  }

  function renderAllChips() {
    renderYearChips();
    renderCountyChips();
    renderGenericChips('weatherChips', 'weather', 'weather');
    renderGenericChips('lightChips', 'light', 'light');
    renderGenericChips('roadClassChips', 'roadClass', 'roadClass');
    renderGenericChips('accTypeChips', 'accTypeMajor', 'accTypeMajor');
    renderGenericChips('causeChips', 'causeMajor', 'causeMajor');
  }

  // ---------------- KPI ----------------

  function renderKpi(accidents) {
    const deaths = accidents.reduce((s, a) => s + a.deaths, 0);
    const injuries = accidents.reduce((s, a) => s + a.injuries, 0);
    const hitRun = accidents.filter(a => a.hitRun === '是').length;
    const a2Rows = State.a2ByCountyFiltered();
    const a2Count = a2Rows.reduce((s, r) => s + r.count, 0);
    const a2Injuries = a2Rows.reduce((s, r) => s + r.injuries, 0);
    const cards = [
      { label: '篩選後 A1 事故件數', value: Util.fmtNum(accidents.length) },
      { label: 'A1 死亡人數', value: Util.fmtNum(deaths), critical: true },
      { label: 'A1 受傷人數', value: Util.fmtNum(injuries) },
      { label: '肇事逃逸件數（A1）', value: Util.fmtNum(hitRun), sub: accidents.length ? Util.fmtPct(hitRun / accidents.length) : '—' },
      { label: '平均每件死亡人數（A1）', value: accidents.length ? (deaths / accidents.length).toFixed(2) : '—', sub: 'A1 事故定義為至少 1 人死亡' },
      { label: 'A2 受傷事故件數', value: Util.fmtNum(a2Count), sub: '依年度/縣市篩選彙整' },
      { label: 'A2 受傷人數', value: Util.fmtNum(a2Injuries) },
    ];
    document.getElementById('kpiRow').innerHTML = cards.map(c => `
      <div class="kpi-card">
        <div class="label">${c.label}</div>
        <div class="value${c.critical ? ' critical' : ''}">${c.value}</div>
        ${c.sub ? `<div class="sub">${c.sub}</div>` : ''}
      </div>
    `).join('');
  }

  // ---------------- 分頁資料表 ----------------

  function renderTable(accidents) {
    const totalPages = Math.max(1, Math.ceil(accidents.length / PAGE_SIZE));
    if (tablePage > totalPages) tablePage = totalPages;
    const start = (tablePage - 1) * PAGE_SIZE;
    const pageRows = accidents.slice(start, start + PAGE_SIZE);
    const cols = Exporter.TABLE_COLUMNS;
    const table = document.getElementById('dataTable');
    table.innerHTML =
      '<thead><tr>' + cols.map(c => `<th>${c.label}</th>`).join('') + '</tr></thead>' +
      '<tbody>' + pageRows.map(r => '<tr>' + cols.map(c => `<td>${r[c.key] ?? ''}</td>`).join('') + '</tr>').join('') + '</tbody>';

    document.getElementById('pagination').innerHTML = `
      <button class="btn" id="pgPrev" ${tablePage <= 1 ? 'disabled' : ''}>← 上一頁</button>
      <span>第 ${tablePage} / ${totalPages} 頁（共 ${Util.fmtNum(accidents.length)} 筆）</span>
      <button class="btn" id="pgNext" ${tablePage >= totalPages ? 'disabled' : ''}>下一頁 →</button>
    `;
    const prev = document.getElementById('pgPrev'), next = document.getElementById('pgNext');
    if (prev) prev.onclick = () => { tablePage--; renderTable(State.filtered()); };
    if (next) next.onclick = () => { tablePage++; renderTable(State.filtered()); };
  }

  function renderA2DownloadList() {
    const el = document.getElementById('a2DownloadList');
    if (!el) return;
    const rows = (window.A2_EXPORT_MANIFEST || []).slice().sort((a, b) => a.year - b.year);
    if (!rows.length) { el.innerHTML = '<li class="hint">找不到原始資料匯出檔（full_data_export/），請確認 build_data.py 是否已重新執行。</li>'; return; }
    el.innerHTML = rows.map(r => `
      <li>
        <span>${r.year} 年（民國 ${r.rocYear} 年）A2 受傷交通事故原始資料 — ${Util.fmtNum(r.accidents)} 件事故</span>
        <a class="btn" href="full_data_export/${encodeURIComponent(r.filename)}" download>
          ⭳ 下載 .gz <span class="meta">(${Util.fmtBytes(r.sizeBytes)})</span>
        </a>
      </li>
    `).join('');
  }

  // ---------------- 各分頁渲染 ----------------

  function renderOverview(accidents) {
    renderKpi(accidents);
    Charts.renderTrend(accidents);
    Charts.renderCountyRank(accidents);
    Charts.renderSimpleDonut('weatherChart', accidents, 'weather');
    Charts.renderHourChart(accidents);
    Charts.renderSimpleDonut('accTypeChart', accidents, 'accTypeMajor');
    Charts.renderA2Trend(State.a2ByCountyFiltered());
    Charts.renderA2CountyRank(State.a2ByCountyFiltered());
  }

  function renderMapTab(accidents) {
    MapView.render(accidents);
    MapView.invalidateSize();
  }

  let exploreSource = 'a1';
  let crossState = { row: 'weather', col: 'accTypeMajor', metric: 'count' };

  function renderExplore(accidents) {
    const singleDimKey = document.getElementById('singleDim').value;
    if (exploreSource === 'a2') {
      const rows = State.a2CrosstabFiltered();
      const metric = crossState.metric === 'deaths' ? 'count' : crossState.metric; // A2 無死亡欄位
      const result = Charts.renderCrossTableAgg('crossTable', rows, crossState.row, crossState.col, metric);
      window.__lastCross = { ...crossState, metric, ...result };
      Charts.renderSingleDimAgg('singleDimChart', rows, singleDimKey, metric);
      Charts.renderCauseChartAgg(State.a2CauseMinorFiltered(), metric === 'injuries' ? 'injuries' : 'count');
    } else {
      const result = Charts.renderCrossTable('crossTable', accidents, crossState.row, crossState.col, crossState.metric);
      window.__lastCross = { ...crossState, ...result };
      Charts.renderSingleDim('singleDimChart', accidents, singleDimKey);
      Charts.renderCauseChart(accidents);
    }
  }

  function renderEnforcementTab(accidents) {
    const counties = [...State.filters.counties];
    const years = [...State.filters.years].filter(y => META.enforcementYears.includes(y));
    const accByCounty = Util.sumBy(accidents, a => a.county, () => 1);
    const deathsByCounty = Util.sumBy(accidents, a => a.county, a => a.deaths);
    const category = document.getElementById('enfCategorySelect').value;
    Charts.renderEnfScatter(counties, years, category, accByCounty);
    Charts.renderEnfTrend(counties);
    Charts.renderEnfBar(counties, years, accByCounty, deathsByCounty);
  }

  function renderPopulationTab(accidents) {
    const counties = [...State.filters.counties];
    const year = Number(document.getElementById('popYearSelect').value);
    Charts.renderPopRate(counties, year);
    Charts.renderDensityScatter(counties);
    Charts.renderLongTrend(counties);
  }

  function renderTableTab(accidents) {
    renderTable(accidents);
  }

  function renderCurrentTab() {
    const accidents = State.filtered();
    document.getElementById('filteredCount').textContent = accidents.length.toLocaleString();
    document.getElementById('totalCount').textContent = ACCIDENTS.length.toLocaleString();
    switch (currentTab) {
      case 'overview': renderOverview(accidents); break;
      case 'map': renderMapTab(accidents); break;
      case 'hotspot': Hotspot.render(); break;
      case 'explore': renderExplore(accidents); break;
      case 'enforcement': renderEnforcementTab(accidents); break;
      case 'population': renderPopulationTab(accidents); break;
      case 'table': renderTableTab(accidents); break;
    }
  }

  // ---------------- Tabs ----------------

  function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        currentTab = btn.dataset.tab;
        document.getElementById('tab-' + currentTab).classList.add('active');
        renderCurrentTab();
        closeSidebar();
      });
    });
  }

  // ---------------- 手機側邊欄開關 ----------------

  function openSidebar() {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebarBackdrop').classList.add('show');
  }
  function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarBackdrop').classList.remove('show');
  }
  function setupSidebarToggle() {
    document.getElementById('sidebarToggle').addEventListener('click', () => {
      const sb = document.getElementById('sidebar');
      sb.classList.contains('open') ? closeSidebar() : openSidebar();
    });
    document.getElementById('sidebarBackdrop').addEventListener('click', closeSidebar);
  }

  // ---------------- 下拉選單初始化 ----------------

  function refreshExploreDimOptions() {
    const keys = exploreSource === 'a2' ? META.a2CrosstabDims : Object.keys(State.DIMENSIONS);
    const dimOptions = keys.map(k => `<option value="${k}">${State.DIMENSIONS[k].label}</option>`).join('');
    const rowSel = document.getElementById('crossRowDim'), colSel = document.getElementById('crossColDim'), singleSel = document.getElementById('singleDim');
    rowSel.innerHTML = dimOptions;
    colSel.innerHTML = dimOptions;
    singleSel.innerHTML = dimOptions;
    rowSel.value = keys.includes(crossState.row) ? crossState.row : keys[0];
    colSel.value = keys.includes(crossState.col) ? crossState.col : keys[1] || keys[0];
    singleSel.value = keys.includes('weather') ? 'weather' : keys[0];
    crossState.row = rowSel.value; crossState.col = colSel.value;

    const metricSel = document.getElementById('crossMetric');
    if (exploreSource === 'a2') {
      metricSel.innerHTML = '<option value="count">事故件數</option><option value="injuries">受傷人數</option>';
      if (crossState.metric === 'deaths') crossState.metric = 'count';
    } else {
      metricSel.innerHTML = '<option value="count">事故件數</option><option value="deaths">死亡人數</option><option value="injuries">受傷人數</option>';
    }
    metricSel.value = crossState.metric;
  }

  function setupSelects() {
    refreshExploreDimOptions();

    document.getElementById('exploreSourceSelect').addEventListener('change', e => {
      exploreSource = e.target.value;
      refreshExploreDimOptions();
      renderCurrentTab();
    });
    document.getElementById('crossRowDim').addEventListener('change', e => { crossState.row = e.target.value; renderCurrentTab(); });
    document.getElementById('crossColDim').addEventListener('change', e => { crossState.col = e.target.value; renderCurrentTab(); });
    document.getElementById('crossMetric').addEventListener('change', e => { crossState.metric = e.target.value; renderCurrentTab(); });
    document.getElementById('singleDim').addEventListener('change', renderCurrentTab);

    document.getElementById('enfCategorySelect').innerHTML = META.enforcementCategories.map(c => `<option value="${c}">${c}</option>`).join('');
    document.getElementById('enfCategorySelect').addEventListener('change', renderCurrentTab);

    const popYears = META.accidentYears;
    document.getElementById('popYearSelect').innerHTML = popYears.map(y => `<option value="${y}">${y}年</option>`).join('');
    document.getElementById('popYearSelect').value = popYears[popYears.length - 1];
    document.getElementById('popYearSelect').addEventListener('change', renderCurrentTab);
  }

  // ---------------- 地圖導航：縣市/鄉鎮跳轉、座標定位、自訂座標環域 ----------------

  function setupMapNav() {
    const jump = State.geoJump();
    const countySel = document.getElementById('navCountySelect');
    const townshipSel = document.getElementById('navTownshipSelect');
    countySel.innerHTML = jump.counties.map(c => `<option value="${c.county}">${c.county}</option>`).join('');

    function refreshTownships() {
      const county = countySel.value;
      const list = jump.townships.filter(t => t.county === county);
      townshipSel.innerHTML = '<option value="">（全縣市）</option>' + list.map(t => `<option value="${t.township}">${t.township}</option>`).join('');
    }
    refreshTownships();
    countySel.addEventListener('change', refreshTownships);

    document.getElementById('navGoBtn').addEventListener('click', () => {
      const county = countySel.value, township = townshipSel.value;
      if (township) {
        const t = jump.townships.find(x => x.county === county && x.township === township);
        if (t) MapView.jumpTo(t.lat, t.lng, 14);
      } else {
        const c = jump.counties.find(x => x.county === county);
        if (c) MapView.jumpTo(c.lat, c.lng, 11);
      }
      if (document.querySelector('.tab-btn[data-tab="map"]') && currentTab !== 'map') {
        document.querySelector('.tab-btn[data-tab="map"]').click();
      }
    });

    const latInput = document.getElementById('navLat');
    const lngInput = document.getElementById('navLng');
    const radiusInput = document.getElementById('customBufferRadius');
    const bufferRow = document.getElementById('customBufferRow');
    const resultEl = document.getElementById('customBufferResult');

    function updateCustomStats() {
      const lat = Number(latInput.value), lng = Number(lngInput.value), radius = Number(radiusInput.value) || 200;
      if (!isFinite(lat) || !isFinite(lng)) return;
      const s = State.customBufferStats(lat, lng, radius);
      resultEl.textContent = `半徑 ${radius}m 內：A1 ${Util.fmtNum(s.a1Count)} 件（死亡 ${s.a1Deaths}／受傷 ${s.a1Injuries}）／A2 約 ${Util.fmtNum(s.a2Count)} 件（受傷約 ${Util.fmtNum(s.a2Injuries)}，1公里網格估算）`;
      MapView.updateCustomRadius(radius);
    }

    document.getElementById('navLocateBtn').addEventListener('click', () => {
      const lat = Number(latInput.value), lng = Number(lngInput.value);
      if (!isFinite(lat) || !isFinite(lng) || latInput.value === '' || lngInput.value === '') {
        alert('請輸入有效的緯度與經度數值');
        return;
      }
      const radius = Number(radiusInput.value) || 200;
      MapView.setCustomPoint(lat, lng, radius);
      bufferRow.hidden = false;
      updateCustomStats();
      if (document.querySelector('.tab-btn[data-tab="map"]') && currentTab !== 'map') {
        document.querySelector('.tab-btn[data-tab="map"]').click();
      }
    });
    document.getElementById('navClearBtn').addEventListener('click', () => {
      MapView.clearCustomPoint();
      bufferRow.hidden = true;
      latInput.value = ''; lngInput.value = '';
    });
    radiusInput.addEventListener('input', updateCustomStats);
  }

  // ---------------- 按鈕事件 ----------------

  function setupButtons() {
    document.getElementById('resetFiltersBtn').addEventListener('click', () => {
      State.resetAll();
      renderAllChips();
    });
    document.querySelector('[data-action="reset-years"]').addEventListener('click', () => {
      State.setAll('years', META.accidentYears);
      renderYearChips();
    });
    document.querySelector('[data-action="toggle-counties"]').addEventListener('click', () => {
      if (State.filters.counties.size === META.counties.length) State.setAll('counties', []);
      else State.setAll('counties', META.counties);
      renderCountyChips();
    });

    document.querySelectorAll('[data-export-chart]').forEach(btn => {
      btn.addEventListener('click', () => Charts.exportPng(btn.dataset.exportChart));
    });

    document.getElementById('mapExportBtn').addEventListener('click', () => MapView.exportPng());

    document.getElementById('exportCsvBtn').addEventListener('click', () => {
      Exporter.exportCsv(State.filtered(), `事故資料_篩選結果_${Date.now()}.csv`);
    });
    document.getElementById('exportXlsxBtn').addEventListener('click', () => {
      Exporter.exportXlsx(State.filtered(), `事故資料_篩選結果_${Date.now()}.xlsx`);
    });
    document.getElementById('crossExportCsv').addEventListener('click', () => {
      const r = window.__lastCross;
      if (!r) return;
      const rowLabel = State.DIMENSIONS[r.row].label, colLabel = State.DIMENSIONS[r.col].label;
      Exporter.exportCrossTableCsv(rowLabel, colLabel, r.rowTop, r.colTop, r.grid, `交叉表_${rowLabel}x${colLabel}_${Date.now()}.csv`);
    });

    document.getElementById('themeToggle').addEventListener('click', () => {
      const el = document.documentElement;
      const cur = el.getAttribute('data-theme');
      let next;
      if (!cur) next = Util.isDark() ? 'light' : 'dark';
      else if (cur === 'dark') next = 'light';
      else next = 'dark';
      el.setAttribute('data-theme', next);
      Charts.refreshTheme();
      renderCurrentTab();
    });
  }

  // ---------------- 初始化 ----------------

  function init() {
    document.getElementById('dataRangeLabel').textContent =
      `事故 ${META.accidentYears[0]}–${META.accidentYears[META.accidentYears.length - 1]}年 ・ 舉發 ${META.enforcementYears[0]}–${META.enforcementYears[META.enforcementYears.length - 1]}年 ・ 更新於 ${META.generatedAt}`;

    renderAllChips();
    setupTabs();
    setupSelects();
    setupButtons();
    setupSidebarToggle();
    setupMapNav();
    renderA2DownloadList();
    MapView.init();
    Hotspot.init();

    State.onChange(() => { tablePage = 1; renderCurrentTab(); });
    renderCurrentTab();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
