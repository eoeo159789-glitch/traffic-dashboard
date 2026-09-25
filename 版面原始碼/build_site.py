"""審計意見統計頁（budget.html）版面重整：側邊快速連結、主要功能置頂、快速篩選晶片、表格固定表頭。
原有資料、表格與互動程式碼一律保留，只調整區塊順序並加上導覽與樣式。"""
import re, sys

SRC = "traffic-dashboard/budget.html"
DST = sys.argv[1] if len(sys.argv) > 1 else "out/budget.html"
s = open(SRC, encoding="utf8").read()

body_start = s.index("<body>") + len("<body>")
head = s[:body_start]
foot_end = s.index("</footer>") + len("</footer>")
tail = s[foot_end:]                      # 含 </div>（wrap 結束）與所有 script
assert tail.lstrip().startswith("</div>")
tail = tail.lstrip()[len("</div>"):]     # 移除原本 wrap 的結尾，改由新版面收尾

def before(marker, tag="<section", start=0):
    i = s.index(marker, start)
    return s.rindex(tag, 0, i)

P = {}
P["header"] = s.index("<header>")
P["notice"] = s.index('<div class="callout">')
P["kw"] = s.index('<div class="tips">')
P["domfilter"] = s.index('<div class="filter-bar">')
P["taxo"] = s.index('<section class="group" id="taxoSection">')
P["six"] = before("<h2>六都（直轄市）</h2>")
P["others"] = before("<h2>其他縣市</h2>")
P["reportTips"] = before("比決算書更有用", '<div class="tips">')
P["sixReport"] = before("<h2>六都審核報告直達連結</h2>")
P["news12"] = s.index('<div class="callout" data-domain="交通">')
P["fine6"] = before("六都5年交通罰鍰")
P["fine22"] = before("全台 22 縣市 5 年「罰款及賠償收入」")
P["tech6"] = before("六都科技執法審核意見比較")
P["road6"] = before("六都道路安全改善建議比較")
P["filter"] = s.index('<section class="group" id="opinionFilterSection">')
P["stats"] = s.index('<section class="group" id="opinionStatsSection">')
P["track"] = s.index('<section class="group" id="trackingSection">')
P["footer"] = s.index("<footer>")
order = sorted(P.items(), key=lambda kv: kv[1])
names = [k for k, _ in order]
assert names == ["header", "notice", "kw", "domfilter", "taxo", "six", "others", "reportTips", "sixReport", "news12",
                 "fine6", "fine22", "tech6", "road6", "filter", "stats", "track", "footer"], names
seg = {}
for i, (k, p) in enumerate(order):
    end = order[i + 1][1] if i + 1 < len(order) else foot_end
    seg[k] = s[p:end]
# 開頭（<body> 到 <header> 之間）只能是 wrap 起始
pre = s[body_start:P["header"]]
assert re.sub(r"\s", "", pre) == '<divclass="wrap">', pre

# ── 為各區塊加上錨點 id ──
def add_id(txt, first_tag_prefix, new_id):
    i = txt.index(first_tag_prefix)
    j = txt.index(">", i)
    tag = txt[i:j]
    if " id=" in tag: return txt
    return txt[:i] + tag + f' id="{new_id}"' + txt[j:]
seg["notice"] = add_id(seg["notice"], "<div", "sec-notice")
seg["kw"] = add_id(seg["kw"], "<div", "sec-keywords")
seg["six"] = add_id(seg["six"], "<section", "sec-six")
seg["others"] = add_id(seg["others"], "<section", "sec-others")
seg["reportTips"] = add_id(seg["reportTips"], "<div", "sec-report")
seg["sixReport"] = add_id(seg["sixReport"], "<section", "sec-sixreport")
seg["news12"] = add_id(seg["news12"], "<div", "sec-news12")
seg["fine6"] = add_id(seg["fine6"], "<section", "sec-fine6")
seg["fine22"] = add_id(seg["fine22"], "<section", "sec-fine22")
seg["tech6"] = add_id(seg["tech6"], "<section", "sec-tech6")
seg["road6"] = add_id(seg["road6"], "<section", "sec-road6")

DOMAINS = [("社政", "social", "社會福利與安全網"), ("勞動", "labor", "勞工權益與市場"), ("交通", "traffic", "運輸安全與基建"),
           ("警政", "police", "治安與防詐"), ("衛福", "health", "醫政與衛政"), ("國土", "land", "環保、能源、營建"),
           ("經濟", "econ", "經政與資安"), ("教育", "edu", "教政與文政"), ("族群", "ethnic", "原民、客家、新住民"),
           ("其他", "other", "一般行政與財務")]
taxo = seg["taxo"]
for zh, en, _ in DOMAINS:
    pat = f'<section class="group" data-domain="{zh}" style="margin-bottom:28px;">'
    assert taxo.count(pat) >= 1, zh
    taxo = taxo.replace(pat, f'<section class="group domain-block" id="dom-{en}" data-domain="{zh}" style="margin-bottom:28px;">', 1)
seg["taxo"] = taxo

# ── 快速篩選晶片（由對應下拉選單自動產生，選單變動時同步）──
def chips(sel, label, extra=""):
    return f'<div class="qchips" data-for="{sel}" {extra}><span class="qchips-label">{label}</span><div class="qchips-row" role="group" aria-label="{label}"></div></div>'

seg["stats"] = seg["stats"].replace('<p class="src-note chart-pie-note" id="osPieNote" hidden>',
    '<div class="qchips-box">' + chips("osView", "統計維度") + chips("osSecondary", "快速切換") + chips("osChartType", "圖表類型") + '</div>\n  <p class="src-note chart-pie-note" id="osPieNote" hidden>', 1)
seg["filter"] = seg["filter"].replace('<p class="tag-filter-count" id="ofCount"></p>',
    '<div class="qchips-box">' + chips("ofYear", "年度") + chips("ofDomain", "領域") + '</div>\n  <p class="tag-filter-count" id="ofCount"></p>', 1)
seg["track"] = seg["track"].replace('<p class="tag-filter-count" id="trkCount"></p>',
    '<div class="qchips-box">' + chips("trkStatus", "改善狀態") + chips("trkYear", "被追蹤年度") + chips("trkDomain", "領域") + '</div>\n  <p class="tag-filter-count" id="trkCount"></p>', 1)

# 九大領域：目錄卡片（捲動）＋「只看此領域」晶片
dom_cards = "".join(f'<a class="dom-card" href="#dom-{en}"><b>{zh}</b><span>{sub}</span></a>' for zh, en, sub in DOMAINS)
domfilter = seg["domfilter"].replace('<div class="filter-bar">', '<div class="filter-bar" id="domFilterBar">', 1)
domfilter = domfilter.replace('<span class="filter-count" id="filterCount"></span>',
    '<span class="filter-count" id="filterCount"></span>\n    ' + chips("domainFilter", "只看此領域", 'data-wide="1"'), 1)

ICON = {
 "stats": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>',
 "filter": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18l-7 8v6l-4 2v-8z" /></svg>',
 "track": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l5 5L20 6" /></svg>',
 "taxo": '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
 "traffic": '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2" width="10" height="20" rx="3"/><circle cx="12" cy="7" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="17" r="1.6"/></svg>',
 "links": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
}
quick = f'''
<nav class="quick-cards" aria-label="主要功能">
  <a class="qcard primary" href="#opinionStatsSection">{ICON["stats"]}<span class="qc-t">意見數量統計與圖表</span><span class="qc-d">縣市×年度／縣市×領域交叉統計，長條、圓餅、折線圖一鍵切換並匯出</span></a>
  <a class="qcard primary" href="#opinionFilterSection">{ICON["filter"]}<span class="qc-t">意見篩選與匯出</span><span class="qc-d">領域、縣市／中央機關、年度、意見類型自由組合，匯出 CSV</span></a>
  <a class="qcard primary" href="#part-taxo">{ICON["taxo"]}<span class="qc-t">公共政策九大關鍵領域盤點</span><span class="qc-d">社政、勞動、交通、警政、衛福、國土、經濟、教育、族群</span></a>
  <a class="qcard" href="#trackingSection">{ICON["track"]}<span class="qc-t">審核意見改善追蹤</span><span class="qc-d">意見提出一年後的改善狀態</span></a>
  <a class="qcard" href="#part-traffic">{ICON["traffic"]}<span class="qc-t">交通罰鍰與科技執法專題</span><span class="qc-d">六都罰鍰、22 縣市罰款、科技執法意見</span></a>
  <a class="qcard" href="#part-links">{ICON["links"]}<span class="qc-t">決算書與審核報告連結</span><span class="qc-d">22 縣市主計處公告、審核報告直達</span></a>
</nav>'''

dom_nav = "".join(f'<li><a href="#dom-{en}">{zh}<small>{sub}</small></a></li>' for zh, en, sub in DOMAINS)
sidenav = f'''
<nav class="sidenav" id="sidenav" aria-label="快速連結">
  <a class="sn-home" href="#top"><span class="sn-eyebrow">快速連結</span><b>審計意見統計</b></a>
  <ul class="sn-list">
    <li class="sn-group-label">主要功能</li>
    <li><a class="sn-main" href="#opinionStatsSection">意見數量統計與圖表</a></li>
    <li><a class="sn-main" href="#opinionFilterSection">意見篩選與匯出</a></li>
    <li><a class="sn-main" href="#trackingSection">審核意見改善追蹤</a></li>
    <li class="sn-group-label">領域盤點</li>
    <li><a class="sn-main" href="#part-taxo">九大關鍵領域盤點</a>
      <ul class="sn-sub">{dom_nav}</ul></li>
    <li class="sn-group-label">專題與連結</li>
    <li><a class="sn-main" href="#part-traffic">交通罰鍰與科技執法</a>
      <ul class="sn-sub">
        <li><a href="#sec-news12">「至少 12%」時事</a></li>
        <li><a href="#sec-fine6">六都罰鍰決算比較</a></li>
        <li><a href="#sec-fine22">22 縣市罰款及賠償收入</a></li>
        <li><a href="#sec-tech6">六都科技執法審核意見</a></li>
        <li><a href="#sec-road6">六都道路安全改善建議</a></li>
      </ul></li>
    <li><a class="sn-main" href="#part-links">決算書與審核報告連結</a>
      <ul class="sn-sub">
        <li><a href="#sec-notice">使用前請注意</a></li>
        <li><a href="#sec-six">六都總決算公告</a></li>
        <li><a href="#sec-others">其他縣市總決算公告</a></li>
        <li><a href="#sec-sixreport">六都審核報告直達</a></li>
      </ul></li>
  </ul>
</nav>'''

def part(pid, inner, title=None, desc=None):
    h = ""
    if title:
        h = f'<div class="part-head"><h2 class="part-title">{title}</h2>' + (f'<p class="part-desc">{desc}</p>' if desc else "") + '</div>'
    return f'\n<div class="part" id="{pid}">\n{h}{inner}\n</div>\n'

# 九大領域：標題與說明之後，插入領域目錄卡片與全頁領域篩選列
_i = seg["taxo"].index('<p class="taxo-intro">'); _j = seg["taxo"].index("</p>", _i) + 4
taxo_with_nav = seg["taxo"][:_j] + f'\n    <div class="dom-cards" aria-label="九大領域目錄">{dom_cards}</div>\n    ' + domfilter + seg["taxo"][_j:]

main = (
    seg["header"].replace("<header>", '<header id="top">', 1)
    + quick
    + part("part-stats", seg["stats"])
    + part("part-filter", seg["filter"])
    + part("part-track", seg["track"])
    + part("part-taxo", taxo_with_nav)
    + part("part-traffic", seg["news12"] + seg["fine6"] + seg["fine22"] + seg["tech6"] + seg["road6"],
           "交通罰鍰與科技執法專題比較", "六都與全台 22 縣市罰鍰、裁罰收入決算，以及六都科技執法、道路安全改善之審核意見對照")
    + part("part-links", seg["notice"] + seg["kw"] + seg["six"] + seg["others"] + seg["reportTips"] + seg["sixReport"],
           "決算書與審核報告查詢連結", "各縣市主計處「總決算」公告頁面與審計部審核報告直達連結，附查找決算書的關鍵字建議")
    + seg["footer"]
)

CSS = open("layout.css", encoding="utf8").read()
JS = open("layout.js", encoding="utf8").read()
head = head.replace("</head>", f"<style id=\"layout-v2\">\n{CSS}\n</style>\n</head>", 1)
out = (head + '\n<a class="skip-link" href="#main">跳至主要內容</a>\n<div class="layout">\n' + sidenav
       + '\n<main class="main wrap" id="main">\n' + main + '\n</main>\n</div>\n'
       + '<a class="to-top" href="#top" aria-label="回到頁首">↑</a>\n' + tail.replace("</body>", f"<script id=\"layout-v2-js\">\n{JS}\n</script>\n</body>", 1))
import os; os.makedirs(os.path.dirname(DST) or ".", exist_ok=True)
open(DST, "w", encoding="utf8").write(out)
# 檢查：原本所有 id 均仍存在且唯一
ids_old = re.findall(r'\sid="([^"]+)"', s); ids_new = re.findall(r'\sid="([^"]+)"', out)
missing = set(ids_old) - set(ids_new)
dups = {i for i in ids_new if ids_new.count(i) > 1} if len(ids_new) < 5000 else set()
print("written", DST, len(out), "missing ids:", missing)
