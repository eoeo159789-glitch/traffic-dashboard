#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tech_enforcement.py — 科技執法位置資料正規化模組

用途：
  把 data_raw/tech_enforcement/ 底下 22 個縣市科技執法設備地點 CSV（欄位格式互不相同，
  來自不同縣市警察局的原始開放資料）以及花蓮縣的 PDF（已另外轉出文字檔）正規化成統一格式，
  供 build_data.py 產生 data/points_tech_enforcement.data.js，並提供 A1/A2 環域分析使用。

已知資料缺口（明確揭露，不臆測補值）：
  - 新竹縣、宜蘭縣、臺東縣、連江縣：使用者提供的原始資料包中完全沒有這4個縣市的檔案。
  - 花蓮縣：僅有 PDF（固定桿測速/闖紅燈清單），地點以「里程樁號」描述，無經緯度座標，
    故僅列入文字參考清單，不納入地圖點位／環域分析。
  - 苗栗縣「區間測速設備取締件數.csv」：地點僅以道路里程範圍描述，無經緯度，同樣僅列入文字參考。
  - 雪山隧道（國道5號）：地點為里程描述而非經緯度，僅列入文字參考。
  - 臺中市「科技執法取締地點.csv」部分列座標欄位資料本身有誤（如「區間測速」字樣誤植於經緯度欄），
    此類無法解析為有效浮點數的列會被排除於地圖點位之外，但保留於文字參考清單中並標註 hasCoords=false。

用法：
  from tech_enforcement import load_tech_enforcement
  points = load_tech_enforcement(RAW_DIR)  # RAW_DIR = data_raw/tech_enforcement
"""
import csv
import io
import os
import re

MISSING_COUNTIES = ["新竹縣", "宜蘭縣", "臺東縣", "連江縣"]


def _read_rows(path, encodings=("utf-8-sig", "utf-8", "big5", "cp950")):
    last_err = None
    for enc in encodings:
        try:
            with open(path, encoding=enc, newline="") as f:
                text = f.read()
            # 部分檔案含雙重 BOM 或欄名前綴多餘 BOM 字元
            text = text.replace("﻿", "")
            reader = csv.reader(io.StringIO(text))
            rows = [r for r in reader]
            return rows
        except (UnicodeDecodeError, LookupError) as e:
            last_err = e
            continue
    raise RuntimeError(f"無法解碼 {path}: {last_err}")


def _f(v):
    if v is None:
        return None
    s = str(v).strip()
    if s == "":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _valid_latlng(lat, lng):
    if lat is None or lng is None:
        return False
    # 台灣範圍粗略檢查，濾除誤植的文字/離群值
    return 21.5 <= lat <= 26.5 and 118.0 <= lng <= 123.0


def _row_dict(header, row):
    d = {}
    for i, h in enumerate(header):
        h = (h or "").strip()
        if not h:
            continue
        d[h] = row[i] if i < len(row) else ""
    return d


def _mkpoint(county, deviceType=None, items=None, loc=None, lat=None, lng=None, district=None,
             direction=None, speedLimit=None, authority=None, remark=None, enforcementCount=None,
             installDate=None, sourceFile=None):
    ok = _valid_latlng(lat, lng)
    return {
        "county": county,
        "district": district or None,
        "deviceType": deviceType or None,
        "items": items or None,
        "loc": loc or None,
        "direction": direction or None,
        "speedLimit": (str(speedLimit).strip() if speedLimit not in (None, "") else None),
        "authority": authority or None,
        "remark": remark or None,
        "enforcementCount": enforcementCount or None,
        "installDate": installDate or None,
        "lat": lat if ok else None,
        "lng": lng if ok else None,
        "hasCoords": ok,
        "sourceFile": sourceFile,
    }


def _parse_generic(rows, sourceFile, county_default,
                    col_district=None, col_type=None, col_items=None, col_loc=None,
                    col_lat=None, col_lng=None, col_dir=None, col_limit=None,
                    col_authority=None, col_remark=None, col_county=None,
                    col_count=None, col_installdate=None, header_row_idx=0):
    header = [h.strip() for h in rows[header_row_idx]]
    out = []
    for r in rows[header_row_idx + 1:]:
        if not any((c or "").strip() for c in r):
            continue
        d = _row_dict(header, r)
        county = county_default
        if col_county:
            raw_c = (d.get(col_county) or "").strip()
            if raw_c:
                county = raw_c
        lat = _f(d.get(col_lat)) if col_lat else None
        lng = _f(d.get(col_lng)) if col_lng else None
        out.append(_mkpoint(
            county=county,
            district=d.get(col_district) if col_district else None,
            deviceType=d.get(col_type) if col_type else None,
            items=d.get(col_items) if col_items else None,
            loc=d.get(col_loc) if col_loc else None,
            lat=lat, lng=lng,
            direction=d.get(col_dir) if col_dir else None,
            speedLimit=d.get(col_limit) if col_limit else None,
            authority=d.get(col_authority) if col_authority else None,
            remark=d.get(col_remark) if col_remark else None,
            enforcementCount=d.get(col_count) if col_count else None,
            installDate=d.get(col_installdate) if col_installdate else None,
            sourceFile=sourceFile,
        ))
    return out


def load_tech_enforcement(raw_dir):
    """raw_dir: 存放 22 個 CSV（+花蓮 PDF 已轉出的 hualien.txt，可選）的資料夾"""
    out = []

    def path(fn):
        return os.path.join(raw_dir, fn)

    def exists(fn):
        return os.path.exists(path(fn))

    # 1) 雲林縣
    fn = "1150817雲林縣警察局科技執法設備設置地點一覽表.csv"
    if exists(fn):
        rows = _read_rows(path(fn))
        # header 列: project,Address,direct,limit,ban,Longitude,Latitude,Remark
        # 第二列是中文子標題 A00,設置地點,拍攝方向,速限,取締項目,經緯度,經緯度,備註 -> 跳過
        header = rows[0]
        data = rows[2:] if len(rows) > 1 and rows[1] and rows[1][0] == "A00" else rows[1:]
        for r in data:
            if not any((c or "").strip() for c in r):
                continue
            d = _row_dict(header, r)
            # 注意：此檔案 header 的 Longitude/Latitude 欄名與實際內容相反（Longitude欄實為緯度值、
            # Latitude欄實為經度值，依數值範圍可判斷），故此處刻意對調對應，以取得正確座標。
            out.append(_mkpoint(
                county="雲林縣", district=None, deviceType="固定式科技執法",
                items=d.get("ban"), loc=(d.get("Address") or "").strip(),
                lat=_f(d.get("Longitude")), lng=_f(d.get("Latitude")),
                direction=d.get("direct"), speedLimit=d.get("limit"),
                authority=d.get("Remark"), sourceFile=fn,
            ))

    # 2) 南投縣
    fn = "南投縣政府警察局固定式科技執法禁駛路段設備設置地點.csv"
    if exists(fn):
        rows = _read_rows(path(fn))
        out += _parse_generic(rows, fn, "南投縣", col_district="行政區", col_loc="設置地點",
                               col_dir="拍攝方向", col_items="取締項目", col_authority="轄區分局",
                               col_lng="經度", col_lat="緯度", col_type=None)
        for p in out[-len([r for r in rows[1:] if any(c.strip() for c in r)]):]:
            if p["deviceType"] is None:
                p["deviceType"] = "固定式科技執法(禁駛路段)"

    # 3) 嘉義縣
    fn = "嘉義縣警察局固定式科技執法設置地點.csv"
    if exists(fn):
        rows = _read_rows(path(fn))
        out += _parse_generic(rows, fn, "嘉義縣", col_district="行政區", col_type="科技執法種類",
                               col_items='取締項目(以","分隔)', col_loc="設置地點(路口或路段)",
                               col_lat="座標緯度", col_lng="座標經度", col_dir="拍攝方向",
                               col_limit="速限", col_authority="管轄單位", col_remark="備註")

    # 4-6) 基隆市（3個檔案）
    for fn, extra_type in [
        ("基隆市科技執法取締地點(區間平均速率執法).csv", "區間測速"),
        ("基隆市科技執法取締地點(固定式測速照相).csv", "固定式測速照相"),
        ("基隆市科技執法取締地點.csv", None),
    ]:
        if exists(fn):
            rows = _read_rows(path(fn))
            header = [h.strip() for h in rows[0]]
            col_type = "科技執法種類" if "科技執法種類" in header else None
            col_authority = "轄區分局" if "轄區分局" in header else ("管轄分局" if "管轄分局" in header else None)
            pts = _parse_generic(rows, fn, "基隆市", col_district="行政區",
                                  col_type=col_type,
                                  col_items="取締項目" if "取締項目" in header else None,
                                  col_loc="設置地點(路口或路段)" if "設置地點(路口或路段)" in header else "設置地點",
                                  col_lat="座標緯度", col_lng="座標經度", col_dir="拍攝方向",
                                  col_limit="速限", col_authority=col_authority, col_remark="備註")
            if extra_type:
                for p in pts:
                    if not p["deviceType"]:
                        p["deviceType"] = extra_type
            out += pts

    # 7) 屏東縣（中英雙語欄名）
    fn = "屏東縣科技執法路段及項目.csv"
    if exists(fn):
        rows = _read_rows(path(fn))
        out += _parse_generic(rows, fn, "屏東縣", col_district="RegionName(設置市區鄉鎮)",
                               col_loc="Address(設置地址)", col_lat="Latitude(緯度)", col_lng="Longitude(經度)",
                               col_dir="direct(拍攝方向)", col_limit="limit(速限)",
                               col_authority="BranchNm(管轄分局)")

    # 8) 彰化縣
    fn = "彰化縣警察局固定式科技執法設備設置地點.csv"
    if exists(fn):
        rows = _read_rows(path(fn))
        out += _parse_generic(rows, fn, "彰化縣", col_district="行政區", col_type="科技執法種類",
                               col_items="取締項目", col_loc="設置地點", col_lat="座標緯度", col_lng="座標經度",
                               col_dir="拍攝方向", col_limit="速限", col_authority="轄區分局", col_remark="備註")

    # 9) 新竹市（極簡欄位）
    fn = "新竹市科技執法點位資訊.csv"
    if exists(fn):
        rows = _read_rows(path(fn))
        out += _parse_generic(rows, fn, "新竹市", col_loc="地點", col_items="違規取締項目",
                               col_lng="經度", col_lat="緯度", col_remark="備註")

    # 10) 桃園市
    fn = "桃園市科技執法設備.csv"
    if exists(fn):
        rows = _read_rows(path(fn))
        out += _parse_generic(rows, fn, "桃園市", col_district="行政區", col_type="科技執法種類",
                               col_items="取締項目", col_loc="設置地點_路口或路段", col_lat="座標緯度",
                               col_lng="座標經度", col_dir="拍攝方向", col_limit="速限",
                               col_authority="管轄單位", col_remark="備註")

    # 11) 澎湖縣
    fn = "澎湖縣科技執法地點.csv"
    if exists(fn):
        rows = _read_rows(path(fn))
        out += _parse_generic(rows, fn, "澎湖縣", col_district="行政區", col_type="科技執法種類",
                               col_items="取締項目", col_loc="設置地點", col_lat="座標緯度",
                               col_lng="座標經度", col_dir="拍攝方向", col_limit="速限",
                               col_authority="轄區分局")

    # 12) 臺中市（固定式）
    fn = "臺中市科學儀器執法設備取締地點(固定式).csv"
    if exists(fn):
        rows = _read_rows(path(fn))
        out += _parse_generic(rows, fn, "臺中市", col_district="行政區", col_items="取締項目",
                               col_loc="設置地點", col_lat="座標緯度", col_lng="座標經度",
                               col_dir="拍攝方向", col_limit="速限", col_authority="管轄單位",
                               col_remark="備註")
        for p in out[-len([r for r in rows[1:] if any((c or '').strip() for c in r)]):]:
            if not p["deviceType"]:
                p["deviceType"] = "固定式科技執法"

    # 13) 臺中市（科技執法取締地點，含髒資料列需防禦）
    fn = "臺中市科技執法取締地點.csv"
    if exists(fn):
        rows = _read_rows(path(fn))
        out += _parse_generic(rows, fn, "臺中市", col_type="科技執法種類", col_items="取締項目",
                               col_loc="設置地點", col_lng="經度", col_lat="緯度")

    # 14) 臺中市（區間平均速率執法，含舉發件數，經緯度欄位順序相反）
    fn = "臺中市科技執法設備(區間平均速率執法).csv"
    if exists(fn):
        rows = _read_rows(path(fn))
        out += _parse_generic(rows, fn, "臺中市", col_type="科技執法種類", col_items="取締項目",
                               col_loc="設置地點_範圍", col_lat="緯度", col_lng="經度",
                               col_count="舉發件數_115年1至7月")
        for p in out[-len([r for r in rows[1:] if any((c or '').strip() for c in r)]):]:
            if not p["deviceType"]:
                p["deviceType"] = "區間平均速率執法"

    # 15) 臺北市（含啟用日期）
    fn = "臺北市智慧管理科技執法設備資料表-1150817.csv"
    if exists(fn):
        rows = _read_rows(path(fn))
        out += _parse_generic(rows, fn, "臺北市", col_district="行政區", col_type="科技執法種類",
                               col_items="取締項目", col_loc="設置地點（路口或路段）", col_lat="座標緯度",
                               col_lng="座標經度", col_remark="備註", col_installdate="啟用日期")

    # 16) 臺南市（欄名含換行需容錯，直接用 index-based fallback）
    fn = "臺南市智慧管理科技執法設備設置地點.csv"
    if exists(fn):
        rows = _read_rows(path(fn))
        header = [re.sub(r"\s+", "", (h or "")) for h in rows[0]]
        idx = {h: i for i, h in enumerate(header)}
        def find_col(*cands):
            for c in cands:
                for h, i in idx.items():
                    if c in h:
                        return i
            return None
        i_loc = find_col("設置地點", "設置位置", "地點", "位置")
        i_items = find_col("取締項目")
        i_lat = find_col("緯度")
        i_lng = find_col("經度")
        i_dir = find_col("拍攝")
        i_limit = find_col("速限")
        i_district = find_col("行政區")
        for r in rows[1:]:
            if not any((c or "").strip() for c in r):
                continue
            def g(i):
                return r[i] if i is not None and i < len(r) else None
            out.append(_mkpoint(
                county="臺南市", district=g(i_district), deviceType="智慧管理科技執法",
                items=g(i_items), loc=g(i_loc), lat=_f(g(i_lat)), lng=_f(g(i_lng)),
                direction=g(i_dir), speedLimit=g(i_limit), sourceFile=fn,
            ))

    # 17) 苗栗縣 - 區間測速取締件數（無座標，僅供文字參考）
    fn = "苗栗縣區間測速設備取締件數.csv"
    if exists(fn):
        rows = _read_rows(path(fn))
        out += _parse_generic(rows, fn, "苗栗縣", col_type="科技執法種類", col_items="取締項目",
                               col_loc="設置地點", col_count="取締件數")

    # 18) 苗栗縣 - 科技執法設備取締地點
    fn = "苗栗縣科技執法設備取締地點.csv"
    if exists(fn):
        rows = _read_rows(path(fn))
        out += _parse_generic(rows, fn, "苗栗縣", col_type="科技執法種類", col_items="取締項目",
                               col_loc="設置地點(路口或路段)", col_lat="座標緯度", col_lng="座標經度",
                               col_dir="拍攝方向", col_limit="速限", col_authority="管轄單位", col_remark="備註")

    # 19) 金門縣
    fn = "金門縣固定式科學儀器執法設備設置地點-科技執法.csv"
    if exists(fn):
        rows = _read_rows(path(fn))
        out += _parse_generic(rows, fn, "金門縣", col_items="取締項目", col_loc="設置地點",
                               col_lat="座標緯度", col_lng="座標經度", col_authority="管轄分局")
        for p in out[-len([r for r in rows[1:] if any((c or '').strip() for c in r)]):]:
            if not p["deviceType"]:
                p["deviceType"] = "固定式科技執法"

    # 20) 雪山隧道（國道5號，僅文字描述地點，無座標）
    fn = "雪山隧道自動化科技執法系統設置地點_11410.csv"
    if exists(fn):
        rows = _read_rows(path(fn))
        header = [h.strip() for h in rows[0]]
        idx = {h: i for i, h in enumerate(header)}
        for r in rows[1:]:
            if not any((c or "").strip() for c in r):
                continue
            d = _row_dict(header, r)
            out.append(_mkpoint(
                county="國道", district="雪山隧道(國道5號)",
                deviceType="自動化科技執法系統",
                items=d.get("說明"), loc=f"{d.get('道路編號','')}{d.get('道路方向','')} {d.get('里程數_公里','')}公里",
                lat=None, lng=None, sourceFile=fn,
            ))

    # 21-22) 高雄市
    fn = "高雄市115年租賃式車不停讓行人科技執法地點.csv"
    if exists(fn):
        rows = _read_rows(path(fn))
        out += _parse_generic(rows, fn, "高雄市", col_type=None, col_items="取締項目", col_loc="設置位置",
                               col_lat="座標緯度", col_lng="座標經度", col_dir="測照行向")
        for p in out[-len([r for r in rows[1:] if any((c or '').strip() for c in r)]):]:
            if not p["deviceType"]:
                p["deviceType"] = "租賃式車不停讓行人科技執法"

    fn = "高雄市115年路口科技執法監測系統設置地點.csv"
    if exists(fn):
        rows = _read_rows(path(fn))
        out += _parse_generic(rows, fn, "高雄市", col_items="取締項目", col_loc="設置位置",
                               col_lat="座標緯度", col_lng="座標經度", col_dir="測照行向")
        for p in out[-len([r for r in rows[1:] if any((c or '').strip() for c in r)]):]:
            if not p["deviceType"]:
                p["deviceType"] = "路口科技執法監測系統"

    # 23) 花蓮縣（PDF 轉出的文字檔：5個分區段，僅文字描述地點/里程樁號，無經緯度座標，僅供文字參考清單）
    fn_txt = "hualien_tech_enforcement.txt"
    if exists(fn_txt):
        src = "花蓮縣警察局_114年度測速照相、闖紅燈照相固定桿及科技執法設置地點一覽表.pdf"
        with open(path(fn_txt), encoding="utf-8") as f:
            lines = [l.rstrip() for l in f.readlines()]
        section = None
        section_titles = {
            "固定桿(測速及闖紅燈照相)": "固定桿(測速及闖紅燈照相)",
            "違規停車科技執法": "違規停車科技執法",
            "禁行車種科技執法": "禁行車種科技執法",
            "區間平均速率科技執法": "區間平均速率科技執法",
            "路口多功能科技執法": "路口多功能科技執法",
        }
        pending_num, pending_loc = None, None
        for line in lines:
            s = line.strip()
            if not s:
                continue
            matched_section = None
            for key, label in section_titles.items():
                if key in s:
                    matched_section = label
                    break
            if matched_section:
                section = matched_section
                pending_num, pending_loc = None, None
                continue
            if s.startswith("編號") or s.startswith("花蓮縣警察局"):
                continue
            if section in ("固定桿(測速及闖紅燈照相)", "路口多功能科技執法"):
                # 編號 地點 取締項目 速限(可能是 - )
                m = re.match(r"^(\d{1,2})\s+(.+?)\s{2,}(\S.*?)\s{2,}(\S+)\s*$", s)
                if m:
                    out.append(_mkpoint(
                        county="花蓮縣", deviceType=section, items=m.group(3).strip(),
                        loc=m.group(2).strip(), lat=None, lng=None, speedLimit=m.group(4).strip(),
                        sourceFile=src,
                    ))
                    pending_num, pending_loc = None, None
                    continue
                # 有些列因為取締項目過長換行，先記住編號+地點，等下一行補取締項目/速限
                m2 = re.match(r"^(\d{1,2})\s+(.+?)\s*$", s)
                if m2 and not re.search(r"(測速|闖紅燈|未停讓|未依|兩段式|禁行|違規)", s):
                    pending_num, pending_loc = m2.group(1), m2.group(2).strip()
                    continue
                if pending_loc is not None:
                    m3 = re.match(r"^(\S.*?)\s{2,}(\S+)\s*$", s)
                    items = m3.group(1).strip() if m3 else s
                    limit = m3.group(2).strip() if m3 else None
                    out.append(_mkpoint(
                        county="花蓮縣", deviceType=section, items=items, loc=pending_loc,
                        lat=None, lng=None, speedLimit=limit, sourceFile=src,
                    ))
                    pending_num, pending_loc = None, None
            elif section == "違規停車科技執法":
                m = re.match(r"^(\d{1,2})\s+(.+?)\s{2,}(違規停車)\s*$", s)
                if m:
                    out.append(_mkpoint(county="花蓮縣", deviceType=section, items="違規停車",
                                         loc=m.group(2).strip(), lat=None, lng=None, sourceFile=src))
            elif section == "禁行車種科技執法":
                m = re.match(r"^(\d{1,2})\s+(.+?)\s{2,}(禁行車種)\s*$", s)
                if m:
                    out.append(_mkpoint(county="花蓮縣", deviceType=section, items="禁行車種",
                                         loc=m.group(2).strip(), lat=None, lng=None, sourceFile=src))
            elif section == "區間平均速率科技執法":
                # 此段落格式複雜（每組路段含多筆起訖點/偵測距離），僅擷取路段名稱列作為概略參考項目，
                # 不逐一拆解每個起訖點座標（本來就無經緯度可用）。
                m = re.match(r"^(\d{1,2})\s+(\S.+?)(?:\(雙向\)|$)", s)
                if m and re.search(r"[Kk線]", s):
                    out.append(_mkpoint(county="花蓮縣", deviceType=section, items="區間平均速率執法",
                                         loc=s, lat=None, lng=None, sourceFile=src))

    # 補上編號
    for i, p in enumerate(out):
        p["id"] = f"t{i + 1}"

    return out


def summarize(points):
    from collections import Counter
    by_county = Counter(p["county"] for p in points)
    with_coords = sum(1 for p in points if p["hasCoords"])
    return {
        "total": len(points),
        "withCoords": with_coords,
        "withoutCoords": len(points) - with_coords,
        "byCounty": dict(by_county),
        "missingCounties": MISSING_COUNTIES,
    }


if __name__ == "__main__":
    import sys
    import json
    raw_dir = sys.argv[1] if len(sys.argv) > 1 else "."
    pts = load_tech_enforcement(raw_dir)
    print(json.dumps(summarize(pts), ensure_ascii=False, indent=2))
    bad = [p for p in pts if not p["hasCoords"]]
    print(f"\n無座標樣本（前5筆）:")
    for p in bad[:5]:
        print(" ", p["county"], p["loc"], p["sourceFile"])
