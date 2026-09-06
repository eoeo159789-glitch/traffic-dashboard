// ============================================================
// Leaflet 地圖：A1（死亡，逐點/熱力）與 A2（受傷，熱區密度）可分開或合併顯示
// ============================================================
const MapView = (() => {
  let map, clusterLayer, a1HeatLayer, a2HeatLayer;

  function init() {
    map = L.map('map', { preferCanvas: true }).setView([23.7, 121.0], 8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 18,
    }).addTo(map);
    clusterLayer = L.markerClusterGroup({ maxClusterRadius: 45, disableClusteringAtZoom: 16 });
    map.addLayer(clusterLayer);

    ['showA1Toggle', 'a1HeatToggle', 'showA2Toggle'].forEach(id => {
      document.getElementById(id).addEventListener('change', () => render(State.filtered()));
    });

    updateLegend();
  }

  function updateLegend() {
    const showA1 = document.getElementById('showA1Toggle').checked;
    const showA2 = document.getElementById('showA2Toggle').checked;
    const legend = document.getElementById('mapLegend');
    let rows = '';
    if (showA1) {
      rows += `
        <div class="row"><span class="dot" style="background:#d03b3b"></span> A1 有死亡</div>
        <div class="row"><span class="dot" style="background:#eda100"></span> A1 僅受傷</div>
      `;
    }
    if (showA2) {
      rows += `
        <div class="row"><span class="dot" style="background:linear-gradient(90deg,#4a3aa7,#e87ba4);width:22px;height:8px;border-radius:4px"></span> A2 受傷事故熱區（約 1 公里網格）</div>
      `;
    }
    legend.innerHTML = rows || '<div class="row hint">未選擇任何圖層</div>';
  }

  function render(accidents) {
    if (!map) init();
    clusterLayer.clearLayers();
    if (a1HeatLayer) { map.removeLayer(a1HeatLayer); a1HeatLayer = null; }
    if (a2HeatLayer) { map.removeLayer(a2HeatLayer); a2HeatLayer = null; }

    const showA1 = document.getElementById('showA1Toggle').checked;
    const a1Heat = document.getElementById('a1HeatToggle').checked;
    const showA2 = document.getElementById('showA2Toggle').checked;
    updateLegend();

    const note = document.getElementById('mapNote');
    const notes = [];

    if (showA1) {
      const pts = accidents.filter(a => a.lat && a.lng && Math.abs(a.lat) > 1 && Math.abs(a.lng) > 1);

      if (a1Heat) {
        const heatPts = pts.map(a => [a.lat, a.lng, a.deaths > 0 ? 1.0 : 0.5]);
        a1HeatLayer = L.heatLayer(heatPts, { radius: 18, blur: 22, maxZoom: 14, gradient: { 0.2: '#eda100', 0.6: '#eb6834', 1.0: '#d03b3b' } });
        a1HeatLayer.addTo(map);
        notes.push(`A1：${pts.length.toLocaleString()} 個點位以熱力圖呈現`);
      } else {
        // 點位過多時取樣，避免瀏覽器過載（叢集顯示仍具代表性）
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
        notes.push(pts.length > MAX_POINTS
          ? `A1：${pts.length.toLocaleString()} 個點位過多，已取樣顯示約 ${sample.length.toLocaleString()} 點`
          : `A1：顯示 ${pts.length.toLocaleString()} 個點位`);
      }
    }

    if (showA2) {
      const geoRows = State.a2GeoFiltered();
      const maxCount = geoRows.reduce((m, r) => Math.max(m, r.count), 1);
      const heatPts = geoRows.map(r => [r.lat, r.lng, Math.min(1, r.count / maxCount * 3)]);
      a2HeatLayer = L.heatLayer(heatPts, {
        radius: 22, blur: 18, maxZoom: 13,
        gradient: { 0.2: '#4a3aa7', 0.5: '#e87ba4', 0.8: '#eb6834', 1.0: '#d03b3b' },
      });
      a2HeatLayer.addTo(map);
      const totalA2 = geoRows.reduce((s, r) => s + r.count, 0);
      notes.push(`A2：${totalA2.toLocaleString()} 件受傷事故彙整為 ${geoRows.length.toLocaleString()} 個網格熱區`);
    }

    if (note) {
      note.textContent = notes.length
        ? notes.join('；') + '（依目前左側篩選條件）'
        : '請於上方勾選至少一個圖層以顯示地圖資料。';
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
