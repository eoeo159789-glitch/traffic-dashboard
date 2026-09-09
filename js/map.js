// ============================================================
// Leaflet 地圖：A1（死亡，逐點/熱力）、A2（受傷，熱區密度）、
// 1000易肇事路口／799人行安全補助點位（固定點位圖層），可分開或合併顯示
// 另提供座標定位／縣市鄉鎮跳轉、自訂座標環域分析
// ============================================================
const MapView = (() => {
  let map, clusterLayer, a1HeatLayer, a2HeatLayer, hotspotLayer, safety799Layer, techEnfLayer, customMarker, customCircle, customMultiLayer;
  const DEFAULT_POPUP_RADIUS = 200; // 點位彈窗預設顯示的環域半徑（公尺）

  function init() {
    map = L.map('map', { preferCanvas: true }).setView([23.7, 121.0], 8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 18,
    }).addTo(map);
    clusterLayer = L.markerClusterGroup({ maxClusterRadius: 45, disableClusteringAtZoom: 16 });
    hotspotLayer = L.layerGroup();
    safety799Layer = L.layerGroup();
    techEnfLayer = L.layerGroup();
    map.addLayer(clusterLayer);

    ['showA1Toggle', 'a1HeatToggle', 'showA2Toggle', 'showHotspotToggle', 'showSafety799Toggle', 'showTechEnfToggle'].forEach(id => {
      document.getElementById(id).addEventListener('change', () => render(State.filtered()));
    });

    updateLegend();
  }

  function updateLegend() {
    const showA1 = document.getElementById('showA1Toggle').checked;
    const showA2 = document.getElementById('showA2Toggle').checked;
    const showHotspot = document.getElementById('showHotspotToggle').checked;
    const showSafety799 = document.getElementById('showSafety799Toggle').checked;
    const showTechEnf = document.getElementById('showTechEnfToggle').checked;
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
    if (showHotspot) {
      rows += `<div class="row"><span class="dot" style="background:#4a3aa7;width:10px;height:10px;border-radius:2px;transform:rotate(45deg)"></span> 1000 易肇事路口</div>`;
    }
    if (showSafety799) {
      rows += `<div class="row"><span class="dot" style="background:#1baf7a;width:10px;height:10px;border-radius:2px;transform:rotate(45deg)"></span> 799 人行安全補助點位</div>`;
    }
    if (showTechEnf) {
      rows += `
        <div class="row"><span class="dot" style="background:#e34948;width:10px;height:10px;border-radius:50%"></span> 科技執法設備－官方座標</div>
        <div class="row"><span class="dot" style="background:#f2a541;width:10px;height:10px;border-radius:50%"></span> 科技執法設備－推估座標（較高信心）</div>
        <div class="row"><span class="dot" style="background:#9a9a9a;width:9px;height:9px;border-radius:50%;opacity:.75"></span> 科技執法設備－推估座標（低信心，僅供概略參考）</div>
      `;
    }
    legend.innerHTML = rows || '<div class="row hint">未選擇任何圖層</div>';
  }

  function bufferSummaryHtml(pointId) {
    const a1 = State.bufferA1For(pointId);
    const a2 = State.bufferA2For(pointId);
    const r = DEFAULT_POPUP_RADIUS;
    const a1s = a1 && a1[r] ? `${Util.fmtNum(a1[r][0])} 件（死亡 ${a1[r][1]}／受傷 ${a1[r][2]}）` : '—';
    const a2s = a2 && a2[r] ? `${Util.fmtNum(a2[r][0])} 件（受傷 ${a2[r][1]}）` : '—';
    return `半徑 ${r}m 內 A1：${a1s}<br>半徑 ${r}m 內 A2：${a2s}<br><span style="color:var(--text-muted)">其他半徑請至「熱點環域分析」分頁查看</span>`;
  }

  function renderHotspotLayer() {
    hotspotLayer.clearLayers();
    State.hotspotPoints().forEach(p => {
      const marker = L.circleMarker([p.lat, p.lng], {
        radius: 6, color: '#4a3aa7', fillColor: '#4a3aa7', fillOpacity: 0.85, weight: 1,
      });
      marker.bindPopup(`
        <b>${p.county}${p.township || ''}</b><br>
        ${p.name || ''}<br>
        原始資料：件數 ${p.count}／死亡 ${p.deaths}／受傷 ${p.injuries}（${p.category || ''}）<br>
        ${bufferSummaryHtml(p.id)}
      `);
      hotspotLayer.addLayer(marker);
    });
  }

  function renderSafety799Layer() {
    safety799Layer.clearLayers();
    State.safety799Points().forEach(p => {
      const marker = L.circleMarker([p.lat, p.lng], {
        radius: 6, color: '#1baf7a', fillColor: '#1baf7a', fillOpacity: 0.85, weight: 1,
      });
      marker.bindPopup(`
        <b>${p.county}${p.township || ''}</b>（來源：${p.source || ''}）<br>
        ${p.position || p.address || ''}<br>
        ${bufferSummaryHtml(p.id)}
      `);
      safety799Layer.addLayer(marker);
    });
  }

  const TECH_ENF_STYLE = {
    official: { color: '#e34948', radius: 5, fillOpacity: 0.85 },
    estimated_high: { color: '#f2a541', radius: 5, fillOpacity: 0.85 },
    estimated_low: { color: '#9a9a9a', radius: 4, fillOpacity: 0.6 },
  };
  const COORD_SOURCE_LABEL = {
    official: '官方座標',
    estimated_high: '推估座標（較高信心）',
    estimated_low: '推估座標（低信心，僅供概略參考，誤差可能達數百公尺以上）',
  };
  function renderTechEnfLayer() {
    techEnfLayer.clearLayers();
    State.techEnforcementPointsWithCoords().forEach(p => {
      const src = p.coordSource || 'official';
      const style = TECH_ENF_STYLE[src] || TECH_ENF_STYLE.official;
      const marker = L.circleMarker([p.lat, p.lng], {
        radius: style.radius, color: style.color, fillColor: style.color, fillOpacity: style.fillOpacity, weight: 1,
      });
      const coordLine = src === 'official'
        ? '座標來源：官方公告清單'
        : `座標來源：${COORD_SOURCE_LABEL[src]}（定位方法：${p.geocodeMethod || '—'}${p.geocodeQuality ? '／' + p.geocodeQuality : ''}）`;
      marker.bindPopup(`
        <b>${p.county}${p.district || ''}</b>（${p.deviceType || '科技執法'}）<br>
        ${p.loc || ''}<br>
        取締項目：${p.items || '—'}<br>
        速限：${p.speedLimit || '—'}／拍攝方向：${p.direction || '—'}<br>
        管轄單位：${p.authority || '—'}<br>
        <span style="color:${src === 'official' ? '#555' : style.color}">${coordLine}</span><br>
        ${bufferSummaryHtml(p.id)}
      `);
      techEnfLayer.addLayer(marker);
    });
  }

  function render(accidents) {
    if (!map) init();
    clusterLayer.clearLayers();
    if (a1HeatLayer) { map.removeLayer(a1HeatLayer); a1HeatLayer = null; }
    if (a2HeatLayer) { map.removeLayer(a2HeatLayer); a2HeatLayer = null; }

    const showA1 = document.getElementById('showA1Toggle').checked;
    const a1Heat = document.getElementById('a1HeatToggle').checked;
    const showA2 = document.getElementById('showA2Toggle').checked;
    const showHotspot = document.getElementById('showHotspotToggle').checked;
    const showSafety799 = document.getElementById('showSafety799Toggle').checked;
    const showTechEnf = document.getElementById('showTechEnfToggle').checked;
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

    if (showHotspot) {
      if (hotspotLayer.getLayers().length === 0) renderHotspotLayer();
      if (!map.hasLayer(hotspotLayer)) hotspotLayer.addTo(map);
      notes.push(`易肇事路口：${State.hotspotPoints().length.toLocaleString()} 處`);
    } else if (map.hasLayer(hotspotLayer)) {
      map.removeLayer(hotspotLayer);
    }

    if (showSafety799) {
      if (safety799Layer.getLayers().length === 0) renderSafety799Layer();
      if (!map.hasLayer(safety799Layer)) safety799Layer.addTo(map);
      notes.push(`人行安全補助點位：${State.safety799Points().length.toLocaleString()} 處`);
    } else if (map.hasLayer(safety799Layer)) {
      map.removeLayer(safety799Layer);
    }

    if (showTechEnf) {
      if (techEnfLayer.getLayers().length === 0) renderTechEnfLayer();
      if (!map.hasLayer(techEnfLayer)) techEnfLayer.addTo(map);
      const withCoordsPts = State.techEnforcementPointsWithCoords();
      const total = State.techEnforcementPoints().length;
      const nOfficial = withCoordsPts.filter(p => (p.coordSource || 'official') === 'official').length;
      const nHigh = withCoordsPts.filter(p => p.coordSource === 'estimated_high').length;
      const nLow = withCoordsPts.filter(p => p.coordSource === 'estimated_low').length;
      notes.push(`科技執法設備：官方座標 ${nOfficial.toLocaleString()} 處＋推估座標-較高信心 ${nHigh.toLocaleString()} 處＋推估座標-低信心 ${nLow.toLocaleString()} 處，合計 ${withCoordsPts.length.toLocaleString()} 處可顯示（原始清單共 ${total.toLocaleString()} 筆；報告正式分析僅採官方座標941處為基礎，推估座標詳見報告第三章第五節）`);
    } else if (map.hasLayer(techEnfLayer)) {
      map.removeLayer(techEnfLayer);
    }

    if (note) {
      note.textContent = notes.length
        ? notes.join('；') + '（A1/A2 依目前左側篩選條件；熱點路口圖層固定顯示全部點位）'
        : '請於上方勾選至少一個圖層以顯示地圖資料。';
    }
  }

  function invalidateSize() {
    if (map) setTimeout(() => map.invalidateSize(), 50);
  }

  // ---------------- 座標定位 / 縣市鄉鎮跳轉 / 自訂座標環域 ----------------

  function jumpTo(lat, lng, zoom = 14) {
    if (!map) init();
    map.setView([lat, lng], zoom);
  }

  function setCustomPoint(lat, lng, radiusM) {
    if (!map) init();
    if (customMarker) map.removeLayer(customMarker);
    if (customCircle) map.removeLayer(customCircle);
    customMarker = L.marker([lat, lng], {
      icon: L.divIcon({ className: '', html: '<div style="width:14px;height:14px;border-radius:50%;background:#0ca30c;border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,.5)"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }),
    }).addTo(map);
    customCircle = L.circle([lat, lng], { radius: radiusM, color: '#0ca30c', weight: 2, fillOpacity: 0.08 }).addTo(map);
    map.setView([lat, lng], 15);
  }

  function updateCustomRadius(radiusM) {
    if (customCircle) customCircle.setRadius(radiusM);
  }

  // 未指定單一點位時：依篩選條件一次顯示多個點位的環域範圍圈（供「熱點查詢」不選點位時使用）
  function setCustomPoints(points, radiusM) {
    if (!map) init();
    if (customMarker) { map.removeLayer(customMarker); customMarker = null; }
    if (customCircle) { map.removeLayer(customCircle); customCircle = null; }
    if (customMultiLayer) { map.removeLayer(customMultiLayer); customMultiLayer = null; }
    if (!points || points.length === 0) return;
    customMultiLayer = L.layerGroup();
    const bounds = [];
    points.forEach(p => {
      L.circleMarker([p.lat, p.lng], { radius: 4, color: '#0ca30c', weight: 2, fillOpacity: 0.9 }).addTo(customMultiLayer);
      L.circle([p.lat, p.lng], { radius: radiusM, color: '#0ca30c', weight: 1.5, fillOpacity: 0.06 }).addTo(customMultiLayer);
      bounds.push([p.lat, p.lng]);
    });
    customMultiLayer.addTo(map);
    if (bounds.length === 1) map.setView(bounds[0], 15);
    else map.fitBounds(bounds, { padding: [40, 40] });
  }

  function clearCustomPoint() {
    if (customMarker) { map.removeLayer(customMarker); customMarker = null; }
    if (customCircle) { map.removeLayer(customCircle); customCircle = null; }
    if (customMultiLayer) { map.removeLayer(customMultiLayer); customMultiLayer = null; }
  }

  async function exportPng() {
    const el = document.getElementById('map');
    const canvas = await html2canvas(el, { useCORS: true, logging: false });
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url; a.download = 'accident_map.png';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  return {
    init, render, invalidateSize, exportPng,
    jumpTo, setCustomPoint, updateCustomRadius, clearCustomPoint, setCustomPoints,
  };
})();
