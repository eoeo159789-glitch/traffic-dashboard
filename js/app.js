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

    const finesYearSel = document.getElementById('finesYearSelect');
    if (finesYearSel && window.ENFORCEMENT_FINES && ENFORCEMENT_FINES.years.length > 0) {
      const yearOrTotal = finesYearSel.value === 'total' ? 'total' : Number(finesYearSel.value);
      Charts.renderEnfFines(counties, yearOrTotal);
      const noteEl = document.getElementById('finesNationalNote');
      const F = ENFORCEMENT_FINES;
      if (noteEl) {
        if (yearOrTotal === 'total') {
          noteEl.textContent = `全國（22縣市）${F.years[0]}–${F.years[F.years.length - 1]}年合計罰鍰收入：約 ${Util.fmtNum(Math.round(F.nationalTotal / 10000))} 萬元。`;
        } else {
          const amt = F.nationalByYear[yearOrTotal];
          let text = `全國（22縣市）${yearOrTotal}年合計罰鍰收入：約 ${Util.fmtNum(Math.round(amt / 10000))} 萬元。`;
          if (F.extraFirstYear && F.extraFirstYear.year === yearOrTotal) {
            text += `（${yearOrTotal}年另有全國性彙總數字供參考：國道公路建設管理基金 ${Util.fmtNum(Math.round(F.extraFirstYear.highwayFund / 10000))} 萬元、解繳國庫 ${Util.fmtNum(Math.round(F.extraFirstYear.remittedToTreasury / 10000))} 萬元、罰鍰總收入 ${Util.fmtNum(Math.round(F.extraFirstYear.totalRevenue / 10000))} 萬元，其餘年度資料來源尚未公布對應項目。）`;
          }
          noteEl.textContent = text;
        }
      }
    }
  }

  function exportFinesCsv() {
    if (!window.ENFORCEMENT_FINES || !ENFORCEMENT_FINES.years.length) return;
    const F = ENFORCEMENT_FINES;
    const counties = [...State.filters.counties];
    const totalsByCounty = new Map(F.totals.map(t => [t.county, t]));
    const rows = counties.filter(c => totalsByCounty.has(c)).map(c => {
      const t = totalsByCounty.get(c);
      const row = { 縣市: c };
      F.years.forEach(y => {
        const rec = F.records.find(r => r.year === y && r.county === c);
        row[`${y}年(元)`] = rec ? rec.amount : '';
      });
      row['合計(元)'] = t.total;
      row['排名'] = t.rank;
      return row;
    }).sort((a, b) => (a['排名'] ?? 999) - (b['排名'] ?? 999));
    if (rows.length === 0) { alert('目前縣市篩選條件下沒有符合的資料可以匯出'); return; }
    const cols = [
      { key: '縣市', label: '縣市' },
      ...F.years.map(y => ({ key: `${y}年(元)`, label: `${y}年(元)`, numeric: true })),
      { key: '合計(元)', label: '合計(元)', numeric: true },
      { key: '排名', label: '排名', numeric: true },
    ];
    const csv = Util.toCsv(rows, cols);
    Util.downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `各縣市道路交通違規罰鍰收入_${Date.now()}.csv`);
  }

  function renderPopulationTab(accidents) {
    const sidebarCounties = [...State.filters.counties];
    const popCountySel = document.getElementById('popCountySelect');
    const focusCounty = popCountySel ? popCountySel.value : '';
    // 「縣市」下拉為本頁專屬的篩選條件：選定特定縣市時，下方兩圖只顯示該縣市
    // （不受側邊欄縣市勾選影響）；選「全部」則沿用側邊欄目前勾選的縣市。
    const counties = focusCounty ? [focusCounty] : sidebarCounties;
    const popAccTypeSel = document.getElementById('popAccTypeSelect');
    const accType = popAccTypeSel ? popAccTypeSel.value : '';

    const year = Number(document.getElementById('popYearSelect').value);
    Charts.renderPopRate(counties, year, accType);

    const densityYearSel = document.getElementById('densityYearSelect');
    const densityYear = densityYearSel ? densityYearSel.value : 'all';
    const densityLabelToggle = document.getElementById('densityShowLabelsToggle');
    const densityShowLabels = !!(densityLabelToggle && densityLabelToggle.checked);
    Charts.renderDensityScatter(counties, densityYear, densityShowLabels, accType);

    Charts.renderLongTrend(sidebarCounties);
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
      case 'improve': Improve.render(); break;
      case 'audit': Audit.render(); break;
      case 'tenders': Tenders.render(); break;
      case 'table': renderTableTab(accidents); break;
      case 'ai': AIAssistant.render(); break;
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

    document.getElementById('enfCategorySelect').innerHTML = META.enforcementCategories
      .map(c => `<option value="${c}">${c === '總件數' ? '全部（各類加總）' : c}</option>`).join('');
    // 「總件數」本身就是該縣市/年度其餘 8 類舉發件數的加總（已核對數字一致），
    // 故直接沿用此既有分類做為「全部」選項，不另外新增重複的加總邏輯；並設為預設選項。
    document.getElementById('enfCategorySelect').value = '總件數';
    document.getElementById('enfCategorySelect').addEventListener('change', renderCurrentTab);

    const finesYearSel = document.getElementById('finesYearSelect');
    if (finesYearSel && window.ENFORCEMENT_FINES && ENFORCEMENT_FINES.years.length > 0) {
      const fy = ENFORCEMENT_FINES.years;
      finesYearSel.innerHTML = fy.map(y => `<option value="${y}">${y}年</option>`).join('') +
        `<option value="total">合計（${fy[0]}–${fy[fy.length - 1]}年）</option>`;
      finesYearSel.value = fy[fy.length - 1];
      finesYearSel.addEventListener('change', renderCurrentTab);
    }
    document.getElementById('finesExportCsv').addEventListener('click', exportFinesCsv);

    const popYears = META.accidentYears;
    document.getElementById('popYearSelect').innerHTML = popYears.map(y => `<option value="${y}">${y}年</option>`).join('');
    document.getElementById('popYearSelect').value = popYears[popYears.length - 1];
    document.getElementById('popYearSelect').addEventListener('change', renderCurrentTab);

    const densityYearSel = document.getElementById('densityYearSelect');
    if (densityYearSel) {
      densityYearSel.innerHTML = '<option value="all">全部年度</option>' +
        popYears.map(y => `<option value="${y}">${y}年</option>`).join('');
      densityYearSel.value = 'all';
      densityYearSel.addEventListener('change', renderCurrentTab);
    }
    const densityLabelToggle = document.getElementById('densityShowLabelsToggle');
    if (densityLabelToggle) densityLabelToggle.addEventListener('change', renderCurrentTab);

    const popCountySel = document.getElementById('popCountySelect');
    if (popCountySel) {
      popCountySel.innerHTML = '<option value="">全部（依側邊欄設定）</option>' +
        META.counties.map(c => `<option value="${c}">${c}</option>`).join('');
      popCountySel.value = '';
      popCountySel.addEventListener('change', renderCurrentTab);
    }
    const popAccTypeSel = document.getElementById('popAccTypeSelect');
    if (popAccTypeSel) {
      popAccTypeSel.innerHTML = '<option value="">全部事故類型</option>' +
        State.uniqueValues('accTypeMajor').map(t => `<option value="${t}">${t}</option>`).join('');
      popAccTypeSel.value = '';
      popAccTypeSel.addEventListener('change', renderCurrentTab);
    }
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

  // ---------------- 熱點查詢：依 799/1000 點位選擇 + 查詢按鈕，地圖顯示環域範圍 ----------------

  function hpColumnsFor(dataset) {
    const base = dataset === 'safety799'
      ? [
          { key: 'id', label: '編號' },
          { key: 'source', label: '資料來源' },
          { key: 'county', label: '縣市' },
          { key: 'township', label: '鄉鎮市區' },
          { key: 'position', label: '路口位置' },
          { key: 'address', label: '完整地址' },
        ]
      : dataset === 'techEnforcement'
      ? [
          { key: 'id', label: '編號' },
          { key: 'county', label: '縣市' },
          { key: 'township', label: '行政區' },
          { key: 'deviceType', label: '科技執法種類' },
          { key: 'loc', label: '設置地點' },
          { key: 'items', label: '取締項目' },
          { key: 'speedLimit', label: '速限' },
          { key: 'authority', label: '管轄單位' },
          { key: 'coordSourceLabel', label: '座標來源' },
        ]
      : [
          { key: 'id', label: '編號' },
          { key: 'county', label: '縣市' },
          { key: 'township', label: '鄉鎮市區' },
          { key: 'name', label: '路口名稱' },
          { key: 'rank', label: '原始排行', numeric: true },
          { key: 'count', label: '原始件數', numeric: true },
          { key: 'deaths', label: '原始死亡', numeric: true },
          { key: 'injuries', label: '原始受傷', numeric: true },
        ];
    return base.concat([
      { key: 'a1Count', label: 'A1件數(半徑內)', numeric: true },
      { key: 'a1Deaths', label: 'A1死亡', numeric: true },
      { key: 'a1Injuries', label: 'A1受傷', numeric: true },
      { key: 'a2Count', label: 'A2件數(半徑內)', numeric: true },
      { key: 'a2Injuries', label: 'A2受傷', numeric: true },
      { key: 'a2Precision', label: 'A2統計方式' },
      { key: 'lat', label: '緯度' },
      { key: 'lng', label: '經度' },
    ]);
  }

  function setupHotspotQuery() {
    const datasetSel = document.getElementById('hpDatasetSelect');
    const countySel = document.getElementById('hpCountySelect');
    const townshipSel = document.getElementById('hpTownshipSelect');
    const searchInput = document.getElementById('hpSearchInput');
    const pointSel = document.getElementById('hpPointSelect');
    const radiusInput = document.getElementById('hpRadiusInput');
    const radiusPresets = document.getElementById('hpRadiusPresets');
    const queryBtn = document.getElementById('hpQueryBtn');
    const exportBtn = document.getElementById('hpExportBtn');
    const resultRow = document.getElementById('hpResultRow');
    const resultText = document.getElementById('hpResultText');
    const clearBtn = document.getElementById('hpClearBtn');

    countySel.innerHTML = '<option value="">全部縣市</option>' + META.counties.map(c => `<option value="${c}">${c}</option>`).join('');
    radiusPresets.innerHTML = META.bufferRadii.map(r => `<option value="${r}">`).join('');

    function labelFor(p, dataset) {
      const nameLike = dataset === 'safety799' ? (p.position || p.address || p.id) : (p.name || p.id);
      return `${p.county || ''}${p.township || ''} ${nameLike}`;
    }

    function currentFilteredPoints() {
      const dataset = datasetSel.value;
      const county = countySel.value;
      const township = townshipSel.value;
      const kw = searchInput.value.trim().toLowerCase();
      const pts = State.pointsByDataset(dataset);
      return pts.filter(p => {
        if (county && p.county !== county) return false;
        if (township && p.township !== township) return false;
        if (!kw) return true;
        const hay = [p.name, p.position, p.address, p.township, p.county].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(kw);
      });
    }

    function refreshTownshipOptions() {
      const dataset = datasetSel.value;
      const county = countySel.value;
      const pts = State.pointsByDataset(dataset).filter(p => !county || p.county === county);
      const townships = Array.from(new Set(pts.map(p => p.township).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-Hant'));
      const prev = townshipSel.value;
      townshipSel.innerHTML = '<option value="">全部鄉鎮市區</option>' + townships.map(t => `<option value="${t}">${t}</option>`).join('');
      townshipSel.value = townships.includes(prev) ? prev : '';
    }

    const MAP_DRAW_CAP = 300;

    function refreshPointOptions() {
      const dataset = datasetSel.value;
      const filtered = currentFilteredPoints();
      const limited = filtered.slice(0, 300);
      const blankOpt = `<option value="">（不指定單一點位，直接依上方篩選條件查詢／匯出全部 ${filtered.length} 筆）</option>`;
      pointSel.innerHTML = blankOpt + limited.map(p => `<option value="${p.id}">${labelFor(p, dataset)}</option>`).join('');
      if (filtered.length > limited.length) {
        const opt = document.createElement('option');
        opt.disabled = true;
        opt.textContent = `…符合 ${filtered.length} 筆，僅顯示前 ${limited.length} 筆可選，請輸入關鍵字或選擇縣市／鄉鎮縮小範圍以選擇單一點位`;
        pointSel.appendChild(opt);
      }
      pointSel.value = '';
    }

    datasetSel.addEventListener('change', () => {
      countySel.value = '';
      refreshTownshipOptions();
      refreshPointOptions();
    });
    countySel.addEventListener('change', () => {
      refreshTownshipOptions();
      refreshPointOptions();
    });
    townshipSel.addEventListener('change', refreshPointOptions);
    searchInput.addEventListener('input', refreshPointOptions);

    refreshTownshipOptions();
    refreshPointOptions();

    queryBtn.addEventListener('click', () => {
      const dataset = datasetSel.value;
      const pointId = pointSel.value;
      const radius = Number(radiusInput.value);
      if (!isFinite(radius) || radius <= 0) { alert('請輸入有效的半徑（公尺）'); return; }

      if (pointId) {
        // 指定單一點位：畫出該點位的環域圓圈並顯示該點位的統計
        const pts = State.pointsByDataset(dataset);
        const p = pts.find(x => x.id === pointId);
        if (!p) return;
        const s = State.pointStatsAtRadius(p, radius);
        MapView.setCustomPoint(p.lat, p.lng, radius);
        const label = labelFor(p, dataset);
        const precisionNote = s.exactA2 ? '〔精確統計〕' : '〔A1精確／A2為概略估算，如需精確請將半徑設為 50/100/200/300/500/1000 公尺〕';
        resultText.textContent = `${label}｜半徑 ${radius}m 內：A1 ${Util.fmtNum(s.a1Count)} 件（死亡 ${s.a1Deaths}／受傷 ${s.a1Injuries}）／A2 ${Util.fmtNum(s.a2Count)} 件（受傷 ${Util.fmtNum(s.a2Injuries)}）${precisionNote}`;
      } else {
        // 未指定單一點位：依目前縣市／鄉鎮／關鍵字篩選，一次查詢所有符合的點位。
        // 這裡用「去重」的合計方式（同一筆事故／同一個 A2 網格只要落在任一點位半徑內就算一次），
        // 避免點位彼此靠近時，同一筆資料被每個點位各自的環域重複計入、導致總數失真膨脹。
        const pts = currentFilteredPoints();
        if (pts.length === 0) { alert('目前的縣市／鄉鎮／關鍵字篩選條件下沒有符合的點位'); return; }
        const agg = State.aggregateBufferStats(pts, radius);
        MapView.setCustomPoints(pts.slice(0, MAP_DRAW_CAP).map(p => ({ lat: p.lat, lng: p.lng })), radius);
        const scopeLabel = [countySel.value, townshipSel.value].filter(Boolean).join('') || '全部';
        const capNote = pts.length > MAP_DRAW_CAP ? `（地圖僅顯示前 ${MAP_DRAW_CAP} 個點位的範圍圈，統計已包含全部 ${pts.length} 個點位）` : '';
        resultText.textContent = `${scopeLabel}（共 ${pts.length} 個點位，範圍已去重不重複計算）合計｜半徑 ${radius}m 內：A1 ${Util.fmtNum(agg.a1Count)} 件（死亡 ${agg.a1Deaths}／受傷 ${agg.a1Injuries}）／A2 ${Util.fmtNum(agg.a2Count)} 件（受傷 ${Util.fmtNum(agg.a2Injuries)}）〔A1精確／A2為概略估算〕${capNote}`;
      }
      resultRow.hidden = false;
      if (document.querySelector('.tab-btn[data-tab="map"]') && currentTab !== 'map') {
        document.querySelector('.tab-btn[data-tab="map"]').click();
      }
    });

    clearBtn.addEventListener('click', () => {
      MapView.clearCustomPoint();
      resultRow.hidden = true;
    });

    exportBtn.addEventListener('click', () => {
      const dataset = datasetSel.value;
      const radius = Number(radiusInput.value);
      if (!isFinite(radius) || radius <= 0) { alert('請輸入有效的半徑（公尺）'); return; }
      const pts = currentFilteredPoints();
      if (pts.length === 0) { alert('目前的縣市／鄉鎮／關鍵字篩選條件下沒有符合的點位可以匯出'); return; }
      const rows = pts.map(p => {
        const s = State.pointStatsAtRadius(p, radius);
        return Object.assign({}, p, {
          a1Count: s.a1Count, a1Deaths: s.a1Deaths, a1Injuries: s.a1Injuries,
          a2Count: s.a2Count, a2Injuries: s.a2Injuries,
          a2Precision: s.exactA2 ? '精確' : '概略估算',
        });
      });
      const cols = hpColumnsFor(dataset);
      const csv = Util.toCsv(rows, cols);
      const label = dataset === 'safety799' ? '人行安全補助799處'
        : dataset === 'techEnforcement' ? '科技執法設備地點'
        : '易肇事路口1000處';
      const scope = [countySel.value, townshipSel.value].filter(Boolean).join('') || '全部';
      Util.downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${label}_${scope}_半徑${radius}m環域統計_${Date.now()}.csv`);
    });
  }

  // ---------------- 易肇事路口科技執法涵蓋查詢（地圖分頁）----------------
  // 與「熱點查詢」方向相反：熱點查詢是「點位半徑內有多少事故」，這裡是「點位半徑內有多少科技執法設備」。

  function tcColumnsFor(dataset) {
    const base = dataset === 'safety799'
      ? [
          { key: 'id', label: '編號' },
          { key: 'source', label: '資料來源' },
          { key: 'county', label: '縣市' },
          { key: 'township', label: '鄉鎮市區' },
          { key: 'position', label: '路口位置' },
          { key: 'address', label: '完整地址' },
        ]
      : [
          { key: 'id', label: '編號' },
          { key: 'county', label: '縣市' },
          { key: 'township', label: '鄉鎮市區' },
          { key: 'name', label: '路口名稱' },
          { key: 'rank', label: '原始排行', numeric: true },
        ];
    return base.concat([
      { key: 'techCount', label: '半徑內科技執法點位數', numeric: true },
      { key: 'nearestM', label: '最近一處科技執法設備距離(公尺)', numeric: true, value: r => r.nearestM == null ? '' : Math.round(r.nearestM) },
      { key: 'lat', label: '緯度' },
      { key: 'lng', label: '經度' },
    ]);
  }

  function setupTechCoverageQuery() {
    const datasetSel = document.getElementById('tcDatasetSelect');
    const countySel = document.getElementById('tcCountySelect');
    const townshipSel = document.getElementById('tcTownshipSelect');
    const searchInput = document.getElementById('tcSearchInput');
    const pointSel = document.getElementById('tcPointSelect');
    const radiusInput = document.getElementById('tcRadiusInput');
    const queryBtn = document.getElementById('tcQueryBtn');
    const exportBtn = document.getElementById('tcExportBtn');
    const resultRow = document.getElementById('tcResultRow');
    const resultText = document.getElementById('tcResultText');
    const clearBtn = document.getElementById('tcClearBtn');
    const deviceTable = document.getElementById('tcDeviceTable');

    countySel.innerHTML = '<option value="">全部縣市</option>' + META.counties.map(c => `<option value="${c}">${c}</option>`).join('');

    function labelFor(p, dataset) {
      const nameLike = dataset === 'safety799' ? (p.position || p.address || p.id) : (p.name || p.id);
      return `${p.county || ''}${p.township || ''} ${nameLike}`;
    }

    function currentFilteredPoints() {
      const dataset = datasetSel.value;
      const county = countySel.value;
      const township = townshipSel.value;
      const kw = searchInput.value.trim().toLowerCase();
      const pts = State.pointsByDataset(dataset);
      return pts.filter(p => {
        if (county && p.county !== county) return false;
        if (township && p.township !== township) return false;
        if (!kw) return true;
        const hay = [p.name, p.position, p.address, p.township, p.county].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(kw);
      });
    }

    function refreshTownshipOptions() {
      const dataset = datasetSel.value;
      const county = countySel.value;
      const pts = State.pointsByDataset(dataset).filter(p => !county || p.county === county);
      const townships = Array.from(new Set(pts.map(p => p.township).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-Hant'));
      const prev = townshipSel.value;
      townshipSel.innerHTML = '<option value="">全部鄉鎮市區</option>' + townships.map(t => `<option value="${t}">${t}</option>`).join('');
      townshipSel.value = townships.includes(prev) ? prev : '';
    }

    const MAP_DRAW_CAP = 300;
    const DEVICE_TABLE_CAP = 500;

    function refreshPointOptions() {
      const dataset = datasetSel.value;
      const filtered = currentFilteredPoints();
      const limited = filtered.slice(0, 300);
      const blankOpt = `<option value="">（不指定單一點位，直接依上方篩選條件合計查詢／匯出全部 ${filtered.length} 筆）</option>`;
      pointSel.innerHTML = blankOpt + limited.map(p => `<option value="${p.id}">${labelFor(p, dataset)}</option>`).join('');
      if (filtered.length > limited.length) {
        const opt = document.createElement('option');
        opt.disabled = true;
        opt.textContent = `…符合 ${filtered.length} 筆，僅顯示前 ${limited.length} 筆可選，請輸入關鍵字或選擇縣市／鄉鎮縮小範圍以選擇單一點位`;
        pointSel.appendChild(opt);
      }
      pointSel.value = '';
    }

    datasetSel.addEventListener('change', () => {
      countySel.value = '';
      refreshTownshipOptions();
      refreshPointOptions();
    });
    countySel.addEventListener('change', () => {
      refreshTownshipOptions();
      refreshPointOptions();
    });
    townshipSel.addEventListener('change', refreshPointOptions);
    searchInput.addEventListener('input', refreshPointOptions);

    refreshTownshipOptions();
    refreshPointOptions();

    function clearTableNote() {
      const prevNote = deviceTable.nextElementSibling;
      if (prevNote && prevNote.tagName === 'P' && prevNote.dataset.tcNote) prevNote.remove();
    }

    function renderDeviceTable(devices) {
      clearTableNote();
      const shown = devices.slice(0, DEVICE_TABLE_CAP);
      if (shown.length === 0) {
        deviceTable.innerHTML = '<thead><tr><th>查詢結果</th></tr></thead><tbody><tr><td>（半徑內查無科技執法設備）</td></tr></tbody>';
        return;
      }
      const cols = [
        { key: 'distanceM', label: '距離(公尺)' },
        { key: 'county', label: '縣市' },
        { key: 'district', label: '行政區' },
        { key: 'deviceType', label: '科技執法種類' },
        { key: 'loc', label: '設置地點' },
        { key: 'coordSourceLabel', label: '座標來源' },
      ];
      const thead = '<thead><tr>' + cols.map(c => `<th>${c.label}</th>`).join('') + '</tr></thead>';
      const tbody = '<tbody>' + shown.map(d => '<tr>' + cols.map(c => {
        const v = c.key === 'distanceM' ? Math.round(d.distanceM).toLocaleString() : (d[c.key] ?? '');
        return `<td>${v}</td>`;
      }).join('') + '</tr>').join('') + '</tbody>';
      deviceTable.innerHTML = thead + tbody;
      if (devices.length > DEVICE_TABLE_CAP) {
        const note = document.createElement('p');
        note.className = 'hint';
        note.dataset.tcNote = '1';
        note.textContent = `共 ${devices.length.toLocaleString()} 處，表格僅列出距離最近的前 ${DEVICE_TABLE_CAP} 處（上方統計數字為完整合計，未被截斷）`;
        deviceTable.after(note);
      }
    }

    queryBtn.addEventListener('click', () => {
      const dataset = datasetSel.value;
      const pointId = pointSel.value;
      const radius = Number(radiusInput.value);
      if (!isFinite(radius) || radius <= 0) { alert('請輸入有效的半徑（公尺）'); return; }

      if (pointId) {
        // 指定單一路口／點位：查該點位半徑內有幾處科技執法設備
        const pts = State.pointsByDataset(dataset);
        const p = pts.find(x => x.id === pointId);
        if (!p) return;
        const s = State.techEnfWithinRadius(p, radius);
        MapView.setPointWithDeviceMarkers(p.lat, p.lng, radius, s.devices);
        const label = labelFor(p, dataset);
        const nearestNote = s.nearestM == null ? '' : `／全部科技執法設備中最近一處距離約 ${Math.round(s.nearestM).toLocaleString()} 公尺`;
        resultText.textContent = `${label}｜半徑 ${radius}m 內共有 ${Util.fmtNum(s.count)} 處科技執法設備${nearestNote}`;
        renderDeviceTable(s.devices);
      } else {
        // 未指定單一點位：依目前縣市／鄉鎮／關鍵字篩選，一次查詢所有符合的點位。
        // 同一處科技執法設備若同時落在多個點位半徑內，只算一次（去重），避免點位彼此靠近時重複膨脹。
        const pts = currentFilteredPoints();
        if (pts.length === 0) { alert('目前的縣市／鄉鎮／關鍵字篩選條件下沒有符合的點位'); return; }
        const agg = State.aggregateTechEnfCoverage(pts, radius);
        MapView.setAggregateWithDeviceMarkers(pts, radius, agg.devices, MAP_DRAW_CAP);
        const scopeLabel = [countySel.value, townshipSel.value].filter(Boolean).join('') || '全部';
        const capNote = pts.length > MAP_DRAW_CAP ? `（地圖僅顯示前 ${MAP_DRAW_CAP} 個點位的範圍圈，統計已包含全部 ${pts.length} 個點位）` : '';
        resultText.textContent = `${scopeLabel}（共 ${pts.length} 個點位，設備已去重不重複計算）合計｜半徑 ${radius}m 內共涵蓋 ${Util.fmtNum(agg.count)} 處科技執法設備${capNote}`;
        renderDeviceTable(agg.devices);
      }
      resultRow.hidden = false;
      if (document.querySelector('.tab-btn[data-tab="map"]') && currentTab !== 'map') {
        document.querySelector('.tab-btn[data-tab="map"]').click();
      }
    });

    clearBtn.addEventListener('click', () => {
      MapView.clearCustomPoint();
      resultRow.hidden = true;
      clearTableNote();
      deviceTable.innerHTML = '';
    });

    exportBtn.addEventListener('click', () => {
      const dataset = datasetSel.value;
      const pointId = pointSel.value;
      const radius = Number(radiusInput.value);
      if (!isFinite(radius) || radius <= 0) { alert('請輸入有效的半徑（公尺）'); return; }

      if (pointId) {
        // 已選單一路口／點位：匯出「該路口半徑內」的科技執法設備明細清單（與畫面上顯示的表格內容一致），
        // 而不是不管有沒有選點位、半徑設多少，都匯出整份清單的彙總統計（此為先前版本的問題）。
        const pts = State.pointsByDataset(dataset);
        const p = pts.find(x => x.id === pointId);
        if (!p) return;
        const s = State.techEnfWithinRadius(p, radius);
        if (s.devices.length === 0) { alert(`「${labelFor(p, dataset)}」半徑 ${radius}m 內查無科技執法設備，沒有可匯出的明細（可放大半徑後再匯出）`); return; }
        const rows = s.devices.map(d => Object.assign({}, d, { distanceM: Math.round(d.distanceM) }));
        const cols = [
          { key: 'distanceM', label: '距離查詢中心點(公尺)' },
          { key: 'county', label: '縣市' },
          { key: 'district', label: '行政區' },
          { key: 'deviceType', label: '科技執法種類' },
          { key: 'loc', label: '設置地點' },
          { key: 'items', label: '取締項目' },
          { key: 'coordSourceLabel', label: '座標來源' },
          { key: 'lat', label: '緯度' },
          { key: 'lng', label: '經度' },
        ];
        const csv = Util.toCsv(rows, cols);
        const safeLabel = labelFor(p, dataset).replace(/[\\/:*?"<>|]/g, '_');
        Util.downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${safeLabel}_半徑${radius}m內科技執法設備明細_${Date.now()}.csv`);
        return;
      }

      // 未指定單一點位：維持「每個路口一列＋該半徑下的涵蓋統計」彙總匯出（供整批比對用）
      const pts = currentFilteredPoints();
      if (pts.length === 0) { alert('目前的縣市／鄉鎮／關鍵字篩選條件下沒有符合的點位可以匯出'); return; }
      const rows = pts.map(p => {
        const s = State.techEnfWithinRadius(p, radius);
        return Object.assign({}, p, { techCount: s.count, nearestM: s.nearestM });
      });
      const cols = tcColumnsFor(dataset);
      const csv = Util.toCsv(rows, cols);
      const label = dataset === 'safety799' ? '人行安全補助799處' : '易肇事路口1000處';
      const scope = [countySel.value, townshipSel.value].filter(Boolean).join('') || '全部';
      Util.downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${label}_${scope}_半徑${radius}m科技執法涵蓋統計_${Date.now()}.csv`);
    });
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
    setupHotspotQuery();
    setupTechCoverageQuery();
    renderA2DownloadList();
    MapView.init();
    Hotspot.init();
    Improve.init();
    Audit.init();
    Tenders.init();
    AIAssistant.init();

    State.onChange(() => { tablePage = 1; renderCurrentTab(); });
    renderCurrentTab();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
