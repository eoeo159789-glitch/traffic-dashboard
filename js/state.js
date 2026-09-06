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

  return {
    DIMENSIONS, filters, uniqueValues, matches, filtered, invalidate,
    toggleInSet, setAll, resetAll, onChange, partiesFor,
    a2CrosstabFiltered, a2ByCountyFiltered, a2ByMonthFiltered, a2ByHourFiltered,
    a2AccTypeMinorFiltered, a2CauseMinorFiltered, a2GeoFiltered,
  };
})();
