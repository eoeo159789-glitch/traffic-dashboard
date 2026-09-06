#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_data.py — 交通事故資料整合網站的資料建置腳本

用途：
  把 data_raw/ 底下的原始檔案（A1事故明細 CSV、舉發統計 xlsx、縣市統計指標 xlsx）
  轉換成前端可直接讀取的 JS 資料檔（放在 data/ 目錄下）。

如何更新資料（新增年度或修改資料）：
  1. 事故明細：把新年度的 CSV 放進 data_raw/accidents/，檔名用西元年份，例如 115.csv
     （欄位需與現有 A1 資料相同的標準格式，UTF-8 或 UTF-8-BOM 皆可）
  2. 舉發統計：把新的 xlsx 取代或新增到 data_raw/enforcement/ 對應類別的檔案中
     （只要是同樣的「統計期 x 縣市_車種」格式，新增列會自動被讀到）
  3. 縣市統計指標：更新 data_raw/indicators/縣市統計指標.xlsx（同樣格式，新增年度列即可）
  4. A2（受傷）事故資料：把新年度的原始 CSV 放進 data_raw/a2/<西元年份>/ 資料夾
     （例如 data_raw/a2/115/，裡面放該年度所有分割檔，檔名不拘）。
     因為資料量非常大（一年可能 80-90 萬列），這邊不會逐筆保留，而是在建置時
     直接串流彙總成統計數字（不會佔用太多記憶體），同時會把每個年度的原始明細
     清理合併、壓縮後輸出到 full_data_export/ 資料夾，供使用者下載原始逐筆資料。
  5. 執行： python3 scripts/build_data.py
  6. 完成後 data/*.data.js 會自動重新產生，直接重新整理網頁（index.html）即可看到新資料。

需求套件： pip install python-calamine
"""
import csv
import json
import re
import glob
import math
import os
import sys
from collections import defaultdict

try:
    from python_calamine import CalamineWorkbook
except ImportError:
    print("請先安裝: pip install python-calamine --break-system-packages", file=sys.stderr)
    sys.exit(1)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(BASE, "data_raw")
OUT = os.path.join(BASE, "data")
os.makedirs(OUT, exist_ok=True)

COUNTIES = [
    "新北市","臺北市","桃園市","臺中市","臺南市","高雄市","宜蘭縣","新竹縣","苗栗縣",
    "彰化縣","南投縣","雲林縣","嘉義縣","屏東縣","臺東縣","花蓮縣","澎湖縣","基隆市",
    "新竹市","嘉義市","金門縣","連江縣"
]
# 舊縣市名 -> 現行縣市名（用於合併歷史欄位/地名字串正規化）
COUNTY_ALIAS = {
    "臺北縣":"新北市","台北縣":"新北市",
    "桃園縣":"桃園市",
    "臺中縣":"臺中市","台中縣":"臺中市","臺中市(99年改制前)":"臺中市","台中市(99年改制前)":"臺中市",
    "臺南縣":"臺南市","台南縣":"臺南市","臺南市(99年改制前)":"臺南市","台南市(99年改制前)":"臺南市",
    "高雄縣":"高雄市","高雄市(99年改制前)":"高雄市",
    "台北市":"臺北市","台中市":"臺中市","台南市":"臺南市","台東縣":"臺東縣",
}
COUNTY_SET = set(COUNTIES)
# 依字串長度排序（長的優先比對，避免「新北市」被「北市」誤判之類的問題）
COUNTY_MATCH_LIST = sorted(list(COUNTY_SET) + list(COUNTY_ALIAS.keys()), key=len, reverse=True)


def normalize_county(name):
    if not name:
        return None
    name = name.strip()
    if name in COUNTY_SET:
        return name
    if name in COUNTY_ALIAS:
        return COUNTY_ALIAS[name]
    return None


def extract_county_from_address(addr):
    if not addr:
        return None
    for c in COUNTY_MATCH_LIST:
        if addr.startswith(c) or (len(addr) >= 3 and c in addr[:6]):
            return normalize_county(c)
    return None


# ---------------------------------------------------------------------------
# 1) A1 事故明細
# ---------------------------------------------------------------------------

def parse_casualty(s):
    """'死亡1;受傷0' -> (1,0)"""
    d, i = 0, 0
    if not s:
        return d, i
    md = re.search(r"死亡(\d+)", s)
    mi = re.search(r"受傷(\d+)", s)
    if md:
        d = int(md.group(1))
    if mi:
        i = int(mi.group(1))
    return d, i


ACC_FIELDS = {
    "year": "發生年度", "month": "發生月份", "date": "發生日期", "time": "發生時間",
    "unit": "處理單位名稱警局層", "addr": "發生地點", "weather": "天候名稱",
    "light": "光線名稱", "roadClass": "道路類別-第1當事者-名稱", "speedLimit": "速限-第1當事者",
    "roadType": "道路型態大類別名稱", "roadSubtype": "道路型態子類別名稱",
    "posType": "事故位置大類別名稱", "posSubtype": "事故位置子類別名稱",
    "surface": "路面狀況-路面鋪裝名稱", "surfaceState": "路面狀況-路面狀態名稱",
    "signalType": "號誌-號誌種類名稱", "signalAction": "號誌-號誌動作名稱",
    "accTypeMajor": "事故類型及型態大類別名稱", "accTypeMinor": "事故類型及型態子類別名稱",
    "causeMajor": "肇因研判大類別名稱-主要", "causeMinor": "肇因研判子類別名稱-主要",
    "casualty": "死亡受傷人數", "seq": "當事者順位", "hitRun": "肇事逃逸類別名稱-是否肇逃",
    "lng": "經度", "lat": "緯度",
}
PARTY_FIELDS = {
    "seq": "當事者順位", "vType": "當事者區分-類別-大類別名稱-車種",
    "vSubtype": "當事者區分-類別-子類別名稱-車種", "gender": "當事者屬-性-別名稱",
    "age": "當事者事故發生時年齡", "gear": "保護裝備名稱", "phone": "行動電話或電腦或其他相類功能裝置名稱",
    "actionMajor": "當事者行動狀態大類別名稱", "actionMinor": "當事者行動狀態子類別名稱",
    "impactMajor": "車輛撞擊部位大類別名稱-最初", "impactMinor": "車輛撞擊部位子類別名稱-最初",
    "causeMajorIndiv": "肇因研判大類別名稱-個別", "causeMinorIndiv": "肇因研判子類別名稱-個別",
}


def load_accidents():
    accidents = []
    parties = []
    files = sorted(glob.glob(os.path.join(RAW, "accidents", "*.csv")))
    for fp in files:
        fname = os.path.basename(fp)
        with open(fp, encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            acc_id = None
            for row in reader:
                raw_year = (row.get("發生年度") or "").strip()
                if not re.match(r"^\d{4}$", raw_year):
                    continue  # 跳過檔案尾端的說明文字列
                seq = row.get("當事者順位", "").strip()
                year = int(raw_year)
                county = extract_county_from_address(row.get("發生地點", ""))
                if seq == "1":
                    acc_id = f"{year}-{len(accidents)+1}"
                    d, i = parse_casualty(row.get("死亡受傷人數", ""))
                    try:
                        lng = float(row.get("經度") or 0) or None
                    except ValueError:
                        lng = None
                    try:
                        lat = float(row.get("緯度") or 0) or None
                    except ValueError:
                        lat = None
                    try:
                        hour = int((row.get("發生時間") or "0").zfill(6)[:2])
                    except ValueError:
                        hour = None
                    accidents.append({
                        "id": acc_id,
                        "year": year,
                        "month": int(row.get("發生月份") or 0),
                        "date": row.get("發生日期"),
                        "hour": hour,
                        "county": county,
                        "unit": row.get("處理單位名稱警局層"),
                        "addr": row.get("發生地點"),
                        "weather": row.get("天候名稱"),
                        "light": row.get("光線名稱"),
                        "roadClass": row.get("道路類別-第1當事者-名稱"),
                        "speedLimit": row.get("速限-第1當事者"),
                        "roadType": row.get("道路型態大類別名稱"),
                        "roadSubtype": row.get("道路型態子類別名稱"),
                        "posType": row.get("事故位置大類別名稱"),
                        "posSubtype": row.get("事故位置子類別名稱"),
                        "surface": row.get("路面狀況-路面鋪裝名稱"),
                        "surfaceState": row.get("路面狀況-路面狀態名稱"),
                        "signalType": row.get("號誌-號誌種類名稱"),
                        "accTypeMajor": row.get("事故類型及型態大類別名稱"),
                        "accTypeMinor": row.get("事故類型及型態子類別名稱"),
                        "causeMajor": row.get("肇因研判大類別名稱-主要"),
                        "causeMinor": row.get("肇因研判子類別名稱-主要"),
                        "deaths": d,
                        "injuries": i,
                        "hitRun": row.get("肇事逃逸類別名稱-是否肇逃"),
                        "lng": lng,
                        "lat": lat,
                    })
                if acc_id is None:
                    continue
                parties.append({
                    "aid": acc_id,
                    "seq": seq,
                    "vType": row.get("當事者區分-類別-大類別名稱-車種"),
                    "vSubtype": row.get("當事者區分-類別-子類別名稱-車種"),
                    "gender": row.get("當事者屬-性-別名稱"),
                    "age": row.get("當事者事故發生時年齡"),
                    "gear": row.get("保護裝備名稱"),
                    "phone": row.get("行動電話或電腦或其他相類功能裝置名稱"),
                    "actionMajor": row.get("當事者行動狀態大類別名稱"),
                    "actionMinor": row.get("當事者行動狀態子類別名稱"),
                    "impactMajor": row.get("車輛撞擊部位大類別名稱-最初"),
                    "causeMajorIndiv": row.get("肇因研判大類別名稱-個別"),
                    "causeMinorIndiv": row.get("肇因研判子類別名稱-個別"),
                })
        print(f"  [accidents] {fname}: 累積 {len(accidents)} 件事故 / {len(parties)} 筆當事者")
    return accidents, parties


# ---------------------------------------------------------------------------
# 2) 舉發統計 (108-114, 年度 x 縣市 x 車種)
# ---------------------------------------------------------------------------

ROC_YEAR_RE = re.compile(r"^(\d{2,3})年")


def roc_to_west(s):
    m = ROC_YEAR_RE.match(s.strip()) if s else None
    if not m:
        return None
    return int(m.group(1)) + 1911


def load_workbook_rows(path, sheet_index=0):
    wb = CalamineWorkbook.from_path(path)
    ws = wb.get_sheet_by_name(wb.sheet_names[sheet_index])
    return ws.to_python()


def load_enforcement():
    """回傳 list of {year, county, category, vType, count}"""
    records = []
    files = sorted(glob.glob(os.path.join(RAW, "enforcement", "*.xlsx")))
    for fp in files:
        category = os.path.splitext(os.path.basename(fp))[0]
        rows = load_workbook_rows(fp)
        # 找出欄位標題列（含「機關別總計」或縣市名稱的那一列）與資料起始列
        header_row_idx = None
        for i, r in enumerate(rows):
            joined = "".join(str(c) for c in r if c)
            if "機關別總計" in joined or (r and any(isinstance(c, str) and c in COUNTY_SET for c in r)):
                header_row_idx = i
                break
        if header_row_idx is None:
            print(f"  [enforcement] WARNING: 找不到標題列於 {fp}")
            continue
        header = [str(c) if c is not None else "" for c in rows[header_row_idx]]
        n = 0
        for r in rows[header_row_idx + 1:]:
            if not r or not r[0]:
                continue
            year = roc_to_west(str(r[0]))
            if year is None:
                continue
            for col_idx in range(1, min(len(header), len(r))):
                col_name = header[col_idx]
                if not col_name:
                    continue
                val = r[col_idx]
                if val in (None, "", "－", "-"):
                    continue
                try:
                    count = int(val)
                except (ValueError, TypeError):
                    continue
                # 解析欄位名稱： "新北市_汽車" / "機關別總計(全選)_總計(含動力機械)" / "新北市" (無車種細分)
                if "_" in col_name:
                    county_raw, vtype = col_name.split("_", 1)
                else:
                    county_raw, vtype = col_name, "總計"
                if "機關別總計" in county_raw or county_raw in ("總計",):
                    county = "__TOTAL__"
                elif county_raw == "署所屬機關":
                    county = "__HQ__"
                else:
                    county = normalize_county(county_raw)
                    if county is None:
                        # 歷史已裁併縣市（如臺北縣、桃園縣...）且此列為0/dash已被跳過，
                        # 若仍有值代表資料異常，忽略但不中斷
                        continue
                vtype_clean = re.sub(r"\(.*?\)", "", vtype).strip() or "總計"
                records.append({
                    "year": year, "county": county, "category": category,
                    "vType": vtype_clean, "count": count,
                })
                n += 1
        print(f"  [enforcement] {os.path.basename(fp)}: {n} 筆")
    return records


# ---------------------------------------------------------------------------
# 3) 縣市統計指標 (人口、事故總件數、死傷人數、道路里程...長年期)
# ---------------------------------------------------------------------------

def load_indicators():
    """
    檔案結構（stacked tables）：
      區塊標題列 '【...】...'
      縣市標題列 ('', '總計', '新北市', '臺北市', ...)  <- 同一個縣市標題列會被之後好幾個指標區塊共用
      指標名稱列 ('男性人口(人)', '', '', ...)
      資料列 ('1998', 11243408, ...) ... 直到下一個非年份列
      指標名稱列 ...
      資料列 ...
      ...（重複到下一個區塊標題列，會出現新的縣市標題列）
      最後還有「註解：」區塊可以整段忽略
    """
    fp = os.path.join(RAW, "indicators", "縣市統計指標.xlsx")
    rows = load_workbook_rows(fp)
    records = []
    seen_titles = set()
    counties_header = None
    i = 0
    while i < len(rows):
        r = rows[i]
        c0 = str(r[0]).strip() if r and r[0] is not None else ""
        if c0.startswith("【"):
            i += 1
            continue
        if r and len(r) > 1 and r[1] == "總計":
            counties_header = r
            i += 1
            continue
        note_prefixes = ("註解：", "------", "指標項：", "單位：", "定義：", "資料來源：", "註記：", "公式：")
        if c0 == "" or c0.startswith(note_prefixes):
            i += 1
            continue
        # 指標名稱列：非空字串、非年份、且已有縣市標題列可用
        if c0 and not re.match(r"^\d{4}$", c0) and counties_header is not None:
            key = c0
            j = i + 1
            while j < len(rows):
                dr = rows[j]
                dc0 = str(dr[0]).strip() if dr and dr[0] is not None else ""
                if not re.match(r"^\d{4}$", dc0):
                    break
                year = int(dc0)
                for col_idx in range(1, min(len(counties_header), len(dr))):
                    cname = counties_header[col_idx]
                    val = dr[col_idx]
                    if cname is None or val in (None, "", "－", "-"):
                        continue
                    county = "__TOTAL__" if cname == "總計" else normalize_county(cname)
                    if county is None:
                        continue
                    try:
                        fval = float(val)
                    except (ValueError, TypeError):
                        continue
                    records.append({"year": year, "county": county, "indicator": key, "value": fval})
                j += 1
            seen_titles.add(key)
            i = j
            continue
        i += 1
    print(f"  [indicators] {len(seen_titles)} 種指標, {len(records)} 筆資料點")
    print("   指標列表:", "、".join(sorted(seen_titles)))
    return records


# ---------------------------------------------------------------------------
# 熱點路口資料（1000 易肇事路口 + 799 人行安全計畫補助地點）與環域分析
# ---------------------------------------------------------------------------

POINTS_DIR = os.path.join(RAW, "points")
BUFFER_RADII_M = [50, 100, 200, 300, 500, 1000]  # 環域分析半徑（公尺）選項
POINT_GRID_DEG = 0.01  # 約 1.1 公里網格，用於環域分析的空間索引（先篩候選點再算精確距離）


def _num(v):
    try:
        if v is None or v == "":
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def load_hotspot1000():
    path = os.path.join(POINTS_DIR, "全國1000易肇事路口清單彙整_已完成地理編碼.xlsx")
    if not os.path.exists(path):
        return []
    rows = load_workbook_rows(path, 0)
    header, data = rows[0], rows[1:]
    idx = {h: i for i, h in enumerate(header)}

    def g(r, col):
        i = idx.get(col)
        return r[i] if i is not None and i < len(r) else None

    out = []
    for r in data:
        lat, lng = _num(g(r, "緯度 Latitude")), _num(g(r, "經度 Longitude"))
        if lat is None or lng is None:
            continue
        num = g(r, "編號")
        rank = g(r, "原始排行")
        out.append({
            "id": f"h{int(num) if num is not None else len(out)+1}",
            "county": normalize_county(g(r, "縣市")) or g(r, "縣市"),
            "township": g(r, "鄉鎮市區"),
            "name": g(r, "路口名稱"),
            "count": int(g(r, "件數") or 0),
            "deaths": int(g(r, "死亡人數") or 0),
            "injuries": int(g(r, "受傷人數") or 0),
            "rank": int(rank) if rank not in (None, "") else None,
            "category": g(r, "備註（類別）"),
            "lat": lat, "lng": lng,
        })
    return out


def load_safety799():
    path = os.path.join(POINTS_DIR, "永續提升人行安全計畫799處補助地點_路口清單_已完成地理編碼.xlsx")
    if not os.path.exists(path):
        return []
    rows = load_workbook_rows(path, 0)
    header, data = rows[0], rows[1:]
    idx = {h: i for i, h in enumerate(header)}

    def g(r, col):
        i = idx.get(col)
        return r[i] if i is not None and i < len(r) else None

    out = []
    for r in data:
        lat, lng = _num(g(r, "緯度 Latitude")), _num(g(r, "經度 Longitude"))
        if lat is None or lng is None:
            continue
        seq = g(r, "序號")
        out.append({
            "id": f"s{int(seq) if seq is not None else len(out)+1}",
            "source": g(r, "資料來源"),
            "county": normalize_county(g(r, "縣市")) or g(r, "縣市"),
            "township": g(r, "鄉鎮市區"),
            "position": g(r, "路口位置(原始)"),
            "code": g(r, "原始項次/代號"),
            "address": g(r, "完整地址"),
            "lat": lat, "lng": lng,
        })
    return out


def build_point_grid(points):
    """把點位依經緯度網格分桶，供環域分析快速篩選候選點（避免對每一筆事故都跟全部點位比對）。"""
    grid = defaultdict(list)
    for i, p in enumerate(points):
        cell = (round(p["lat"] / POINT_GRID_DEG), round(p["lng"] / POINT_GRID_DEG))
        grid[cell].append(i)
    return grid


def dist_m(lat1, lng1, lat2, lng2):
    """兩點距離（公尺），採等距圓柱投影近似（短距離已足夠精準，且比 haversine 快很多）。"""
    lat_avg = math.radians((lat1 + lat2) / 2)
    dx = math.radians(lng2 - lng1) * math.cos(lat_avg) * 6371000
    dy = math.radians(lat2 - lat1) * 6371000
    return math.sqrt(dx * dx + dy * dy)


def nearby_point_indices(grid, lat, lng):
    cx, cy = round(lat / POINT_GRID_DEG), round(lng / POINT_GRID_DEG)
    out = []
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            cell = grid.get((cx + dx, cy + dy))
            if cell:
                out.extend(cell)
    return out


def compute_point_buffers_a1(points, grid, accidents):
    """回傳 {point_id: {半徑: [件數, 死亡人數, 受傷人數]}}，以 A1 逐筆資料精確計算。"""
    buf = {p["id"]: {r: [0, 0, 0] for r in BUFFER_RADII_M} for p in points}
    max_r = BUFFER_RADII_M[-1]
    for a in accidents:
        lat, lng = a.get("lat"), a.get("lng")
        if lat is None or lng is None or abs(lat) < 1 or abs(lng) < 1:
            continue
        cand = nearby_point_indices(grid, lat, lng)
        if not cand:
            continue
        for i in cand:
            p = points[i]
            d = dist_m(lat, lng, p["lat"], p["lng"])
            if d > max_r:
                continue
            e = buf[p["id"]]
            deaths, injuries = a.get("deaths", 0) or 0, a.get("injuries", 0) or 0
            for r in BUFFER_RADII_M:
                if d <= r:
                    b = e[r]
                    b[0] += 1
                    b[1] += deaths
                    b[2] += injuries
    return buf


def compute_geo_jump(all_points):
    """依熱點/補助點位資料，算出各縣市、各鄉鎮市區的概略中心座標，供地圖「跳到此區域」使用。"""
    county_acc = defaultdict(lambda: [0.0, 0.0, 0])
    township_acc = defaultdict(lambda: [0.0, 0.0, 0])
    for p in all_points:
        c = p.get("county")
        if not c:
            continue
        e = county_acc[c]; e[0] += p["lat"]; e[1] += p["lng"]; e[2] += 1
        t = p.get("township")
        if t:
            e2 = township_acc[(c, t)]; e2[0] += p["lat"]; e2[1] += p["lng"]; e2[2] += 1

    counties = [{"county": c, "lat": v[0] / v[2], "lng": v[1] / v[2]} for c, v in county_acc.items()]
    have = {c["county"] for c in counties}
    # 1000/799 兩份名單皆未涵蓋外島兩縣，補上概略縣治座標，讓地圖跳轉功能涵蓋全 22 縣市
    fallback = {"金門縣": (24.4457, 118.3768), "連江縣": (26.1608, 119.9500)}
    for name, (lat, lng) in fallback.items():
        if name not in have:
            counties.append({"county": name, "lat": lat, "lng": lng})

    townships = [
        {"county": c, "township": t, "lat": v[0] / v[2], "lng": v[1] / v[2]}
        for (c, t), v in township_acc.items()
    ]
    return {
        "counties": sorted(counties, key=lambda x: x["county"]),
        "townships": sorted(townships, key=lambda x: (x["county"], x["township"])),
    }


# ---------------------------------------------------------------------------
# A2 事故資料（僅受傷、無死亡；資料量遠大於 A1，採「串流彙總」而非逐筆保留）
# ---------------------------------------------------------------------------

A2_GEO_ROUND = 2          # 經緯度四捨五入到小數第2位（約1.1公里網格），用於地圖熱區密度（區域級即可，避免彙整表過大）
A2_CROSSTAB_DIMS = [
    "county", "weather", "light", "roadClass", "roadType",
    "posType", "signalType", "accTypeMajor", "causeMajor", "hitRun",
]
FULL_EXPORT_DIR = os.path.join(BASE, "full_data_export")


def load_a2(points=None, grid=None):
    """
    串流讀取 data_raw/a2/<年度>/*.csv（每年 10-15 個分割檔，單年可能高達 80-90 萬列）。
    不保留逐筆記錄，只累積：
      - crosstab: 依 A2_CROSSTAB_DIMS + year 分組的件數/受傷人數
      - byMonth / byHour: 依年度+縣市+月份/時段 分組
      - byCounty: 依年度+縣市 分組（總計，供 KPI／排行用）
      - accTypeMinor / causeMinor: 依年度+縣市+子類別 分組（供排行圖表用）
      - geo: 依年度+縣市+經緯度網格 分組（供地圖熱力圖用）
      - bufferA2: 若有帶入 points/grid（熱點路口環域分析用），同一次掃描順便累積
        各點位在 BUFFER_RADII_M 各半徑內的 A2 件數/受傷人數（避免整份 A2 原始資料被重複掃描）
    同時把每個年度的原始明細清理後合併成一個檔案，壓縮輸出到 full_data_export/，
    供使用者匯出原始逐筆資料做進一步分析（不會被網站載入，僅提供下載）。
    """
    year_dirs = sorted(glob.glob(os.path.join(RAW, "a2", "*")))
    if not year_dirs:
        print("  [A2] 找不到 data_raw/a2/ 資料，略過")
        return None

    crosstab = defaultdict(lambda: [0, 0])   # key: tuple(year, *dims) -> [count, injuries]
    by_month = defaultdict(lambda: [0, 0])   # key: (year, county, month)
    by_hour = defaultdict(lambda: [0, 0])    # key: (year, county, hour)
    by_county = defaultdict(lambda: [0, 0])  # key: (year, county)
    acc_type_minor = defaultdict(lambda: [0, 0])  # key: (year, county, accTypeMinor)
    cause_minor = defaultdict(lambda: [0, 0])     # key: (year, county, causeMinor)
    geo = defaultdict(lambda: [0, 0])        # key: (year, county, latBin, lngBin)

    do_buffer = bool(points and grid is not None)
    buf_a2 = {p["id"]: {r: [0, 0] for r in BUFFER_RADII_M} for p in points} if do_buffer else {}
    max_r = BUFFER_RADII_M[-1] if do_buffer else 0

    os.makedirs(FULL_EXPORT_DIR, exist_ok=True)
    total_rows = 0
    total_accidents = 0
    export_manifest = []

    for year_dir in year_dirs:
        year_label = os.path.basename(year_dir)
        files = sorted(glob.glob(os.path.join(year_dir, "*.csv")))
        if not files:
            continue
        merged_path = os.path.join(FULL_EXPORT_DIR, f"A2_受傷交通事故資料_{year_label}年.csv")
        merged_f = open(merged_path, "w", encoding="utf-8-sig", newline="")
        merged_writer = None
        year_accidents = 0

        for fp in files:
            print(f"  [A2] 讀取 {os.path.basename(fp)} ...", flush=True)
            with open(fp, encoding="utf-8-sig", newline="") as f:
                reader = csv.reader(f)
                header = next(reader)
                idx = {name: i for i, name in enumerate(header)}
                if merged_writer is None:
                    merged_writer = csv.writer(merged_f)
                    merged_writer.writerow(header)

                def g(row, col):
                    i = idx.get(col)
                    return row[i] if i is not None and i < len(row) else ""

                for row in reader:
                    total_rows += 1
                    raw_year = g(row, "發生年度").strip()
                    if not re.match(r"^\d{4}$", raw_year):
                        continue  # 檔案尾端說明文字列
                    merged_writer.writerow(row)
                    if g(row, "當事者順位").strip() != "1":
                        continue  # 只取事故層級列（比照 A1 的處理方式）
                    year_accidents += 1
                    total_accidents += 1
                    year = int(raw_year)
                    month = int(g(row, "發生月份") or 0)
                    try:
                        hour = int((g(row, "發生時間") or "0").zfill(6)[:2])
                    except ValueError:
                        hour = None
                    county = extract_county_from_address(g(row, "發生地點"))
                    _, injuries = parse_casualty(g(row, "死亡受傷人數"))
                    weather = g(row, "天候名稱")
                    light = g(row, "光線名稱")
                    roadClass = g(row, "道路類別-第1當事者-名稱")
                    roadType = g(row, "道路型態大類別名稱")
                    posType = g(row, "事故位置大類別名稱")
                    signalType = g(row, "號誌-號誌種類名稱")
                    accTypeMajor = g(row, "事故類型及型態大類別名稱")
                    accTypeMinorV = g(row, "事故類型及型態子類別名稱")
                    causeMajor = g(row, "肇因研判大類別名稱-主要")
                    causeMinorV = g(row, "肇因研判子類別名稱-主要")
                    hitRun = g(row, "肇事逃逸類別名稱-是否肇逃")

                    dims = {
                        "county": county, "weather": weather, "light": light,
                        "roadClass": roadClass, "roadType": roadType, "posType": posType,
                        "signalType": signalType, "accTypeMajor": accTypeMajor,
                        "causeMajor": causeMajor, "hitRun": hitRun,
                    }
                    ck = (year,) + tuple(dims[d] for d in A2_CROSSTAB_DIMS)
                    e = crosstab[ck]; e[0] += 1; e[1] += injuries

                    e = by_month[(year, county, month)]; e[0] += 1; e[1] += injuries
                    if hour is not None:
                        e = by_hour[(year, county, hour)]; e[0] += 1; e[1] += injuries
                    e = by_county[(year, county)]; e[0] += 1; e[1] += injuries
                    e = acc_type_minor[(year, county, accTypeMinorV)]; e[0] += 1; e[1] += injuries
                    e = cause_minor[(year, county, causeMinorV)]; e[0] += 1; e[1] += injuries

                    try:
                        raw_lat = float(g(row, "緯度") or 0)
                        raw_lng = float(g(row, "經度") or 0)
                    except ValueError:
                        raw_lat = raw_lng = 0.0
                    if abs(raw_lat) > 1 and abs(raw_lng) > 1:
                        gy, gx = round(raw_lat, A2_GEO_ROUND), round(raw_lng, A2_GEO_ROUND)
                        e = geo[(year, county, gy, gx)]; e[0] += 1; e[1] += injuries

                        if do_buffer:
                            cand = nearby_point_indices(grid, raw_lat, raw_lng)
                            for i in cand:
                                p = points[i]
                                d = dist_m(raw_lat, raw_lng, p["lat"], p["lng"])
                                if d > max_r:
                                    continue
                                be = buf_a2[p["id"]]
                                for r in BUFFER_RADII_M:
                                    if d <= r:
                                        b = be[r]
                                        b[0] += 1
                                        b[1] += injuries

        merged_f.close()
        # 壓縮輸出，刪除未壓縮版本以節省空間
        import gzip as _gzip
        with open(merged_path, "rb") as fin, _gzip.open(merged_path + ".gz", "wb", compresslevel=6) as fout:
            fout.writelines(fin)
        gz_size = os.path.getsize(merged_path + ".gz")
        os.remove(merged_path)
        print(f"  [A2] {year_label}年：{year_accidents:,} 件事故 → {os.path.basename(merged_path)}.gz ({gz_size/1024/1024:.1f} MB)")
        west_year = int(year_label) + 1911 if re.match(r"^\d{2,3}$", year_label) else None
        export_manifest.append({
            "rocYear": year_label,
            "year": west_year,
            "filename": os.path.basename(merged_path) + ".gz",
            "sizeBytes": gz_size,
            "accidents": year_accidents,
        })

    def dictify(d, dim_names):
        out = []
        for k, v in d.items():
            row = dict(zip(dim_names, k))
            row["count"] = v[0]
            row["injuries"] = v[1]
            out.append(row)
        return out

    result = {
        "crosstab": dictify(crosstab, ["year"] + A2_CROSSTAB_DIMS),
        "byMonth": dictify(by_month, ["year", "county", "month"]),
        "byHour": dictify(by_hour, ["year", "county", "hour"]),
        "byCounty": dictify(by_county, ["year", "county"]),
        "accTypeMinor": dictify(acc_type_minor, ["year", "county", "accTypeMinor"]),
        "causeMinor": dictify(cause_minor, ["year", "county", "causeMinor"]),
        "geo": dictify(geo, ["year", "county", "lat", "lng"]),
        "exportManifest": export_manifest,
        "bufferA2": buf_a2,
    }
    print(f"  [A2] 總計掃描 {total_rows:,} 列原始資料，{total_accidents:,} 件事故")
    for k, v in result.items():
        print(f"       {k}: {len(v):,} 筆彙總列")
    return result


# ---------------------------------------------------------------------------
# 輸出
# ---------------------------------------------------------------------------

def write_js(varname, data, filename):
    path = os.path.join(OUT, filename)
    with open(path, "w", encoding="utf-8") as f:
        f.write(f"// 自動產生，請勿手動修改。由 scripts/build_data.py 產生。\n")
        f.write(f"window.{varname} = ")
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    size_kb = os.path.getsize(path) / 1024
    print(f"  -> {filename} ({size_kb:.0f} KB, {len(data)} 筆)")


def main():
    print("=== 建置事故明細資料 ===")
    accidents, parties = load_accidents()
    print("=== 建置舉發統計資料 ===")
    enforcement = load_enforcement()
    print("=== 建置縣市統計指標資料 ===")
    indicators = load_indicators()

    print("=== 建置熱點路口資料（1000易肇事路口 + 799人行安全計畫補助地點）===")
    hotspot1000 = load_hotspot1000()
    safety799 = load_safety799()
    all_points = [
        {"id": p["id"], "lat": p["lat"], "lng": p["lng"], "county": p["county"], "township": p["township"]}
        for p in hotspot1000 + safety799
    ]
    print(f"  熱點路口共 {len(hotspot1000):,} 處，人行安全補助地點共 {len(safety799):,} 處")

    point_grid = build_point_grid(all_points) if all_points else None
    geo_jump = compute_geo_jump(all_points) if all_points else {"counties": [], "townships": []}

    buffer_a1 = {}
    if all_points:
        print("=== 計算 A1 環域分析（各熱點路口半徑內的 A1 事故統計）===")
        buffer_a1 = compute_point_buffers_a1(all_points, point_grid, accidents)

    print("=== 建置 A2（受傷）事故彙總資料（並同步計算 A2 環域分析）===")
    a2 = load_a2(all_points if all_points else None, point_grid)

    years = sorted(set(a["year"] for a in accidents))
    meta = {
        "counties": COUNTIES,
        "accidentYears": years,
        "enforcementYears": sorted(set(e["year"] for e in enforcement)),
        "enforcementCategories": sorted(set(e["category"] for e in enforcement)),
        "indicatorNames": sorted(set(i["indicator"] for i in indicators)),
        "a2CrosstabDims": A2_CROSSTAB_DIMS,
        "a2Years": sorted(set(r["year"] for r in a2["byCounty"])) if a2 else [],
        "bufferRadii": BUFFER_RADII_M,
        "hotspot1000Count": len(hotspot1000),
        "safety799Count": len(safety799),
        "generatedAt": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
    }

    print("=== 輸出 data/*.data.js ===")
    write_js("ACCIDENTS", accidents, "accidents.data.js")
    write_js("PARTIES", parties, "parties.data.js")
    write_js("ENFORCEMENT", enforcement, "enforcement.data.js")
    write_js("INDICATORS", indicators, "indicators.data.js")
    write_js("META", meta, "meta.data.js")
    write_js("POINTS_HOTSPOT1000", hotspot1000, "points_hotspot1000.data.js")
    write_js("POINTS_SAFETY799", safety799, "points_safety799.data.js")
    write_js("GEO_JUMP", geo_jump, "geo_jump.data.js")
    write_js("POINT_BUFFER_A1", buffer_a1, "point_buffer_a1.data.js")
    if a2:
        write_js("A2_EXPORT_MANIFEST", a2["exportManifest"], "a2_export_manifest.data.js")
        write_js("A2_CROSSTAB", a2["crosstab"], "a2_crosstab.data.js")
        write_js("A2_BY_MONTH", a2["byMonth"], "a2_by_month.data.js")
        write_js("A2_BY_HOUR", a2["byHour"], "a2_by_hour.data.js")
        write_js("A2_BY_COUNTY", a2["byCounty"], "a2_by_county.data.js")
        write_js("A2_ACC_TYPE_MINOR", a2["accTypeMinor"], "a2_acc_type_minor.data.js")
        write_js("A2_CAUSE_MINOR", a2["causeMinor"], "a2_cause_minor.data.js")
        write_js("A2_GEO", a2["geo"], "a2_geo.data.js")
        write_js("POINT_BUFFER_A2", a2["bufferA2"], "point_buffer_a2.data.js")
    print("完成！")


if __name__ == "__main__":
    main()
