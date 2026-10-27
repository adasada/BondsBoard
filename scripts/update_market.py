#!/usr/bin/env python3
"""获取中国货币网国债和国开债收盘收益率并更新静态站点数据"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "public" / "data" / "market.json"
ENDPOINT = "https://www.chinamoney.com.cn/ags/ms/cm-u-bk-currency/ClsYldCurvHis"
SOURCE_URL = "https://www.chinamoney.com.cn/chinese/bkcurvclosedy/"
CHINA_TZ = timezone(timedelta(hours=8), "Asia/Shanghai")
PAGE_SIZE = 50
MAX_PAGES = 120
MAX_HISTORY_DAYS = 90
BOOTSTRAP_DAYS = 90
REFRESH_DAYS = 7
TARGET_TENORS = (0.25, 0.5, 1, 2, 3, 5, 7, 10, 15, 20, 30)
INSTRUMENTS = {
    "treasury": {"code": "CYCC000", "name": "国债"},
    "policy": {"code": "CYCC021", "name": "政策性金融债（国开行）"},
}


def now_china() -> datetime:
    """返回中国时区当前时间"""
    return datetime.now(CHINA_TZ).replace(microsecond=0)


def tenor_key(raw_value: Any) -> str | None:
    """将上游期限规范化为站点使用的键"""
    try:
        value = float(raw_value)
    except (TypeError, ValueError):
        return None
    if not any(value == tenor for tenor in TARGET_TENORS):
        return None
    return str(int(value)) if value.is_integer() else str(value)


def load_existing() -> dict[str, Any]:
    """读取已有行情，首次运行时返回空数据结构"""
    if not DATA_PATH.exists():
        return {
            "schemaVersion": 1,
            "sourceName": "中国货币网 · 债券收盘收益率曲线",
            "sourceUrl": SOURCE_URL,
            "unit": {"yield": "%", "change": "bp"},
            "status": "pending",
            "message": "正在准备首次历史行情采集。",
            "latestDate": None,
            "checkedAt": None,
            "bootstrapComplete": False,
            "history": [],
        }
    with DATA_PATH.open("r", encoding="utf-8") as stream:
        value = json.load(stream)
    if value.get("schemaVersion") != 1 or not isinstance(value.get("history"), list):
        raise ValueError("已有行情文件格式不受支持")
    return value


def request_json(params: dict[str, str]) -> dict[str, Any]:
    """读取官方历史曲线接口，网络抖动时进行有限重试"""
    query = urlencode(params)
    url = f"{ENDPOINT}?{query}"
    headers = {
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": "https://www.chinamoney.com.cn/chinese/bkcurvclosedyhis/?bondType=CYCC000&reference=1",
    }
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            request = Request(url, headers=headers)
            with urlopen(request, timeout=30) as response:
                payload = json.loads(response.read().decode("utf-8"))
            head = payload.get("head", {})
            if str(head.get("rep_code", "200")) not in {"200", "0"}:
                raise RuntimeError(f"数据源返回状态 {head.get('rep_code')}")
            return payload
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, RuntimeError) as error:
            last_error = error
            if attempt < 2:
                time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"数据接口请求失败：{last_error}") from last_error


def fetch_instrument(field: str, code: str, start: date, end: date) -> dict[str, dict[str, float]]:
    """分页读取某类债券在指定日期范围内的收盘到期收益率"""
    collected: dict[str, dict[str, float]] = {}
    page = 1
    page_total = 1
    while page <= page_total:
        payload = request_json({
            "lang": "CN",
            "reference": "1",
            "bondType": code,
            "startDate": start.isoformat(),
            "endDate": end.isoformat(),
            "termId": "1",
            "pageNum": str(page),
            "pageSize": str(PAGE_SIZE),
        })
        data = payload.get("data", {})
        try:
            page_total = int(data.get("pageTotal", 1) or 1)
        except (TypeError, ValueError):
            page_total = 1
        if page_total > MAX_PAGES:
            raise RuntimeError(f"上游分页数量异常：{page_total}")
        records = payload.get("records", [])
        if not isinstance(records, list):
            raise RuntimeError("上游行情记录格式无效")
        for record in records:
            row_date = record.get("newDateValueCN")
            maturity = tenor_key(record.get("yearTermStr"))
            try:
                yield_value = float(record.get("maturityYieldStr"))
            except (TypeError, ValueError):
                continue
            if not row_date or not maturity or not (yield_value == yield_value and abs(yield_value) < 100):
                continue
            collected.setdefault(row_date, {})[maturity] = yield_value
        page += 1
        if page <= page_total:
            time.sleep(0.2)
    return collected


def chunk_ranges(start: date, end: date, chunk_days: int = 30) -> list[tuple[date, date]]:
    """将历史范围切成上游接口支持的短区间"""
    ranges: list[tuple[date, date]] = []
    cursor = start
    while cursor <= end:
        chunk_end = min(cursor + timedelta(days=chunk_days - 1), end)
        ranges.append((cursor, chunk_end))
        cursor = chunk_end + timedelta(days=1)
    return ranges


def collect_window(start: date, end: date) -> dict[str, dict[str, dict[str, float]]]:
    """依次拉取国债和国开债区间数据并合并同日曲线"""
    by_date: dict[str, dict[str, dict[str, float]]] = {}
    for range_start, range_end in chunk_ranges(start, end):
        for field, config in INSTRUMENTS.items():
            print(f"读取{config['name']}：{range_start} 至 {range_end}", flush=True)
            instrument_rows = fetch_instrument(field, config["code"], range_start, range_end)
            for row_date, curve in instrument_rows.items():
                snapshot = by_date.setdefault(row_date, {"treasury": {}, "policy": {}})
                snapshot[field].update(curve)
    return by_date


def merge_snapshots(existing: list[dict[str, Any]], fresh: dict[str, dict[str, dict[str, float]]], cutoff: date) -> list[dict[str, Any]]:
    """合并新旧曲线，只保留双边完整的最近 90 日快照"""
    by_date: dict[str, dict[str, Any]] = {}
    for row in existing:
        if isinstance(row, dict) and isinstance(row.get("date"), str):
            by_date[row["date"]] = row
    for row_date, curves in fresh.items():
        current = by_date.get(row_date, {"date": row_date, "curves": {"treasury": {}, "policy": {}}})
        old_curves = current.get("curves", {})
        current_curves = {
            "treasury": dict(old_curves.get("treasury", {})),
            "policy": dict(old_curves.get("policy", {})),
        }
        current_curves["treasury"].update(curves.get("treasury", {}))
        current_curves["policy"].update(curves.get("policy", {}))
        current["curves"] = current_curves
        by_date[row_date] = current

    result = []
    required = ("1", "3", "5", "7", "10")
    for row_date in sorted(by_date):
        try:
            parsed_date = date.fromisoformat(row_date)
        except ValueError:
            continue
        if parsed_date < cutoff:
            continue
        row = by_date[row_date]
        curves = row.get("curves", {})
        if any(any(key not in curves.get(field, {}) for key in required) for field in INSTRUMENTS):
            continue
        result.append({"date": row_date, "curves": curves})
    return result


def save_json(value: dict[str, Any]) -> None:
    """原子写入站点行情文件，避免生成半截 JSON"""
    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    handle = tempfile.NamedTemporaryFile("w", encoding="utf-8", newline="\n", delete=False, dir=DATA_PATH.parent, suffix=".tmp")
    temp_path = Path(handle.name)
    try:
        with handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(temp_path, DATA_PATH)
    finally:
        if temp_path.exists():
            temp_path.unlink()


def main() -> int:
    """更新 90 日历史或重刷最近一周行情"""
    checked_at = now_china()
    today = checked_at.date()
    state = load_existing()
    history = state.get("history", [])
    is_bootstrap = not state.get("bootstrapComplete")
    window_days = BOOTSTRAP_DAYS if is_bootstrap else REFRESH_DAYS
    start = today - timedelta(days=window_days - 1)
    try:
        fresh = collect_window(start, today)
        merged = merge_snapshots(history, fresh, today - timedelta(days=MAX_HISTORY_DAYS - 1))
        if not merged:
            raise RuntimeError("采集窗口内没有同时包含国债和国开债关键期限的有效记录")
        latest_date = merged[-1]["date"]
        state.update({
            "schemaVersion": 1,
            "sourceName": "中国货币网 · 债券收盘收益率曲线",
            "sourceUrl": SOURCE_URL,
            "unit": {"yield": "%", "change": "bp"},
            "checkedAt": checked_at.isoformat(),
            "latestDate": latest_date,
            "historyStartDate": merged[0]["date"],
            "historyEndDate": latest_date,
            "status": "success" if latest_date == today.isoformat() else "stale",
            "message": "国债与国开债收盘曲线已更新。" if latest_date == today.isoformat() else "数据源尚未发布当日曲线，展示最近交易日收盘数据。",
            "bootstrapComplete": True,
            "history": merged,
        })
        state.pop("lastError", None)
        save_json(state)
        print(f"数据已写入：{len(merged)} 个有效交易日，最新行情 {latest_date}")
        return 0
    except Exception as error:  # noqa: BLE001 - 失败时保留行情，同时记录检查状态
        state["checkedAt"] = checked_at.isoformat()
        state["status"] = "error" if history else "pending"
        state["message"] = "本次更新检查未成功，页面保留最近一次有效行情。" if history else "首次采集未完成，暂无有效行情数据。"
        state["lastError"] = str(error)[:300]
        save_json(state)
        print(f"行情更新失败：{error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
