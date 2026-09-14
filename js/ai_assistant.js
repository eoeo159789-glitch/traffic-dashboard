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
  ];

  const PLATFORM_KNOWLEDGE = `你是「臺灣交通事故資料整合分析模組」網站內建的 AI 客服助理。這個網站是一個純靜態、以視覺化為主的交通事故資料分析平台，彙整民國110年至115年（西元2021–2026年）之公開資料。請用繁體中文、簡潔但具體地回答使用者的問題，優先協助使用者理解「怎麼用這個網站」「資料從哪裡來」「某個統計數字是怎麼算的」「有什麼已知的資料限制」。如果使用者問的內容超出你目前掌握的資訊範圍，請誠實說明你不確定，並建議使用者查看對應分頁的說明文字或 README，不要編造數字。

【網站結構】
主站 index.html 為多分頁單頁式應用，左側為篩選側欄（年度、縣市、天候、光線、道路類別、事故類型、肇因大類別），上方分頁包含：
- 總覽：KPI 卡片與整體資料概覽圖表。
- 地圖：Leaflet 地圖，可縣市/鄉鎮跳轉、座標定位即時環域統計、熱點查詢（1000易肇事路口／799人行安全補助點位／科技執法設備地點），A1死亡逐點或熱力圖、A2受傷熱區密度、各類點位圖層可自由勾選組合顯示。
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
- 審計意見統計：監察院調查與各級審計機關歷年決算審核報告中與交通安全相關之意見分類彙整。

【關鍵計算方法】
- 環域（buffer）分析：以每個點位座標為圓心，計算指定半徑內於統計期間實際發生之A1/A2事故件數與死傷人數；建置時以空間網格索引預先算好50/100/200/300/500/1000公尺六種半徑的結果，網站查詢時只是查表，不是即時運算全部距離。
- 覆蓋率分析：計算官方認定的高風險點位（如1000易肇事路口）中，有多少比例在特定距離內設有科技執法設備，並計算至最近一處設備的直線距離；直線距離採等距圓柱投影近似公式（非大圓距離，短距離下誤差可忽略）。
- 象限分析：X軸與Y軸各以「目前篩選範圍內的平均值」為分界（而非以0為分界），藉此凸顯個別縣市相對於目前群體平均的相對位置。
- 跨資料集異常偵測：年增率異常需比較「相鄰年度」且「前一年不為0」時才計算，並對全部縣市/年度分布算z分數；標案金額異常則先取金額之自然對數再算z分數，避免極端大型標案扭曲平均值。

【已知資料限制（請誠實告知使用者，不要迴避）】
- 科技執法設備清單僅連江縣完全未公開；逾四成清單原本無經緯度座標，需經地理編碼推估，推估座標精度不一。
- 標案資料為關鍵字檢索結果，可能有漏未收錄之案件，屬於下限而非總支出。
- 環域統計期間涵蓋設備設置前後，事故較少可能是嚇阻成效、也可能是選址不佳，無法僅憑統計數字判斷因果。
- 審計意見與標案之交叉比對，僅「道路安全與路口工程」「科技執法與監理」兩個子標籤有對應之標案分類可供比對，其餘子標籤（公共運輸與客運鐵路、停車管理、電動車與淨零運具、港埠與航空）沒有可比對之標案類別純屬資料範圍限制。

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

  async function callGemini(cfg, messages) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.geminiModel)}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`;
    const body = {
      systemInstruction: { role: 'system', parts: [{ text: PLATFORM_KNOWLEDGE }] },
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

  async function callOpenAICompatible(cfg, messages) {
    if (!cfg.openaiBaseUrl) throw new Error('請先填寫 API 網址');
    if (!cfg.openaiModel) throw new Error('請先填寫模型名稱');
    const url = `${cfg.openaiBaseUrl}/chat/completions`;
    const body = {
      model: cfg.openaiModel,
      messages: [{ role: 'system', content: PLATFORM_KNOWLEDGE }]
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

  async function callProvider(cfg, messages) {
    if (!cfg.apiKey) throw new Error('請先在上方輸入 API 金鑰並儲存設定');
    if (cfg.provider === 'gemini') return callGemini(cfg, messages);
    return callOpenAICompatible(cfg, messages);
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
      const reply = await callProvider(settings, recent);
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
