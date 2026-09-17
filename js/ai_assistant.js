// ============================================================
// AI 客服：讓使用者自行帶入 Google Gemini 或 OpenAI 相容格式的 API 金鑰，
// 直接從瀏覽器呼叫 AI 服務進行問答，協助了解本平台的功能、資料來源與統計方法。
// ------------------------------------------------------------
// 重要設計原則：
//   - 本站為純靜態網站，沒有任何後端伺服器。金鑰、對話紀錄等全部只存在使用者
//     目前瀏覽器的 localStorage，AI 服務的呼叫也是直接從瀏覽器發出，本站
//     完全不會經手、也無法看到使用者的金鑰或對話內容。
//   - 部分 AI 服務商（例如官方 OpenAI API）預設不允許瀏覽器端（CORS）直接
//     呼叫，遇到連線失敗時，會在畫面上明確提示可能原因，而不是靜默失敗。
//   - 系統提示詞（PLATFORM_KNOWLEDGE）內容整理自 README.md 與各分頁功能，
//     供 AI 回答「怎麼用」「資料從哪來」「數字怎麼算」等客服性質問題；
//     不涉及任何使用者填寫之篩選條件或個人資料。
// ============================================================
const AIAssistant = (() => {
  const STORAGE_KEY = 'ai_assistant_settings_v1';
  const HISTORY_KEY = 'ai_assistant_history_v1';
  const MAX_HISTORY_TURNS = 12; // 送往 API 的最近對話輪數上限，避免 payload 過大

  let settings = { provider: 'gemini', apiKey: '', geminiModel: 'gemini-3.6-flash', openaiBaseUrl: '', openaiModel: '' };
  let history = []; // [{role:'user'|'assistant', text}]
  let sending = false;

  const QUICK_QUESTIONS = [
    '這個平台可以做什麼？各分頁分別是做什麼用的？',
    '熱點環域分析的距離是怎麼計算的？',
    '科技執法設備的座標涵蓋率是多少？有哪些是推估座標？',
    '1000 易肇事路口跟 799 人行安全補助地點是什麼資料？',
    '標案經費的統計方式與限制是什麼？',
    '稽核工作站的跨資料集異常偵測是怎麼判斷嚴重度的？',
    '審計意見裡有提到科技執法設備選址跟事故熱點對不上的問題嗎？',
  ];

  // ============================================================
  // 審計意見檢索（輕量、純前端 TF-IDF 風格關鍵字比對）
  // ------------------------------------------------------------
  // 目的：AI 客服原本只知道「審計意見統計」頁面『存在、怎麼算、有什麼限制』，
  // 並沒有實際審計意見全文可以引用。這裡在每次送出問題前，先用簡單的中文
  // 雙字元（bigram）重疊比對，從網站既有的兩份審計意見資料
  //   - AUDIT_OPINIONS_TRAFFIC：交通政策領域全類別（公共運輸/停車管理/道路安全
  //     與路口工程/電動車與淨零運具/港埠與航空），110-114年度、22縣市。
  //   - AUDIT_OPINIONS_TECH_ENFORCEMENT：「科技執法設備選址與易肇事路口改善」
  //     專題彙整（52則，五大主題A-E），內容比前者更完整（含具體查核發現數字）。
  // 中檢出與使用者問題最相關的幾則「原文片段」，暫時夾帶進系統提示詞，讓 AI
  // 服務商（Gemini/OpenAI相容）真的能引用具體年度、縣市、數字回答，而不是只能
  // 說「這個功能存在，請自己去查」。這一切都在瀏覽器端完成，不會多送出任何
  // 使用者資料，只是把「原本就在這個網站裡的公開資料」多組合一份文字附上去。
  // 只是「輕量檢索」而非真正的向量式 RAG：命中率抓大方向即可，不追求完美排序。
  // ============================================================
  let auditIndex = null; // 延遲建立，避免資料尚未載入時就出錯

  function auditBigrams(str) {
    const s = String(str || '').replace(/[\s，。、；：「」『』（）()%％,.\-—]/g, '');
    const out = [];
    for (let i = 0; i < s.length - 1; i++) out.push(s.substr(i, 2));
    return out;
  }

  function auditYearVariants(y) {
    const n = Number(y);
    if (!n) return [];
    return n > 1900 ? [n, n - 1911] : [n, n + 1911];
  }

  function buildAuditRecords() {
    const records = [];
    const traffic = (typeof window !== 'undefined' && window.AUDIT_OPINIONS_TRAFFIC) || [];
    traffic.forEach(o => {
      const seen = new Set();
      (o.tags || []).forEach(tag => {
        const sentences = (o.tagItems && o.tagItems[tag]) || [];
        sentences.forEach(s => {
          if (seen.has(s)) return;
          seen.add(s);
          records.push({
            county: o.county, year: o.year, tag,
            text: s,
            display: `【${o.year}年度｜${o.county}｜審計意見統計－${tag}】${s}`,
          });
        });
      });
      if (seen.size === 0 && o.rep) {
        records.push({
          county: o.county, year: o.year, tag: (o.tags || [])[0] || '',
          text: o.rep,
          display: `【${o.year}年度｜${o.county}｜審計意見統計】${o.rep}`,
        });
      }
    });
    const tech = (typeof window !== 'undefined' && window.AUDIT_OPINIONS_TECH_ENFORCEMENT) || [];
    tech.forEach(o => {
      records.push({
        county: o.entity, year: o.year, tag: o.themeName,
        text: o.gist + ' ' + o.finding,
        display: `【${o.year}年度｜${o.entity}${o.agency ? '（' + o.agency + '）' : ''}｜科技執法/易肇事路口專題－主題${o.theme}：${o.themeName}】意見要旨：${o.gist}／查核發現：${o.finding}`,
      });
    });
    return records;
  }

  function buildAuditIndex() {
    const records = buildAuditRecords();
    const df = new Map();
    const itemGrams = records.map(r => {
      const grams = new Set(auditBigrams(r.text));
      grams.forEach(g => df.set(g, (df.get(g) || 0) + 1));
      return grams;
    });
    const N = records.length || 1;
    const idf = new Map();
    df.forEach((count, g) => idf.set(g, Math.log((N + 1) / (count + 1)) + 1));
    return { records, itemGrams, idf };
  }

  const AUDIT_SEARCH_MIN_SCORE = 8;   // 至少要有一定的關鍵字重疊才值得夾帶，避免每次都附資料
  const AUDIT_SEARCH_TOP_K = 5;
  const AUDIT_SEARCH_MAX_CHARS = 2800; // 控制夾帶文字總長度，避免 payload 過大

  function searchAuditOpinions(query) {
    if (!auditIndex) auditIndex = buildAuditIndex();
    if (!auditIndex.records.length) return [];
    const qGrams = [...new Set(auditBigrams(query))];
    if (!qGrams.length) return [];
    const scored = auditIndex.records.map((r, i) => {
      let score = 0;
      const grams = auditIndex.itemGrams[i];
      qGrams.forEach(g => { if (grams.has(g)) score += (auditIndex.idf.get(g) || 1); });
      if (r.county && query.indexOf(r.county) !== -1) score += 3;
      if (auditYearVariants(r.year).some(y => query.indexOf(String(y)) !== -1)) score += 2;
      return { r, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.filter(s => s.score >= AUDIT_SEARCH_MIN_SCORE).slice(0, AUDIT_SEARCH_TOP_K);
  }

  function buildAuditRetrievalContext(query) {
    let hits;
    try {
      hits = searchAuditOpinions(query);
    } catch (e) { return ''; }
    if (!hits.length) return '';
    let used = 0;
    const lines = [];
    for (const h of hits) {
      if (used + h.r.display.length > AUDIT_SEARCH_MAX_CHARS) break;
      lines.push(h.r.display);
      used += h.r.display.length;
    }
    if (!lines.length) return '';
    return '【系統自動檢索到的相關審計意見原文片段，僅供本次回答參考】\n' +
      lines.map((l, i) => `${i + 1}. ${l}`).join('\n') +
      '\n（以上為審計部110-114年度總決算審核報告原文摘錄，非全部審計意見；請優先根據以上實際內容回答並清楚註明年度與縣市/機關，不要自行編造數字或年度；若與使用者問題無關請忽略，若判斷查無對應資料請誠實告知，並可建議使用者到 budget.html「審計意見統計」頁查閱完整原文。）';
  }

  const PLATFORM_KNOWLEDGE = `你是「臺灣交通事故資料整合分析模組」網站內建的 AI 客服助理。這個網站是一個純靜態、以視覺化為主的交通事故資料分析平台，彙整民國110年至115年（西元2021–2026年）之公開資料。請用繁體中文、簡潔但具體地回答使用者的問題，優先協助使用者理解「怎麼用這個網站」「資料從哪裡來」「某個統計數字是怎麼算的」「有什麼已知的資料限制」。如果使用者問的內容超出你目前掌握的資訊範圍，請誠實說明你不確定，並建議使用者查看對應分頁的說明文字或 README，不要編造數字。

【網站結構】
主站 index.html 為多分頁單頁式應用，左側為篩選側欄（年度、縣市、天候、光線、道路類別、事故類型、肇因大類別），上方分頁包含：
- 總覽：KPI 卡片與整體資料概覽圖表。
- 地圖：Leaflet 地圖，可縣市/鄉鎮跳轉、座標定位即時環域統計、熱點查詢（1000易肇事路口／799人行安全補助點位／科技執法設備地點，查點位半徑內有多少「事故」）、易肇事路口科技執法涵蓋查詢（查1000易肇事路口或799人行安全補助點位半徑內有多少「科技執法設備」＋最近一處距離，方向與熱點查詢相反，可選單一路口或合計目前篩選出的所有路口去重查詢；合計查詢會同時列出「不重複計算的設備數」與「涵蓋路口數／總路口數（涵蓋率%）」兩個數字並列——前者是同一設備跨路口去重後的設備總數，後者是與報告圖3-3同一種「路口有無被涵蓋」統計，兩者本來就可能不同，不是算錯；可匯出CSV，未選單一路口時可勾選「只匯出有涵蓋的路口」直接篩選、不必自行到Excel手動篩選）、各縣市易肇事路口科技執法設備覆蓋率長條圖（對應報告圖3-3，可自訂查詢對象與半徑即時生成，算每個縣市路口中半徑內至少有1處科技執法設備的比例，由高到低排序，綠/藍/紅三色代表涵蓋率相對平均值的高低；固定顯示全臺22縣市，清單中無路口資料的縣市〔如金門縣、連江縣〕以灰色「無資料」標示、不納入平均值，縣市名稱標「＊」代表該縣市科技執法設備座標全數為系統推估座標、涵蓋率僅供參考；可匯出PNG與CSV，採用平台目前較完整資料，數字可能與報告原文略有出入屬預期現象），A1死亡逐點或熱力圖、A2受傷熱區密度、各類點位圖層可自由勾選組合顯示。
- 熱點環域分析：選擇一份點位清單＋環域半徑（50/100/200/300/500/1000公尺），即時列出每個點位在該半徑內的A1/A2事故統計，可排序、篩選、匯出CSV。
- 多維探索：跨欄位交叉分析。
- 事故 vs 舉發執法：比較事故與違規舉發件數之間的關係。
- 事故 vs 人口/縣市：人口密度、道路里程等結構性因素與事故結果的關聯分析。
- 改善趨勢分析：整合A1/A2事故、舉發件數、罰鍰收入三份資料，呈現全國與各縣市改善比例排行、象限圖（以目前顯示縣市在X、Y軸的平均值為分界，而非0），以及縣市結構因素vs安全結果的橫斷面關聯分析。
- 稽核工作站：跨資料集異常偵測（對縣市/年度的年增率或標案金額算z分數，找出統計上明顯偏離常態的組合，需再對照事故率變化才能判斷嚴重度，僅供縮小查核範圍，不代表必然有弊端）、待查清單、審計意見與標案交叉比對（依審計意見統計的完整子標籤分類逐一比對是否有對應標案，只有「道路安全與路口工程」「科技執法與監理」兩類有對應的標案分類可比對，其餘子標籤沒有標案類別可比對純屬資料範圍限制，不代表沒有問題）。
- 工程經費(標案)：政府電子採購網決標公告彙整，六大類（科技執法、標誌標線、人行道、道路工程、道路改善、拓寬工程）交通安全相關標案。
- 資料表與匯出：篩選後逐筆資料表，可匯出CSV/Excel；A2受傷事故原始逐筆資料（約434萬列）另提供分年度gzip壓縮CSV下載。
另有兩個獨立分頁：budget.html「審計意見統計」（監察院/審計機關歷年審計意見分類統計）、tenders.html「六都及全國交通標案分類彙整」。

【主要資料集與規模】
- A1（24小時內死亡）交通事故：逐筆資料，含經緯度座標，民國110–114年（西元2021–2025年）。
- A2（受傷）交通事故：約192.6萬件事故、434萬列當事者資料，因量體龐大採彙整表與預先計算之環域統計，逐筆原始資料另外提供下載。
- 交通違規舉發統計、道路交通違規罰鍰收入各縣市分配金額（罰鍰資料自民國111年起才有公開資料）。
- 科技執法設備地點：22縣市警察局及公路主管機關公開清單，共1,616處，其中941處為官方公告經緯度座標，其餘675處原本只有文字地點描述，後續以地理編碼（省道里程樁號內插、Google Geocoding API、內政部TGOS批次地址比對）補上推估座標，分為「推估座標-較高信心」與「推估座標-低信心」兩種精度標記，僅連江縣完全未公開清單。
- 全國1000處易肇事路口清單、永續提升人行安全計畫799處補助地點（交通部核定196處＋內政部核定601處彙整，實際去重後為797處），皆已完成地理編碼。
- 縣市重要統計指標（人口、人口密度、道路里程、事故傷害死亡率等，1998–2025）。
- 交通安全相關政府採購標案：以「科技執法」「標誌標線」「人行道」「道路工程」「道路改善」「拓寬工程」六大類關鍵字查詢並人工複核，是「至少有這麼多」的下限金額，不代表政府實際總支出。
- 審計意見統計：監察院調查與各級審計機關歷年決算審核報告中與交通安全相關之意見分類彙整，另有「科技執法設備選址與易肇事路口改善」專題彙整52則（110-114年度、五大主題A-E，內容含具體查核發現數字，比審計意見統計頁的代表性摘要更完整）。

【關鍵計算方法】
- 環域（buffer）分析：以每個點位座標為圓心，計算指定半徑內於統計期間實際發生之A1/A2事故件數與死傷人數；建置時以空間網格索引預先算好50/100/200/300/500/1000公尺六種半徑的結果，網站查詢時只是查表，不是即時運算全部距離。
- 覆蓋率分析：計算官方認定的高風險點位（如1000易肇事路口）中，有多少比例在特定距離內設有科技執法設備，並計算至最近一處設備的直線距離；直線距離採等距圓柱投影近似公式（非大圓距離，短距離下誤差可忽略）。報告內的「圖3-3」為固定半徑（100/300/500公尺）之靜態彙整表；若使用者想查任意路口在任意自訂半徑內的即時涵蓋數字，可到「地圖」分頁的「易肇事路口科技執法涵蓋查詢」卡片查詢，不需要再另外產生報表。
- 象限分析：X軸與Y軸各以「目前篩選範圍內的平均值」為分界（而非以0為分界），藉此凸顯個別縣市相對於目前群體平均的相對位置。
- 跨資料集異常偵測：年增率異常需比較「相鄰年度」且「前一年不為0」時才計算，並對全部縣市/年度分布算z分數；標案金額異常則先取金額之自然對數再算z分數，避免極端大型標案扭曲平均值。

【已知資料限制（請誠實告知使用者，不要迴避）】
- 科技執法設備清單僅連江縣完全未公開；逾四成清單原本無經緯度座標，需經地理編碼推估，推估座標精度不一。
- 標案資料為關鍵字檢索結果，可能有漏未收錄之案件，屬於下限而非總支出。
- 環域統計期間涵蓋設備設置前後，事故較少可能是嚇阻成效、也可能是選址不佳，無法僅憑統計數字判斷因果。
- 審計意見與標案之交叉比對，僅「道路安全與路口工程」「科技執法與監理」兩個子標籤有對應之標案分類可供比對，其餘子標籤（公共運輸與客運鐵路、停車管理、電動車與淨零運具、港埠與航空）沒有可比對之標案類別純屬資料範圍限制。
- 【審計意見檢索】系統會在你（AI）收到使用者訊息之前，自動用關鍵字比對從審計意見資料中挑出最相關的幾則原文片段，以「【系統自動檢索到的相關審計意見原文片段…】」開頭附加在這份系統提示詞下方——那一段才是本次對話「額外夾帶」的內容，並非我平常固定的知識。若那段檢索結果存在，請優先根據其中的實際文字回答，並清楚註明年度與縣市/機關，不要另外編造數字或年度；若本次對話沒有附加那一段（代表系統判斷檢索不到明顯相關的內容），且使用者問的是某一則具體審計意見的內容，請誠實說明目前查無足夠相關的檢索結果，建議使用者到 budget.html「審計意見統計」頁查閱完整原文，不要用你自己的推測或記憶去回答審計意見的具體內容。

回答時請適度指出使用者可以到哪一個分頁查看更完整的資料或圖表，讓回答具備可操作性。若使用者的問題涉及對外發布的正式統計結論，請提醒其以頁面上實際數據與方法論說明為準，AI回答僅供理解輔助。`;

  // ---------------- localStorage ----------------

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) settings = Object.assign(settings, JSON.parse(raw));
    } catch (e) { /* 忽略壞掉的儲存資料 */ }
    // 2026-09：gemini-2.5-flash 已對新用戶停用，若使用者先前儲存的仍是這個舊模型，
    // 自動升級為 gemini-3.6-flash，避免舊用戶一開啟就遇到 API 錯誤。
    if (settings.geminiModel === 'gemini-2.5-flash') {
      settings.geminiModel = 'gemini-3.6-flash';
      saveSettingsToStorage();
    }
  }

  function saveSettingsToStorage() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (e) { /* 私密瀏覽模式等情況可能失敗，忽略即可 */ }
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) history = JSON.parse(raw);
    } catch (e) { history = []; }
  }

  function saveHistoryToStorage() {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch (e) { /* 忽略 */ }
  }

  // ---------------- UI helpers ----------------

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function setStatus(text, kind) {
    const el = document.getElementById('aiConnStatus');
    if (!el) return;
    el.textContent = text;
    el.style.color = kind === 'ok' ? 'var(--status-good)' : kind === 'error' ? 'var(--status-critical)' : '';
  }

  function syncSettingsForm() {
    const providerSel = document.getElementById('aiProviderSelect');
    const keyInput = document.getElementById('aiApiKey');
    const geminiModelSel = document.getElementById('aiGeminiModel');
    const geminiModelCustom = document.getElementById('aiGeminiModelCustom');
    const openaiBaseUrl = document.getElementById('aiOpenAIBaseUrl');
    const openaiModel = document.getElementById('aiOpenAIModel');
    if (!providerSel) return;

    providerSel.value = settings.provider;
    keyInput.value = settings.apiKey || '';
    openaiBaseUrl.value = settings.openaiBaseUrl || '';
    openaiModel.value = settings.openaiModel || '';

    const knownModels = Array.from(geminiModelSel.options).map(o => o.value).filter(v => v !== '__custom__');
    if (settings.geminiModel && knownModels.includes(settings.geminiModel)) {
      geminiModelSel.value = settings.geminiModel;
      geminiModelCustom.hidden = true;
    } else if (settings.geminiModel) {
      geminiModelSel.value = '__custom__';
      geminiModelCustom.value = settings.geminiModel;
      geminiModelCustom.hidden = false;
    }

    toggleProviderRows();
    setStatus(settings.apiKey ? '已設定（尚未測試連線）' : '尚未設定');
  }

  function toggleProviderRows() {
    const provider = document.getElementById('aiProviderSelect').value;
    document.getElementById('aiGeminiRow').hidden = provider !== 'gemini';
    document.getElementById('aiOpenAIRow').hidden = provider !== 'openai';
    document.getElementById('aiOpenAIRow2').hidden = provider !== 'openai';
  }

  function readSettingsFromForm() {
    const provider = document.getElementById('aiProviderSelect').value;
    const apiKey = document.getElementById('aiApiKey').value.trim();
    const geminiModelSel = document.getElementById('aiGeminiModel').value;
    const geminiModelCustom = document.getElementById('aiGeminiModelCustom').value.trim();
    const geminiModel = geminiModelSel === '__custom__' ? (geminiModelCustom || 'gemini-3.6-flash') : geminiModelSel;
    const openaiBaseUrl = document.getElementById('aiOpenAIBaseUrl').value.trim().replace(/\/+$/, '');
    const openaiModel = document.getElementById('aiOpenAIModel').value.trim();
    return { provider, apiKey, geminiModel, openaiBaseUrl, openaiModel };
  }

  function renderChatLog() {
    const log = document.getElementById('aiChatLog');
    if (!log) return;
    log.innerHTML = history.map(m =>
      `<div class="ai-msg ${m.role === 'user' ? 'user' : 'assistant'}">${escapeHtml(m.text)}</div>`
    ).join('');
    log.scrollTop = log.scrollHeight;
  }

  function appendPending() {
    const log = document.getElementById('aiChatLog');
    if (!log) return null;
    const el = document.createElement('div');
    el.className = 'ai-msg assistant pending';
    el.textContent = '思考中…';
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  function renderQuickChips() {
    const wrap = document.getElementById('aiQuickChips');
    if (!wrap) return;
    wrap.innerHTML = QUICK_QUESTIONS.map((q, i) => `<span class="chip" data-q="${i}">${escapeHtml(q)}</span>`).join('');
    wrap.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const q = QUICK_QUESTIONS[+chip.dataset.q];
        document.getElementById('aiChatInput').value = q;
        sendCurrentInput();
      });
    });
  }

  // ---------------- API calls ----------------

  async function callGemini(cfg, messages, extraContext) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.geminiModel)}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`;
    const systemText = extraContext ? `${PLATFORM_KNOWLEDGE}\n\n${extraContext}` : PLATFORM_KNOWLEDGE;
    const body = {
      systemInstruction: { role: 'system', parts: [{ text: systemText }] },
      contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] })),
    };
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      const msg = (data && data.error && data.error.message) || `HTTP ${resp.status}`;
      if (/no longer available|not found|is not supported|deprecated/i.test(msg)) {
        throw new Error(
          `Gemini API 錯誤：${msg}\n` +
          `→ 這通常表示目前選用的模型（${cfg.geminiModel}）已被 Google 停用或不再開放新用戶使用。` +
          `請回到上方「AI 客服設定」，將模型改選為 gemini-3.6-flash 或 gemini-3.8-flash 後重新測試連線。`
        );
      }
      throw new Error(`Gemini API 錯誤：${msg}`);
    }
    const text = data && data.candidates && data.candidates[0] && data.candidates[0].content &&
      data.candidates[0].content.parts && data.candidates[0].content.parts.map(p => p.text || '').join('');
    if (!text) {
      const blockReason = data && data.promptFeedback && data.promptFeedback.blockReason;
      throw new Error(blockReason ? `Gemini 未回傳內容（原因：${blockReason}）` : 'Gemini 未回傳任何內容');
    }
    return text;
  }

  async function callOpenAICompatible(cfg, messages, extraContext) {
    if (!cfg.openaiBaseUrl) throw new Error('請先填寫 API 網址');
    if (!cfg.openaiModel) throw new Error('請先填寫模型名稱');
    const url = `${cfg.openaiBaseUrl}/chat/completions`;
    const systemText = extraContext ? `${PLATFORM_KNOWLEDGE}\n\n${extraContext}` : PLATFORM_KNOWLEDGE;
    const body = {
      model: cfg.openaiModel,
      messages: [{ role: 'system', content: systemText }]
        .concat(messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.text }))),
    };
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(body),
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      const msg = (data && data.error && data.error.message) || `HTTP ${resp.status}`;
      throw new Error(`API 錯誤：${msg}`);
    }
    const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!text) throw new Error('伺服器未回傳任何內容');
    return text;
  }

  async function callProvider(cfg, messages, extraContext) {
    if (!cfg.apiKey) throw new Error('請先在上方輸入 API 金鑰並儲存設定');
    if (cfg.provider === 'gemini') return callGemini(cfg, messages, extraContext);
    return callOpenAICompatible(cfg, messages, extraContext);
  }

  function friendlyNetworkError(err) {
    if (err instanceof TypeError) {
      // 瀏覽器 fetch 對於 CORS 被擋、網域錯誤、離線等情況，通常只會丟出通用的 TypeError
      return '連線失敗（可能是網路離線、API 網址錯誤，或該服務商不允許瀏覽器直接呼叫〔CORS〕）。若使用「OpenAI 相容格式」，建議改用明確支援瀏覽器端呼叫的服務，或自行架設轉發伺服器。';
    }
    return err.message || String(err);
  }

  // ---------------- 主要動作 ----------------

  async function sendCurrentInput() {
    if (sending) return;
    const input = document.getElementById('aiChatInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    history.push({ role: 'user', text });
    renderChatLog();
    saveHistoryToStorage();

    sending = true;
    document.getElementById('aiSendBtn').disabled = true;
    const pendingEl = appendPending();
    try {
      const recent = history.slice(-MAX_HISTORY_TURNS * 2);
      const retrievalContext = buildAuditRetrievalContext(text);
      const reply = await callProvider(settings, recent, retrievalContext);
      history.push({ role: 'assistant', text: reply });
      saveHistoryToStorage();
      renderChatLog();
    } catch (err) {
      if (pendingEl) pendingEl.remove();
      const msg = friendlyNetworkError(err);
      const log = document.getElementById('aiChatLog');
      const el = document.createElement('div');
      el.className = 'ai-msg error';
      el.textContent = '⚠ ' + msg;
      log.appendChild(el);
      log.scrollTop = log.scrollHeight;
    } finally {
      sending = false;
      document.getElementById('aiSendBtn').disabled = false;
    }
  }

  async function testConnection() {
    const cfg = readSettingsFromForm();
    const resultEl = document.getElementById('aiTestResult');
    resultEl.textContent = '測試中…';
    setStatus('測試中…');
    try {
      const reply = await callProvider(cfg, [{ role: 'user', text: '請只回覆「連線成功」四個字。' }]);
      resultEl.textContent = '✅ 連線成功，服務回覆：' + reply.slice(0, 60);
      setStatus('已連線', 'ok');
    } catch (err) {
      const msg = friendlyNetworkError(err);
      resultEl.textContent = '❌ ' + msg;
      setStatus('連線失敗', 'error');
    }
  }

  // ---------------- render / init ----------------

  function render() {
    syncSettingsForm();
    renderQuickChips();
    renderChatLog();
  }

  function init() {
    loadSettings();
    loadHistory();

    const providerSel = document.getElementById('aiProviderSelect');
    if (!providerSel) return; // 本頁未載入（不應發生，防呆）

    providerSel.addEventListener('change', toggleProviderRows);

    document.getElementById('aiGeminiModel').addEventListener('change', (e) => {
      document.getElementById('aiGeminiModelCustom').hidden = e.target.value !== '__custom__';
    });

    document.getElementById('aiToggleKeyBtn').addEventListener('click', () => {
      const input = document.getElementById('aiApiKey');
      const btn = document.getElementById('aiToggleKeyBtn');
      if (input.type === 'password') { input.type = 'text'; btn.textContent = '🙈 隱藏'; }
      else { input.type = 'password'; btn.textContent = '👁 顯示'; }
    });

    document.getElementById('aiSaveSettingsBtn').addEventListener('click', () => {
      settings = readSettingsFromForm();
      if (!settings.apiKey) { alert('請先輸入 API 金鑰再儲存'); return; }
      saveSettingsToStorage();
      setStatus('已設定（尚未測試連線）');
      document.getElementById('aiTestResult').textContent = '設定已儲存。建議按「測試連線」確認金鑰可正常使用。';
    });

    document.getElementById('aiClearSettingsBtn').addEventListener('click', () => {
      if (!confirm('確定要清除本機儲存的 API 金鑰與設定嗎？此動作無法復原。')) return;
      settings = { provider: 'gemini', apiKey: '', geminiModel: 'gemini-3.6-flash', openaiBaseUrl: '', openaiModel: '' };
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* 忽略 */ }
      syncSettingsForm();
      document.getElementById('aiTestResult').textContent = '已清除。';
    });

    document.getElementById('aiTestBtn').addEventListener('click', testConnection);

    document.getElementById('aiSendBtn').addEventListener('click', sendCurrentInput);
    document.getElementById('aiChatInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendCurrentInput(); }
    });

    document.getElementById('aiClearChatBtn').addEventListener('click', () => {
      if (!history.length) return;
      if (!confirm('確定要清空目前的對話紀錄嗎？')) return;
      history = [];
      saveHistoryToStorage();
      renderChatLog();
    });
  }

  return { init, render };
})();
