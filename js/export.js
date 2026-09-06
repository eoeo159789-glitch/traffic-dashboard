// ============================================================
// 匯出功能（CSV / Excel / 交叉表 CSV）
// ============================================================
const Exporter = (() => {

  const TABLE_COLUMNS = [
    { key: 'id', label: '事故編號' },
    { key: 'year', label: '年度' },
    { key: 'month', label: '月份' },
    { key: 'date', label: '日期' },
    { key: 'hour', label: '時' },
    { key: 'county', label: '縣市' },
    { key: 'addr', label: '地點' },
    { key: 'weather', label: '天候' },
    { key: 'light', label: '光線' },
    { key: 'roadClass', label: '道路類別' },
    { key: 'roadType', label: '道路型態' },
    { key: 'accTypeMajor', label: '事故類型(大)' },
    { key: 'accTypeMinor', label: '事故類型(子)' },
    { key: 'causeMajor', label: '肇因(大)' },
    { key: 'causeMinor', label: '肇因(子)' },
    { key: 'deaths', label: '死亡人數' },
    { key: 'injuries', label: '受傷人數' },
    { key: 'hitRun', label: '是否肇逃' },
    { key: 'lng', label: '經度' },
    { key: 'lat', label: '緯度' },
  ];

  function exportCsv(rows, filename) {
    const csv = Util.toCsv(rows, TABLE_COLUMNS);
    Util.downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename);
  }

  function exportXlsx(rows, filename) {
    const data = rows.map(r => {
      const o = {};
      TABLE_COLUMNS.forEach(c => o[c.label] = r[c.key]);
      return o;
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '事故資料');
    XLSX.writeFile(wb, filename);
  }

  function exportCrossTableCsv(rowLabel, colLabel, rowTop, colTop, grid, filename) {
    const header = [rowLabel + '\\' + colLabel, ...colTop];
    const lines = [header.join(',')];
    rowTop.forEach(r => {
      const row = [r];
      colTop.forEach(c => row.push(grid.get(r + '' + c) || 0));
      lines.push(row.join(','));
    });
    const csv = '﻿' + lines.join('\r\n');
    Util.downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename);
  }

  return { TABLE_COLUMNS, exportCsv, exportXlsx, exportCrossTableCsv };
})();
