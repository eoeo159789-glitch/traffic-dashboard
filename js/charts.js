// ============================================================
// Chart.js 圖表渲染
// ============================================================
const Charts = (() => {
  const instances = {};

  function baseOptions(extra = {}) {
    const text = Util.chartTextColor();
    const grid = Util.chartGridColor();
    return Object.assign({
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      plugins: {
        legend: { labels: { color: text, boxWidth: 12, font: { size: 11 } } },
        tooltip: { titleFont: { size: 12 }, bodyFont: { size: 12 } },
      },
      scales: {
        x: { ticks: { color: text, font: { size: 10 } }, grid: { color: grid } },
        y: { ticks: { color: text, font: { size: 10 } }, grid: { color: grid }, beginAtZero: true },
      },
    }, extra);
  }

  function upsert(id, config) {
    const canvas = document.getElementById(id);
    if (!canvas) return null;
    if (instances[id]) { instances[id].destroy(); }
    instances[id] = new Chart(canvas.getContext('2d'), config);
    return instances[id];
  }

  function exportPng(id, filename) {
    const c = instances[id];
    if (!c) return;
    const url = c.toBase64Image('image/png', 1);
    const a = document.createElement('a');
    a.href = url; a.download = (filename || id) + '.png';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  function refreshTheme() {
    Object.values(instances).forEach(c => {
      const text = Util.chartTextColor();
      const grid = Util.chartGridColor();
      if (c.options.plugins && c.options.plugins.legend) c.options.plugins.legend.labels.color = text;
      if (c.options.scales) {
        Object.values(c.options.scales).forEach(sc => {
          if (sc.ticks) sc.ticks.color = text;
          if (sc.grid) sc.grid.color = grid;
        });
      }
      c.update();
    });
  }

  // ---------------- 總覽 ----------------

  function renderTrend(accidents) {
    const byYear = new Map();
    META.accidentYears.forEach(y => byYear.set(y, { count: 0, deaths: 0, injuries: 0 }));
    accidents.forEach(a => {
      const o = byYear.get(a.year) || { count: 0, deaths: 0, injuries: 0 };
      o.count++; o.deaths += a.deaths; o.injuries += a.injuries;
      byYear.set(a.year, o);
    });
    const years = [...byYear.keys()].sort();
    upsert('trendChart', {
      type: 'line',
      data: {
        labels: years.map(y => y + '年'),
        datasets: [
          { label: '事故件數', data: years.map(y => byYear.get(y).count), borderColor: Util.seriesColor(0), backgroundColor: Util.seriesColor(0), tension: .25, borderWidth: 2, pointRadius: 3 },
          { label: '死亡人數', data: years.map(y => byYear.get(y).deaths), borderColor: Util.STATUS.critical, backgroundColor: Util.STATUS.critical, tension: .25, borderWidth: 2, pointRadius: 3, yAxisID: 'y1' },
          { label: '受傷人數', data: years.map(y => byYear.get(y).injuries), borderColor: Util.seriesColor(3), backgroundColor: Util.seriesColor(3), tension: .25, borderWidth: 2, pointRadius: 3, hidden: true },
        ],
      },
      options: baseOptions({
        scales: {
          x: { ticks: { color: Util.chartTextColor() }, grid: { display: false } },
          y: { position: 'left', ticks: { color: Util.chartTextColor() }, grid: { color: Util.chartGridColor() }, beginAtZero: true, title: { display: true, text: '事故 / 受傷 件數', color: Util.chartTextColor() } },
          y1: { position: 'right', ticks: { color: Util.STATUS.critical }, grid: { display: false }, beginAtZero: true, title: { display: true, text: '死亡人數', color: Util.STATUS.critical } },
        },
      }),
    });
  }

  function renderCountyRank(accidents) {
    const m = Util.sumBy(accidents, a => a.county, () => 1);
    const arr = Util.sortMapDesc(m);
    upsert('countyRankChart', {
      type: 'bar',
      data: {
        labels: arr.map(x => x[0]),
        datasets: [{ label: '事故件數', data: arr.map(x => x[1]), backgroundColor: Util.seriesColor(0), borderRadius: 4 }],
      },
      options: baseOptions({
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, ticks: { color: Util.chartTextColor() }, grid: { color: Util.chartGridColor() } },
          y: { ticks: { color: Util.chartTextColor(), font: { size: 10 } }, grid: { display: false } },
        },
      }),
    });
  }

  function renderSimpleDonut(canvasId, accidents, dimKey, topN = 7) {
    const dim = State.DIMENSIONS[dimKey];
    const m = Util.countBy(accidents, dim.get);
    let arr = Util.sortMapDesc(m);
    if (arr.length > topN) {
      const rest = arr.slice(topN).reduce((s, x) => s + x[1], 0);
      arr = arr.slice(0, topN);
      if (rest > 0) arr.push(['其他', rest]);
    }
    upsert(canvasId, {
      type: 'doughnut',
      data: {
        labels: arr.map(x => x[0]),
        datasets: [{ data: arr.map(x => x[1]), backgroundColor: arr.map((_, i) => Util.seriesColor(i)) }],
      },
      options: baseOptions({
        plugins: {
          legend: { position: 'right', labels: { color: Util.chartTextColor(), boxWidth: 10, font: { size: 10 } } },
        },
        scales: {},
      }),
    });
  }

  function renderHourChart(accidents) {
    const buckets = new Array(24).fill(0);
    accidents.forEach(a => { if (a.hour !== null && a.hour >= 0 && a.hour < 24) buckets[a.hour]++; });
    upsert('hourChart', {
      type: 'bar',
      data: {
        labels: buckets.map((_, i) => i + '時'),
        datasets: [{ label: '事故件數', data: buckets, backgroundColor: Util.seriesColor(2), borderRadius: 3 }],
      },
      options: baseOptions({ plugins: { legend: { display: false } } }),
    });
  }

  // ---------------- 多維探索 ----------------

  function renderSingleDim(canvasId, accidents, dimKey, topN = 15) {
    const dim = State.DIMENSIONS[dimKey];
    const m = Util.countBy(accidents, dim.get);
    let arr = Util.sortMapDesc(m).slice(0, topN);
    upsert(canvasId, {
      type: 'bar',
      data: {
        labels: arr.map(x => String(x[0])),
        datasets: [{ label: dim.label, data: arr.map(x => x[1]), backgroundColor: Util.seriesColor(0), borderRadius: 4 }],
      },
      options: baseOptions({
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, ticks: { color: Util.chartTextColor() }, grid: { color: Util.chartGridColor() } },
          y: { ticks: { color: Util.chartTextColor(), font: { size: 10 } }, grid: { display: false } },
        },
      }),
    });
  }

  function renderCauseChart(accidents) {
    const m = Util.countBy(accidents, a => a.causeMinor);
    const arr = Util.sortMapDesc(m).filter(x => x[0] && x[0] !== '尚未發現肇事因素').slice(0, 15);
    upsert('causeChart', {
      type: 'bar',
      data: {
        labels: arr.map(x => x[0]),
        datasets: [{ label: '事故件數', data: arr.map(x => x[1]), backgroundColor: Util.seriesColor(7), borderRadius: 4 }],
      },
      options: baseOptions({
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, ticks: { color: Util.chartTextColor() }, grid: { color: Util.chartGridColor() } },
          y: { ticks: { color: Util.chartTextColor(), font: { size: 10 } }, grid: { display: false } },
        },
      }),
    });
  }

  function renderCrossTable(tableId, accidents, rowKey, colKey, metric) {
    const table = document.getElementById(tableId);
    const rowDim = State.DIMENSIONS[rowKey], colDim = State.DIMENSIONS[colKey];
    const rowVals = [...new Set(accidents.map(rowDim.get).filter(v => v !== null && v !== undefined))];
    const colVals = [...new Set(accidents.map(colDim.get).filter(v => v !== null && v !== undefined))];
    // 限制欄位數避免表格過大
    const rowTop = rowVals.length > 25 ? Util.sortMapDesc(Util.countBy(accidents, rowDim.get)).slice(0, 25).map(x => x[0]) : rowVals;
    const colTop = colVals.length > 12 ? Util.sortMapDesc(Util.countBy(accidents, colDim.get)).slice(0, 12).map(x => x[0]) : colVals;

    const grid = new Map();
    let maxVal = 0;
    for (const a of accidents) {
      const r = rowDim.get(a), c = colDim.get(a);
      if (!rowTop.includes(r) || !colTop.includes(c)) continue;
      const key = r + '' + c;
      const inc = metric === 'count' ? 1 : (a[metric] || 0);
      const v = (grid.get(key) || 0) + inc;
      grid.set(key, v);
      if (v > maxVal) maxVal = v;
    }

    let html = '<thead><tr><th class="rowhead">' + rowDim.label + ' \\ ' + colDim.label + '</th>';
    colTop.forEach(c => html += `<th>${c}</th>`);
    html += '</tr></thead><tbody>';
    rowTop.forEach(r => {
      html += `<tr><th class="rowhead">${r}</th>`;
      colTop.forEach(c => {
        const v = grid.get(r + '' + c) || 0;
        const t = maxVal ? v / maxVal : 0;
        const bg = v > 0 ? Util.seqColor(t) : 'transparent';
        const textColor = t > 0.55 ? '#fff' : 'inherit';
        html += `<td class="cell" style="background:${bg};color:${textColor}">${v ? Util.fmtNum(v) : ''}</td>`;
      });
      html += '</tr>';
    });
    html += '</tbody>';
    table.innerHTML = html;
    return { rowTop, colTop, grid };
  }

  // ---------------- A2 受傷事故（彙整統計）----------------

  function renderA2Trend(rows) {
    const byYear = new Map();
    META.a2Years.forEach(y => byYear.set(y, { count: 0, injuries: 0 }));
    rows.forEach(r => {
      const o = byYear.get(r.year) || { count: 0, injuries: 0 };
      o.count += r.count; o.injuries += r.injuries;
      byYear.set(r.year, o);
    });
    const years = [...byYear.keys()].sort();
    upsert('a2TrendChart', {
      type: 'line',
      data: {
        labels: years.map(y => y + '年'),
        datasets: [
          { label: 'A2 事故件數', data: years.map(y => byYear.get(y).count), borderColor: Util.seriesColor(4), backgroundColor: Util.seriesColor(4), tension: .25, borderWidth: 2, pointRadius: 3 },
          { label: 'A2 受傷人數', data: years.map(y => byYear.get(y).injuries), borderColor: Util.seriesColor(2), backgroundColor: Util.seriesColor(2), tension: .25, borderWidth: 2, pointRadius: 3 },
        ],
      },
      options: baseOptions(),
    });
  }

  function renderA2CountyRank(rows) {
    const m = new Map();
    rows.forEach(r => m.set(r.county, (m.get(r.county) || 0) + r.count));
    const arr = Util.sortMapDesc(m);
    upsert('a2CountyRankChart', {
      type: 'bar',
      data: {
        labels: arr.map(x => x[0]),
        datasets: [{ label: 'A2 受傷事故件數', data: arr.map(x => x[1]), backgroundColor: Util.seriesColor(4), borderRadius: 4 }],
      },
      options: baseOptions({
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, ticks: { color: Util.chartTextColor() }, grid: { color: Util.chartGridColor() } },
          y: { ticks: { color: Util.chartTextColor(), font: { size: 10 } }, grid: { display: false } },
        },
      }),
    });
  }

  // 依彙整統計（agg rows，每列已含 count / injuries 加總值）繪製交叉表 / 單一維度分布
  // dimGetters: { key: (row) => value } 供 rowKey/colKey/dimKey 取值使用（A2 彙整表欄位與 State.DIMENSIONS 同名）

  function renderCrossTableAgg(tableId, rows, rowKey, colKey, metric) {
    const table = document.getElementById(tableId);
    const rowDim = State.DIMENSIONS[rowKey], colDim = State.DIMENSIONS[colKey];
    const rowTotals = Util.sumBy(rows, rowDim.get, r => r[metric] || 0);
    const colTotals = Util.sumBy(rows, colDim.get, r => r[metric] || 0);
    const rowTop = Util.sortMapDesc(rowTotals).slice(0, 25).map(x => x[0]);
    const colTop = Util.sortMapDesc(colTotals).slice(0, 12).map(x => x[0]);

    const grid = new Map();
    let maxVal = 0;
    for (const r of rows) {
      const rv = rowDim.get(r), cv = colDim.get(r);
      if (!rowTop.includes(rv) || !colTop.includes(cv)) continue;
      const key = rv + '' + cv;
      const v = (grid.get(key) || 0) + (r[metric] || 0);
      grid.set(key, v);
      if (v > maxVal) maxVal = v;
    }

    let html = '<thead><tr><th class="rowhead">' + rowDim.label + ' \\ ' + colDim.label + '</th>';
    colTop.forEach(c => html += `<th>${c}</th>`);
    html += '</tr></thead><tbody>';
    rowTop.forEach(r => {
      html += `<tr><th class="rowhead">${r}</th>`;
      colTop.forEach(c => {
        const v = grid.get(r + '' + c) || 0;
        const t = maxVal ? v / maxVal : 0;
        const bg = v > 0 ? Util.seqColor(t) : 'transparent';
        const textColor = t > 0.55 ? '#fff' : 'inherit';
        html += `<td class="cell" style="background:${bg};color:${textColor}">${v ? Util.fmtNum(v) : ''}</td>`;
      });
      html += '</tr>';
    });
    html += '</tbody>';
    table.innerHTML = html;
    return { rowTop, colTop, grid };
  }

  function renderSingleDimAgg(canvasId, rows, dimKey, metric, topN = 15) {
    const dim = State.DIMENSIONS[dimKey];
    const m = Util.sumBy(rows, dim.get, r => r[metric] || 0);
    const arr = Util.sortMapDesc(m).slice(0, topN);
    upsert(canvasId, {
      type: 'bar',
      data: {
        labels: arr.map(x => String(x[0])),
        datasets: [{ label: dim.label, data: arr.map(x => x[1]), backgroundColor: Util.seriesColor(4), borderRadius: 4 }],
      },
      options: baseOptions({
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, ticks: { color: Util.chartTextColor() }, grid: { color: Util.chartGridColor() } },
          y: { ticks: { color: Util.chartTextColor(), font: { size: 10 } }, grid: { display: false } },
        },
      }),
    });
  }

  function renderCauseChartAgg(rows, metric) {
    const m = new Map();
    rows.forEach(r => {
      if (!r.causeMinor || r.causeMinor === '尚未發現肇事因素') return;
      m.set(r.causeMinor, (m.get(r.causeMinor) || 0) + (r[metric] || 0));
    });
    const arr = Util.sortMapDesc(m).slice(0, 15);
    upsert('causeChart', {
      type: 'bar',
      data: {
        labels: arr.map(x => x[0]),
        datasets: [{ label: metric === 'injuries' ? '受傷人數' : '事故件數', data: arr.map(x => x[1]), backgroundColor: Util.seriesColor(7), borderRadius: 4 }],
      },
      options: baseOptions({
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, ticks: { color: Util.chartTextColor() }, grid: { color: Util.chartGridColor() } },
          y: { ticks: { color: Util.chartTextColor(), font: { size: 10 } }, grid: { display: false } },
        },
      }),
    });
  }

  // ---------------- 事故 vs 舉發執法 ----------------

  function renderEnfScatter(counties, years, category, accByCounty) {
    const enfByCounty = new Map();
    ENFORCEMENT.filter(e => e.category === category && e.vType === '總計' && counties.includes(e.county) && years.includes(e.year))
      .forEach(e => enfByCounty.set(e.county, (enfByCounty.get(e.county) || 0) + e.count));
    const points = counties.map(c => ({
      x: enfByCounty.get(c) || 0, y: accByCounty.get(c) || 0, label: c,
    })).filter(p => p.x > 0 || p.y > 0);

    upsert('enfScatterChart', {
      type: 'scatter',
      data: { datasets: [{ label: category + ' vs 事故件數', data: points, backgroundColor: Util.seriesColor(0) }] },
      options: baseOptions({
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => `${ctx.raw.label}：舉發 ${Util.fmtNum(ctx.raw.x)} / 事故 ${Util.fmtNum(ctx.raw.y)}` } },
        },
        scales: {
          x: { title: { display: true, text: category + ' 舉發件數', color: Util.chartTextColor() }, ticks: { color: Util.chartTextColor() }, grid: { color: Util.chartGridColor() } },
          y: { title: { display: true, text: '事故件數', color: Util.chartTextColor() }, ticks: { color: Util.chartTextColor() }, grid: { color: Util.chartGridColor() }, beginAtZero: true },
        },
      }),
    });
  }

  function renderEnfTrend(counties) {
    const cats = META.enforcementCategories.filter(c => c !== '總件數');
    const years = META.enforcementYears;
    const datasets = cats.map((cat, i) => {
      const byYear = years.map(y => ENFORCEMENT.filter(e => e.category === cat && e.vType === '總計' && e.year === y && counties.includes(e.county)).reduce((s, e) => s + e.count, 0));
      return { label: cat, data: byYear, borderColor: Util.seriesColor(i), backgroundColor: Util.seriesColor(i), tension: .25, borderWidth: 2, pointRadius: 2 };
    });
    upsert('enfTrendChart', {
      type: 'line',
      data: { labels: years.map(y => y + '年'), datasets },
      options: baseOptions(),
    });
  }

  function renderEnfBar(counties, years, accByCountyAll, deathsByCountyAll) {
    const totalEnf = new Map();
    ENFORCEMENT.filter(e => e.category === '總件數' && counties.includes(e.county) && years.includes(e.year))
      .forEach(e => totalEnf.set(e.county, (totalEnf.get(e.county) || 0) + e.count));
    const rows = counties.map(c => {
      const enf = totalEnf.get(c) || 0;
      const acc = accByCountyAll.get(c) || 0;
      const deaths = deathsByCountyAll.get(c) || 0;
      return { c, enf, acc, deaths, ratio: enf > 0 ? (acc / enf) * 10000 : 0 };
    }).sort((a, b) => b.ratio - a.ratio);
    upsert('enfBarChart', {
      type: 'bar',
      data: {
        labels: rows.map(r => r.c),
        datasets: [
          { label: '每萬件舉發對應事故件數', data: rows.map(r => Number(r.ratio.toFixed(1))), backgroundColor: Util.seriesColor(0), borderRadius: 4 },
        ],
      },
      options: baseOptions({
        plugins: { legend: { display: true } },
        scales: {
          x: { ticks: { color: Util.chartTextColor(), font: { size: 10 } }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: Util.chartTextColor() }, grid: { color: Util.chartGridColor() } },
        },
      }),
    });
  }

  // 各縣市道路交通違規罰鍰收入分配金額（111-114年，資料來源：政府資料開放平台 dataset 167869）
  // yearOrTotal 為西元年（2022-2025）數字，或字串 'total' 代表四年合計排行
  function renderEnfFines(counties, yearOrTotal) {
    const F = window.ENFORCEMENT_FINES;
    if (!F || !F.years || F.years.length === 0) return;
    let rows;
    let label;
    if (yearOrTotal === 'total') {
      rows = F.totals.filter(t => counties.includes(t.county) && t.total != null).map(t => ({ c: t.county, amount: t.total }));
      label = `${F.years[0]}–${F.years[F.years.length - 1]}年合計罰鍰收入（萬元）`;
    } else {
      const year = Number(yearOrTotal);
      rows = F.records.filter(r => r.year === year && counties.includes(r.county)).map(r => ({ c: r.county, amount: r.amount }));
      label = `${year}年罰鍰收入（萬元）`;
    }
    rows.sort((a, b) => b.amount - a.amount);
    upsert('finesChart', {
      type: 'bar',
      data: {
        labels: rows.map(r => r.c),
        datasets: [{ label, data: rows.map(r => Number((r.amount / 10000).toFixed(1))), backgroundColor: Util.seriesColor(3), borderRadius: 4 }],
      },
      options: baseOptions({
        indexAxis: 'y',
        plugins: { legend: { display: true } },
        scales: {
          x: { beginAtZero: true, ticks: { color: Util.chartTextColor() }, grid: { color: Util.chartGridColor() } },
          y: { ticks: { color: Util.chartTextColor(), font: { size: 10 } }, grid: { display: false } },
        },
      }),
    });
  }

  // ---------------- 事故 vs 人口/縣市 ----------------

  // accType：選填，指定時只計入該事故類型(大類別)的事故件數（不篩選則計入全部類型）
  function renderPopRate(counties, year, accType) {
    const pop = new Map();
    INDICATORS.filter(i => i.indicator === '男性人口(人)' && i.year === year && counties.includes(i.county))
      .forEach(i => pop.set(i.county, (pop.get(i.county) || 0) + i.value));
    INDICATORS.filter(i => i.indicator === '女性人口(人)' && i.year === year && counties.includes(i.county))
      .forEach(i => pop.set(i.county, (pop.get(i.county) || 0) + i.value));
    const accInYear = ACCIDENTS.filter(a => a.year === year && counties.includes(a.county) && (!accType || a.accTypeMajor === accType));
    const accByCounty = Util.sumBy(accInYear, a => a.county, () => 1);
    const rows = counties.map(c => {
      const p = pop.get(c) || 0;
      const acc = accByCounty.get(c) || 0;
      return { c, rate: p > 0 ? (acc / p) * 100000 : 0 };
    }).filter(r => r.rate > 0).sort((a, b) => b.rate - a.rate);
    upsert('popRateChart', {
      type: 'bar',
      data: { labels: rows.map(r => r.c), datasets: [{ label: '每十萬人口事故件數', data: rows.map(r => Number(r.rate.toFixed(1))), backgroundColor: Util.seriesColor(2), borderRadius: 4 }] },
      options: baseOptions({
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, ticks: { color: Util.chartTextColor() }, grid: { color: Util.chartGridColor() } },
          y: { ticks: { color: Util.chartTextColor(), font: { size: 10 } }, grid: { display: false } },
        },
      }),
    });
  }

  // -- 人口密度 vs 事故密度：輔助函式 --
  function indicatorValue(name, county, year) {
    const row = INDICATORS.find(i => i.indicator === name && i.county === county && i.year === year);
    return row ? row.value : null;
  }
  // 官方指標未直接提供各縣市土地面積，以「（男性人口＋女性人口）÷ 人口密度」反推
  // （皆為官方公布數字之四則運算組合，非新增推估假設）。
  function computeAreaSqKm(county, year) {
    const male = indicatorValue('男性人口(人)', county, year);
    const female = indicatorValue('女性人口(人)', county, year);
    const dens = indicatorValue('人口密度(人/平方公里)', county, year);
    if (male == null || female == null || !dens) return null;
    return (male + female) / dens;
  }
  function densityQuadIndex(x, y, meanX, meanY) {
    const xHigh = x >= meanX, yHigh = y >= meanY;
    if (xHigh && yHigh) return 0;
    if (!xHigh && yHigh) return 1;
    if (!xHigh && !yHigh) return 2;
    return 3;
  }
  function renderDensityQuadLegend(groups, xLabel, yLabel) {
    const descs = [
      `${xLabel}高於平均、${yLabel}高於平均`,
      `${xLabel}低於平均、${yLabel}高於平均`,
      `${xLabel}低於平均、${yLabel}低於平均`,
      `${xLabel}高於平均、${yLabel}低於平均`,
    ];
    const html = [0, 1, 2, 3].map(q => {
      const names = groups[q] || [];
      return `
        <div class="quad-box">
          <div class="quad-box-head"><span class="quad-dot" style="background:${QUADRANT_COLORS[q]}"></span>${descs[q]}（${names.length} 縣市）</div>
          <div class="quad-box-list">${names.length ? names.join('、') : '（無）'}</div>
        </div>
      `;
    }).join('');
    const el = document.getElementById('densityQuadLegend');
    if (el) el.innerHTML = html;
  }

  // yearSel: 數字年度，或 'all' 代表全部年度加總／平均。showLabels：是否在圖上直接標示縣市名稱。
  // accType：選填，指定時只計入該事故類型(大類別)的事故件數。
  function renderDensityScatter(counties, yearSel, showLabels, accType) {
    const years = META.accidentYears;
    const isAll = yearSel === 'all' || yearSel == null;
    const accMatches = a => !accType || a.accTypeMajor === accType;
    const points = [];
    counties.forEach(c => {
      let popDensity = null, accDensity = null;
      if (isAll) {
        let area = null;
        const densVals = [];
        years.forEach(y => {
          const a = computeAreaSqKm(c, y);
          if (a != null) area = a; // 土地面積年度間變動極小，取任一有值年度即可
          const d = indicatorValue('人口密度(人/平方公里)', c, y);
          if (d != null) densVals.push(d);
        });
        if (area == null || densVals.length === 0) return;
        const totalAcc = ACCIDENTS.filter(a => a.county === c && accMatches(a)).length;
        popDensity = densVals.reduce((s, v) => s + v, 0) / densVals.length;
        accDensity = totalAcc / area;
      } else {
        const y = Number(yearSel);
        const area = computeAreaSqKm(c, y);
        const dens = indicatorValue('人口密度(人/平方公里)', c, y);
        if (area == null || dens == null) return;
        const accCount = ACCIDENTS.filter(a => a.county === c && a.year === y && accMatches(a)).length;
        popDensity = dens;
        accDensity = accCount / area;
      }
      points.push({ x: popDensity, y: accDensity, label: c });
    });

    if (points.length === 0) {
      upsert('densityScatterChart', { type: 'scatter', data: { datasets: [] }, options: baseOptions({}) });
      renderDensityQuadLegend({ 0: [], 1: [], 2: [], 3: [] }, '人口密度', '事故密度');
      return;
    }

    const meanX = points.reduce((s, p) => s + p.x, 0) / points.length;
    const meanY = points.reduce((s, p) => s + p.y, 0) / points.length;
    const groups = { 0: [], 1: [], 2: [], 3: [] };
    const tagged = points.map(p => {
      const q = densityQuadIndex(p.x, p.y, meanX, meanY);
      groups[q].push(p.label);
      return Object.assign({}, p, { q });
    });

    renderImproveScatter('densityScatterChart', tagged, '人口密度', '事故密度', meanX, meanY, '人/km²', '件/km²', !!showLabels);
    renderDensityQuadLegend(groups, '人口密度', '事故密度');
  }

  function renderLongTrend(counties) {
    const allCountySelected = counties.length === META.counties.length;
    const scope = allCountySelected ? '__TOTAL__' : null;
    const years = [...new Set(INDICATORS.filter(i => i.indicator === '事故傷害死亡率(人/每十萬人口)').map(i => i.year))].sort();
    let deathRate, totalPop;
    if (scope) {
      deathRate = years.map(y => (INDICATORS.find(i => i.indicator === '事故傷害死亡率(人/每十萬人口)' && i.year === y && i.county === '__TOTAL__') || {}).value ?? null);
      totalPop = years.map(y => {
        const male = INDICATORS.find(i => i.indicator === '男性人口(人)' && i.year === y && i.county === '__TOTAL__');
        const female = INDICATORS.find(i => i.indicator === '女性人口(人)' && i.year === y && i.county === '__TOTAL__');
        return (male ? male.value : 0) + (female ? female.value : 0) || null;
      });
    } else {
      deathRate = years.map(y => {
        const vals = counties.map(c => INDICATORS.find(i => i.indicator === '事故傷害死亡率(人/每十萬人口)' && i.year === y && i.county === c)).filter(Boolean).map(i => i.value);
        return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
      });
      totalPop = years.map(y => {
        let sum = 0, any = false;
        counties.forEach(c => {
          const male = INDICATORS.find(i => i.indicator === '男性人口(人)' && i.year === y && i.county === c);
          const female = INDICATORS.find(i => i.indicator === '女性人口(人)' && i.year === y && i.county === c);
          if (male) { sum += male.value; any = true; }
          if (female) { sum += female.value; any = true; }
        });
        return any ? sum : null;
      });
    }
    upsert('longTrendChart', {
      type: 'line',
      data: {
        labels: years,
        datasets: [
          { label: '事故傷害死亡率（人/每十萬人口）', data: deathRate, borderColor: Util.STATUS.critical, backgroundColor: Util.STATUS.critical, borderWidth: 2, pointRadius: 0, tension: .2 },
          { label: '人口數（右軸）', data: totalPop, borderColor: Util.seriesColor(0), backgroundColor: Util.seriesColor(0), borderWidth: 2, pointRadius: 0, tension: .2, yAxisID: 'y1' },
        ],
      },
      options: baseOptions({
        scales: {
          x: { ticks: { color: Util.chartTextColor(), maxTicksLimit: 15 }, grid: { display: false } },
          y: { position: 'left', ticks: { color: Util.STATUS.critical }, grid: { color: Util.chartGridColor() }, title: { display: true, text: '每十萬人死亡人數(人)', color: Util.STATUS.critical } },
          y1: { position: 'right', ticks: { color: Util.seriesColor(0) }, grid: { display: false }, title: { display: true, text: '人口數', color: Util.seriesColor(0) } },
        },
      }),
    });
  }

  // ---------------- 改善趨勢分析 ----------------

  // 各縣市改善排行：rows = [{county, start, end, pct}]，pct 正值=改善(減少)，負值=惡化(增加)
  function renderImproveRank(canvasId, rows, seriesLabel) {
    upsert(canvasId, {
      type: 'bar',
      data: {
        labels: rows.map(r => r.county),
        datasets: [{
          label: seriesLabel,
          data: rows.map(r => Number(r.pct.toFixed(1))),
          backgroundColor: rows.map(r => r.pct >= 0 ? Util.STATUS.good : Util.STATUS.critical),
          borderRadius: 4,
        }],
      },
      options: baseOptions({
        indexAxis: 'y',
        plugins: { legend: { display: true } },
        scales: {
          x: { ticks: { color: Util.chartTextColor() }, grid: { color: Util.chartGridColor() } },
          y: { ticks: { color: Util.chartTextColor(), font: { size: 10 } }, grid: { display: false } },
        },
      }),
    });
  }

  // 當事者年齡結構 vs 人口年齡結構「涉入比」排行：rows = [{county, ratio}]
  // ratio = 該縣市當事者中該齡層佔比 ÷ 該縣市人口中該齡層佔比；1.0 = 涉入比例與人口比例相同
  // refLine 固定畫在 x=1 的虛線，ratio>=1 用 warning 色（高於人口比例），< 1 用藍色（低於人口比例）
  function renderRatioRank(canvasId, rows, seriesLabel) {
    const refLinePlugin = {
      id: 'ratioRefLine',
      afterDraw(chart) {
        const { ctx, chartArea, scales } = chart;
        if (!chartArea) return;
        const xPix = scales.x.getPixelForValue(1);
        ctx.save();
        ctx.strokeStyle = Util.chartGridColor();
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(xPix, chartArea.top);
        ctx.lineTo(xPix, chartArea.bottom);
        ctx.stroke();
        ctx.restore();
        ctx.save();
        ctx.setLineDash([]);
        ctx.fillStyle = Util.chartTextColor();
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('涉入比＝1.0（與人口比例相同）', Math.min(xPix + 4, chartArea.right - 160), chartArea.top + 2);
        ctx.restore();
      },
    };

    upsert(canvasId, {
      type: 'bar',
      data: {
        labels: rows.map(r => r.county),
        datasets: [{
          label: seriesLabel,
          data: rows.map(r => Number(r.ratio.toFixed(2))),
          backgroundColor: rows.map(r => r.ratio >= 1 ? Util.STATUS.warning : Util.seriesColor(0)),
          borderRadius: 4,
        }],
      },
      options: baseOptions({
        indexAxis: 'y',
        plugins: { legend: { display: true } },
        scales: {
          x: { ticks: { color: Util.chartTextColor() }, grid: { color: Util.chartGridColor() } },
          y: { ticks: { color: Util.chartTextColor(), font: { size: 10 } }, grid: { display: false } },
        },
      }),
      plugins: [refLinePlugin],
    });
  }

  // 舉發／罰鍰變化 vs 事故改善對照象限圖
  // points = [{x, y, label, q}]，q = 0~3 象限編號（由呼叫端依平均值算好，0=右上 1=左上 2=左下 3=右下）
  // meanX / meanY = 兩軸的平均值（象限分界線）
  const QUADRANT_COLORS = [Util.seriesColor(0), Util.seriesColor(2), Util.seriesColor(1), Util.seriesColor(7)];

  // xUnit / yUnit：附加在數值後面的單位文字（預設 '%'，維持既有改善%／變化% 圖表的行為）；
  // 傳空字串 '' 表示不附加任何單位。
  // showLabels：是否在每個點旁直接標示 label 文字（預設 false，不影響既有呼叫端的圖表外觀）
  function renderImproveScatter(canvasId, points, xLabel, yLabel, meanX, meanY, xUnit = '%', yUnit = '%', showLabels = false) {
    const pointLabelsPlugin = {
      id: 'improveScatterPointLabels',
      afterDatasetsDraw(chart) {
        if (!showLabels) return;
        const meta = chart.getDatasetMeta(0);
        if (!meta || !meta.data) return;
        const { ctx } = chart;
        ctx.save();
        ctx.font = '11px sans-serif';
        ctx.fillStyle = Util.chartTextColor();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        meta.data.forEach((el, i) => {
          const raw = points[i];
          if (!raw) return;
          ctx.fillText(raw.label, el.x, el.y - 8);
        });
        ctx.restore();
      },
    };
    const quadLinesPlugin = {
      id: 'improveQuadLines',
      afterDraw(chart) {
        const { ctx, chartArea, scales } = chart;
        if (!chartArea) return;
        const xPix = scales.x.getPixelForValue(meanX);
        const yPix = scales.y.getPixelForValue(meanY);
        ctx.save();
        ctx.strokeStyle = '#e5484d';
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 1.75;
        ctx.beginPath();
        ctx.moveTo(xPix, chartArea.top);
        ctx.lineTo(xPix, chartArea.bottom);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(chartArea.left, yPix);
        ctx.lineTo(chartArea.right, yPix);
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.setLineDash([]);
        ctx.fillStyle = Util.chartTextColor();
        ctx.font = '11px sans-serif';
        const xLabelText = `平均 ${Util.fmtNum(Math.round(meanX * 10) / 10)}${xUnit}`;
        const xTextX = Math.min(Math.max(xPix + 4, chartArea.left + 2), chartArea.right - ctx.measureText(xLabelText).width - 2);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(xLabelText, xTextX, chartArea.top + 2);
        const yLabelText = `平均 ${Util.fmtNum(Math.round(meanY * 10) / 10)}${yUnit}`;
        ctx.textAlign = 'right';
        ctx.textBaseline = Math.abs(yPix - chartArea.top) < 14 ? 'top' : 'bottom';
        ctx.fillText(yLabelText, chartArea.right - 2, yPix - 2 >= chartArea.top ? yPix - 2 : yPix + 14);
        ctx.restore();
      },
    };

    upsert(canvasId, {
      type: 'scatter',
      data: {
        datasets: [{
          label: `${points.length} 個縣市`,
          data: points,
          backgroundColor: (ctx) => ctx.raw ? QUADRANT_COLORS[ctx.raw.q] : QUADRANT_COLORS[0],
          pointRadius: 6,
          pointHoverRadius: 8,
        }],
      },
      options: baseOptions({
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.raw.label}：${xLabel} ${Util.fmtNum(ctx.raw.x)}${xUnit}，${yLabel} ${Util.fmtNum(ctx.raw.y)}${yUnit}`,
            },
          },
        },
        scales: {
          x: { title: { display: true, text: xLabel + (xUnit ? `（${xUnit}）` : ''), color: Util.chartTextColor() }, ticks: { color: Util.chartTextColor() }, grid: { color: Util.chartGridColor() } },
          y: { title: { display: true, text: yLabel + (yUnit ? `（${yUnit}）` : ''), color: Util.chartTextColor() }, ticks: { color: Util.chartTextColor() }, grid: { color: Util.chartGridColor() } },
        },
      }),
      plugins: [quadLinesPlugin, pointLabelsPlugin],
    });
  }

  return {
    upsert, exportPng, refreshTheme,
    renderImproveRank, renderImproveScatter, renderRatioRank,
    renderTrend, renderCountyRank, renderSimpleDonut, renderHourChart,
    renderSingleDim, renderCauseChart, renderCrossTable,
    renderEnfScatter, renderEnfTrend, renderEnfBar, renderEnfFines,
    renderPopRate, renderDensityScatter, renderLongTrend,
    renderA2Trend, renderA2CountyRank, renderCrossTableAgg, renderSingleDimAgg, renderCauseChartAgg,
  };
})();
