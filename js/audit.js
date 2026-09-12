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
//     -- 但單一指標的年增率異常，本身不足以判斷「好壞」（例如罰鍰收入變多，
//     可能是執法更積極，也可能只是統計波動）。因此「舉發總件數」與「罰鍰收入」
//     這兩項，會再對照「同縣市、同年度」的 A1 事故件數年增率：如果數值上升
//     但事故並未同步改善（甚至惡化），才會提高嚴重度；如果數值上升但事故已
//     同步改善，會調降嚴重度並標註原因。A1 事故件數年增率本身就是安全成效
//     指標，不需要再對照其他指標。
//   - 標案金額離群值：同一個標案分類內，先取金額的自然對數（降低金額本身
//     右偏分布 -- 少數超大型標案 -- 對平均值的影響），再算 z 分數。單一標案
//     金額異常（不論偏高或偏低）本身無法反映安全成效，因此嚴重度上限為「中」，
//     且會附註同縣市同年度的事故趨勢僅供參考，不作為嚴重度判斷依據。
//   - 人口/事故密度離群縣市：沿用「事故 vs 人口/縣市」頁密度象限圖同一套
//     密度算法，計算各縣市在（人口密度, 事故密度）平面上，相對全國平均值的
//     標準化距離 -- 本身就是兩項指標的綜合判斷。
//   以上全部屬於「統計上偏離平均」，不代表必然有弊端、違規或因果關係，僅供
//   縮小查核範圍之用，仍須人工判讀原始資料與情境。
// ============================================================
const Audit = (() => {
  const DEFAULT_THRESHOLD = 2;
  const SEV_LEVELS = ['low', 'medium', 'high'];
  const SEV_LABEL = { high: '高', medium: '中', low: '低' };
  let lastAnomaliesFiltered = [];
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
  function sevIndex(s) { return SEV_LEVELS.indexOf(s); }
  function sevAt(i) { return SEV_LEVELS[Math.max(0, Math.min(SEV_LEVELS.length - 1, i))]; }

  // ---------------- A1 事故件數年增率（供其他指標交叉比對用） ----------------

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

  // county|year -> 該年相對前一年的 A1 事故件數年增率（僅相鄰年度、前一年不為0時才有值）
  let _a1YoyMapCache = null;
  function computeA1YoyMap() {
    if (_a1YoyMapCache) return _a1YoyMapCache;
    const byCounty = new Map();
    a1Pairs().forEach(p => {
      if (!byCounty.has(p.county)) byCounty.set(p.county, new Map());
      byCounty.get(p.county).set(p.year, p.value);
    });
    const map = new Map();
    byCounty.forEach((yearMap, county) => {
      const years = [...yearMap.keys()].sort((a, b) => a - b);
      for (let i = 1; i < years.length; i++) {
        const y0 = years[i - 1], y1 = years[i];
        if (y1 - y0 !== 1) continue;
        const v0 = yearMap.get(y0), v1 = yearMap.get(y1);
        if (!v0) continue;
        map.set(county + '|' + y1, (v1 - v0) / v0);
      }
    });
    _a1YoyMapCache = map;
    return map;
  }

  // 依「本指標年增率」與「同期 A1 事故件數年增率」的搭配，判斷這是「數值異常但無安全疑慮」
  // 還是「數值異常且安全成效未同步改善」，藉此調整嚴重度（而不是只看單一指標的 z 分數）。
  function judgeAgainstAccidentTrend(metricPct, accPct, metricLabel) {
    if (accPct == null) return { note: '（同期 A1 事故件數資料不足，無法比對趨勢，嚴重度僅依本指標判斷）', adjust: 0 };
    const metricUp = metricPct > 0, accUp = accPct > 0;
    if (metricUp && !accUp) {
      return { note: `同期 A1 事故件數下降 ${Util.fmtPct(accPct)}，${metricLabel}上升但事故已同步改善，較不需優先關注`, adjust: -1 };
    }
    if (metricUp && accUp) {
      return { note: `同期 A1 事故件數同步上升 ${Util.fmtPct(accPct)}，${metricLabel}增加但事故未同步改善，值得留意`, adjust: +1 };
    }
    if (!metricUp && accUp) {
      return { note: `同期 A1 事故件數卻上升 ${Util.fmtPct(accPct)}，${metricLabel}減少但事故惡化，值得留意`, adjust: +1 };
    }
    return { note: `同期 A1 事故件數同步下降 ${Util.fmtPct(accPct)}，兩者同向變化`, adjust: -1 };
  }

  // ---------------- 年增率異常：A1 事故件數 / 舉發總件數 / 罰鍰收入 ----------------

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

  // opts.crossRefAccident: 是否要對照同期 A1 事故件數年增率調整嚴重度（A1 本身不需要對照自己）
  function yoyAnomalies(pairs, typeKey, typeLabel, threshold, opts) {
    opts = opts || {};
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
    const a1YoyMap = opts.crossRefAccident ? computeA1YoyMap() : null;
    const out = [];
    changes.forEach(c => {
      const z = zOf(c.pct, mean, std);
      const absZ = Math.abs(z);
      if (absZ < threshold) return;
      let severity = severityOf(absZ, threshold);
      let detail = `${c.prevYear}年 ${Util.fmtNum(c.v0)} → ${c.year}年 ${Util.fmtNum(c.v1)}（年增率 ${Util.fmtPct(c.pct)}，z=${z.toFixed(2)}）`;
      if (a1YoyMap) {
        const key = c.county + '|' + c.year;
        const accPct = a1YoyMap.has(key) ? a1YoyMap.get(key) : null;
        const dir = judgeAgainstAccidentTrend(c.pct, accPct, opts.metricLabelForCross || typeLabel);
        severity = sevAt(sevIndex(severity) + dir.adjust);
        detail += `；${dir.note}`;
      }
      out.push({
        id: `${typeKey}__${c.county}__${c.year}`,
        typeLabel, county: c.county, year: c.year,
        z, absZ, severity, detail,
      });
    });
    return out;
  }

  // ---------------- 標案金額離群值（同分類、對數 z 分數） ----------------

  function tenderOutliers(threshold) {
    if (!window.TENDERS) return [];
    const a1YoyMap = computeA1YoyMap();
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
        // 單一標案的金額離群，無法像「同縣市年增率」一樣有明確的安全成效可對照
        // （一個縣市一年可能有數十件同分類標案），因此嚴重度上限為「中」，
        // 避免僅因金額統計上偏離就被當成「高風險」。
        let severity = severityOf(absZ, threshold);
        if (sevIndex(severity) > sevIndex('medium')) severity = 'medium';
        let detail = `分類「${category}」內與同分類標案金額比較（取對數後），z=${z.toFixed(2)}；${r.agency || '（未知機關）'}／${r.title || '(無標題)'}，決標金額 ${Util.fmtNum(r.totalAmount)} 元`;
        const key = (r.performLocCounty || '') + '|' + (r.awardYear || '');
        if (r.performLocCounty && r.awardYear && a1YoyMap.has(key)) {
          detail += `（僅供參考，非嚴重度判斷依據：${r.performLocCounty} ${r.awardYear}年 A1 事故件數年增率 ${Util.fmtPct(a1YoyMap.get(key))}；金額異常本身不代表工程有無效益或違規，須另行查核履約內容）`;
        } else {
          detail += '（金額異常本身不代表有問題，須另行查核履約內容是否合理）';
        }
        out.push({
          id: `tender_outlier__${category}__${r.performLocCounty || ''}__${r.awardYear || ''}__${out.length}`,
          typeLabel: '標案金額離群值', county: r.performLocCounty || '（查無比對結果）', year: r.awardYear || '—',
          z, absZ, severity, detail,
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
        detail: `${year}年 人口密度 ${Util.fmtNum(Math.round(p.x))} 人/km²（z=${zx.toFixed(2)}）、事故密度 ${p.y.toFixed(3)} 件/km²（z=${zy.toFixed(2)}），距全國平均的複合距離 ${dist.toFixed(2)}（本項已同時考量兩項指標，非單一指標判斷）`,
      });
    });
    out.sort((a, b) => b.absZ - a.absZ);
    return out;
  }

  const DATASET_DEFS = {
    a1_yoy:          { label: 'A1 事故件數 年增率異常',      run: th => yoyAnomalies(a1Pairs(), 'a1_yoy', 'A1事故件數年增率', th) },
    enf_yoy:         { label: '舉發總件數 年增率異常（已對照事故趨勢）', run: th => yoyAnomalies(enfPairs(), 'enf_yoy', '舉發總件數年增率', th, { crossRefAccident: true, metricLabelForCross: '舉發件數' }) },
    fines_yoy:       { label: '罰鍰收入 年增率異常（已對照事故趨勢）',   run: th => yoyAnomalies(finesPairs(), 'fines_yoy', '罰鍰收入年增率', th, { crossRefAccident: true, metricLabelForCross: '罰鍰收入' }) },
    tender_outlier:  { label: '標案金額離群值（同分類比較，上限中度）', run: th => tenderOutliers(th) },
    density_outlier: { label: '人口/事故密度離群縣市（雙指標）',        run: th => densityOutliers(th) },
  };

  function runAnomalies(datasetKey, threshold) {
    if (datasetKey === 'all') {
      let all = [];
      Object.keys(DATASET_DEFS).forEach(k => { all = all.concat(DATASET_DEFS[k].run(threshold)); });
      all.sort((a, b) => b.absZ - a.absZ);
      return all.slice(0, 300);
    }
    const def = DATASET_DEFS[datasetKey];
    return def ? def.run(threshold) : [];
  }

  // ---------------- 審計意見 vs 標案 交叉比對 ----------------

  // 「交通」領域審核意見的子標籤分類，與「審計意見統計」頁完全一致（依實際出現頻率排序）；
  // 其中只有前兩個子標籤在「工程經費(標案)」目前的資料範圍內能對應到具體標案分類——
  // 公共運輸與客運鐵路／停車管理／電動車與淨零運具／港埠與航空目前完全沒有對應分類的
  // 標案資料（本站標案資料僅涵蓋科技執法／標誌標線／人行道／道路工程／道路改善／拓寬
  // 工程六類），這是標案資料涵蓋範圍的限制，不代表這些子標籤沒有意見或不重要。
  const ALL_TAGS = ['道路安全與路口工程', '科技執法與監理', '公共運輸與客運鐵路', '停車管理', '電動車與淨零運具', '港埠與航空'];
  const TAG_TO_TENDER_CATS = {
    '道路安全與路口工程': ['道路工程', '標誌標線', '人行道', '道路改善', '拓寬工程'],
    '科技執法與監理': ['科技執法'],
  };

  // 交叉比對的最小單位改為「縣市 × 年度 × 子標籤」（而不是整個縣市年度合併看待），
  // 這樣「相關子標籤」欄位才能反映『審計意見統計』頁完整的分類系統，也才能依子標籤篩選——
  // 先前版本只挑「能對應標案分類」的兩個子標籤，其餘子標籤即使存在也完全不會出現在畫面上。
  function crossCheckRows() {
    if (!window.AUDIT_OPINIONS_TRAFFIC || !window.TENDERS) return [];
    const out = [];
    AUDIT_OPINIONS_TRAFFIC.forEach(o => {
      (o.tags || []).forEach(tag => {
        const items = (o.tagItems && o.tagItems[tag]) || [];
        const tenderCats = TAG_TO_TENDER_CATS[tag];
        let verdict, comparableCats = [], matchCount = 0, matchAmount = 0;
        if (!tenderCats) {
          // 此子標籤在「工程經費(標案)」中沒有對應的標案分類，並非查無標案，是無從比對。
          verdict = 'not_applicable';
        } else if (!items.length) {
          // 該子標籤雖標註在這個縣市年度上，但抓不到「實際提到這個子標籤內容」的具體意見句。
          verdict = 'no_evidence';
        } else {
          comparableCats = tenderCats;
          // TENDERS.records 的 awardYear 是民國年（110~115），審計意見的 year 是西元年
          // （2021~2025），比對前先換算成同一套年份系統，避免年份沒對齊導致恆為「查無」。
          const matches = TENDERS.records.filter(r =>
            r.performLocCounty === o.county &&
            tenderCats.includes(r.category) &&
            r.awardYear != null && Math.abs((r.awardYear + 1911) - o.year) <= 1
          );
          matchCount = matches.length;
          matchAmount = matches.reduce((s, r) => s + (r.totalAmount || 0), 0);
          verdict = matchCount === 0 ? 'no_match' : 'has_match';
        }
        out.push({
          county: o.county, year: o.year, n: o.n, rep: o.rep,
          tag, matchedTitles: items, comparableCats, matchCount, matchAmount, verdict,
        });
      });
    });
    const rank = { no_match: 0, has_match: 1, no_evidence: 2, not_applicable: 3 };
    out.sort((a, b) => rank[a.verdict] - rank[b.verdict] || a.county.localeCompare(b.county) || b.year - a.year);
    return out;
  }

  const VERDICT_LABEL = {
    no_match: '<span class="sev-badge sev-high">有具體意見／查無對應標案</span>',
    has_match: '<span class="sev-badge sev-info">已有對應標案</span>',
    no_evidence: '<span class="sev-badge sev-low">無具體意見句可佐證</span>',
    not_applicable: '<span class="sev-badge sev-low">此子標籤無對應標案分類</span>',
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

  function exportAnomalyCsv() {
    if (!lastAnomaliesFiltered.length) { alert('目前篩選條件下沒有可匯出的異常項目'); return; }
    const cols = [
      { key: 'idx', label: '項次', numeric: true }, { key: 'typeLabel', label: '類型' },
      { key: 'county', label: '縣市' }, { key: 'year', label: '年度' },
      { key: 'severity', label: '嚴重度', value: r => SEV_LABEL[r.severity] },
      { key: 'z', label: 'z分數／距離', value: r => r.z.toFixed(2) },
      { key: 'detail', label: '說明' },
    ];
    const rows = lastAnomaliesFiltered.map((r, i) => Object.assign({ idx: i + 1 }, r));
    const csv = Util.toCsv(rows, cols);
    Util.downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `稽核異常偵測清單_${Date.now()}.csv`);
  }

  // ---------------- 渲染 ----------------

  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function renderAnomalyTable() {
    const datasetSel = document.getElementById('auditDatasetSelect');
    const sensSel = document.getElementById('auditSensitivitySelect');
    if (!datasetSel) return;
    const threshold = sensSel ? Number(sensSel.value) : DEFAULT_THRESHOLD;
    const all = runAnomalies(datasetSel.value, threshold);

    const countyFilter = document.getElementById('auditCountyFilterSelect');
    const sevFilter = document.getElementById('auditSeverityFilterSelect');
    const countyVal = countyFilter ? countyFilter.value : '';
    const sevVal = sevFilter ? sevFilter.value : '';
    lastAnomaliesFiltered = all.filter(r =>
      (!countyVal || r.county === countyVal) && (!sevVal || r.severity === sevVal)
    );

    const countEl = document.getElementById('auditAnomalyCount');
    if (countEl) {
      const capNote = all.length >= 300 ? '（合併檢視已達顯示上限，僅取 |z| 最大的前 300 筆再篩選）' : '';
      countEl.textContent = `符合篩選 ${lastAnomaliesFiltered.length} 筆／偵測到 ${all.length} 筆${capNote}`;
    }
    const table = document.getElementById('auditAnomalyTable');
    if (!table) return;
    if (!lastAnomaliesFiltered.length) {
      table.innerHTML = '<tbody><tr><td class="hint" style="padding:16px 4px">目前資料集／敏感度／縣市／嚴重度篩選條件下沒有偵測到異常。可嘗試調寬「敏感度」或改選「全部」縣市／嚴重度。</td></tr></tbody>';
      return;
    }
    table.innerHTML =
      '<thead><tr><th>項次</th><th>類型</th><th>縣市</th><th>年度</th><th>嚴重度</th><th>說明</th><th></th></tr></thead><tbody>' +
      lastAnomaliesFiltered.map((r, i) => `
        <tr>
          <td>${i + 1}</td>
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
        const row = lastAnomaliesFiltered[Number(btn.dataset.idx)];
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
    const countySel = document.getElementById('auditCrossCountySelect');
    const yearSel = document.getElementById('auditCrossYearSelect');
    const tagSel = document.getElementById('auditCrossTagSelect');
    const countyVal = countySel ? countySel.value : '';
    const yearVal = yearSel ? yearSel.value : '';
    const tagVal = tagSel ? tagSel.value : '';
    const all = crossCheckRows();
    lastCrossRows = all.filter(r =>
      (!countyVal || r.county === countyVal) && (!yearVal || String(r.year) === yearVal) && (!tagVal || r.tag === tagVal)
    );
    const countEl = document.getElementById('auditCrossCount');
    if (countEl) countEl.textContent = `符合篩選 ${lastCrossRows.length} 筆／共 ${all.length} 筆`;
    if (!lastCrossRows.length) {
      table.innerHTML = '<tbody><tr><td class="hint" style="padding:16px 4px">目前縣市／年度／子標籤篩選條件下沒有資料，可嘗試改選「全部」。</td></tr></tbody>';
      return;
    }
    table.innerHTML =
      '<thead><tr><th>縣市</th><th>年度</th><th>相關子標籤</th><th>同期(±1年)相關標案</th><th>初判</th><th>依據（實際審核意見句）</th><th></th></tr></thead><tbody>' +
      lastCrossRows.map((r, i) => {
        const id = `audit_cross__${r.county}__${r.year}__${r.tag}`;
        const matchText = (r.verdict === 'not_applicable' || r.verdict === 'no_evidence') ? '—' : `${r.matchCount} 筆／${Util.fmtNum(r.matchAmount)} 元`;
        const basisText = r.matchedTitles.length ? r.matchedTitles.map(esc).join('；') : '—';
        return `
        <tr>
          <td>${esc(r.county)}</td>
          <td>${esc(r.year)}</td>
          <td>${esc(r.tag)}</td>
          <td>${matchText}</td>
          <td>${VERDICT_LABEL[r.verdict]}</td>
          <td>${basisText}</td>
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
          id: `audit_cross__${r.county}__${r.year}__${r.tag}`,
          typeLabel: '審計意見／標案交叉比對',
          county: r.county, year: r.year,
          detail: `${r.year}年「交通」領域審核意見中，子標籤「${r.tag}」有具體意見句：${r.matchedTitles.join('；')}。同縣市同期（±1年）在對應標案分類（${r.comparableCats.join('、')}）下查無標案。`,
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

    const countyFilterSel = document.getElementById('auditCountyFilterSelect');
    if (countyFilterSel) {
      countyFilterSel.innerHTML = '<option value="">全部縣市</option>' +
        META.counties.map(c => `<option value="${c}">${c}</option>`).join('');
      countyFilterSel.value = '';
      countyFilterSel.addEventListener('change', renderAnomalyTable);
    }
    const sevFilterSel = document.getElementById('auditSeverityFilterSelect');
    if (sevFilterSel) sevFilterSel.addEventListener('change', renderAnomalyTable);

    const addAllBtn = document.getElementById('auditAddAllBtn');
    if (addAllBtn) addAllBtn.addEventListener('click', () => {
      if (!lastAnomaliesFiltered.length) { alert('目前篩選條件下沒有可加入的異常項目'); return; }
      lastAnomaliesFiltered.forEach(upsertWatchlist);
      renderAnomalyTable();
      renderWatchlist();
    });

    const anomalyExportBtn = document.getElementById('auditAnomalyExportCsv');
    if (anomalyExportBtn) anomalyExportBtn.addEventListener('click', exportAnomalyCsv);

    const exportBtn = document.getElementById('auditWlExportCsv');
    if (exportBtn) exportBtn.addEventListener('click', exportWatchlistCsv);

    const crossCountySel = document.getElementById('auditCrossCountySelect');
    const crossYearSel = document.getElementById('auditCrossYearSelect');
    if (crossCountySel && window.AUDIT_OPINIONS_TRAFFIC) {
      const counties = [...new Set(AUDIT_OPINIONS_TRAFFIC.map(o => o.county))].sort();
      crossCountySel.innerHTML = '<option value="">全部縣市</option>' +
        counties.map(c => `<option value="${c}">${c}</option>`).join('');
      crossCountySel.value = '';
      crossCountySel.addEventListener('change', renderCrossCheck);
    }
    if (crossYearSel && window.AUDIT_OPINIONS_TRAFFIC) {
      const years = [...new Set(AUDIT_OPINIONS_TRAFFIC.map(o => o.year))].sort((a, b) => a - b);
      crossYearSel.innerHTML = '<option value="">全部年度</option>' +
        years.map(y => `<option value="${y}">${y}</option>`).join('');
      crossYearSel.value = '';
      crossYearSel.addEventListener('change', renderCrossCheck);
    }
    const crossTagSel = document.getElementById('auditCrossTagSelect');
    if (crossTagSel && window.AUDIT_OPINIONS_TRAFFIC) {
      // 分類與「審計意見統計」頁一致，依 ALL_TAGS 的固定順序（而非字母序）列出，
      // 只保留「交通」領域縣市層級資料中實際出現過的子標籤。
      const tagsPresent = new Set();
      AUDIT_OPINIONS_TRAFFIC.forEach(o => (o.tags || []).forEach(t => tagsPresent.add(t)));
      const orderedTags = ALL_TAGS.filter(t => tagsPresent.has(t));
      crossTagSel.innerHTML = '<option value="">全部子標籤</option>' +
        orderedTags.map(t => `<option value="${t}">${t}${TAG_TO_TENDER_CATS[t] ? '' : '（無對應標案分類）'}</option>`).join('');
      crossTagSel.value = '';
      crossTagSel.addEventListener('change', renderCrossCheck);
    }
  }

  return { init, render };
})();
