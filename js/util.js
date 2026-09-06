// ============================================================
// 共用工具函式
// ============================================================
const Util = (() => {

  const PALETTE = [
    '#2a78d6', '#eb6834', '#1baf7a', '#eda100',
    '#e87ba4', '#008300', '#4a3aa7', '#e34948',
  ];

  const STATUS = {
    good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b',
  };

  function seriesColor(i) { return PALETTE[i % PALETTE.length]; }

  function isDark() {
    const el = document.documentElement;
    if (el.getAttribute('data-theme') === 'dark') return true;
    if (el.getAttribute('data-theme') === 'light') return false;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function chartTextColor() { return isDark() ? '#c3c2b7' : '#52514e'; }
  function chartGridColor() { return isDark() ? '#2c2c2a' : '#e1e0d9'; }

  function groupBy(arr, keyFn) {
    const m = new Map();
    for (const item of arr) {
      const k = keyFn(item);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(item);
    }
    return m;
  }

  function countBy(arr, keyFn) {
    const m = new Map();
    for (const item of arr) {
      const k = keyFn(item) ?? '（未知）';
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  }

  function sumBy(arr, keyFn, valFn) {
    const m = new Map();
    for (const item of arr) {
      const k = keyFn(item) ?? '（未知）';
      m.set(k, (m.get(k) || 0) + (valFn(item) || 0));
    }
    return m;
  }

  function sortMapDesc(m) {
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }

  function fmtNum(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Number(n).toLocaleString('zh-Hant');
  }

  function fmtPct(n, digits = 1) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return (n * 100).toFixed(digits) + '%';
  }

  function fmtBytes(n) {
    if (!n) return '—';
    const mb = n / 1024 / 1024;
    return mb >= 1 ? mb.toFixed(1) + ' MB' : (n / 1024).toFixed(0) + ' KB';
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
  }

  function toCsv(rows, columns) {
    const esc = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    };
    const header = columns.map(c => esc(c.label)).join(',');
    const lines = rows.map(r => columns.map(c => esc(typeof c.value === 'function' ? c.value(r) : r[c.key])).join(','));
    return '﻿' + [header, ...lines].join('\r\n');
  }

  // 依数值產生藍色系色階（sequential，用於交叉表熱度）
  function seqColor(t) {
    // t: 0~1
    const stops = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
    const idx = Math.min(stops.length - 1, Math.max(0, Math.round(t * (stops.length - 1))));
    return stops[idx];
  }

  return {
    PALETTE, STATUS, seriesColor, isDark, chartTextColor, chartGridColor,
    groupBy, countBy, sumBy, sortMapDesc, fmtNum, fmtPct, fmtBytes, downloadBlob, toCsv, seqColor,
  };
})();
