(() => {
  'use strict';

  const TENORS = [
    { year: 0.25, label: '3M', longLabel: '3 个月' },
    { year: 0.5, label: '6M', longLabel: '6 个月' },
    { year: 1, label: '1Y', longLabel: '1 年' },
    { year: 2, label: '2Y', longLabel: '2 年' },
    { year: 3, label: '3Y', longLabel: '3 年' },
    { year: 5, label: '5Y', longLabel: '5 年' },
    { year: 7, label: '7Y', longLabel: '7 年' },
    { year: 10, label: '10Y', longLabel: '10 年' },
    { year: 15, label: '15Y', longLabel: '15 年' },
    { year: 20, label: '20Y', longLabel: '20 年' },
    { year: 30, label: '30Y', longLabel: '30 年' },
  ];
  const SERIES = {
    treasury: { title: '10 年国债', field: 'treasury', unit: '%', color: '#354b72' },
    policy: { title: '10 年国开债', field: 'policy', unit: '%', color: '#4c9b91' },
    spread: { title: '10Y 国开债－国债利差', field: 'spread', unit: 'bp', color: '#c59b47' },
  };
  const state = { data: null, range: 30, series: 'treasury', tableSeries: 'treasury' };
  const $ = (id) => document.getElementById(id);
  const number = (value, digits = 4) => Number.isFinite(value) ? value.toFixed(digits) : '—';
  const bp = (value) => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(1)} bp` : '—';
  const parseDate = (value) => new Date(`${value}T00:00:00+08:00`);
  const shortDate = (value) => {
    if (!value) return '—';
    const date = parseDate(value);
    return Number.isNaN(date.getTime()) ? value : `${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
  };
  const dateGapDays = (left, right) => (parseDate(left).getTime() - parseDate(right).getTime()) / 86400000;
  const sortedHistory = () => [...(state.data?.history || [])].sort((a, b) => a.date.localeCompare(b.date));
  const yieldAt = (row, field, year) => {
    const curve = row?.curves?.[field];
    const value = curve?.[String(year)] ?? curve?.[year];
    if (value === null || value === undefined || value === '') return null;
    return Number.isFinite(Number(value)) ? Number(value) : null;
  };
  const daySpread = (row, year) => {
    const treasury = yieldAt(row, 'treasury', year);
    const policy = yieldAt(row, 'policy', year);
    return treasury === null || policy === null ? null : (policy - treasury) * 100;
  };
  const yieldChange = (current, previous, year) => {
    const a = yieldAt(current, 'treasury', year);
    const b = yieldAt(previous, 'treasury', year);
    return a === null || b === null ? null : (a - b) * 100;
  };
  const setText = (id, value) => { $(id).textContent = value; };
  const roundedBp = (value) => Number.isFinite(value) ? Math.round(value * 10) / 10 : null;

  function setChange(id, value, unit = 'bp') {
    const node = $(id);
    node.classList.remove('positive', 'negative', 'flat');
    const rounded = roundedBp(value);
    if (rounded === null) {
      node.textContent = '—';
      node.classList.add('flat');
      return;
    }
    node.classList.add(rounded > 0 ? 'positive' : rounded < 0 ? 'negative' : 'flat');
    node.textContent = `${rounded > 0 ? '↑' : rounded < 0 ? '↓' : '→'} ${rounded > 0 ? '+' : ''}${rounded.toFixed(1)} ${unit}`;
  }

  function makeSparkline(id, values, colorClass) {
    const host = $(id);
    const clean = values.filter(Number.isFinite);
    if (clean.length < 2) { host.innerHTML = ''; return; }
    const min = Math.min(...clean);
    const max = Math.max(...clean);
    const span = max - min || 1;
    const points = clean.map((value, index) => `${(index / (clean.length - 1)) * 100},${24 - ((value - min) / span) * 19}`).join(' ');
    host.className = `sparkline ${colorClass}`;
    host.innerHTML = `<svg viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}"/><circle cx="100" cy="${24 - ((clean.at(-1) - min) / span) * 19}" r="2.1"/></svg>`;
  }

  function setStatus() {
    const status = state.data?.status || 'empty';
    const node = $('data-status');
    node.className = 'status-chip';
    if (status === 'success') {
      node.textContent = '● 已更新';
      const latest = state.data?.latestDate;
      const checked = state.data?.checkedAt;
      const isStale = latest && checked && dateGapDays(checked.slice(0, 10), latest) >= 1;
      if (isStale) {
        node.classList.add('status-stale');
        node.textContent = '● 最近交易日';
      }
    } else if (status === 'error') {
      node.classList.add('status-error');
      node.textContent = '● 更新异常';
    } else if (status === 'stale') {
      node.classList.add('status-stale');
      node.textContent = '● 暂无新行情';
    } else {
      node.classList.add('status-pending');
      node.textContent = '● 暂无数据';
    }
    const message = state.data?.message;
    $('market-notice').classList.toggle('notice-error', status === 'error');
    $('notice-message').textContent = message || (status === 'success'
      ? '展示最近交易日收盘曲线；休市日沿用上一交易日数据。'
      : status === 'stale' ? '尚未发现新的交易日行情，页面保留最近一次有效数据。'
        : status === 'error' ? '本次更新检查未成功，页面仍展示最近一次有效行情。'
          : '等待自动更新任务写入行情数据。');
  }

  function renderMetrics(history) {
    const latest = history.at(-1);
    const previous = history.at(-2);
    if (!latest) return;
    const treasury10 = yieldAt(latest, 'treasury', 10);
    const policy10 = yieldAt(latest, 'policy', 10);
    const treasury1 = yieldAt(latest, 'treasury', 1);
    setText('metric-treasury', number(treasury10));
    setText('metric-policy', number(policy10));
    setText('metric-spread', number(daySpread(latest, 10), 1));
    setText('metric-slope', treasury10 === null || treasury1 === null ? '—' : number((treasury10 - treasury1) * 100, 1));
    setChange('change-treasury', previous ? yieldChange(latest, previous, 10) : null);
    const pNow = yieldAt(latest, 'policy', 10);
    const pBefore = previous ? yieldAt(previous, 'policy', 10) : null;
    setChange('change-policy', pNow === null || pBefore === null ? null : (pNow - pBefore) * 100);
    const spNow = daySpread(latest, 10);
    const spBefore = previous ? daySpread(previous, 10) : null;
    setChange('change-spread', spNow === null || spBefore === null ? null : spNow - spBefore);
    setText('slope-caption', '10 年期减 1 年期');
    setText('market-date', latest.date);
    setText('brief-date', `${latest.date} · ${previous ? `对比 ${previous.date}` : '等待前一交易日数据'}`);

    makeSparkline('spark-treasury', history.slice(-14).map((row) => yieldAt(row, 'treasury', 10)), 'spark-navy');
    makeSparkline('spark-policy', history.slice(-14).map((row) => yieldAt(row, 'policy', 10)), 'spark-teal');
    makeSparkline('spark-spread', history.slice(-14).map((row) => daySpread(row, 10)), 'spark-gold');
    makeSparkline('spark-slope', history.slice(-14).map((row) => {
      const long = yieldAt(row, 'treasury', 10); const short = yieldAt(row, 'treasury', 1);
      return long === null || short === null ? null : (long - short) * 100;
    }), 'spark-lilac');
  }

  function makeLinePath(values, xFor, yFor) {
    const points = values.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    return points.map((point, index) => `${index ? 'L' : 'M'} ${xFor(point.x).toFixed(2)} ${yFor(point.y).toFixed(2)}`).join(' ');
  }

  function renderCurve(history) {
    const host = $('curve-chart');
    const current = history.at(-1);
    const previous = history.at(-2);
    if (!current) { host.innerHTML = '<div class="chart-empty">尚无有效收益率曲线数据</div>'; return; }
    const values = [];
    for (const row of [current, previous]) for (const tenor of TENORS) {
      const t = yieldAt(row, 'treasury', tenor.year); const p = yieldAt(row, 'policy', tenor.year);
      if (t !== null) values.push(t); if (p !== null) values.push(p);
    }
    const lo = Math.floor((Math.min(...values) - .1) * 10) / 10;
    const hi = Math.ceil((Math.max(...values) + .1) * 10) / 10;
    const W = 740; const H = 250; const left = 43; const right = 10; const top = 12; const bottom = 31;
    const x = (index) => left + (index / (TENORS.length - 1)) * (W - left - right);
    const y = (value) => top + ((hi - value) / ((hi - lo) || 1)) * (H - top - bottom);
    const ticks = 4;
    const grid = Array.from({ length: ticks + 1 }, (_, i) => {
      const value = lo + ((hi - lo) * i) / ticks; const py = y(value);
      return `<g><line class="chart-gridline" x1="${left}" x2="${W - right}" y1="${py}" y2="${py}"/><text class="chart-axis" x="${left - 8}" y="${py + 3}" text-anchor="end">${value.toFixed(2)}</text></g>`;
    }).join('');
    const xTicks = TENORS.map((tenor, index) => `<g><line class="chart-gridline" x1="${x(index)}" x2="${x(index)}" y1="${top}" y2="${H - bottom}" opacity=".45"/><text class="chart-axis" x="${x(index)}" y="${H - 9}" text-anchor="middle">${tenor.label}</text></g>`).join('');
    const curve = (row, field, klass) => {
      if (!row) return '';
      const points = TENORS.map((tenor, index) => ({ x: index, y: yieldAt(row, field, tenor.year), tenor })).filter((point) => point.y !== null);
      const path = makeLinePath(points, x, y);
      const dotColor = row === previous ? '#aeb8c5' : klass === 'navy' ? '#354b72' : '#4c9b91';
      const dots = points.map((point) => `<circle class="chart-point ${klass}" fill="${dotColor}" cx="${x(point.x)}" cy="${y(point.y)}" r="3.2"><title>${row.date} · ${field === 'treasury' ? '国债' : '国开债'} ${point.tenor.label}：${number(point.y)}%</title></circle>`).join('');
      return `<path class="curve-line ${klass}${row === previous ? ' previous' : ''}" d="${path}"/>${dots}`;
    };
    host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${current.date}国债与国开债到期收益率曲线，虚线为上一交易日"><g>${grid}${xTicks}</g>${curve(previous, 'treasury', 'navy')}${curve(previous, 'policy', 'teal')}${curve(current, 'treasury', 'navy')}${curve(current, 'policy', 'teal')}</svg>`;
  }

  function seriesValue(row, series) {
    if (series === 'spread') return daySpread(row, 10);
    return yieldAt(row, series, 10);
  }

  function renderHistory(history) {
    const spec = SERIES[state.series];
    const last = history.at(-1);
    const threshold = last ? parseDate(last.date).getTime() - (state.range - 1) * 86400000 : 0;
    const entries = history.filter((row) => parseDate(row.date).getTime() >= threshold && seriesValue(row, state.series) !== null);
    const host = $('history-chart');
    setText('history-latest', entries.length ? `${number(seriesValue(entries.at(-1), state.series), state.series === 'spread' ? 1 : 4)} ${spec.unit}` : '—');
    setText('history-change', `过去 ${state.range} 天 · ${entries.length} 个交易日`);
    if (entries.length < 2) { host.innerHTML = '<div class="chart-empty">历史数据不足，完成后续更新后显示走势</div>'; return; }
    const vals = entries.map((row) => seriesValue(row, state.series));
    const min = Math.min(...vals); const max = Math.max(...vals);
    const pad = (max - min || Math.max(Math.abs(max) * .02, .02)) * .22;
    const lo = min - pad; const hi = max + pad;
    const W = 620; const H = 230; const left = 42; const right = 10; const top = 12; const bottom = 30;
    const x = (index) => left + (index / (entries.length - 1)) * (W - left - right);
    const y = (value) => top + ((hi - value) / (hi - lo || 1)) * (H - top - bottom);
    const ticks = 3;
    const grid = Array.from({ length: ticks + 1 }, (_, i) => {
      const value = lo + ((hi - lo) * i) / ticks; const py = y(value);
      return `<g><line class="chart-gridline" x1="${left}" x2="${W - right}" y1="${py}" y2="${py}"/><text class="chart-axis" x="${left - 7}" y="${py + 3}" text-anchor="end">${value.toFixed(state.series === 'spread' ? 0 : 2)}</text></g>`;
    }).join('');
    const points = entries.map((row, index) => ({ x: index, y: seriesValue(row, state.series), row }));
    const path = makeLinePath(points, x, y);
    const area = `${path} L ${x(points.at(-1).x)} ${H - bottom} L ${x(0)} ${H - bottom} Z`;
    const selected = [0, Math.round((entries.length - 1) / 2), entries.length - 1];
    const xLabels = [...new Set(selected)].map((index) => `<text class="chart-axis" x="${x(index)}" y="${H - 8}" text-anchor="${index === 0 ? 'start' : index === entries.length - 1 ? 'end' : 'middle'}">${shortDate(entries[index].date)}</text>`).join('');
    const dots = points.map((point, index) => `<circle class="chart-point" fill="${spec.color}" cx="${x(point.x)}" cy="${y(point.y)}" r="${index === points.length - 1 ? 4 : 2.7}" opacity="${index === points.length - 1 ? 1 : .76}"><title>${point.row.date} · ${spec.title}：${number(point.y, state.series === 'spread' ? 1 : 4)} ${spec.unit}</title></circle>`).join('');
    host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${spec.title}过去${state.range}天历史走势"><g>${grid}</g><path class="history-fill" fill="${spec.color}" d="${area}"/><path class="history-line" stroke="${spec.color}" d="${path}"/>${dots}${xLabels}</svg>`;
  }

  function renderTable(history) {
    const latest = history.at(-1); const previous = history.at(-2);
    const body = $('tenor-table');
    if (!latest) { body.innerHTML = '<tr><td colspan="4" class="empty-cell">尚无有效行情数据</td></tr>'; return; }
    body.innerHTML = TENORS.map((tenor) => {
      const current = yieldAt(latest, state.tableSeries, tenor.year);
      const before = previous ? yieldAt(previous, state.tableSeries, tenor.year) : null;
      const delta = roundedBp(current === null || before === null ? null : (current - before) * 100);
      const deltaClass = delta === null || delta === 0 ? 'td-change-flat' : delta > 0 ? 'td-change-up' : 'td-change-down';
      return `<tr><td>${tenor.label}</td><td>${number(current)}%</td><td class="${deltaClass}">${delta === null ? '—' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)} bp`}</td><td>${number(before)}%</td></tr>`;
    }).join('');
  }

  function renderBrief(history) {
    const current = history.at(-1); const previous = history.at(-2);
    const host = $('brief-content');
    if (!current || !previous) { host.innerHTML = '<p>至少积累两个交易日的有效曲线后，自动生成日变化简报。</p>'; return; }
    const changes = TENORS.map((tenor) => ({ tenor, delta: roundedBp(yieldChange(current, previous, tenor.year)) })).filter((item) => Number.isFinite(item.delta));
    const largest = [...changes].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
    const upCount = changes.filter((item) => item.delta > 0).length;
    const downCount = changes.filter((item) => item.delta < 0).length;
    const spreadNow = daySpread(current, 10); const spreadPrev = daySpread(previous, 10);
    const spreadDelta = spreadNow === null || spreadPrev === null ? null : spreadNow - spreadPrev;
    const largestDelta = roundedBp(largest?.delta);
    const spreadMove = roundedBp(spreadDelta);
    const move = largest ? `${largest.tenor.longLabel}国债收益率${largestDelta > 0 ? '上行' : largestDelta < 0 ? '下行' : '持平'} <strong>${largestDelta > 0 ? '+' : ''}${Math.abs(largestDelta).toFixed(1)} bp</strong>，是关键期限中变化幅度最大的一项。` : '关键期限日变化数据不足。';
    const direction = upCount > downCount ? '多数关键期限收益率上行' : downCount > upCount ? '多数关键期限收益率下行' : '关键期限涨跌互现或变化接近';
    const spreadText = spreadMove === null ? '国开债利差数据不足' : `10 年国开债－国债利差${spreadMove > 0 ? '走阔' : spreadMove < 0 ? '收窄' : '持平'} <strong>${spreadMove > 0 ? '+' : ''}${Math.abs(spreadMove).toFixed(1)} bp</strong>`;
    host.innerHTML = `<p>${move}</p><p>${direction}（上行 ${upCount} 个、下行 ${downCount} 个）。${spreadText}，当前为 <strong>${number(spreadNow, 1)} bp</strong>。</p>`;
  }

  function renderAll() {
    const history = sortedHistory();
    const latest = history.at(-1);
    setText('market-date', latest?.date || '暂无行情');
    setStatus();
    const checkedAt = state.data?.checkedAt;
    setText('check-time', checkedAt ? `最近检查 ${checkedAt.replace('T', ' ').replace('+08:00', ' 北京时间')}` : '检查时间 —');
    renderMetrics(history);
    renderCurve(history);
    renderHistory(history);
    renderTable(history);
    renderBrief(history);
  }

  async function loadData({ quiet = false } = {}) {
    const button = $('refresh-button');
    if (!quiet) button.classList.add('is-loading');
    try {
      const response = await fetch(`./public/data/market.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data.history)) throw new Error('行情文件结构无效');
      state.data = data;
      renderAll();
    } catch (error) {
      if (!state.data) {
        $('notice-message').textContent = '无法读取行情文件，请稍后重试或通过本地 HTTP 服务预览。';
        $('market-date').textContent = '暂无行情';
      }
      console.error('加载行情失败', error);
    } finally {
      button.classList.remove('is-loading');
    }
  }

  $('refresh-button').addEventListener('click', () => loadData());
  $('history-series').addEventListener('change', (event) => { state.series = event.target.value; renderHistory(sortedHistory()); });
  document.querySelectorAll('[data-range]').forEach((button) => button.addEventListener('click', () => {
    state.range = Number(button.dataset.range);
    document.querySelectorAll('[data-range]').forEach((item) => item.classList.toggle('active', item === button));
    renderHistory(sortedHistory());
  }));
  document.querySelectorAll('[data-table-series]').forEach((button) => button.addEventListener('click', () => {
    state.tableSeries = button.dataset.tableSeries;
    document.querySelectorAll('[data-table-series]').forEach((item) => item.classList.toggle('active', item === button));
    renderTable(sortedHistory());
  }));
  loadData();
  window.setInterval(() => loadData({ quiet: true }), 10 * 60 * 1000);
})();
