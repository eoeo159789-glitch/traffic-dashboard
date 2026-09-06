// ============================================================
// 改善趨勢分析分頁
// ------------------------------------------------------------
// 名詞定義（務必維持一致，避免像「死亡率」一樣造成誤解）：
//   「改善%」只用在事故／死傷相關指標，定義為：
//     (起始年數值 - 結束年數值) / 起始年數值 × 100%
//     正值 = 數值減少 = 改善；負值 = 數值增加 = 惡化。
//   「變化%」用在舉發件數／罰鍰收入等中性指標（不預設好壞），定義為：
//     (結束年數值 - 起始年數值) / 起始年數值 × 100%
//     正值 = 增加；負值 = 減少。
// 所有比較都只在同一份資料「實際涵蓋」的年度內進行；某年度／某縣市缺資料
// （例如官方死亡率因死亡人數未滿20人、自112年起以「*」標示不可靠而未公布）
// 一律排除，不用 0 或估計值頂替。
// ============================================================
const Improve = (() => {
  const SAFETY_METRICS = {
    a1Deaths:   { label: 'A1 死亡人數', kind: 'a1' },
    a1Count:    { label: 'A1 事故件數', kind: 'a1' },
    a2Count:    { label: 'A2 事故件數', kind: 'a2' },
    a2Injuries: { label: 'A2 受傷人數', kind: 'a2' },
    deathRate:  { label: '每十萬人死亡率（官方指標）', kind: 'rate' },
  };
  const DEATH_RATE_INDICATOR = '事故傷害死亡率(人/每十萬人口)';

  let rankState = { metric: 'a1Deaths', startYear: null, endYear: null };
  let enfState = { metric: 'a1Deaths', startYear: null, endYear: null };
  let finesState = { metric: 'a1Deaths', startYear: null, endYear: null };

  // ---------------- 資料存取 ----------------

  function a1Agg(county, year) {
    let count = 0, deaths = 0;
    ACCIDENTS.forEach(a => { if (a.county === county && a.year === year) { count++; deaths += a.deaths; } });
    return { count, deaths };
  }
  function a2Agg(county, year) {
    const row = (window.A2_BY_COUNTY || []).find(r => r.county === county && r.year === year);
    return row ? { count: row.count, injuries: row.injuries } : { count: 0, injuries: 0 };
  }
  function deathRateValue(county, year) {
    const row = INDICATORS.find(i => i.indicator === DEATH_RATE_INDICATOR && i.county === county && i.year === year);
    return row ? row.value : null;
  }
  function enfTotal(county, year) {
    const row = ENFORCEMENT.find(e => e.category === '總件數' && e.county === county && e.year === year);
    return row ? row.count : 0;
  }
  function finesAmount(county, year) {
    if (!window.ENFORCEMENT_FINES) return null;
    const row = ENFORCEMENT_FINES.records.find(r => r.county === county && r.year === year);
    return row ? row.amount : 0;
  }

  function safetyValue(metric, county, year) {
    switch (metric) {
      case 'a1Deaths': return a1Agg(county, year).deaths;
      case 'a1Count': return a1Agg(county, year).count;
      case 'a2Count': return a2Agg(county, year).count;
      case 'a2Injuries': return a2Agg(county, year).injuries;
      case 'deathRate': return deathRateValue(county, year);
      default: return null;
    }
  }
  function nationalSafetyValue(metric, year) {
    switch (metric) {
      case 'a1Deaths': { let v = 0; ACCIDENTS.forEach(a => { if (a.year === year) v += a.deaths; }); return v; }
      case 'a1Count': { let v = 0; ACCIDENTS.forEach(a => { if (a.year === year) v++; }); return v; }
      case 'a2Count': { let v = 0; (window.A2_BY_COUNTY || []).forEach(r => { if (r.year === year) v += r.count; }); return v; }
      case 'a2Injuries': { let v = 0; (window.A2_BY_COUNTY || []).forEach(r => { if (r.year === year) v += r.injuries; }); return v; }
      case 'deathRate': { const row = INDICATORS.find(i => i.indicator === DEATH_RATE_INDICATOR && i.county === '__TOTAL__' && i.year === year); return row ? row.value : null; }
      default: return null;
    }
  }

  function safetyYearsFor(metric) {
    if (metric === 'a1Deaths' || metric === 'a1Count') return META.accidentYears.slice().sort((a, b) => a - b);
    if (metric === 'a2Count' || metric === 'a2Injuries') return (META.a2Years || []).slice().sort((a, b) => a - b);
    if (metric === 'deathRate') {
      return [...new Set(INDICATORS.filter(i => i.indicator === DEATH_RATE_INDICATOR && i.county === '__TOTAL__').map(i => i.year))].sort((a, b) => a - b);
    }
    return [];
  }
  function enfYears() {
    return [...new Set(ENFORCEMENT.filter(e => e.category === '總件數').map(e => e.year))].sort((a, b) => a - b);
  }
  function finesYearsList() {
    return (window.ENFORCEMENT_FINES && ENFORCEMENT_FINES.years) ? ENFORCEMENT_FINES.years.slice().sort((a, b) => a - b) : [];
  }
  function intersectYears(a, b) {
    const setB = new Set(b);
    return a.filter(y => setB.has(y));
  }

  function improvePct(startVal, endVal) {
    if (startVal == null || endVal == null) return null;
    if (startVal === 0) return endVal === 0 ? 0 : null;
    return ((startVal - endVal) / startVal) * 100;
  }
  function changePct(startVal, endVal) {
    if (startVal == null || endVal == null) return null;
    if (startVal === 0) return endVal === 0 ? 0 : null;
    return ((endVal - startVal) / startVal) * 100;
  }
  function fmtSigned(n, digits = 1) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return (n >= 0 ? '+' : '') + n.toFixed(digits) + '%';
  }

  // ---------------- 全國整體改善總覽 ----------------

  function renderKpiOverview() {
    const cards = Object.keys(SAFETY_METRICS).map(metric => {
      const def = SAFETY_METRICS[metric];
      const years = safetyYearsFor(metric);
      if (years.length < 2) {
        return { label: def.label, value: '—', sub: '資料年度不足，無法比較' };
      }
      const startYear = years[0], endYear = years[years.length - 1];
      const startVal = nationalSafetyValue(metric, startYear);
      const endVal = nationalSafetyValue(metric, endYear);
      const pct = improvePct(startVal, endVal);
      return {
        label: `${def.label}（${startYear}→${endYear}）`,
        value: fmtSigned(pct),
        cls: pct == null ? '' : (pct >= 0 ? 'good' : 'critical'),
        sub: pct == null ? '資料不足' : `${Util.fmtNum(Math.round(startVal * 100) / 100)} → ${Util.fmtNum(Math.round(endVal * 100) / 100)}`,
      };
    });
    document.getElementById('improveKpiRow').innerHTML = cards.map(c => `
      <div class="kpi-card">
        <div class="label">${c.label}</div>
        <div class="value${c.cls ? ' ' + c.cls : ''}">${c.value}</div>
        ${c.sub ? `<div class="sub">${c.sub}</div>` : ''}
      </div>
    `).join('');
  }

  // ---------------- 各縣市改善排行 ----------------

  function rankRows(metric, startYear, endYear, counties) {
    return counties.map(c => {
      const s = safetyValue(metric, c, startYear);
      const e = safetyValue(metric, c, endYear);
      const pct = improvePct(s, e);
      return { county: c, start: s, end: e, pct };
    }).filter(r => r.pct !== null);
  }

  function refreshRankYearOptions(resetToFullRange) {
    const years = safetyYearsFor(rankState.metric);
    const startSel = document.getElementById('improveRankStartYear');
    const endSel = document.getElementById('improveRankEndYear');
    startSel.innerHTML = years.map(y => `<option value="${y}">${y}年</option>`).join('');
    endSel.innerHTML = years.map(y => `<option value="${y}">${y}年</option>`).join('');
    if (resetToFullRange || !years.includes(rankState.startYear) || !years.includes(rankState.endYear)) {
      rankState.startYear = years[0];
      rankState.endYear = years[years.length - 1];
    }
    startSel.value = rankState.startYear;
    endSel.value = rankState.endYear;
  }

  function renderRankChart() {
    const counties = [...State.filters.counties];
    let rows = rankRows(rankState.metric, rankState.startYear, rankState.endYear, counties)
      .sort((a, b) => b.pct - a.pct);
    const def = SAFETY_METRICS[rankState.metric];
    Charts.renderImproveRank('improveRankChart', rows, `${def.label} 改善%（${rankState.startYear}→${rankState.endYear}）`);
    const improved = rows.filter(r => r.pct > 0).length;
    const worsened = rows.filter(r => r.pct < 0).length;
    const excluded = counties.length - rows.length;
    document.getElementById('improveRankNote').textContent =
      `目前顯示 ${rows.length} 個縣市（改善 ${improved} 個、惡化 ${worsened} 個${excluded > 0 ? `，另有 ${excluded} 個縣市因資料不足未列入` : ''}）。`;
  }

  function exportRankCsv() {
    const counties = [...State.filters.counties];
    const rows = rankRows(rankState.metric, rankState.startYear, rankState.endYear, counties)
      .sort((a, b) => b.pct - a.pct);
    if (rows.length === 0) { alert('目前條件下沒有可匯出的資料'); return; }
    const def = SAFETY_METRICS[rankState.metric];
    const cols = [
      { key: 'county', label: '縣市' },
      { key: 'start', label: `${rankState.startYear}年（起始）`, numeric: true },
      { key: 'end', label: `${rankState.endYear}年（結束）`, numeric: true },
      { key: 'pctText', label: '改善%（正值=改善/減少，負值=惡化/增加）' },
    ];
    const dataRows = rows.map(r => Object.assign({}, r, { pctText: fmtSigned(r.pct) }));
    const csv = Util.toCsv(dataRows, cols);
    Util.downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `各縣市改善排行_${def.label}_${rankState.startYear}-${rankState.endYear}_${Date.now()}.csv`);
  }

  // ---------------- 舉發／罰鍰變化 vs 事故改善對照 ----------------

  function setupCompareYearSelects(prefix, state, compareYearsFn) {
    const years = intersectYears(safetyYearsFor(state.metric), compareYearsFn());
    const startSel = document.getElementById(`${prefix}StartYear`);
    const endSel = document.getElementById(`${prefix}EndYear`);
    startSel.innerHTML = years.map(y => `<option value="${y}">${y}年</option>`).join('');
    endSel.innerHTML = years.map(y => `<option value="${y}">${y}年</option>`).join('');
    if (!years.includes(state.startYear) || !years.includes(state.endYear)) {
      state.startYear = years[0];
      state.endYear = years[years.length - 1];
    }
    if (years.length > 0) {
      startSel.value = state.startYear;
      endSel.value = state.endYear;
    }
  }

  function renderEnfScatterCard() {
    const counties = [...State.filters.counties];
    const def = SAFETY_METRICS[enfState.metric];
    const points = counties.map(c => {
      const enfStart = enfTotal(c, enfState.startYear);
      const enfEnd = enfTotal(c, enfState.endYear);
      const safeStart = safetyValue(enfState.metric, c, enfState.startYear);
      const safeEnd = safetyValue(enfState.metric, c, enfState.endYear);
      const x = changePct(enfStart, enfEnd);
      const y = improvePct(safeStart, safeEnd);
      return { x, y, label: c };
    }).filter(p => p.x !== null && p.y !== null);
    Charts.renderImproveScatter('improveEnfScatterChart', points, '舉發總件數變化', `${def.label}改善`);
  }

  function renderFinesScatterCard() {
    const counties = [...State.filters.counties];
    const def = SAFETY_METRICS[finesState.metric];
    const points = counties.map(c => {
      const finesStart = finesAmount(c, finesState.startYear);
      const finesEnd = finesAmount(c, finesState.endYear);
      const safeStart = safetyValue(finesState.metric, c, finesState.startYear);
      const safeEnd = safetyValue(finesState.metric, c, finesState.endYear);
      const x = changePct(finesStart, finesEnd);
      const y = improvePct(safeStart, safeEnd);
      return { x, y, label: c };
    }).filter(p => p.x !== null && p.y !== null);
    Charts.renderImproveScatter('improveFinesScatterChart', points, '罰鍰收入變化', `${def.label}改善`);
  }

  // ---------------- 控制項綁定 ----------------

  function metricOptionsHtml() {
    return Object.keys(SAFETY_METRICS).map(k => `<option value="${k}">${SAFETY_METRICS[k].label}</option>`).join('');
  }

  function setupControls() {
    const rankMetricSel = document.getElementById('improveRankMetric');
    rankMetricSel.innerHTML = metricOptionsHtml();
    rankMetricSel.value = rankState.metric;
    refreshRankYearOptions(true);
    rankMetricSel.addEventListener('change', () => { rankState.metric = rankMetricSel.value; refreshRankYearOptions(true); render(); });
    document.getElementById('improveRankStartYear').addEventListener('change', e => { rankState.startYear = Number(e.target.value); render(); });
    document.getElementById('improveRankEndYear').addEventListener('change', e => { rankState.endYear = Number(e.target.value); render(); });
    document.getElementById('improveRankExportCsv').addEventListener('click', exportRankCsv);

    const enfMetricSel = document.getElementById('improveEnfMetric');
    enfMetricSel.innerHTML = metricOptionsHtml();
    enfMetricSel.value = enfState.metric;
    setupCompareYearSelects('improveEnf', enfState, enfYears);
    enfMetricSel.addEventListener('change', () => { enfState.metric = enfMetricSel.value; setupCompareYearSelects('improveEnf', enfState, enfYears); render(); });
    document.getElementById('improveEnfStartYear').addEventListener('change', e => { enfState.startYear = Number(e.target.value); render(); });
    document.getElementById('improveEnfEndYear').addEventListener('change', e => { enfState.endYear = Number(e.target.value); render(); });

    const finesMetricSel = document.getElementById('improveFinesMetric');
    finesMetricSel.innerHTML = metricOptionsHtml();
    finesMetricSel.value = finesState.metric;
    setupCompareYearSelects('improveFines', finesState, finesYearsList);
    finesMetricSel.addEventListener('change', () => { finesState.metric = finesMetricSel.value; setupCompareYearSelects('improveFines', finesState, finesYearsList); render(); });
    document.getElementById('improveFinesStartYear').addEventListener('change', e => { finesState.startYear = Number(e.target.value); render(); });
    document.getElementById('improveFinesEndYear').addEventListener('change', e => { finesState.endYear = Number(e.target.value); render(); });
  }

  function render() {
    if (!window.META) return;
    renderKpiOverview();
    renderRankChart();
    renderEnfScatterCard();
    renderFinesScatterCard();
  }

  function init() {
    setupControls();
    render();
  }

  return { init, render };
})();
