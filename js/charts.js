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

  // ---------------- 事故 vs 人口/縣市 ----------------

  function renderPopRate(counties, year) {
    const pop = new Map();
    INDICATORS.filter(i => i.indicator === '男性人口(人)' && i.year === year && counties.includes(i.county))
      .forEach(i => pop.set(i.county, (pop.get(i.county) || 0) + i.value));
    INDICATORS.filter(i => i.indicator === '女性人口(人)' && i.year === year && counties.includes(i.county))
      .forEach(i => pop.set(i.county, (pop.get(i.county) || 0) + i.value));
    const accInYear = ACCIDENTS.filter(a => a.year === year && counties.includes(a.county));
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

  function renderDensityScatter(counties) {
    const years = META.accidentYears;
    const points = [];
    counties.forEach(c => {
      years.forEach(y => {
        const dens = INDICATORS.find(i => i.indicator === '人口密度(人/平方公里)' && i.county === c && i.year === y);
        if (!dens) return;
        const accCount = ACCIDENTS.filter(a => a.county === c && a.year === y).length;
        points.push({ x: dens.value, y: accCount, label: `${c} ${y}` });
      });
    });
    upsert('densityScatterChart', {
      type: 'scatter',
      data: { datasets: [{ label: '人口密度 vs 事故件數', data: points, backgroundColor: Util.seriesColor(4) }] },
      options: baseOptions({
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.raw.label}：密度 ${Util.fmtNum(ctx.raw.x)} / 事故 ${Util.fmtNum(ctx.raw.y)}` } } },
        scales: {
          x: { title: { display: true, text: '人口密度（人/平方公里）', color: Util.chartTextColor() }, ticks: { color: Util.chartTextColor() }, grid: { color: Util.chartGridColor() } },
          y: { title: { display: true, text: '事故件數', color: Util.chartTextColor() }, ticks: { color: Util.chartTextColor() }, grid: { color: Util.chartGridColor() }, beginAtZero: true },
        },
      }),
    });
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
          y: { position: 'left', ticks: { color: Util.STATUS.critical }, grid: { color: Util.chartGridColor() }, title: { display: true, text: '死亡率', color: Util.STATUS.critical } },
          y1: { position: 'right', ticks: { color: Util.seriesColor(0) }, grid: { display: false }, title: { display: true, text: '人口數', color: Util.seriesColor(0) } },
        },
      }),
    });
  }

  return {
    upsert, exportPng, refreshTheme,
    renderTrend, renderCountyRank, renderSimpleDonut, renderHourChart,
    renderSingleDim, renderCauseChart, renderCrossTable,
    renderEnfScatter, renderEnfTrend, renderEnfBar,
    renderPopRate, renderDensityScatter, renderLongTrend,
  };
})();
