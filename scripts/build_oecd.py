# -*- coding: utf-8 -*-
"""
產生「國際比較（OECD）」分頁用資料：data/oecd_road_safety.data.js

資料來源
  1. OECD Data Explorer／ITF「Annual road fatalities, injured, injury crashes」
     (OECD.ITF:DSD_TRENDS@DF_TRENDSSAFETY 1.0) → data_raw/oecd/OECD.ITF_DSD_TRENDS@DF_TRENDSSAFETY_1.0.csv
  2. OECD Data Explorer「Historical population data」
     (OECD.ELS.SAE:DSD_POPULATION@DF_POP_HIST 1.0，僅保留總人口) → data_raw/oecd/OECD.ELS.SAE_DSD_POPULATION@DF_POP_HIST_總人口.csv
  3. 臺灣：本站 data/indicators.data.js（行政院主計總處「縣市重要統計指標」）之
     道路交通事故(30日內)死亡人數、(30日內)受傷人數、肇事總件數、男性＋女性人口

更新方式：以 OECD Data Explorer「Download → Unfiltered data in tabular text (CSV)」下載新檔覆蓋上述兩個 CSV，
再執行 python3 scripts/build_oecd.py
"""
import csv, json, os, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data_raw", "oecd")
YEAR_FROM, YEAR_TO = 2019, 2025

# OECD 38 個會員國（2026 年）
OECD38 = ["AUS", "AUT", "BEL", "CAN", "CHL", "COL", "CRI", "CZE", "DNK", "EST", "FIN", "FRA", "DEU", "GRC", "HUN", "ISL",
          "IRL", "ISR", "ITA", "JPN", "KOR", "LVA", "LTU", "LUX", "MEX", "NLD", "NZL", "NOR", "POL", "PRT", "SVK", "SVN",
          "ESP", "SWE", "CHE", "TUR", "GBR", "USA"]
NAMES = {
    "AUS": "澳洲", "AUT": "奧地利", "BEL": "比利時", "CAN": "加拿大", "CHL": "智利", "COL": "哥倫比亞", "CRI": "哥斯大黎加",
    "CZE": "捷克", "DNK": "丹麥", "EST": "愛沙尼亞", "FIN": "芬蘭", "FRA": "法國", "DEU": "德國", "GRC": "希臘", "HUN": "匈牙利",
    "ISL": "冰島", "IRL": "愛爾蘭", "ISR": "以色列", "ITA": "義大利", "JPN": "日本", "KOR": "韓國", "LVA": "拉脫維亞",
    "LTU": "立陶宛", "LUX": "盧森堡", "MEX": "墨西哥", "NLD": "荷蘭", "NZL": "紐西蘭", "NOR": "挪威", "POL": "波蘭",
    "PRT": "葡萄牙", "SVK": "斯洛伐克", "SVN": "斯洛維尼亞", "ESP": "西班牙", "SWE": "瑞典", "CHE": "瑞士", "TUR": "土耳其",
    "GBR": "英國", "USA": "美國", "TWN": "臺灣",
}
REGION = {  # 供頁面「國家群組」快速選取
    "亞太": ["JPN", "KOR", "AUS", "NZL"],
    "北美與拉丁美洲": ["USA", "CAN", "MEX", "CHL", "COL", "CRI"],
    "北歐": ["SWE", "NOR", "FIN", "DNK", "ISL"],
    "西歐": ["GBR", "IRL", "FRA", "DEU", "NLD", "BEL", "LUX", "AUT", "CHE"],
    "南歐": ["ITA", "ESP", "PRT", "GRC", "SVN", "TUR", "ISR"],
    "中東歐": ["POL", "CZE", "SVK", "HUN", "EST", "LVA", "LTU"],
}

def read_sdmx(path):
    with open(path, encoding="utf-8-sig") as f:
        r = csv.reader(f)
        head = next(r)
        idx = {h: i for i, h in enumerate(head) if h}
        for row in r:
            yield {h: row[i] for h, i in idx.items()}

def build():
    rows = {}  # (code, year) -> dict
    def rec(c, y):
        return rows.setdefault((c, y), {"c": c, "y": y})
    status = {}
    for d in read_sdmx(os.path.join(RAW, "OECD.ITF_DSD_TRENDS@DF_TRENDSSAFETY_1.0.csv")):
        c, y = d["REF_AREA"], int(d["TIME_PERIOD"])
        if c not in OECD38 or not (YEAR_FROM <= y <= YEAR_TO) or d["TRANSPORT_MODE"] != "ROAD":
            continue
        if d["VEHICLE_TYPE"] != "_T" or d["INFRASTRUCTURE_TYPE"] != "_T" or d["OBS_VALUE"] == "":
            continue
        key = {"FATALITIES": "f", "INJURED": "i", "CRASHES": "cr"}.get(d["MEASURE"])
        if not key:
            continue
        rec(c, y)[key] = float(d["OBS_VALUE"])
        if d["OBS_STATUS"] in ("E", "P", "B"):  # 估計值／暫定值／序列斷層
            status.setdefault((c, y), set()).add({"E": "估計值", "P": "暫定值", "B": "統計序列變更"}[d["OBS_STATUS"]])
    for d in read_sdmx(os.path.join(RAW, "OECD.ELS.SAE_DSD_POPULATION@DF_POP_HIST_總人口.csv")):
        c, y = d["REF_AREA"], int(d["TIME_PERIOD"])
        if c in OECD38 and YEAR_FROM <= y <= YEAR_TO and d["SEX"] == "_T" and d["AGE"] == "_T" and d["MEASURE"] == "POP":
            if (c, y) in rows:
                rows[(c, y)]["pop"] = float(d["OBS_VALUE"])
    # 臺灣
    s = open(os.path.join(ROOT, "data", "indicators.data.js"), encoding="utf-8").read()
    ind = json.loads(s[s.index("["):s.rindex("]") + 1])
    tw = {}
    for x in ind:
        if x["county"] == "__TOTAL__" and YEAR_FROM <= x["year"] <= YEAR_TO:
            tw.setdefault(x["year"], {})[x["indicator"]] = x["value"]
    for y, v in tw.items():
        r = rec("TWN", y)
        r["f"] = v.get("道路交通事故(30日內)死亡人數(人)")
        r["i"] = v.get("道路交通事故(30日內)受傷人數(人)")
        r["cr"] = v.get("道路交通事故肇事總件數(件)")
        if v.get("男性人口(人)") and v.get("女性人口(人)"):
            r["pop"] = v["男性人口(人)"] + v["女性人口(人)"]
    out = []
    for (c, y), r in sorted(rows.items(), key=lambda kv: (kv[0][0], kv[0][1])):
        for k in ("f", "i", "cr", "pop"):
            if r.get(k) is not None:
                r[k] = int(round(r[k]))
        if (c, y) in status:
            r["note"] = "、".join(sorted(status[(c, y)]))
        out.append(r)
    have = sorted({r["c"] for r in out if "f" in r})
    countries = [{"code": c, "name": NAMES[c], "oecd": c != "TWN",
                  "region": next((g for g, lst in REGION.items() if c in lst), "臺灣" if c == "TWN" else "其他"),
                  "hasData": c in have} for c in OECD38 + ["TWN"]]
    meta = {
        "yearFrom": YEAR_FROM, "yearTo": YEAR_TO,
        "oecdLatestYear": max(r["y"] for r in out if r["c"] != "TWN" and "f" in r),
        "missing": [NAMES[c] for c in OECD38 if c not in have],
        "sources": [
            {"name": "OECD／ITF Annual road fatalities, injured, injury crashes（DSD_TRENDS@DF_TRENDSSAFETY 1.0）",
             "url": "https://data-explorer.oecd.org/vis?df%5Bag%5D=OECD.ITF&df%5Bds%5D=DisseminateFinalDMZ&df%5Bid%5D=DSD_TRENDS%40DF_TRENDSSAFETY&df%5Bvs%5D=1.0"},
            {"name": "OECD Historical population data（DSD_POPULATION@DF_POP_HIST 1.0）",
             "url": "https://data-explorer.oecd.org/vis?df%5Bds%5D=DisseminateFinalDMZ&df%5Bid%5D=DSD_POPULATION@DF_POP_HIST&df%5Bag%5D=OECD.ELS.SAE"},
            {"name": "臺灣：行政院主計總處「縣市重要統計指標」（道路交通事故 30 日內死亡／受傷人數、肇事總件數、人口）", "url": ""},
        ],
        "downloadedAt": "2026-09-25",
        "generatedAt": datetime.datetime.now().isoformat(timespec="seconds"),
    }
    js = ("// 自動產生，請勿手動修改。由 scripts/build_oecd.py 產生。\n"
          "window.OECD_ROAD = " + json.dumps({"meta": meta, "countries": countries, "rows": out}, ensure_ascii=False, separators=(",", ":")) + ";\n")
    open(os.path.join(ROOT, "data", "oecd_road_safety.data.js"), "w", encoding="utf-8").write(js)
    print(f"[oecd] {len(out)} 筆（{len(have)} 國／地區），OECD 最新年度 {meta['oecdLatestYear']}，缺資料：{meta['missing']}")

if __name__ == "__main__":
    build()
