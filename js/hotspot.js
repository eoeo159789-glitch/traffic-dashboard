// ============================================================
// 熱點環域分析分頁：1000易肇事路口 / 799人行安全補助點位
// 選擇半徑後即時計算每個點位在該半徑內的 A1／A2 事故統計，並可排序、篩選、匯出
// ============================================================
const Hotspot = (() => {
  let hsState = { dataset: 'hotspot1000', radius: 200, county: '', search: '', sortKey: null, sortDir: 1, page: 1 };
  const PAGE_SIZE = 50;

  function columnsFor(dataset) {
    if (dataset === 'safety799') {
      return [
        { key: 'id', label: '編號' },
        { key: 'source', label: '資料來源' },
        { key: 'county', label: '縣市' },
        { key: 'township', label: '鄉鎮市區' },
        { key: 'position', label: '路口位置' },
        { key: 'address', label: '完整地址' },
        { key: 'a1Count', label: `A1件數(半徑內)`, numeric: true },
        { key: 'a1Deaths', label: 'A1死亡', numeric: true },
        { key: 'a1Injuries', label: 'A1受傷', numeric: true },
        { key: 'a2Count', label: 'A2件數(半徑內)', numeric: true },
        { key: 'a2Injuries', label: 'A2受傷', numeric: true },
        { key: 'lat', label: '緯度' },
        { key: 'lng', label: '經度' },
      ];
    }
    if (dataset === 'techEnforcement') {
      return [
        { key: 'id', label: '編號' },
        { key: 'county', label: '縣市' },
        { key: 'district', label: '行政區' },
        { key: 'deviceType', label: '科技執法種類' },
        { key: 'loc', label: '設置地點' },
        { key: 'items', label: '取締項目' },
        { key: 'speedLimit', label: '速限' },
        { key: 'authority', label: '管轄單位' },
        { key: 'a1Count', label: 'A1件數(半徑內)', numeric: true },
        { key: 'a1Deaths', label: 'A1死亡', numeric: true },
        { key: 'a1Injuries', label: 'A1受傷', numeric: true },
        { key: 'a2Count', label: 'A2件數(半徑內)', numeric: true },
        { key: 'a2Injuries', label: 'A2受傷', numeric: true },
        { key: 'lat', label: '緯度' },
        { key: 'lng', label: '經度' },
      ];
    }
    return [
      { key: 'id', label: '編號' },
      { key: 'county', label: '縣市' },
      { key: 'township', label: '鄉鎮市區' },
      { key: 'name', label: '路口名稱' },
      { key: 'rank', label: '原始排行', numeric: true },
      { key: 'count', label: '原始件數', numeric: true },
      { key: 'deaths', label: '原始死亡', numeric: true },
      { key: 'injuries', label: '原始受傷', numeric: true },
      { key: 'a1Count', label: 'A1件數(半徑內)', numeric: true },
      { key: 'a1Deaths', label: 'A1死亡', numeric: true },
      { key: 'a1Injuries', label: 'A1受傷', numeric: true },
      { key: 'a2Count', label: 'A2件數(半徑內)', numeric: true },
      { key: 'a2Injuries', label: 'A2受傷', numeric: true },
      { key: 'lat', label: '緯度' },
      { key: 'lng', label: '經度' },
    ];
  }

  function withBuffer(points, radius) {
    return points.map(p => {
      const a1 = State.bufferA1For(p.id);
      const a2 = State.bufferA2For(p.id);
      const b1 = a1 && a1[radius] ? a1[radius] : [0, 0, 0];
      const b2 = a2 && a2[radius] ? a2[radius] : [0, 0];
      return Object.assign({}, p, {
        a1Count: b1[0], a1Deaths: b1[1], a1Injuries: b1[2],
        a2Count: b2[0], a2Injuries: b2[1],
      });
    });
  }

  function filteredRows() {
    const raw = State.pointsByDataset(hsState.dataset);
    const withStats = withBuffer(raw, hsState.radius);
    const kw = hsState.search.trim().toLowerCase();
    return withStats.filter(r => {
      if (hsState.county && r.county !== hsState.county) return false;
      if (!kw) return true;
      const hay = [r.name, r.position, r.address, r.township, r.district, r.loc, r.items, r.deviceType]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(kw);
    });
  }

  function sortedRows(rows) {
    if (!hsState.sortKey) return rows;
    const k = hsState.sortKey, dir = hsState.sortDir;
    return rows.slice().sort((a, b) => {
      const av = a[k], bv = b[k];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv), 'zh-Hant') * dir;
    });
  }

  function setupControls() {
    const radiusSel = document.getElementById('hsRadiusSelect');
    radiusSel.innerHTML = META.bufferRadii.map(r => `<option value="${r}">${r} 公尺</option>`).join('');
    radiusSel.value = hsState.radius;

    const countySel = document.getElementById('hsCountySelect');
    countySel.innerHTML = '<option value="">全部縣市</option>' + META.counties.map(c => `<option value="${c}">${c}</option>`).join('');

    document.getElementById('hsDatasetSelect').addEventListener('change', e => {
      hsState.dataset = e.target.value; hsState.page = 1; hsState.sortKey = null; render();
    });
    radiusSel.addEventListener('change', e => { hsState.radius = Number(e.target.value); render(); });
    countySel.addEventListener('change', e => { hsState.county = e.target.value; hsState.page = 1; render(); });
    document.getElementById('hsSearchInput').addEventListener('input', e => { hsState.search = e.target.value; hsState.page = 1; render(); });
    document.getElementById('hsExportCsv').addEventListener('click', exportCsv);
  }

  function render() {
    if (!window.META || !META.bufferRadii) return; // 資料尚未載入
    const cols = columnsFor(hsState.dataset);
    let rows = sortedRows(filteredRows());
    document.getElementById('hsFilteredCount').textContent = rows.length.toLocaleString();

    const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (hsState.page > totalPages) hsState.page = totalPages;
    const start = (hsState.page - 1) * PAGE_SIZE;
    const pageRows = rows.slice(start, start + PAGE_SIZE);

    const table = document.getElementById('hsTable');
    const thead = '<thead><tr>' + cols.map(c => {
      const active = hsState.sortKey === c.key;
      const arrow = active ? (hsState.sortDir === 1 ? ' ▲' : ' ▼') : '';
      return `<th data-sort="${c.key}" style="cursor:pointer;white-space:nowrap">${c.label}${arrow}</th>`;
    }).join('') + '</tr></thead>';
    const tbody = '<tbody>' + pageRows.map(r => '<tr>' + cols.map(c => {
      let v = r[c.key];
      if (typeof v === 'number' && c.numeric) v = Util.fmtNum(v);
      return `<td>${v ?? ''}</td>`;
    }).join('') + '</tr>').join('') + '</tbody>';
    table.innerHTML = thead + tbody;

    table.querySelectorAll('th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (hsState.sortKey === key) hsState.sortDir *= -1;
        else { hsState.sortKey = key; hsState.sortDir = 1; }
        render();
      });
    });

    document.getElementById('hsPagination').innerHTML = `
      <button class="btn" id="hsPgPrev" ${hsState.page <= 1 ? 'disabled' : ''}>← 上一頁</button>
      <span>第 ${hsState.page} / ${totalPages} 頁（共 ${Util.fmtNum(rows.length)} 筆）</span>
      <button class="btn" id="hsPgNext" ${hsState.page >= totalPages ? 'disabled' : ''}>下一頁 →</button>
    `;
    const prev = document.getElementById('hsPgPrev'), next = document.getElementById('hsPgNext');
    if (prev) prev.onclick = () => { hsState.page--; render(); };
    if (next) next.onclick = () => { hsState.page++; render(); };
  }

  function exportCsv() {
    const cols = columnsFor(hsState.dataset);
    const rows = sortedRows(filteredRows());
    const csv = Util.toCsv(rows, cols);
    const label = hsState.dataset === 'safety799' ? '人行安全補助799處'
      : hsState.dataset === 'techEnforcement' ? '科技執法設備地點'
      : '易肇事路口1000處';
    Util.downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${label}_半徑${hsState.radius}m環域統計_${Date.now()}.csv`);
  }

  function init() {
    setupControls();
    render();
  }

  return { init, render };
})();
