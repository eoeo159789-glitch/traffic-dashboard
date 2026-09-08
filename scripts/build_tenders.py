#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_tenders.py — 六都及全國交通標案分類彙整資料建置腳本

用途：
  把 data_raw/tenders/ 底下的「六都及全國交通標案分類彙整.xlsx」（政府電子採購網關鍵字查詢
  結果，已由使用者人工分類、去重、比對履約地點）轉換成 data/tenders.data.js，供網站「標案彙整」
  頁面（tenders.html）查詢、篩選、彙整分析使用。

如何更新資料：
  1. 用新版 xlsx 取代 data_raw/tenders/ 底下的檔案（維持相同的工作表名稱與欄位結構）
  2. 執行： python3 scripts/build_tenders.py
  3. 完成後 data/tenders.data.js 會自動重新產生，重新整理 tenders.html 即可看到新資料

需求套件： pip install python-calamine （與 build_data.py 共用）
"""
import datetime
import glob
import json
import os
import sys

from python_calamine import CalamineWorkbook

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(BASE, "data_raw", "tenders")
OUT = os.path.join(BASE, "data")
os.makedirs(OUT, exist_ok=True)

CATEGORIES = ["科技執法", "標誌標線", "人行道", "道路工程", "道路改善", "拓寬工程"]

RECORD_FIELD_MAP = [
    ("機關名稱", "agency"),
    ("標案案號", "tenderNo"),
    ("標案名稱", "title"),
    ("決標方式", "awardMethod"),
    ("預算金額", "budget"),
    ("是否受機關補助", "subsidized"),
    ("標的分類", "targetType"),
    ("標的分類代碼與名稱", "targetCode"),
    ("招標方式", "biddingMethod"),
    ("採購金額級距", "amountTier"),
    ("補助機關名稱", "subsidyAgency"),
    ("補助金額", "subsidyAmount"),
    ("決標/無法決標序號", "awardSeq"),
    ("決標日期", "awardDate"),
    ("決標公告日期", "awardAnnounceDate"),
    ("底價金額", "baseAmount"),
    ("總決標金額", "totalAmount"),
    ("標比(％)", "bidRatio"),
    ("機關所屬地區", "region"),
    ("政府層級", "govLevel"),
    ("決標年度(民國)", "awardYear"),
    ("與道路交通安全相關性", "relevance"),
    ("排除原因(不相關時)", "excludeReason"),
    ("中央機關標題推定施工縣市", "titleGuessCounty"),
    ("履約地點(原始)", "performLocRaw"),
    ("履約地點-縣市", "performLocCounty"),
    ("跨類別重複標記", "crossCategoryDup"),
]


def clean_cell(v):
    if v is None:
        return None
    if isinstance(v, (datetime.date, datetime.datetime)):
        return v.isoformat()[:10]
    if isinstance(v, float):
        if v != v:  # NaN
            return None
        if v == int(v):
            return int(v)
        return v
    if isinstance(v, str):
        s = v.strip()
        return s if s != "" else None
    return v


def sheet_rows(wb, name):
    if name not in wb.sheet_names:
        print(f"  WARNING: 找不到工作表 {name}", file=sys.stderr)
        return None
    return wb.get_sheet_by_name(name).to_python()


def rows_to_dicts(rows, header_idx=0):
    """把整張表轉成 list of dict，欄名直接沿用原始表頭文字（供彙總/概覽表格直接顯示用）。"""
    header = [str(h).strip() if h is not None else "" for h in rows[header_idx]]
    out = []
    for r in rows[header_idx + 1:]:
        if not any(c not in (None, "") for c in r):
            continue
        d = {}
        for i, h in enumerate(header):
            if not h:
                continue
            d[h] = clean_cell(r[i] if i < len(r) else None)
        out.append(d)
    return out


def parse_records(rows, category):
    header = [str(h).strip() if h is not None else "" for h in rows[0]]
    idx = {h: i for i, h in enumerate(header)}
    out = []
    for r in rows[1:]:
        if not any(c not in (None, "") for c in r):
            continue
        d = {"category": category}
        for cn, key in RECORD_FIELD_MAP:
            i = idx.get(cn)
            d[key] = clean_cell(r[i]) if i is not None and i < len(r) else None
        out.append(d)
    return out


def main():
    files = sorted(glob.glob(os.path.join(RAW, "*.xlsx")))
    if not files:
        print("找不到 data_raw/tenders/*.xlsx，略過標案資料建置", file=sys.stderr)
        return
    fp = files[0]
    print(f"讀取 {os.path.basename(fp)} ...")
    wb = CalamineWorkbook.from_path(fp)

    notes = []
    note_rows = sheet_rows(wb, "說明") or []
    for r in note_rows:
        for c in r:
            if c not in (None, ""):
                notes.append(str(c))

    overview = rows_to_dicts(sheet_rows(wb, "總覽比較表") or [[]])
    by_year = rows_to_dicts(sheet_rows(wb, "中央地方年度比較表") or [[]])
    by_region_central = rows_to_dicts(sheet_rows(wb, "中央機關標案地區分布") or [[]])
    by_county = rows_to_dicts(sheet_rows(wb, "各縣市標案金額總表(依履約地點)") or [[]])

    category_summary = {}
    for cat in CATEGORIES:
        rows = sheet_rows(wb, f"{cat}彙總")
        if rows:
            category_summary[cat] = rows_to_dicts(rows)

    records = []
    for cat in CATEGORIES:
        rows = sheet_rows(wb, cat)
        if rows:
            recs = parse_records(rows, cat)
            print(f"  [{cat}] {len(recs)} 筆")
            records.extend(recs)

    agency_region = rows_to_dicts(sheet_rows(wb, "機關地區對照表") or [[]])

    result = {
        "meta": {
            "categories": CATEGORIES,
            "sourceNotes": notes,
            "recordCount": len(records),
            "generatedAt": datetime.datetime.now().isoformat(timespec="seconds"),
        },
        "overview": overview,
        "byYear": by_year,
        "byRegionCentral": by_region_central,
        "byCounty": by_county,
        "categorySummary": category_summary,
        "records": records,
        "agencyRegionCount": len(agency_region),
    }

    out_path = os.path.join(OUT, "tenders.data.js")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("// 自動產生，請勿手動修改。由 scripts/build_tenders.py 產生。\n")
        f.write("window.TENDERS = ")
        json.dump(result, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    size_kb = os.path.getsize(out_path) / 1024
    print(f"-> tenders.data.js ({size_kb:.0f} KB, {len(records)} 筆標案記錄)")


if __name__ == "__main__":
    main()
