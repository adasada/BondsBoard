(() => {
  'use strict';
  const Model = window.BondsBoardIndexModel;
  if (!Model) return;

  const STORAGE_KEY = 'bondsboard.custom-index.v1';
  const $ = (id) => document.getElementById(id);
  const fields = ['leverage', 'feePct', 'fundingPct', 'baseValue', 'rateShockBp', 'creditShockBp', 'forecastRateBp', 'forecastCreditBp'];
  let config = Model.cloneDefaults();
  let applied = Model.cloneDefaults();
  let market = { history: [], status: 'empty', checkedAt: null };
  let range = '30';
  let calculatedDay = null;

  function readSaved() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!saved) return null;
      // Migrate previous browser settings while accepting only known, validated fields.
      const merged = { ...Model.cloneDefaults(), ...saved };
      if (!Model.validate(merged)) {
        const clean = Model.cloneDefaults();
        fields.forEach((key) => { clean[key] = Number(merged[key]); });
        clean.forecastDate = merged.forecastDate || '';
        clean.buckets = clean.buckets.map((bucket) => {
          const source = merged.buckets.find((item) => item.id === bucket.id);
          Object.keys(bucket).filter((key) => key !== 'id').forEach((key) => { bucket[key] = Number(source[key]); });
          return bucket;
        });
        return clean;
      }
    } catch { /* Ignore malformed or unavailable browser storage. */ }
    return null;
  }
  function writeSaved() {
    const error = Model.validate(config);
    if (error) {
      $('index-config-status').textContent = `${error} · 修正后再保存`;
      $('index-config-status').classList.add('is-invalid');
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
      $('index-config-status').textContent = '已保存到本机浏览器';
    } catch {
      $('index-config-status').textContent = '浏览器未允许保存';
    }
  }
  const fmt = (number, digits = 2) => Number.isFinite(number) ? number.toFixed(digits) : '—';
  const selectedHistory = (points) => {
    if (range === 'all' || !points.length) return points;
    const last = Date.parse(`${points.at(-1).date}T00:00:00Z`);
    const threshold = last - (Number(range) - 1) * 86400000;
    return points.filter((point) => Date.parse(`${point.date}T00:00:00Z`) >= threshold);
  };

  function renderBuckets() {
    const host = $('index-buckets');
    host.innerHTML = Model.BUCKETS.map((definition) => {
      const bucket = config.buckets.find((item) => item.id === definition.id);
      const weight = `<label class="index-weight-field"><span>权重</span><span class="index-input-suffix"><input data-bucket="${definition.id}" data-key="weight" type="number" min="0" max="100" step="1" value="${bucket.weight}" aria-label="${definition.label}权重" /><i>%</i></span></label>`;
      const rowFields = definition.curve
        ? `<label><span>期限</span><select data-bucket="${definition.id}" data-key="tenor" aria-label="${definition.label}期限">${Model.TENORS.map((year) => `<option value="${year}" ${Number(bucket.tenor) === year ? 'selected' : ''}>${year < 1 ? `${year * 12} 个月` : `${year} 年`}</option>`).join('')}</select></label><label><span>久期</span><span class="index-input-suffix"><input data-bucket="${definition.id}" data-key="duration" type="number" min="0" max="30" step="0.1" value="${bucket.duration}" aria-label="${definition.label}修正久期" /><i>年</i></span></label><label><span>利差</span><span class="index-input-suffix"><input data-bucket="${definition.id}" data-key="spreadBp" type="number" min="0" max="1000" step="5" value="${bucket.spreadBp}" aria-label="${definition.label}假设利差" /><i>bp</i></span></label>`
        : `<label><span>收益假设</span><span class="index-input-suffix"><input data-bucket="${definition.id}" data-key="ratePct" type="number" min="0" max="20" step="0.05" value="${bucket.ratePct}" aria-label="现金年化收益假设" /><i>%</i></span></label><span class="index-cash-hint">现金不使用曲线久期</span>`;
      return `<div class="index-bucket" data-bucket-row="${definition.id}"><span class="index-bucket-dot" style="--bucket-color:${definition.color}"></span><strong>${definition.label}</strong>${weight}${rowFields}</div>`;
    }).join('');
    fields.forEach((key) => { $(`index-config`).elements.namedItem(key).value = config[key]; });
    $('index-config').elements.namedItem('forecastDate').value = config.forecastDate || '';
  }

  function renderAllocation() {
    const total = config.buckets.reduce((sum, bucket) => sum + Number(bucket.weight || 0), 0);
    const totalNode = $('index-weight-total');
    totalNode.textContent = `${fmt(total, 1)}%`;
    totalNode.classList.toggle('is-invalid', Math.abs(total - 100) > 0.01);
    const host = $('index-allocation');
    if (host) host.innerHTML = Model.BUCKETS.map((definition) => {
      const bucket = config.buckets.find((item) => item.id === definition.id);
      return Number(bucket.weight) > 0 ? `<i title="${definition.label} ${bucket.weight}%" style="width:${Math.min(100, bucket.weight)}%;--bucket-color:${definition.color}"></i>` : '';
    }).join('');
  }

  function renderChart(points, forecasts) {
    const host = $('custom-index-chart');
    const entries = selectedHistory(points);
    const all = [...entries, ...forecasts];
    if (!all.length) {
      const message = market.status === 'error' ? '行情读取失败，请点击顶部刷新或检查网络连接' : market.status === 'empty' ? '正在等待行情文件；加载后自动回溯估算' : !market.history.length ? '行情文件暂无历史曲线，取得首个有效曲线后才能回溯与预估' : '所选资产缺少可用曲线及可插值期限，请调整参考期限或资产权重';
      host.innerHTML = `<div class="chart-empty">${message}</div>`;
      return;
    }
    const width = 740; const height = 230; const left = 54; const right = 12; const top = 16; const bottom = 30;
    const values = all.map((point) => point.value);
    const lo = Math.min(...values); const hi = Math.max(...values);
    const pad = (hi - lo || Math.max(hi * 0.002, 1)) * 0.22;
    const y0 = lo - pad; const y1 = hi + pad;
    const start = Date.parse(`${all[0].date}T00:00:00Z`);
    const end = Date.parse(`${all.at(-1).date}T00:00:00Z`);
    const x = (point) => left + (end === start ? 0.5 : (Date.parse(`${point.date}T00:00:00Z`) - start) / (end - start)) * (width - left - right);
    const y = (value) => top + (y1 - value) / (y1 - y0) * (height - top - bottom);
    const path = (series) => series.map((point, i) => `${i ? 'L' : 'M'}${x(point).toFixed(1)},${y(point.value).toFixed(1)}`).join(' ');
    const line = path(entries);
    const area = `${line} L${x(entries.at(-1)).toFixed(1)},${height - bottom} L${x(entries[0]).toFixed(1)},${height - bottom} Z`;
    const forecastLine = forecasts.length ? `<path class="index-forecast-line" d="${path([entries.at(-1), ...forecasts])}"/>` : '';
    const grid = [0, 1, 2, 3].map((step) => {
      const value = y1 - (y1 - y0) * step / 3; const py = y(value);
      return `<line class="chart-gridline" x1="${left}" x2="${width - right}" y1="${py}" y2="${py}"/><text class="chart-axis" x="${left - 8}" y="${py + 3}" text-anchor="end">${value.toFixed(1)}</text>`;
    }).join('');
    const dates = all.length > 2 ? [all[0], all[Math.floor((all.length - 1) / 2)], all.at(-1)] : all;
    const labels = dates.map((point, index) => `<text class="chart-axis" x="${x(point)}" y="${height - 8}" text-anchor="${index === 0 ? 'start' : index === dates.length - 1 ? 'end' : 'middle'}">${point.date.slice(5).replace('-', '.')}</text>`).join('');
    const latest = all.at(-1);
    const dots = all.map((point) => `<circle cx="${x(point)}" cy="${y(point.value)}" r="5" fill="transparent"><title>${point.date} · ${point.kind === 'forecast' ? '预估' : point.kind === 'gap-estimate' ? '历史缺口回溯补估' : point.kind === 'tenor-estimate' ? '期限插值回溯' : '历史回溯'} ${fmt(point.value)} 点</title></circle>`).join('');
    host.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="历史回溯至 ${entries.at(-1).date}${forecasts.length ? `，预估至 ${latest.date}` : ''}"><defs><linearGradient id="index-area-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--navy)" stop-opacity=".23"/><stop offset="1" stop-color="var(--navy)" stop-opacity=".01"/></linearGradient></defs>${grid}<path class="index-history-fill" d="${area}"/><path class="history-line index-history-line" pathLength="1" d="${line}"/>${forecastLine}${dots}<circle class="chart-point" cx="${x(latest)}" cy="${y(latest.value)}" r="3.5" fill="${forecasts.length ? 'var(--gold)' : 'var(--navy)'}"/>${labels}</svg>`;
  }

  function render() {
    renderAllocation();
    const validation = Model.validate(config);
    const status = $('index-config-status');
    if (validation) {
      status.textContent = `${validation} · 图表保留上次有效参数`;
      status.classList.add('is-invalid');
    } else {
      status.textContent = market.history.length ? '参数有效 · 尚未保存' : '参数有效 · 等待行情数据';
      status.classList.remove('is-invalid');
      applied = JSON.parse(JSON.stringify(config));
    }
    const output = Model.calculate(market.history, applied);
    calculatedDay = output.today;
    const points = output.points;
    const entries = selectedHistory(points);
    const latest = points.at(-1);
    const forecast = output.forecastPoint;
    const first = entries[0]; const last = entries.at(-1);
    $('index-value').textContent = latest ? fmt(latest.value) : '等待行情';
    $('index-asof').textContent = latest ? `${latest.date} · 历史回溯` : '尚无可计算起点';
    $('index-forecast-value').textContent = forecast ? fmt(forecast.value) : '—';
    $('index-forecast-date').textContent = output.targetDate === output.today ? '今日预估' : '目标日期预估';
    $('index-forecast-note').textContent = output.forecastError || (forecast ? `${forecast.date} · 从 ${forecast.afterDate} 延伸 ${forecast.days} 天 · 较历史末点 ${forecast.totalReturn > 0 ? '+' : ''}${fmt(forecast.totalReturn * 100)}%` : latest ? `历史已覆盖 ${output.targetDate}，无需重复预估；可设置更晚日期` : '需先取得至少一个有效曲线起点');
    $('index-range-label').textContent = `区间收益 · ${range === 'all' ? '全部' : `${range} 天`}`;
    const returnPct = first && last && first.value !== 0 ? (last.value / first.value - 1) * 100 : null;
    $('index-return').textContent = Number.isFinite(returnPct) ? `${returnPct > 0 ? '+' : ''}${fmt(returnPct)}%` : '—';
    $('index-return').classList.toggle('is-positive', Number.isFinite(returnPct) && returnPct > 0);
    $('index-return').classList.toggle('is-negative', Number.isFinite(returnPct) && returnPct < 0);
    $('index-observations').textContent = `${entries.length} 个回溯日 · 含 ${entries.filter((point) => point.kind === 'gap-estimate').length} 个补估日`;
    let peak = -Infinity; let drawdown = 0;
    for (const point of entries) { peak = Math.max(peak, point.value); if (peak > 0) drawdown = Math.min(drawdown, point.value / peak - 1); }
    $('index-drawdown').textContent = entries.length ? `${fmt(drawdown * 100)}%` : '—';
    const scenario = output.scenarioPct;
    $('index-scenario').textContent = Number.isFinite(scenario) ? `${scenario > 0 ? '+' : ''}${fmt(scenario)}%` : '—';
    $('index-scenario').classList.toggle('is-positive', Number.isFinite(scenario) && scenario > 0);
    $('index-scenario').classList.toggle('is-negative', Number.isFinite(scenario) && scenario < 0);
    $('index-scenario-note').textContent = `利率 ${Number(applied.rateShockBp) > 0 ? '+' : ''}${applied.rateShockBp} bp · 利差 ${Number(applied.creditShockBp) > 0 ? '+' : ''}${applied.creditShockBp} bp`;
    const statusText = market.status === 'success' ? '行情更新' : market.status === 'stale' ? '最近交易日数据' : market.status === 'error' ? '行情读取异常' : '行情状态待确认';
    $('index-model-note').textContent = `${statusText}${latest ? ` · 曲线截至 ${latest.date}` : ''} · ${output.interpolatedRows || 0} 日期限插值 · ${output.skippedRows || 0} 条缺数记录跳过 · 历史指标不含预估`;
    renderChart(points, output.forecastPoints || []);
  }

  function updateFromTarget(target) {
    if (target.matches('[data-bucket][data-key]')) {
      const bucket = config.buckets.find((item) => item.id === target.dataset.bucket);
      if (bucket) bucket[target.dataset.key] = target.value === '' ? NaN : Number(target.value);
    } else if (target.name === 'forecastDate') {
      config.forecastDate = target.value;
    } else if (fields.includes(target.name)) {
      config[target.name] = target.value === '' ? NaN : Number(target.value);
    }
    render();
  }

  function init() {
    config = readSaved() || Model.cloneDefaults();
    applied = JSON.parse(JSON.stringify(config));
    renderBuckets();
    render();
    $('index-config').addEventListener('input', (event) => { if (event.target.matches('input')) updateFromTarget(event.target); });
    $('index-config').addEventListener('change', (event) => updateFromTarget(event.target));
    $('index-save').addEventListener('click', writeSaved);
    $('index-reset').addEventListener('click', () => {
      config = Model.cloneDefaults(); applied = JSON.parse(JSON.stringify(config));
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* Storage is optional. */ }
      renderBuckets();
      render(); $('index-config-status').textContent = '已恢复通用初始参数';
    });
    document.querySelectorAll('[data-index-range]').forEach((button) => button.addEventListener('click', () => {
      range = button.dataset.indexRange;
      document.querySelectorAll('[data-index-range]').forEach((item) => item.classList.toggle('active', item === button));
      render();
    }));
    window.addEventListener('bondsboard:market-data', (event) => {
      market = { history: event.detail?.history || [], status: event.detail?.status || 'empty', checkedAt: event.detail?.checkedAt || null };
      render();
    });
    if (window.BondsBoardMarketData) {
      market = window.BondsBoardMarketData;
      render();
    }
    const refreshDate = () => { if (calculatedDay !== Model.chinaToday()) render(); };
    window.setInterval(refreshDate, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshDate(); });
  }
  init();
})();
