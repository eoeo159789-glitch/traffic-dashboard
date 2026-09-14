// ============================================================
// 全域篩選狀態 + 資料存取層
// ============================================================
const State = (() => {

  const listeners = [];
  function onChange(fn) { listeners.push(fn); }
  function emitChange() { listeners.forEach(fn => fn()); }

  // ---- 維度定義（供交叉比對 / 單一維度分布 / 篩選晶片使用）----
  const DIMENSIONS = {
    county:      { label: '縣市',          get: a => a.county },
    year:        { label: '年度',          get: a => a.year },
    month:       { label: '月份',          get: a => a.month },
    hour:        { label: '時段（小時）',   get: a => a.hour },
    weather:     { label: '天候',          get: a => a.weather },
    light:       { label: '光線',          get: a => a.light },
    roadClass:   { label: '道路類別',      get: a => a.roadClass },
    roadType:    { label: '道路型態',      get: a => a.roadType },
    posType:     { label: '事故位置',      get: a => a.posType },
    signalType:  { label: '號誌種類',      get: a => a.signalType },
    accTypeMajor:{ label: '事故類型(大類別)', get: a => a.accTypeMajor },
    accTypeMinor:{ label: '事故類型(子類別)', get: a => a.accTypeMinor },
    causeMajor:  { label: '肇因(大類別)',   get: a => a.causeMajor },
    causeMinor:  { label: '肇因(子類別)',   get: a => a.causeMinor },
    hitRun:      { label: '是否肇逃',       get: a => a.hitRun },
    surface:     { label: '路面鋪裝',       get: a => a.surface },
  };

  const filters = {
    years: new Set(META.accidentYears),
    counties: new Set(META.counties),
    weather: new Set(),   // 空集合 = 不限制
    light: new Set(),
    roadClass: new Set(),
    accTypeMajor: new Set(),
    causeMajor: new Set(),
  };

  function uniqueValues(key) {
    const s = new Set();
    ACCIDENTS.forEach(a => { const v = DIMENSIONS[key].get(a); if (v) s.add(v); });
    return [...s].sort();
  }

  function matches(a) {
    if (!filters.years.has(a.year)) return false;
    if (!filters.counties.has(a.county)) return false;
    if (filters.weather.size && !filters.weather.has(a.weather)) return false;
    if (filters.light.size && !filters.light.has(a.light)) return false;
    if (filters.roadClass.size && !filters.roadClass.has(a.roadClass)) return false;
    if (filters.accTypeMajor.size && !filters.accTypeMajor.has(a.accTypeMajor)) return false;
    if (filters.causeMajor.size && !filters.causeMajor.has(a.causeMajor)) return false;
    return true;
  }

  let _cache = null;
  function filtered() {
    if (_cache) return _cache;
    _cache = ACCIDENTS.filter(matches);
    return _cache;
  }

  // ---- A2（受傷）彙整統計資料：套用側邊欄篩選 ----
  // A2_CROSSTAB 具備與 A1 相同的維度欄位（county/weather/light/roadClass/accTypeMajor/causeMajor 等），
  // 故可直接沿用側邊欄篩選條件；A2_BY_COUNTY / A2_BY_MONTH / A2_BY_HOUR / A2_ACC_TYPE_MINOR /
  // A2_CAUSE_MINOR / A2_GEO 僅有 year + county 兩個共通維度，僅套用年度與縣市篩選。
  let _a2CrosstabCache = null, _a2YearCountyCache = {};
  function matchesA2Crosstab(r) {
    if (!filters.years.has(r.year)) return false;
    if (!filters.counties.has(r.county)) return false;
    if (filters.weather.size && !filters.weather.has(r.weather)) return false;
    if (filters.light.size && !filters.light.has(r.light)) return false;
    if (filters.roadClass.size && !filters.roadClass.has(r.roadClass)) return false;
    if (filters.accTypeMajor.size && !filters.accTypeMajor.has(r.accTypeMajor)) return false;
    if (filters.causeMajor.size && !filters.causeMajor.has(r.causeMajor)) return false;
    return true;
  }
  function a2CrosstabFiltered() {
    if (_a2CrosstabCache) return _a2CrosstabCache;
    _a2CrosstabCache = (window.A2_CROSSTAB || []).filter(matchesA2Crosstab);
    return _a2CrosstabCache;
  }
  function a2YearCountyFiltered(dataName) {
    if (_a2YearCountyCache[dataName]) return _a2YearCountyCache[dataName];
    const arr = window[dataName] || [];
    const out = arr.filter(r => filters.years.has(r.year) && filters.counties.has(r.county));
    _a2YearCountyCache[dataName] = out;
    return out;
  }
  function a2ByCountyFiltered() { return a2YearCountyFiltered('A2_BY_COUNTY'); }
  function a2ByMonthFiltered() { return a2YearCountyFiltered('A2_BY_MONTH'); }
  function a2ByHourFiltered() { return a2YearCountyFiltered('A2_BY_HOUR'); }
  function a2AccTypeMinorFiltered() { return a2YearCountyFiltered('A2_ACC_TYPE_MINOR'); }
  function a2CauseMinorFiltered() { return a2YearCountyFiltered('A2_CAUSE_MINOR'); }
  function a2GeoFiltered() { return a2YearCountyFiltered('A2_GEO'); }

  function invalidate() {
    _cache = null;
    _a2CrosstabCache = null;
    _a2YearCountyCache = {};
    emitChange();
  }

  function toggleInSet(setKey, value) {
    const s = filters[setKey];
    if (s.has(value)) s.delete(value); else s.add(value);
    invalidate();
  }

  function setAll(setKey, values) {
    filters[setKey] = new Set(values);
    invalidate();
  }

  function resetAll() {
    filters.years = new Set(META.accidentYears);
    filters.counties = new Set(META.counties);
    filters.weather = new Set();
    filters.light = new Set();
    filters.roadClass = new Set();
    filters.accTypeMajor = new Set();
    filters.causeMajor = new Set();
    invalidate();
  }

  function partiesFor(accidents) {
    const ids = new Set(accidents.map(a => a.id));
    return PARTIES.filter(p => ids.has(p.aid));
  }

  // ---- 熱點路口（1000易肇事路口 / 799人行安全補助點位）與環域分析 ----
  // 這兩份點位資料與環域統計不受側邊欄篩選影響（獨立資料集，有自己的分頁篩選）
  function hotspotPoints() { return window.POINTS_HOTSPOT1000 || []; }
  function safety799Points() { return window.POINTS_SAFETY799 || []; }
  // 科技執法設備地點：完整清單（含無座標者，供文字參考／表格展示），與僅有座標可上地圖／環域分析者
  // 補上 township 別名（原始欄位為 district），讓熱點查詢／環域分析共用邏輯（p.township）可正常運作
  const COORD_SOURCE_LABEL = {
    official: '官方座標',
    estimated_high: '推估座標-較高信心',
    estimated_low: '推估座標-低信心（僅供參考）',
  };
  let _techEnfCache = null;
  function techEnforcementPoints() {
    if (_techEnfCache) return _techEnfCache;
    _techEnfCache = (window.POINTS_TECH_ENFORCEMENT || []).map(p => Object.assign({}, p, {
      township: p.district, name: p.loc,
      coordSourceLabel: p.hasCoords ? (COORD_SOURCE_LABEL[p.coordSource] || '官方座標') : '',
    }));
    return _techEnfCache;
  }
  function techEnforcementPointsWithCoords() { return techEnforcementPoints().filter(p => p.hasCoords && p.lat != null && p.lng != null); }
  function pointsByDataset(key) {
    if (key === 'safety799') return safety799Points();
    if (key === 'techEnforcement') return techEnforcementPointsWithCoords();
    return hotspotPoints();
  }
  function bufferA1For(pointId) { return (window.POINT_BUFFER_A1 || {})[pointId] || null; }
  function bufferA2For(pointId) { return (window.POINT_BUFFER_A2 || {})[pointId] || null; }
  function geoJump() { return window.GEO_JUMP || { counties: [], townships: [] }; }

  // 自訂座標的即時環域分析：A1 用逐筆精確計算（資料量小），A2 用 1 公里網格資料概略估算
  function customBufferStats(lat, lng, radiusM) {
    let a1Count = 0, a1Deaths = 0, a1Injuries = 0;
    ACCIDENTS.forEach(a => {
      if (a.lat == null || a.lng == null) return;
      if (Util.distMeters(lat, lng, a.lat, a.lng) <= radiusM) {
        a1Count++; a1Deaths += a.deaths; a1Injuries += a.injuries;
      }
    });
    let a2Count = 0, a2Injuries = 0;
    (window.A2_GEO || []).forEach(g => {
      // 網格中心到查詢點距離扣除半個網格對角線寬容度（約 1.1 公里網格 -> 容許 800 公尺），避免邊界網格被漏算
      if (Util.distMeters(lat, lng, g.lat, g.lng) <= radiusM + 800) {
        a2Count += g.count; a2Injuries += g.injuries;
      }
    });
    return { a1Count, a1Deaths, a1Injuries, a2Count, a2Injuries };
  }

  // 指定熱點/補助點位在「任意半徑」下的統計：
  // 半徑剛好等於建置時預先計算的固定選項（META.bufferRadii）時，直接查表回傳精確結果（A1、A2 皆精確）；
  // 其他自訂半徑則即時計算：A1 一樣逐筆精確比對（資料量小、可即時運算），A2 沿用網格概略估算（同 customBufferStats）。
  function pointStatsAtRadius(point, radiusM) {
    const presets = (window.META && META.bufferRadii) || [];
    if (presets.includes(radiusM)) {
      const a1 = bufferA1For(point.id);
      const a2 = bufferA2For(point.id);
      const b1 = a1 && a1[radiusM] ? a1[radiusM] : null;
      const b2 = a2 && a2[radiusM] ? a2[radiusM] : null;
      if (b1 && b2) {
        return {
          a1Count: b1[0], a1Deaths: b1[1], a1Injuries: b1[2],
          a2Count: b2[0], a2Injuries: b2[1], exactA2: true,
        };
      }
    }
    const approx = customBufferStats(point.lat, point.lng, radiusM);
    return {
      a1Count: approx.a1Count, a1Deaths: approx.a1Deaths, a1Injuries: approx.a1Injuries,
      a2Count: approx.a2Count, a2Injuries: approx.a2Injuries, exactA2: false,
    };
  }

  // 多個點位「合計」統計（熱點查詢未指定單一點位、依篩選條件一次查詢全部點位時使用）：
  // 不能直接把每個點位各自的環域統計加總，因為點位彼此靠近時同一起事故／同一個 A2 網格會落在多個點位的半徑內而被重複計算，
  // 導致總數被嚴重高估。因此改成「去重」計算：每一筆事故／每個 A2 網格只要落在「任一」篩選點位的半徑內就算一次。
  // A1 資料量小可即時逐筆精確比對；A2 仍沿用網格概略估算（同 customBufferStats），因此此函式的 A2 一律標記為概略估算。
  function aggregateBufferStats(points, radiusM) {
    let a1Count = 0, a1Deaths = 0, a1Injuries = 0;
    ACCIDENTS.forEach(a => {
      if (a.lat == null || a.lng == null) return;
      for (let i = 0; i < points.length; i++) {
        if (Util.distMeters(points[i].lat, points[i].lng, a.lat, a.lng) <= radiusM) {
          a1Count++; a1Deaths += a.deaths; a1Injuries += a.injuries;
          break;
        }
      }
    });
    let a2Count = 0, a2Injuries = 0;
    (window.A2_GEO || []).forEach(g => {
      for (let i = 0; i < points.length; i++) {
        if (Util.distMeters(points[i].lat, points[i].lng, g.lat, g.lng) <= radiusM + 800) {
          a2Count += g.count; a2Injuries += g.injuries;
          break;
        }
      }
    });
    return { a1Count, a1Deaths, a1Injuries, a2Count, a2Injuries, exactA2: false };
  }

  // ---- 科技執法涵蓋查詢：以易肇事路口／人行安全點位為中心，找半徑內有幾處科技執法設備 ----
  // 與 pointStatsAtRadius／aggregateBufferStats（算「點位半徑內有多少事故」）方向相反：
  // 這裡算「點位半徑內有多少科技執法設備」，供「圖3-3」報告涵蓋率圖表同等邏輯的網站即時查詢版本。
  // 直線距離計算方式與 build_buffer_compare_xlsx.py／Util.distMeters 一致（等距圓柱投影近似，短距離誤差可忽略）。
  function techEnfWithinRadius(point, radiusM) {
    const devices = techEnforcementPointsWithCoords();
    let nearestM = null;
    const matched = [];
    devices.forEach(d => {
      const dist = Util.distMeters(point.lat, point.lng, d.lat, d.lng);
      if (nearestM === null || dist < nearestM) nearestM = dist;
      if (dist <= radiusM) matched.push(Object.assign({}, d, { distanceM: dist }));
    });
    matched.sort((a, b) => a.distanceM - b.distanceM);
    return { count: matched.length, nearestM, devices: matched };
  }

  // 多點合計（去重）：同一處科技執法設備若同時落在多個查詢點位的半徑內，只計算一次，
  // 避免點位彼此靠近時，同一處設備被重複計入、導致涵蓋數字失真膨脹（邏輯同 aggregateBufferStats）。
  function aggregateTechEnfCoverage(points, radiusM) {
    const devices = techEnforcementPointsWithCoords();
    const matched = [];
    devices.forEach(d => {
      for (let i = 0; i < points.length; i++) {
        const dist = Util.distMeters(points[i].lat, points[i].lng, d.lat, d.lng);
        if (dist <= radiusM) { matched.push(Object.assign({}, d, { distanceM: dist })); break; }
      }
    });
    matched.sort((a, b) => a.distanceM - b.distanceM);
    return { count: matched.length, devices: matched };
  }

  return {
    DIMENSIONS, filters, uniqueValues, matches, filtered, invalidate,
    toggleInSet, setAll, resetAll, onChange, partiesFor,
    a2CrosstabFiltered, a2ByCountyFiltered, a2ByMonthFiltered, a2ByHourFiltered,
    a2AccTypeMinorFiltered, a2CauseMinorFiltered, a2GeoFiltered,
    hotspotPoints, safety799Points, techEnforcementPoints, techEnforcementPointsWithCoords,
    pointsByDataset, bufferA1For, bufferA2For, geoJump, customBufferStats,
    pointStatsAtRadius, aggregateBufferStats,
    techEnfWithinRadius, aggregateTechEnfCoverage,
  };
})();
