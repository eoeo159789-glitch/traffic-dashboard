// ============================================================
// 稽核工作站：跨資料集異常偵測、待查／可疑案件清單、審計意見 vs 標案交叉比對
// ------------------------------------------------------------
// 目的：讓稽核／審計人員能快速從龐雜的事故、舉發、罰鍰、標案、審計意見資料中，
// 篩出「數值明顯偏離常態」或「有意見卻查無對應標案」的組合，作為優先查核的
// 起點清單，而不是逐頁、逐縣市自行比對。
//
// 方法論說明（請務必留意，避免誤讀統計結果）：
//   - 年增率異常：只在「年度相鄰」（例如 2024→2025）且「前一年數值不為 0」時
//     計算年增率，再對「全部縣市 × 全部年度」的年增率分布算 z 分數；
//     |z| 越大代表該縣市當年度的變化幅度，相對其他縣市/年度而言越不尋常。
//   - 標案金額離群值：同一個標案分類內，先取金額的自然對數（降低金額本身
//     右偏分布 -- 少數超大型標案 -- 對平均值的影響），再算 z 分數。
//   - 人口/事故密度離群縣市：沿用「事故 vs 人口/縣市」頁密度象限圖同一套
//     密度算法，計算各縣市在（人口密度, 事故密度）平面上，相對全國平均值的
//     標準化距離。
//   以上全部屬於「統計上偏離平均」，不代表必然有弊端、違規或因果關係，僅供
//   縮小查核範圍之用，仍須人工判讀原始資料與情境。
// ============================================================
const Audit = (() => {
  const DEFAULT_THRESHOLD = 2;
  let lastAnomalies = [];
  let lastCrossRows = [];

  // ---------------- 基礎統計 ----------------

  function meanStd(arr) {
    if (!arr.length) return { mean: 0, std: 0 };
    const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
    const variance = arr.reduce((s, v) => s + (v - mean) * (v - mean), 0) / arr.length;
    return { mean, std: Math.sqrt(variance) };
  }
  function zOf(v, mean, std) { return std > 0 ? (v - mean) / std : 0; }
  function severityOf(absZ, threshold) {
    if (absZ >= threshold + 1) return 'high';
    if (absZ >= threshold + 0.4) return 'medium';
    return 'low';
  }
  const SEV_LABEL = { high: '高', medium: '中', low: '低' };

  // ---------------- 年增率異常：A1 事故件數 / 舉發總件數 / 罰鍰收入 ----------------

  function a1Pairs() {
    const map = new Map();
    ACCIDENTS.forEach(a => {
      const key = a.county + '|' + a.year;
      map.set(key, (map.get(key) || 0) + 1);
    });
    const out = [];
    META.counties.forEach(c => META.accidentYears.forEach(y => {
      out.push({ county: c, year: y, value: map.get(c + '|' + y) || 0 });
    }));
    return out;
  }

  function enfPairs() {
    const map = new Map();
    (window.ENFORCEMENT || []).forEach(e => {
      if (e.county === '__TOTAL__' || e.category !== '總件數') return;
      const key = e.county + '|' + e.year;
      map.set(key, (map.get(key) || 0) + e.count);
    });
    const out = [];
    META.counties.forEach(c => META.enforcementYears.forEach(y => {
      out.push({ county: c, year: y, value: map.get(c + '|' + y) || 0 });
    }));
    return out;
  }

  function finesPairs() {
    if (!window.ENFORCEMENT_FINES) return [];
    return ENFORCEMENT_FINES.records.map(r => ({ county: r.county, year: r.year, value: r.amount || 0 }));
  }

  function yoyAnomalies(pairs, typeKey, typeLabel, threshold) {
    const byCounty = new Map();
    pairs.forEach(p => {
      if (!byCounty.has(p.county)) byCounty.set(p.county, new Map());
      byCounty.get(p.county).set(p.year, p.value);
    });
    const changes = [];
    byCounty.forEach((yearMap, county) => {
      const years = [...yearMap.keys()].sort((a, b) => a - b);
      for (let i = 1; i < years.length; i++) {
        const y0 = years[i - 1], y1 = years[i];
        if (y1 - y0 !== 1) continue;
        const v0 = yearMap.get(y0), v1 = yearMap.get(y1);
        if (!v0) continue;
        changes.push({ county, prevYear: y0, year: y1, v0, v1, pct: (v1 - v0) / v0 });
      }
    });
    const { mean, std } = meanStd(changes.map(c => c.pct));
    const out = [];
    changes.forEach(c => {
      const z = zOf(c.pct, mean, std);
      const absZ = Math.abs(z);
      if (absZ < threshold) return;
      out.push({
        id: `${typeKey}__${c.county}__${c.year}`,
        typeLabel, county: c.county, year: c.year,
        z, absZ, severity: severityOf(absZ, threshold),
        detail: `${c.prevYear}年 ${Util.fmtNum(c.v0)} → ${c.year}年 ${Util.fmtNum(c.v1)}（年增率 ${Util.fmtPct(c.pct)}，z=${z.toFixed(2)}）`,
      });
    });
    return out;
  }

  // ---------------- 標案金額離群值（同分類、對數 z 分數） ----------------

  function tenderOutliers(threshold) {
    if (!window.TENDERS) return [];
    const byCat = new Map();
    TENDERS.records.forEach(r => {
      if (!r.totalAmount || r.totalAmount <= 0) return;
      if (!byCat.has(r.category)) byCat.set(r.category, []);
      byCat.get(r.category).push(r);
    });
    let out = [];
    byCat.forEach((records, category) => {
      const logs = records.map(r => Math.log(r.totalAmount));
      const { mean, std } = meanStd(logs);
      records.forEach((r, i) => {
        const z = zOf(logs[i], mean, std);
        const absZ = Math.abs(z);
        if (absZ < threshold) return;
        out.push({
          id: `tender_outlier__${category}__${r.performLocCounty || ''}__${r.awardYear || ''}__${out.length}`,
          typeLabel: '標案金額離群值', county: r.performLocCounty || '（查無比對結果）', year: r.awardYear || '—',
          z, absZ, severity: severityOf(absZ, threshold),
          detail: `分類「${category}」內與同分類標案金額比較（取對數後），z=${z.toFixed(2)}；${r.agency || '（未知機關）'}／${r.title || '(無標題)'}，決標金額 ${Util.fmtNum(r.totalAmount)} 元`,
        });
      });
    });
    out.sort((a, b) => b.absZ - a.absZ);
    return out.slice(0, 150);
  }

  // ---------------- 人口/事故密度離群縣市（沿用密度象限圖同一套面積換算） ----------------

  function indicatorValue(name, county, year) {
    const row = INDICATORS.find(i => i.indicator === name && i.county === county && i.year === year);
    return row ? row.value : null;
  }
  function computeAreaSqKm(county, year) {
    const male = indicatorValue('男性人口(人)', county, year);
    const female = indicatorValue('女性人口(人)', county, year);
    const dens = indicatorValue('人口密度(人/平方公里)', county, year);
    if (male == null || female == null || !dens) return null;
    return (male + female) / dens;
  }
  function densityOutliers(threshold) {
    const year = META.accidentYears[META.accidentYears.length - 1];
    const points = [];
    META.counties.forEach(c => {
      const area = computeAreaSqKm(c, year);
      const dens = indicatorValue('人口密度(人/平方公里)', c, year);
      if (area == null || dens == null) return;
      const accCount = ACCIDENTS.filter(a => a.county === c && a.year === year).length;
      points.push({ county: c, x: dens, y: accCount / area });
    });
    const { mean: mx, std: sx } = meanStd(points.map(p => p.x));
    const { mean: my, std: sy } = meanStd(points.map(p => p.y));
    const out = [];
    points.forEach(p => {
      const zx = zOf(p.x, mx, sx), zy = zOf(p.y, my, sy);
      const dist = Math.sqrt(zx * zx + zy * zy);
      if (dist < threshold) return;
      out.push({
        id: `density_outlier__${p.county}__${year}`,
        typeLabel: '人口/事故密度離群縣市', county: p.county, year,
        z: dist, absZ: dist, severity: severityOf(dist, threshold),
        detail: `${year}年 人口密度 ${Util.fmtNum(Math.round(p.x))} 人/km²（z=${zx.toFixed(2)}）、事故密度 ${p.y.toFixed(3)} 件/km²（z=${zy.toFixed(2)}），距全國平均的複合距離 ${dist.toFixed(2)}`,
      });
    });
    out.sort((a, b) => b.absZ - a.absZ);
    return out;
  }

  const DATASET_DEFS = {
    a1_yoy:          { label: 'A1 事故件數 年增率異常',      run: th => yoyAnomalies(a1Pairs(), 'a1_yoy', 'A1事故件數年增率', th) },
    enf_yoy:         { label: '舉發總件數 年增率異常',        run: th => yoyAnomalies(enfPairs(), 'enf_yoy', '舉發總件數年增率', th) },
    fines_yoy:       { label: '罰鍰收入 年增率異常',          run: th => yoyAnomalies(finesPairs(), 'fines_yoy', '罰鍰收入年增率', th) },
    tender_outlier:  { label: '標案金額離群值（同分類比較）', run: th => tenderOutliers(th) },
    density_outlier: { label: '人口/事故密度離群縣市',        run: th => densityOutliers(th) },
  };

  function runAnomalies(datasetKey, threshold) {
    if (datasetKey === 'all') {
      let all = [];
      Object.keys(DATASET_DEFS).forEach(k => { all = all.concat(DATASET_DEFS[k].run(threshold)); });
      all.sort((a, b) => b.absZ - a.absZ);
      return all.slice(0, 200);
    }
    const def = DATASET_DEFS[datasetKey];
    return def ? def.run(threshold) : [];
  }

  // ---------------- 審計意見 vs 標案 交叉比對 ----------------

  const TAG_TO_TENDER_CATS = {
    '道路安全與路口工程': ['道路工程', '標誌標線', '人行道', '道路改善', '拓寬工程'],
    '科技執法與監理': ['科技執法'],
  };

  function crossCheckRows() {
    if (!window.AUDIT_OPINIONS_TRAFFIC || !window.TENDERS) return [];
    return AUDIT_OPINIONS_TRAFFIC.map(o => {
      const comparableCats = new Set();
      (o.tags || []).forEach(t => (TAG_TO_TENDER_CATS[t] || []).forEach(c => comparableCats.add(c)));
      if (comparableCats.size === 0) {
        return Object.assign({}, o, { comparableCats: [], matchCount: 0, matchAmount: 0, verdict: 'not_comparable' });
      }
      const matches = TENDERS.records.filter(r =>
        r.performLocCounty === o.county &&
        comparableCats.has(r.category) &&
        r.awardYear != null && Math.abs(r.awardYear - o.year) <= 1
      );
      const matchAmount = matches.reduce((s, r) => s + (r.totalAmount || 0), 0);
      return Object.assign({}, o, {
        comparableCats: [...comparableCats],
        matchCount: matches.length, matchAmount,
        verdict: matches.length === 0 ? 'no_match' : 'has_match',
      });
    }).sort((a, b) => {
      const rank = { no_match: 0, has_match: 1, not_comparable: 2 };
      return rank[a.verdict] - rank[b.verdict] || b.n - a.n;
    });
  }

  const VERDICT_LABEL = {
    no_match: '<span class="sev-badge sev-high">有意見／查無對應標案</span>',
    has_match: '<span class="sev-badge sev-info">已有對應標案</span>',
    not_comparable: '<span class="sev-badge sev-low">標籤無法比對</span>',
  };

  // ---------------- 待查／可疑案件清單（localStorage） ----------------

  const WL_KEY = 'trafficAuditWatchlist_v1';
  function loadWatchlist() {
    try {
      const raw = localStorage.getItem(WL_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  }
  function saveWatchlist() {
    try { localStorage.setItem(WL_KEY, JSON.stringify(watchlist)); } catch (e) { /* 私密瀏覽模式等情況下可能失敗，忽略即可 */ }
  }
  let watchlist = loadWatchlist();

  function upsertWatchlist(entry) {
    const idx = watchlist.findIndex(w => w.id === entry.id);
    if (idx >= 0) {
      watchlist[idx].summary = entry.detail;
      watchlist[idx].type = entry.typeLabel;
      watchlist[idx].county = entry.county;
      watchlist[idx].year = entry.year;
    } else {
      watchlist.unshift({
        id: entry.id, type: entry.typeLabel, county: entry.county, year: entry.year,
        summary: entry.detail, status: '待查', note: '', addedAt: new Date().toISOString(),
      });
    }
    saveWatchlist();
  }
  function removeWatchlistItem(id) {
    watchlist = watchlist.filter(w => w.id !== id);
    saveWatchlist();
  }
  function watchlistHas(id) { return watchlist.some(w => w.id === id); }

  function exportWatchlistCsv() {
    if (!watchlist.length) { alert('待查清單目前是空的'); return; }
    const cols = [
      { key: 'type', label: '類型' }, { key: 'county', label: '縣市' }, { key: 'year', label: '年度' },
      { key: 'summary', label: '摘要' }, { key: 'status', label: '狀態' }, { key: 'note', label: '備註' },
      { key: 'addedAt', label: '加入時間' },
    ];
    const csv = Util.toCsv(watchlist, cols);
    Util.downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `稽核待查清單_${Date.now()}.csv`);
  }

  // ---------------- 渲染 ----------------

  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function renderAnomalyTable() {
    const datasetSel = document.getElementById('auditDatasetSelect');
    const sensSel = document.getElementById('auditSensitivitySelect');
    if (!datasetSel) return;
    const threshold = sensSel ? Number(sensSel.value) : DEFAULT_THRESHOLD;
    lastAnomalies = runAnomalies(datasetSel.value, threshold);
    const countEl = document.getElementById('auditAnomalyCount');
    if (countEl) countEl.textContent = `共 ${lastAnomalies.length} 筆${lastAnomalies.length >= 200 ? '（已達顯示上限，僅列出 |z| 最大的前 200 筆）' : ''}`;
    const table = document.getElementById('auditAnomalyTable');
    if (!table) return;
    if (!lastAnomalies.length) {
      table.innerHTML = '<tbody><tr><td class="hint" style="padding:16px 4px">目前資料集／敏感度設定下沒有偵測到異常。可嘗試調寬「敏感度」。</td></tr></tbody>';
      return;
    }
    table.innerHTML =
      '<thead><tr><th>類型</th><th>縣市</th><th>年度</th><th>嚴重度</th><th>說明</th><th></th></tr></thead><tbody>' +
      lastAnomalies.map((r, i) => `
        <tr>
          <td>${esc(r.typeLabel)}</td>
          <td>${esc(r.county)}</td>
          <td>${esc(r.year)}</td>
          <td><span class="sev-badge sev-${r.severity}">${SEV_LABEL[r.severity]}</span></td>
          <td>${esc(r.detail)}</td>
          <td>${watchlistHas(r.id)
            ? '<span class="hint">已在待查清單</span>'
            : `<button class="btn wl-add-btn" data-idx="${i}">＋ 加入待查</button>`}</td>
        </tr>
      `).join('') + '</tbody>';
    table.querySelectorAll('.wl-add-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const row = lastAnomalies[Number(btn.dataset.idx)];
        if (!row) return;
        upsertWatchlist(row);
        renderAnomalyTable();
        renderWatchlist();
      });
    });
  }

  function renderWatchlist() {
    const table = document.getElementById('auditWatchlistTable');
    if (!table) return;
    if (!watchlist.length) {
      table.innerHTML = '<tbody><tr><td class="hint" style="padding:16px 4px">目前待查清單是空的，可從上方「異常偵測」或下方「意見／標案交叉比對」加入項目。</td></tr></tbody>';
      return;
    }
    table.innerHTML =
      '<thead><tr><th>縣市</th><th>年度</th><th>類型</th><th>摘要</th><th>狀態</th><th>備註</th><th></th></tr></thead><tbody>' +
      watchlist.map((w, i) => `
        <tr>
          <td>${esc(w.county)}</td>
          <td>${esc(w.year)}</td>
          <td>${esc(w.type)}</td>
          <td>${esc(w.summary)}</td>
          <td>
            <select class="wl-status-select" data-idx="${i}">
              ${['待查', '已核閱', '已排除'].map(s => `<option value="${s}" ${w.status === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </td>
          <td><input class="wl-note-input" data-idx="${i}" type="text" value="${esc(w.note)}" placeholder="加入備註…"></td>
          <td><button class="btn wl-remove-btn" data-idx="${i}">移除</button></td>
        </tr>
      `).join('') + '</tbody>';
    table.querySelectorAll('.wl-status-select').forEach(sel => {
      sel.addEventListener('change', () => {
        watchlist[Number(sel.dataset.idx)].status = sel.value;
        saveWatchlist();
      });
    });
    table.querySelectorAll('.wl-note-input').forEach(inp => {
      inp.addEventListener('change', () => {
        watchlist[Number(inp.dataset.idx)].note = inp.value;
        saveWatchlist();
      });
    });
    table.querySelectorAll('.wl-remove-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        removeWatchlistItem(watchlist[Number(btn.dataset.idx)].id);
        renderWatchlist();
        renderAnomalyTable();
        renderCrossCheck();
      });
    });
  }

  function renderCrossCheck() {
    const table = document.getElementById('auditCrossCheckTable');
    if (!table) return;
    lastCrossRows = crossCheckRows();
    if (!lastCrossRows.length) {
      table.innerHTML = '<tbody><tr><td class="hint" style="padding:16px 4px">找不到可比對的審計意見資料。</td></tr></tbody>';
      return;
    }
    table.innerHTML =
      '<thead><tr><th>縣市</th><th>年度</th><th>意見則數</th><th>相關子標籤</th><th>同期(±1年)相關標案</th><th>初判</th><th>代表性摘要</th><th></th></tr></thead><tbody>' +
      lastCrossRows.map((r, i) => {
        const id = `audit_cross__${r.county}__${r.year}`;
        const matchText = r.verdict === 'not_comparable' ? '—'
          : `${r.matchCount} 筆／${Util.fmtNum(r.matchAmount)} 元`;
        return `
        <tr>
          <td>${esc(r.county)}</td>
          <td>${esc(r.year)}</td>
          <td>${esc(r.n)}</td>
          <td>${(r.tags || []).map(esc).join('、') || '（無）'}</td>
          <td>${matchText}</td>
          <td>${VERDICT_LABEL[r.verdict]}</td>
          <td style="max-width:360px">${esc(r.rep)}</td>
          <td>${r.verdict === 'no_match'
            ? (watchlistHas(id) ? '<span class="hint">已在待查清單</span>' : `<button class="btn wl-cross-add-btn" data-idx="${i}">＋ 加入待查</button>`)
            : ''}</td>
        </tr>`;
      }).join('') + '</tbody>';
    table.querySelectorAll('.wl-cross-add-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const r = lastCrossRows[Number(btn.dataset.idx)];
        if (!r) return;
        upsertWatchlist({
          id: `audit_cross__${r.county}__${r.year}`,
          typeLabel: '審計意見／標案交叉比對',
          county: r.county, year: r.year,
          detail: `${r.year}年「交通」領域審核意見共 ${r.n} 則（子標籤：${(r.tags || []).join('、') || '無'}），同縣市同期（±1年）在對應標案分類下查無標案。代表性摘要：${r.rep}`,
        });
        renderCrossCheck();
        renderWatchlist();
      });
    });
  }

  function render() {
    renderAnomalyTable();
    renderWatchlist();
    renderCrossCheck();
  }

  function init() {
    const datasetSel = document.getElementById('auditDatasetSelect');
    if (datasetSel) {
      datasetSel.innerHTML = '<option value="all">全部（合併檢視，依 |z| 排序）</option>' +
        Object.keys(DATASET_DEFS).map(k => `<option value="${k}">${DATASET_DEFS[k].label}</option>`).join('');
      datasetSel.value = 'all';
      datasetSel.addEventListener('change', renderAnomalyTable);
    }
    const sensSel = document.getElementById('auditSensitivitySelect');
    if (sensSel) sensSel.addEventListener('change', renderAnomalyTable);

    const addAllBtn = document.getElementById('auditAddAllBtn');
    if (addAllBtn) addAllBtn.addEventListener('click', () => {
      if (!lastAnomalies.length) { alert('目前沒有可加入的異常項目'); return; }
      lastAnomalies.forEach(upsertWatchlist);
      renderAnomalyTable();
      renderWatchlist();
    });

    const exportBtn = document.getElementById('auditWlExportCsv');
    if (exportBtn) exportBtn.addEventListener('click', exportWatchlistCsv);
  }

  return { init, render };
})();
