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
    const cards = [
      { label: '篩選後事故件數', value: Util.fmtNum(accidents.length) },
      { label: '死亡人數', value: Util.fmtNum(deaths), critical: true },
      { label: '受傷人數', value: Util.fmtNum(injuries) },
      { label: '肇事逃逸件數', value: Util.fmtNum(hitRun), sub: accidents.length ? Util.fmtPct(hitRun / accidents.length) : '—' },
      { label: '平均每件死亡人數', value: accidents.length ? (deaths / accidents.length).toFixed(2) : '—', sub: 'A1 事故定義為至少 1 人死亡' },
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

  // ---------------- 各分頁渲染 ----------------

  function renderOverview(accidents) {
    renderKpi(accidents);
    Charts.renderTrend(accidents);
    Charts.renderCountyRank(accidents);
    Charts.renderSimpleDonut('weatherChart', accidents, 'weather');
    Charts.renderHourChart(accidents);
    Charts.renderSimpleDonut('accTypeChart', accidents, 'accTypeMajor');
  }

  function renderMapTab(accidents) {
    MapView.render(accidents);
    MapView.invalidateSize();
  }

  let crossState = { row: 'weather', col: 'accTypeMajor', metric: 'count' };
  function renderExplore(accidents) {
    const result = Charts.renderCrossTable('crossTable', accidents, crossState.row, crossState.col, crossState.metric);
    window.__lastCross = { ...crossState, ...result };
    const singleDimKey = document.getElementById('singleDim').value;
    Charts.renderSingleDim('singleDimChart', accidents, singleDimKey);
    Charts.renderCauseChart(accidents);
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
      });
    });
  }

  // ---------------- 下拉選單初始化 ----------------

  function setupSelects() {
    const dimOptions = Object.entries(State.DIMENSIONS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
    document.getElementById('crossRowDim').innerHTML = dimOptions;
    document.getElementById('crossColDim').innerHTML = dimOptions;
    document.getElementById('singleDim').innerHTML = dimOptions;
    document.getElementById('crossRowDim').value = crossState.row;
    document.getElementById('crossColDim').value = crossState.col;
    document.getElementById('singleDim').value = 'weather';

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
    MapView.init();

    State.onChange(() => { tablePage = 1; renderCurrentTab(); });
    renderCurrentTab();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
