// ============================================================
// 國際比較（OECD）分頁
// 資料：data/oecd_road_safety.data.js（scripts/build_oecd.py 產生）
// ============================================================
const Oecd = (() => {
  const D = window.OECD_ROAD;
  if (!D) return { render() {} };

  const TW = 'TWN';
  const NAME = Object.fromEntries(D.countries.map(c => [c.code, c.name]));
  const HAS = D.countries.filter(c => c.hasData).map(c => c.code);
  const OECD_CODES = HAS.filter(c => c !== TW);
  const YEARS = [];
  for (let y = D.meta.yearFrom; y <= Math.min(D.meta.oecdLatestYear, D.meta.yearTo); y++) YEARS.push(y);
  const TW_LAST = Math.max(...D.rows.filter(r => r.c === TW && r.f != null).map(r => r.y));
  const TARGET_YEAR = 2030;

  // 事故件數口徑疑義：受傷人數 < 傷亡事故件數（件數可能含財損事故或受傷定義較窄）→ 嚴重度比較預設排除
  // 墨西哥：死亡數明顯偏低，統計涵蓋範圍可能不完整
  const byKey = new Map(D.rows.map(r => [r.c + '|' + r.y, r]));
  const get = (c, y) => byKey.get(c + '|' + y);
  const CRASH_ISSUE = new Set(OECD_CODES.filter(c => D.rows.some(r => r.c === c && r.i && r.cr && r.i / r.cr < 1)));
  const COVERAGE_ISSUE = new Set(['MEX']);

  const METRICS = {
    fr:  { label: '每十萬人口死亡率', unit: '人／十萬人', dec: 1, fn: r => (r.f != null && r.pop) ? r.f / r.pop * 1e5 : null },
    f:   { label: '死亡人數（30 日內）', unit: '人', dec: 0, fn: r => r.f ?? null },
    ir:  { label: '每十萬人口受傷人數', unit: '人／十萬人', dec: 0, fn: r => (r.i != null && r.pop) ? r.i / r.pop * 1e5 : null },
    i:   { label: '受傷人數', unit: '人', dec: 0, fn: r => r.i ?? null },
    crr: { label: '每十萬人口傷亡事故件數', unit: '件／十萬人', dec: 0, fn: r => (r.cr != null && r.pop) ? r.cr / r.pop * 1e5 : null },
    cr:  { label: '傷亡事故件數', unit: '件', dec: 0, fn: r => r.cr ?? null },
    sevCr: { label: '每千件傷亡事故死亡人數', unit: '人／千件', dec: 1, fn: r => (r.f != null && r.cr) ? r.f / r.cr * 1000 : null },
    sevCas: { label: '致死率（死亡占傷亡人數）', unit: '%', dec: 2, fn: r => (r.f != null && r.i != null && (r.f + r.i)) ? r.f / (r.f + r.i) * 100 : null },
  };

  const PRESETS = {
    '精選對照': ['JPN', 'KOR', 'USA', 'GBR', 'SWE', 'FRA'],
    '亞太': ['JPN', 'KOR', 'AUS', 'NZL'],
    '北美與拉丁美洲': ['USA', 'CAN', 'MEX', 'CHL'],
    '北歐': ['SWE', 'NOR', 'FIN', 'DNK', 'ISL'],
    '西歐': ['GBR', 'FRA', 'DEU', 'NLD', 'BEL', 'AUT', 'CHE'],
    '南歐': ['ITA', 'ESP', 'PRT', 'GRC', 'TUR', 'ISR', 'SVN'],
    '中東歐': ['POL', 'CZE', 'SVK', 'HUN', 'EST', 'LVA', 'LTU'],
  };
  const MAX_SEL = 7;

  const st = {
    sel: [...PRESETS['精選對照']],
    colorSlot: {},             // 國家 → 分類色序號（2..8），選取時指定，之後不因篩選改變
    trendMetric: 'fr', trendType: 'line', yFrom: 2020, yTo: YEARS[YEARS.length - 1],
    rankMetric: 'fr', rankYear: 'latest',
    baseYear: 2021, endYear: 'latest',
    sevMetric: 'sevCr', sevYear: 'latest', sevExclude: true,
    tableScope: 'sel',
  };
  let inited = false;

  // ---------------- 工具 ----------------
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const col = n => css('--series-' + n) || Util.PALETTE[n - 1];
  const gray = () => Util.isDark() ? '#5b5a56' : '#c3c2b7';
  const ink = () => css('--text-primary') || '#0b0b0b';
  const muted = () => css('--text-muted') || '#898781';
  const fmt = (v, d = 0) => v == null || isNaN(v) ? '—' : Number(v).toLocaleString('zh-TW', { minimumFractionDigits: d, maximumFractionDigits: d });
  const median = arr => { const a = arr.filter(v => v != null && !isNaN(v)).sort((x, y) => x - y); if (!a.length) return null; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
  const val = (c, y, m) => { const r = get(c, y); return r ? METRICS[m].fn(r) : null; };
  function latestYear(c, m, maxY = YEARS[YEARS.length - 1]) {
    for (let y = maxY; y >= D.meta.yearFrom; y--) { if (val(c, y, m) != null) return y; }
    return null;
  }
  const pickYear = (c, m, sel) => sel === 'latest' ? latestYear(c, m) : (val(c, +sel, m) != null ? +sel : null);
  function colorOf(c) {
    if (c === TW) return col(1);
    if (!st.colorSlot[c]) {
      const used = new Set(st.sel.filter(x => x !== c).map(x => st.colorSlot[x]).filter(Boolean));
      for (let s = 2; s <= 8; s++) if (!used.has(s)) { st.colorSlot[c] = s; break; }
    }
    return col(st.colorSlot[c] || 8);
  }
  const label = (c, y, refY) => NAME[c] + (refY && y !== refY ? `（${y}）` : '');

  // 垂直參考線（中位數）外掛
  function vlinePlugin(id, getX, text) {
    return {
      id,
      afterDatasetsDraw(chart) {
        const x0 = getX(); if (x0 == null) return;
        const { ctx, chartArea: a, scales: { x } } = chart;
        const px = x.getPixelForValue(x0);
        ctx.save(); ctx.strokeStyle = muted(); ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke();
        ctx.setLineDash([]); ctx.fillStyle = muted(); ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
        ctx.fillText(text(), Math.min(px + 4, a.right - 120), a.top - 6);
        ctx.restore();
      },
    };
  }
  // 散佈圖直接標註外掛
  function pointLabelPlugin(id) {
    return {
      id,
      afterDatasetsDraw(chart) {
        const { ctx } = chart;
        ctx.save(); ctx.font = '11px sans-serif'; ctx.fillStyle = ink(); ctx.textBaseline = 'middle';
        chart.data.datasets.forEach((ds, di) => {
          if (!ds._labels) return;
          chart.getDatasetMeta(di).data.forEach((pt, i) => {
            const t = ds._labels[i]; if (!t) return;
            ctx.fillText(t, pt.x + 8, pt.y);
          });
        });
        ctx.restore();
      },
    };
  }

  // ---------------- 控制項 ----------------
  function fillSelect(id, opts, cur) {
    const el = document.getElementById(id);
    el.innerHTML = opts.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
    el.value = String(cur);
    return el;
  }
  function init() {
    inited = true;
    const presetSel = fillSelect('oecdPreset', [...Object.keys(PRESETS).map(k => [k, k]), ['__custom', '自訂']], '精選對照');
    presetSel.onchange = () => {
      if (presetSel.value === '__custom') return;
      st.sel = PRESETS[presetSel.value].filter(c => HAS.includes(c)).slice(0, MAX_SEL);
      renderChips(); draw();
    };
    renderChips();

    const metricOpts = ['fr', 'f', 'ir', 'i', 'crr', 'cr', 'sevCr', 'sevCas'].map(k => [k, METRICS[k].label]);
    fillSelect('oecdTrendMetric', metricOpts, st.trendMetric).onchange = e => { st.trendMetric = e.target.value; drawTrend(); };
    fillSelect('oecdTrendType', [['line', '折線圖'], ['bar', '長條圖'], ['index', `指數化（起始年＝100）`]], st.trendType).onchange = e => { st.trendType = e.target.value; drawTrend(); };
    const yOpts = YEARS.map(y => [y, y + '年']);
    fillSelect('oecdYearFrom', yOpts, st.yFrom).onchange = e => { st.yFrom = +e.target.value; if (st.yFrom > st.yTo) { st.yTo = st.yFrom; document.getElementById('oecdYearTo').value = st.yTo; } drawTrend(); };
    fillSelect('oecdYearTo', yOpts, st.yTo).onchange = e => { st.yTo = +e.target.value; if (st.yTo < st.yFrom) { st.yFrom = st.yTo; document.getElementById('oecdYearFrom').value = st.yFrom; } drawTrend(); };

    fillSelect('oecdRankMetric', ['fr', 'ir', 'crr', 'f', 'sevCr', 'sevCas'].map(k => [k, METRICS[k].label]), st.rankMetric).onchange = e => { st.rankMetric = e.target.value; drawRank(); };
    const latestOpt = [['latest', `各國最新可得年度（至 ${YEARS[YEARS.length - 1]}）`]];
    fillSelect('oecdRankYear', [...latestOpt, ...yOpts.slice().reverse()], st.rankYear).onchange = e => { st.rankYear = e.target.value; drawRank(); };

    fillSelect('oecdBaseYear', [[2019, '2019（疫情前）'], [2020, '2020'], [2021, '2021（聯合國第二個道安十年起點）']], st.baseYear).onchange = e => { st.baseYear = +e.target.value; drawChange(); };
    fillSelect('oecdEndYear', [...latestOpt, ...yOpts.filter(([y]) => y > 2021).reverse()], st.endYear).onchange = e => { st.endYear = e.target.value; drawChange(); };

    fillSelect('oecdSevMetric', [['sevCr', METRICS.sevCr.label], ['sevCas', METRICS.sevCas.label]], st.sevMetric).onchange = e => { st.sevMetric = e.target.value; drawSeverity(); };
    fillSelect('oecdSevYear', [...latestOpt, ...yOpts.slice().reverse()], st.sevYear).onchange = e => { st.sevYear = e.target.value; drawSeverity(); };
    const ex = document.getElementById('oecdSevExclude'); ex.checked = st.sevExclude; ex.onchange = () => { st.sevExclude = ex.checked; drawSeverity(); };

    fillSelect('oecdTableScope', [['sel', '臺灣＋目前勾選國家'], ['all', `全部（OECD ${OECD_CODES.length} 國＋臺灣）`]], st.tableScope).onchange = e => { st.tableScope = e.target.value; drawTable(); };

    document.querySelectorAll('[data-oecd-csv]').forEach(b => b.addEventListener('click', () => exportCsv(b.dataset.oecdCsv)));
    document.getElementById('oecdXlsxBtn').addEventListener('click', exportXlsx);
    document.getElementById('oecdSrcList').innerHTML = D.meta.sources.map(s => s.url
      ? `<li><a href="${s.url}" target="_blank" rel="noopener">${s.name}</a></li>` : `<li>${s.name}</li>`).join('');
  }

  function renderChips() {
    const el = document.getElementById('oecdChips');
    const groups = {};
    D.countries.filter(c => c.code !== TW).forEach(c => (groups[c.region] = groups[c.region] || []).push(c));
    el.innerHTML = Object.entries(groups).map(([g, list]) => `<div class="oecd-chip-group"><span class="oecd-chip-g">${g}</span>` +
      list.map(c => {
        const on = st.sel.includes(c.code);
        const dot = on ? `<i class="oecd-dot" style="background:${colorOf(c.code)}"></i>` : '';
        return `<button type="button" class="chip${on ? ' active oecd-on' : ''}" data-c="${c.code}" ${c.hasData ? '' : 'disabled title="OECD 資料集未提供此國資料"'} aria-pressed="${on}">${dot}${c.name}</button>`;
      }).join('') + '</div>').join('');
    el.querySelectorAll('button[data-c]').forEach(b => b.onclick = () => {
      const c = b.dataset.c;
      if (st.sel.includes(c)) { st.sel = st.sel.filter(x => x !== c); delete st.colorSlot[c]; }
      else {
        if (st.sel.length >= MAX_SEL) { flash(`最多同時比較 ${MAX_SEL} 個國家（另加臺灣），請先取消其他國家`); return; }
        st.sel.push(c);
      }
      document.getElementById('oecdPreset').value = '__custom';
      renderChips(); draw();
    });
    document.getElementById('oecdSelCount').textContent = `已選 ${st.sel.length}／${MAX_SEL} 國（臺灣固定顯示）`;
  }
  function flash(msg) {
    const n = document.getElementById('oecdMsg'); n.textContent = msg; n.hidden = false;
    clearTimeout(flash._t); flash._t = setTimeout(() => { n.hidden = true; }, 3500);
  }

  // ---------------- KPI ----------------
  function drawKpis() {
    const ly = YEARS[YEARS.length - 1];
    const twY = latestYear(TW, 'fr');
    const twRate = val(TW, twY, 'fr');
    const rates = OECD_CODES.map(c => { const y = latestYear(c, 'fr'); return y ? val(c, y, 'fr') : null; }).filter(v => v != null);
    const med = median(rates);
    const rankAll = [...rates, twRate].sort((a, b) => b - a);
    const rank = rankAll.indexOf(twRate) + 1;
    const jp = val('JPN', latestYear('JPN', 'fr'), 'fr');
    const twBase = val(TW, 2021, 'f'), twLast = val(TW, TW_LAST, 'f');
    const cards = [
      { label: `臺灣每十萬人口死亡率（${twY}）`, value: fmt(twRate, 1), sub: `OECD 中位數 ${fmt(med, 1)}，約為其 ${fmt(twRate / med, 1)} 倍` },
      { label: `在 OECD ${rates.length} 國＋臺灣中排名`, value: `第 ${rank} 高`, sub: '依各國最新可得年度比較' },
      { label: '與日本相比', value: `${fmt(twRate / jp, 1)} 倍`, sub: `日本 ${fmt(jp, 1)} 人／十萬人` },
      { label: `臺灣死亡人數 2021→${TW_LAST}`, value: `${fmt((twLast / twBase - 1) * 100, 1)}%`, sub: `${fmt(twBase)} → ${fmt(twLast)} 人；減半目標需年降約 ${fmt((1 - Math.pow(0.5, 1 / (TARGET_YEAR - 2021))) * 100, 1)}%` },
    ];
    document.getElementById('oecdKpis').innerHTML = cards.map(c => `<div class="kpi-card"><div class="label">${c.label}</div><div class="value">${c.value}</div><div class="sub">${c.sub}</div></div>`).join('');
  }

  // ---------------- 1. 趨勢 ----------------
  function drawTrend() {
    const m = st.trendMetric, M = METRICS[m];
    const years = YEARS.filter(y => y >= st.yFrom && y <= st.yTo);
    const idx = st.trendType === 'index';
    const series = [TW, ...st.sel];
    const mk = c => years.map(y => {
      const v = val(c, y, m); if (!idx) return v;
      const b = val(c, years[0], m); return (v != null && b) ? v / b * 100 : null;
    });
    const medSeries = years.map(y => {
      const vs = OECD_CODES.map(c => val(c, y, m));
      if (!idx) return median(vs);
      const ratios = OECD_CODES.map(c => { const v = val(c, y, m), b = val(c, years[0], m); return (v != null && b) ? v / b * 100 : null; });
      return median(ratios);
    });
    const isBar = st.trendType === 'bar';
    const datasets = series.map(c => ({
      label: NAME[c], data: mk(c), borderColor: colorOf(c), backgroundColor: colorOf(c),
      borderWidth: c === TW ? 3 : 2, pointRadius: c === TW ? 4 : 3, pointHoverRadius: 6, tension: 0,
      borderRadius: isBar ? 4 : 0, order: c === TW ? 0 : 1, spanGaps: false,
    }));
    datasets.push({
      label: 'OECD 中位數', data: medSeries, borderColor: muted(), backgroundColor: isBar ? gray() : muted(),
      borderDash: isBar ? [] : [6, 4], borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, borderRadius: isBar ? 4 : 0, order: 2,
    });
    const text = Util.chartTextColor(), grid = Util.chartGridColor();
    Charts.upsert('oecdTrendChart', {
      type: isBar ? 'bar' : 'line',
      data: { labels: years.map(String), datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: text, boxWidth: 12, font: { size: 11 } } },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}：${ctx.parsed.y == null ? '無資料' : fmt(ctx.parsed.y, idx ? 1 : M.dec)}${idx ? '' : ' ' + M.unit}` } },
          title: { display: true, text: idx ? `${M.label}（${years[0]} 年＝100）` : `${M.label}（${M.unit}）`, color: text, font: { size: 12, weight: '600' }, align: 'start' },
        },
        scales: {
          x: { ticks: { color: text }, grid: { display: false } },
          y: { ticks: { color: text, callback: v => fmt(v, 0) }, grid: { color: grid }, beginAtZero: !idx },
        },
      },
    });
    const gaps = series.filter(c => mk(c).some(v => v == null)).map(c => NAME[c]);
    document.getElementById('oecdTrendNote').textContent = gaps.length
      ? `提醒：${gaps.join('、')} 在所選期間有年度缺資料（圖上斷線處），OECD 各國多數更新至 ${YEARS[YEARS.length - 1]} 年，部分國家僅至 2021–2023 年。`
      : '';
  }

  // ---------------- 2. 排名 ----------------
  let rankRows = [];
  function drawRank() {
    const m = st.rankMetric, M = METRICS[m];
    const refY = st.rankYear === 'latest' ? null : +st.rankYear;
    rankRows = [...OECD_CODES, TW].map(c => {
      const y = pickYear(c, m, st.rankYear); return y ? { c, y, v: val(c, y, m) } : null;
    }).filter(Boolean).filter(r => !(m === 'sevCr' && CRASH_ISSUE.has(r.c)))
      .sort((a, b) => b.v - a.v);
    const med = median(rankRows.filter(r => r.c !== TW).map(r => r.v));
    const mute = gray();
    const colors = rankRows.map(r => r.c === TW ? col(1) : mute);
    const text = Util.chartTextColor(), grid = Util.chartGridColor();
    const wrap = document.getElementById('oecdRankWrap');
    wrap.style.height = Math.max(380, rankRows.length * 20 + 70) + 'px';
    Charts.upsert('oecdRankChart', {
      type: 'bar',
      data: { labels: rankRows.map(r => (r.c === TW ? '▶ ' : '') + label(r.c, r.y, refY || YEARS[YEARS.length - 1]) + (COVERAGE_ISSUE.has(r.c) ? ' ※' : '')), datasets: [{ label: M.label, data: rankRows.map(r => r.v), backgroundColor: colors, borderRadius: 4, barPercentage: 0.8, categoryPercentage: 0.9 }] },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: { duration: 250 }, layout: { padding: { top: 14 } },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { title: it => { const r = rankRows[it[0].dataIndex]; return `${NAME[r.c]}（${r.y} 年）第 ${it[0].dataIndex + 1} 名`; }, label: ctx => `${M.label}：${fmt(ctx.parsed.x, M.dec)} ${M.unit}` } },
          title: { display: true, text: `${M.label}（${M.unit}）｜由高至低`, color: text, font: { size: 12, weight: '600' }, align: 'start' },
        },
        scales: {
          x: { ticks: { color: text }, grid: { color: grid }, beginAtZero: true },
          y: { ticks: { color: text, font: ctx => ({ size: 11, weight: rankRows[ctx.index] && rankRows[ctx.index].c === TW ? '700' : '400' }) }, grid: { display: false } },
        },
      },
      plugins: [vlinePlugin('oecdMedLine', () => med, () => `OECD 中位數 ${fmt(med, M.dec)}`)],
    });
    const tw = rankRows.findIndex(r => r.c === TW);
    document.getElementById('oecdRankNote').innerHTML = tw >= 0
      ? `臺灣（${rankRows[tw].y} 年）${M.label} ${fmt(rankRows[tw].v, M.dec)} ${M.unit}，在 ${rankRows.length} 國中排第 <b>${tw + 1}</b> 高，為 OECD 中位數的 ${fmt(rankRows[tw].v / med, 1)} 倍。`
        + (st.rankYear === 'latest' ? ' 國名後括號為該國最新可得年度。' : '') + (rankRows.some(r => COVERAGE_ISSUE.has(r.c)) ? ' ※墨西哥數值明顯偏低，統計涵蓋範圍可能不完整。' : '')
      : '臺灣在所選年度無資料。';
  }

  // ---------------- 3. 五年變化與減半目標 ----------------
  let changeRows = [];
  function drawChange() {
    const base = st.baseYear;
    const need = Math.pow(0.5, 1 / (TARGET_YEAR - base)) - 1; // 每年需變化率（負值）
    changeRows = [...OECD_CODES, TW].map(c => {
      const vb = val(c, base, 'f');
      let ey = st.endYear === 'latest' ? latestYear(c, 'f') : +st.endYear;
      if (c === TW && st.endYear === 'latest') ey = YEARS[YEARS.length - 1];
      const ve = ey ? val(c, ey, 'f') : null;
      if (vb == null || ve == null || ey <= base) return null;
      const pct = (ve / vb - 1) * 100;
      const ann = Math.pow(ve / vb, 1 / (ey - base)) - 1;
      const status = ann <= need ? 'good' : (ann < 0 ? 'warning' : 'critical');
      return { c, base, ey, vb, ve, pct, ann: ann * 100, need: need * 100, status };
    }).filter(Boolean).sort((a, b) => a.pct - b.pct);
    const blue = col(1), red = col(8);
    const text = Util.chartTextColor(), grid = Util.chartGridColor();
    document.getElementById('oecdChangeWrap').style.height = Math.max(380, changeRows.length * 20 + 70) + 'px';
    const refEnd = st.endYear === 'latest' ? YEARS[YEARS.length - 1] : +st.endYear;
    Charts.upsert('oecdChangeChart', {
      type: 'bar',
      data: {
        labels: changeRows.map(r => (r.c === TW ? '▶ ' : '') + label(r.c, r.ey, refEnd) + (COVERAGE_ISSUE.has(r.c) ? ' ※' : '')),
        datasets: [{ label: `死亡人數增減幅（${base}→）`, data: changeRows.map(r => r.pct), backgroundColor: changeRows.map(r => r.pct < 0 ? blue : red),
          borderColor: changeRows.map(r => r.c === TW ? ink() : 'transparent'), borderWidth: changeRows.map(r => r.c === TW ? 2 : 0), borderRadius: 4, barPercentage: 0.8, categoryPercentage: 0.9 }],
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { title: it => { const r = changeRows[it[0].dataIndex]; return `${NAME[r.c]}：${r.base}→${r.ey}`; },
            label: ctx => { const r = changeRows[ctx.dataIndex]; return [`死亡 ${fmt(r.vb)} → ${fmt(r.ve)} 人（${r.pct > 0 ? '+' : ''}${fmt(r.pct, 1)}%）`, `年均 ${r.ann > 0 ? '+' : ''}${fmt(r.ann, 1)}%／減半需 ${fmt(r.need, 1)}%`]; } } },
          title: { display: true, text: `死亡人數增減幅（%）｜藍色＝減少、紅色＝增加`, color: text, font: { size: 12, weight: '600' }, align: 'start' },
        },
        scales: { x: { ticks: { color: text, callback: v => v + '%' }, grid: { color: grid } }, y: { ticks: { color: text, font: ctx => ({ size: 11, weight: changeRows[ctx.index] && changeRows[ctx.index].c === TW ? '700' : '400' }) }, grid: { display: false } } },
      },
      plugins: [vlinePlugin('oecdZero', () => 0, () => '')],
    });

    // 減半路徑圖
    const years = []; for (let y = base; y <= TARGET_YEAR; y++) years.push(y);
    const path = years.map(y => 100 * Math.pow(0.5, (y - base) / (TARGET_YEAR - base)));
    const series = [TW, ...st.sel];
    const ds = series.map(c => {
      const b = val(c, base, 'f');
      return { label: NAME[c], data: years.map(y => { const v = val(c, y, 'f'); return (b && v != null) ? v / b * 100 : null; }),
        borderColor: colorOf(c), backgroundColor: colorOf(c), borderWidth: c === TW ? 3 : 2, pointRadius: c === TW ? 4 : 3, spanGaps: false, order: c === TW ? 0 : 1 };
    });
    ds.push({ label: `減半路徑（${base}→${TARGET_YEAR}）`, data: path, borderColor: muted(), borderDash: [6, 4], borderWidth: 2, pointRadius: 0, order: 2 });
    Charts.upsert('oecdPathChart', {
      type: 'line', data: { labels: years.map(String), datasets: ds },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 250 }, interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: text, boxWidth: 12, font: { size: 11 } } },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}：${ctx.parsed.y == null ? '無資料' : fmt(ctx.parsed.y, 1)}` } },
          title: { display: true, text: `死亡人數指數（${base} 年＝100）vs. 2030 年減半路徑`, color: text, font: { size: 12, weight: '600' }, align: 'start' },
        },
        scales: { x: { ticks: { color: text }, grid: { display: false } }, y: { ticks: { color: text }, grid: { color: grid }, suggestedMin: 40, suggestedMax: 120 } },
      },
    });

    // 進度表
    const pill = s => ({ good: '<span class="oecd-pill good">✔ 達標步調</span>', warning: '<span class="oecd-pill warning">▲ 下降但落後</span>', critical: '<span class="oecd-pill critical">✖ 未下降</span>' }[s]);
    const cnt = { good: 0, warning: 0, critical: 0 }; changeRows.filter(r => r.c !== TW).forEach(r => cnt[r.status]++);
    document.getElementById('oecdTargetSummary').innerHTML =
      `以 ${base} 年為基準、${TARGET_YEAR} 年死亡人數減半，每年需平均減少 <b>${fmt(-need * 100, 1)}%</b>。OECD ${changeRows.filter(r => r.c !== TW).length} 國中：達標步調 ${cnt.good} 國、下降但落後 ${cnt.warning} 國、未下降 ${cnt.critical} 國。`;
    const sorted = [...changeRows].sort((a, b) => a.ann - b.ann);
    document.getElementById('oecdTargetTable').innerHTML =
      '<thead><tr><th class="num">#</th><th>國家（期間）</th><th class="num">死亡人數</th><th class="num">累計</th><th class="num">年均</th><th>減半進度</th></tr></thead><tbody>' +
      sorted.map((r, i) => `<tr${r.c === TW ? ' class="oecd-tw"' : ''}><td class="num">${i + 1}</td><td>${NAME[r.c]}${COVERAGE_ISSUE.has(r.c) ? ' ※' : ''}<span class="oecd-sub">${r.base}→${r.ey}</span></td><td class="num">${fmt(r.vb)}→${fmt(r.ve)}</td><td class="num">${r.pct > 0 ? '+' : ''}${fmt(r.pct, 1)}%</td><td class="num">${r.ann > 0 ? '+' : ''}${fmt(r.ann, 1)}%</td><td>${pill(r.status)}</td></tr>`).join('') + '</tbody>'
      + (sorted.some(r => COVERAGE_ISSUE.has(r.c)) ? '<caption class="oecd-cap">※ 墨西哥死亡數統計涵蓋範圍可能不完整，降幅僅供參考。</caption>' : '');
  }

  // ---------------- 4. 嚴重度 ----------------
  let sevRows = [];
  function drawSeverity() {
    const m = st.sevMetric, M = METRICS[m];
    const excluded = [];
    sevRows = [...OECD_CODES, TW].map(c => {
      const y = st.sevYear === 'latest' ? (() => { for (let yy = YEARS[YEARS.length - 1]; yy >= D.meta.yearFrom; yy--) if (val(c, yy, m) != null && val(c, yy, 'fr') != null) return yy; return null; })()
        : (val(c, +st.sevYear, m) != null && val(c, +st.sevYear, 'fr') != null ? +st.sevYear : null);
      if (!y) return null;
      if (st.sevExclude && (CRASH_ISSUE.has(c) || COVERAGE_ISSUE.has(c))) { excluded.push(NAME[c]); return null; }
      return { c, y, x: val(c, y, 'fr'), v: val(c, y, m) };
    }).filter(Boolean);
    const refY = st.sevYear === 'latest' ? YEARS[YEARS.length - 1] : +st.sevYear;
    const others = sevRows.filter(r => r.c !== TW && !st.sel.includes(r.c));
    const sel = sevRows.filter(r => st.sel.includes(r.c));
    const tw = sevRows.filter(r => r.c === TW);
    const pt = rs => rs.map(r => ({ x: r.x, y: r.v, _r: r }));
    const ds = [
      { label: '其他 OECD 國家', data: pt(others), backgroundColor: gray(), pointRadius: 5, pointHoverRadius: 7, _labels: others.map(() => '') },
      ...sel.map(r => ({ label: NAME[r.c], data: pt([r]), backgroundColor: colorOf(r.c), borderColor: css('--surface-2'), borderWidth: 2, pointRadius: 7, pointHoverRadius: 9, _labels: [label(r.c, r.y, refY)] })),
      ...tw.map(r => ({ label: '臺灣', data: pt([r]), backgroundColor: col(1), borderColor: css('--surface-2'), borderWidth: 2, pointRadius: 9, pointHoverRadius: 11, pointStyle: 'rectRot', _labels: [label(r.c, r.y, refY)] })),
    ];
    const medX = median(sevRows.filter(r => r.c !== TW).map(r => r.x)), medY = median(sevRows.filter(r => r.c !== TW).map(r => r.v));
    const text = Util.chartTextColor(), grid = Util.chartGridColor();
    Charts.upsert('oecdSevChart', {
      type: 'scatter', data: { datasets: ds },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
        plugins: {
          legend: { labels: { color: text, boxWidth: 10, font: { size: 11 }, usePointStyle: true } },
          tooltip: { callbacks: { label: ctx => { const r = ctx.raw._r; return `${NAME[r.c]}（${r.y}）：死亡率 ${fmt(r.x, 1)}／${M.label} ${fmt(r.v, M.dec)} ${M.unit}`; } } },
          title: { display: true, text: `X：每十萬人口死亡率　Y：${M.label}（${M.unit}）｜虛線為 OECD 中位數`, color: text, font: { size: 12, weight: '600' }, align: 'start' },
        },
        scales: {
          x: { title: { display: true, text: '每十萬人口死亡率（人）', color: text }, ticks: { color: text }, grid: { color: grid }, beginAtZero: true },
          y: { title: { display: true, text: M.label, color: text }, ticks: { color: text }, grid: { color: grid }, beginAtZero: true },
        },
      },
      plugins: [pointLabelPlugin('oecdSevLabels'), vlinePlugin('oecdSevMedX', () => medX, () => ''), {
        id: 'oecdSevMedY', afterDatasetsDraw(chart) {
          if (medY == null) return; const { ctx, chartArea: a, scales: { y } } = chart; const py = y.getPixelForValue(medY);
          ctx.save(); ctx.strokeStyle = muted(); ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(a.left, py); ctx.lineTo(a.right, py); ctx.stroke(); ctx.restore();
        },
      }],
    });
    const t = tw[0];
    document.getElementById('oecdSevNote').innerHTML = (t ? `臺灣（${t.y}）${M.label} ${fmt(t.v, M.dec)} ${M.unit}，OECD 中位數 ${fmt(medY, M.dec)}。` : '')
      + (excluded.length ? ` 已排除口徑不一致國家：${excluded.join('、')}（取消勾選可顯示）。` : '');
  }

  // ---------------- 5. 明細表與匯出 ----------------
  function tableRows() {
    const codes = st.tableScope === 'all' ? [TW, ...OECD_CODES] : [TW, ...st.sel];
    const out = [];
    codes.forEach(c => D.rows.filter(r => r.c === c).sort((a, b) => a.y - b.y).forEach(r => out.push({
      country: NAME[c], code: c, member: c === TW ? '非會員' : 'OECD', year: r.y, f: r.f ?? '', i: r.i ?? '', cr: r.cr ?? '', pop: r.pop ?? '',
      fr: METRICS.fr.fn(r) != null ? +METRICS.fr.fn(r).toFixed(2) : '', ir: METRICS.ir.fn(r) != null ? +METRICS.ir.fn(r).toFixed(1) : '',
      sevCr: METRICS.sevCr.fn(r) != null ? +METRICS.sevCr.fn(r).toFixed(2) : '', sevCas: METRICS.sevCas.fn(r) != null ? +METRICS.sevCas.fn(r).toFixed(3) : '',
      note: [r.note, CRASH_ISSUE.has(c) ? '事故件數口徑疑義' : '', COVERAGE_ISSUE.has(c) ? '死亡數涵蓋範圍可能不完整' : '', c === TW ? '主計總處縣市重要統計指標' : ''].filter(Boolean).join('；'),
    })));
    return out;
  }
  const TABLE_COLS = [
    { key: 'country', label: '國家' }, { key: 'code', label: 'ISO 代碼' }, { key: 'member', label: '身分' }, { key: 'year', label: '年度' },
    { key: 'f', label: '死亡人數(30日內)' }, { key: 'i', label: '受傷人數' }, { key: 'cr', label: '傷亡事故件數' }, { key: 'pop', label: '人口數' },
    { key: 'fr', label: '每十萬人口死亡率' }, { key: 'ir', label: '每十萬人口受傷人數' }, { key: 'sevCr', label: '每千件傷亡事故死亡人數' },
    { key: 'sevCas', label: '致死率(%)' }, { key: 'note', label: '備註' },
  ];
  function drawTable() {
    const rows = tableRows();
    const num = new Set(['f', 'i', 'cr', 'pop', 'fr', 'ir', 'sevCr', 'sevCas', 'year']);
    const dec = { fr: 1, ir: 0, sevCr: 1, sevCas: 2 };
    document.getElementById('oecdTable').innerHTML = '<thead><tr>' + TABLE_COLS.map(c => `<th${num.has(c.key) ? ' class="num"' : ''}>${c.label}</th>`).join('') + '</tr></thead><tbody>' +
      rows.map(r => `<tr${r.code === TW ? ' class="oecd-tw"' : ''}>` + TABLE_COLS.map(c => {
        const v = r[c.key]; const shown = (v === '' ? '—' : (num.has(c.key) && c.key !== 'year' ? fmt(v, dec[c.key] || 0) : v));
        return `<td${num.has(c.key) ? ' class="num"' : ''}>${shown}</td>`;
      }).join('') + '</tr>').join('') + '</tbody>';
    document.getElementById('oecdTableCount').textContent = `共 ${rows.length} 筆`;
  }
  function exportCsv(which) {
    let rows, cols, name;
    if (which === 'table') { rows = tableRows(); cols = TABLE_COLS; name = 'OECD道路安全比較_明細'; }
    else if (which === 'trend') {
      const years = YEARS.filter(y => y >= st.yFrom && y <= st.yTo); const m = st.trendMetric;
      rows = [TW, ...st.sel].map(c => Object.assign({ country: NAME[c] }, ...years.map(y => ({ ['y' + y]: val(c, y, m) != null ? +val(c, y, m).toFixed(3) : '' }))));
      rows.push(Object.assign({ country: 'OECD 中位數' }, ...years.map(y => ({ ['y' + y]: +(median(OECD_CODES.map(c => val(c, y, m))) || 0).toFixed(3) }))));
      cols = [{ key: 'country', label: '國家' }, ...years.map(y => ({ key: 'y' + y, label: y + '年' }))]; name = 'OECD趨勢_' + METRICS[m].label;
    } else if (which === 'rank') {
      rows = rankRows.map((r, i) => ({ rank: i + 1, country: NAME[r.c], year: r.y, v: +r.v.toFixed(3) }));
      cols = [{ key: 'rank', label: '排名' }, { key: 'country', label: '國家' }, { key: 'year', label: '年度' }, { key: 'v', label: METRICS[st.rankMetric].label }]; name = 'OECD排名_' + METRICS[st.rankMetric].label;
    } else if (which === 'change') {
      rows = [...changeRows].sort((a, b) => a.ann - b.ann).map(r => ({ country: NAME[r.c], base: r.base, end: r.ey, vb: r.vb, ve: r.ve, pct: +r.pct.toFixed(2), ann: +r.ann.toFixed(2), need: +r.need.toFixed(2), status: { good: '達標步調', warning: '下降但落後', critical: '未下降' }[r.status] }));
      cols = [{ key: 'country', label: '國家' }, { key: 'base', label: '基準年' }, { key: 'end', label: '最新年' }, { key: 'vb', label: '基準年死亡' }, { key: 've', label: '最新死亡' }, { key: 'pct', label: '累計增減(%)' }, { key: 'ann', label: '年均增減(%)' }, { key: 'need', label: '減半所需年均(%)' }, { key: 'status', label: '減半進度' }];
      name = 'OECD減半目標進度_基準' + st.baseYear;
    } else if (which === 'sev') {
      rows = sevRows.map(r => ({ country: NAME[r.c], year: r.y, x: +r.x.toFixed(3), v: +r.v.toFixed(3) }));
      cols = [{ key: 'country', label: '國家' }, { key: 'year', label: '年度' }, { key: 'x', label: '每十萬人口死亡率' }, { key: 'v', label: METRICS[st.sevMetric].label }]; name = 'OECD嚴重度_' + METRICS[st.sevMetric].label;
    }
    Util.downloadBlob(new Blob([Util.toCsv(rows, cols)], { type: 'text/csv;charset=utf-8' }), name + '.csv');
  }
  function exportXlsx() {
    const wb = XLSX.utils.book_new();
    const toSheet = (rows, cols) => XLSX.utils.json_to_sheet(rows.map(r => Object.fromEntries(cols.map(c => [c.label, r[c.key]]))));
    const all = (() => { const keep = st.tableScope; st.tableScope = 'all'; const r = tableRows(); st.tableScope = keep; return r; })();
    XLSX.utils.book_append_sheet(wb, toSheet(all, TABLE_COLS), '明細');
    XLSX.utils.book_append_sheet(wb, toSheet(rankRows.map((r, i) => ({ rank: i + 1, country: NAME[r.c], year: r.y, v: +r.v.toFixed(3) })),
      [{ key: 'rank', label: '排名' }, { key: 'country', label: '國家' }, { key: 'year', label: '年度' }, { key: 'v', label: METRICS[st.rankMetric].label }]), '排名');
    XLSX.utils.book_append_sheet(wb, toSheet([...changeRows].sort((a, b) => a.ann - b.ann).map(r => ({ country: NAME[r.c], base: r.base, end: r.ey, vb: r.vb, ve: r.ve, pct: +r.pct.toFixed(2), ann: +r.ann.toFixed(2), status: { good: '達標步調', warning: '下降但落後', critical: '未下降' }[r.status] })),
      [{ key: 'country', label: '國家' }, { key: 'base', label: '基準年' }, { key: 'end', label: '最新年' }, { key: 'vb', label: '基準年死亡' }, { key: 've', label: '最新死亡' }, { key: 'pct', label: '累計增減(%)' }, { key: 'ann', label: '年均增減(%)' }, { key: 'status', label: '減半進度' }]), '減半目標進度');
    XLSX.writeFile(wb, 'OECD道路安全國際比較.xlsx');
  }

  // ---------------- 主繪製 ----------------
  function draw() { drawTrend(); drawRank(); drawChange(); drawSeverity(); drawTable(); }
  function render() {
    if (!inited) { init(); drawKpis(); }
    draw();
  }
  return { render };
})();
