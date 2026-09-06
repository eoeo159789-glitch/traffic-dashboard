// ============================================================
// Leaflet 地圖
// ============================================================
const MapView = (() => {
  let map, clusterLayer, heatLayer;
  let heatMode = false;

  function init() {
    map = L.map('map', { preferCanvas: true }).setView([23.7, 121.0], 8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 18,
    }).addTo(map);
    clusterLayer = L.markerClusterGroup({ maxClusterRadius: 45, disableClusteringAtZoom: 16 });
    map.addLayer(clusterLayer);

    const legend = document.getElementById('mapLegend');
    legend.innerHTML = `
      <div class="row"><span class="dot" style="background:#d03b3b"></span> 有死亡</div>
      <div class="row"><span class="dot" style="background:#eda100"></span> 僅受傷</div>
    `;

    document.getElementById('mapHeatToggle').addEventListener('change', (e) => {
      heatMode = e.target.checked;
      render(State.filtered());
    });
  }

  function render(accidents) {
    if (!map) init();
    clusterLayer.clearLayers();
    if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }

    const pts = accidents.filter(a => a.lat && a.lng && Math.abs(a.lat) > 1 && Math.abs(a.lng) > 1);

    if (heatMode) {
      const heatPts = pts.map(a => [a.lat, a.lng, a.deaths > 0 ? 1.0 : 0.5]);
      heatLayer = L.heatLayer(heatPts, { radius: 18, blur: 22, maxZoom: 14 });
      heatLayer.addTo(map);
      return;
    }

    // 點位過多時取樣，避免瀏覽器過載（叢集顯示仍具代表性；目前資料量遠低於此門檻）
    const MAX_POINTS = 20000;
    const sample = pts.length > MAX_POINTS
      ? pts.filter((_, i) => i % Math.ceil(pts.length / MAX_POINTS) === 0)
      : pts;

    sample.forEach(a => {
      const color = a.deaths > 0 ? '#d03b3b' : '#eda100';
      const marker = L.circleMarker([a.lat, a.lng], {
        radius: 5, color, fillColor: color, fillOpacity: 0.75, weight: 1,
      });
      marker.bindPopup(`
        <b>${a.county || ''}</b> ${a.year}/${a.month}<br>
        ${a.addr || ''}<br>
        天候：${a.weather || '—'}／光線：${a.light || '—'}<br>
        事故類型：${a.accTypeMajor || '—'}${a.accTypeMinor ? '（' + a.accTypeMinor + '）' : ''}<br>
        肇因：${a.causeMajor || '—'}${a.causeMinor ? '｜' + a.causeMinor : ''}<br>
        死亡 ${a.deaths} ／ 受傷 ${a.injuries}
      `);
      clusterLayer.addLayer(marker);
    });

    const note = document.querySelector('#tab-map .hint');
    if (note) {
      note.textContent = pts.length > MAX_POINTS
        ? `點位僅顯示有經緯度座標之事故（依目前左側篩選條件）。標記顏色：紅=有死亡、橘=僅受傷。（目前 ${pts.length.toLocaleString()} 個點位過多，地圖已取樣顯示約 ${sample.length.toLocaleString()} 點以維持效能，其他分頁統計數字仍以完整資料計算）`
        : `點位僅顯示有經緯度座標之事故（依目前左側篩選條件）。標記顏色：紅=有死亡、橘=僅受傷。目前顯示 ${pts.length.toLocaleString()} 個點位。`;
    }
  }

  function invalidateSize() {
    if (map) setTimeout(() => map.invalidateSize(), 50);
  }

  async function exportPng() {
    const el = document.getElementById('map');
    const canvas = await html2canvas(el, { useCORS: true, logging: false });
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url; a.download = 'accident_map.png';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  return { init, render, invalidateSize, exportPng };
})();
