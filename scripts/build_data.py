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
  4. 執行： python3 scripts/build_data.py
  5. 完成後 data/*.data.js 會自動重新產生，直接重新整理網頁（index.html）即可看到新資料。

需求套件： pip install python-calamine
"""
import csv
import json
import re
import glob
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

    years = sorted(set(a["year"] for a in accidents))
    meta = {
        "counties": COUNTIES,
        "accidentYears": years,
        "enforcementYears": sorted(set(e["year"] for e in enforcement)),
        "enforcementCategories": sorted(set(e["category"] for e in enforcement)),
        "indicatorNames": sorted(set(i["indicator"] for i in indicators)),
        "generatedAt": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
    }

    print("=== 輸出 data/*.data.js ===")
    write_js("ACCIDENTS", accidents, "accidents.data.js")
    write_js("PARTIES", parties, "parties.data.js")
    write_js("ENFORCEMENT", enforcement, "enforcement.data.js")
    write_js("INDICATORS", indicators, "indicators.data.js")
    write_js("META", meta, "meta.data.js")
    print("完成！")


if __name__ == "__main__":
    main()
