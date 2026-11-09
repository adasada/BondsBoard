(() => {
  'use strict';
  const Model = window.BondsBoardIndexModel;
  if (!Model) return;

  const STORAGE_KEY = 'bondsboard.custom-index.v1';
  const $ = (id) => document.getElementById(id);
  const fields = ['leverage', 'feePct', 'fundingPct', 'baseValue', 'rateShockBp', 'creditShockBp'];
  let config = Model.cloneDefaults();
  let applied = Model.cloneDefaults();
  let market = { history: [], status: 'empty', checkedAt: null };
  let range = '30';

  function readSaved() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!Model.validate(saved)) return saved;
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

  function renderChart(points) {
    const host = $('custom-index-chart');
    const entries = selectedHistory(points);
    if (entries.length < 2) {
      host.innerHTML = `<div class="chart-empty">${entries.length ? '历史数据不足，暂无法绘制曲线' : '当前参数下暂无可用历史数据'}</div>`;
      return;
    }
    const width = 740; const height = 230; const left = 54; const right = 12; const top = 16; const bottom = 30;
    const values = entries.map((point) => point.value);
    const lo = Math.min(...values); const hi = Math.max(...values);
    const pad = (hi - lo || Math.max(hi * 0.002, 1)) * 0.22;
    const y0 = lo - pad; const y1 = hi + pad;
    const x = (index) => left + index / (entries.length - 1) * (width - left - right);
    const y = (value) => top + (y1 - value) / (y1 - y0) * (height - top - bottom);
    const line = entries.map((point, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(point.value).toFixed(1)}`).join(' ');
    const area = `${line} L${x(entries.length - 1).toFixed(1)},${height - bottom} L${left},${height - bottom} Z`;
    const grid = [0, 1, 2, 3].map((step) => {
      const value = y1 - (y1 - y0) * step / 3; const py = y(value);
      return `<line class="chart-gridline" x1="${left}" x2="${width - right}" y1="${py}" y2="${py}"/><text class="chart-axis" x="${left - 8}" y="${py + 3}" text-anchor="end">${value.toFixed(1)}</text>`;
    }).join('');
    const dates = [entries[0], entries[Math.floor((entries.length - 1) / 2)], entries.at(-1)];
    const labels = dates.map((point, index) => `<text class="chart-axis" x="${x(index === 0 ? 0 : index === 1 ? Math.floor((entries.length - 1) / 2) : entries.length - 1)}" y="${height - 8}" text-anchor="${index === 0 ? 'start' : index === 2 ? 'end' : 'middle'}">${point.date.slice(5).replace('-', '.')}</text>`).join('');
    const latest = entries.at(-1);
    host.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="情景指数 ${fmt(entries[0].value)} 至 ${fmt(latest.value)} 点"><defs><linearGradient id="index-area-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--navy)" stop-opacity=".23"/><stop offset="1" stop-color="var(--navy)" stop-opacity=".01"/></linearGradient></defs>${grid}<path class="index-history-fill" d="${area}"/><path class="history-line index-history-line" pathLength="1" d="${line}"/><circle class="chart-point" cx="${x(entries.length - 1)}" cy="${y(latest.value)}" r="3.5" fill="var(--navy)"/>${labels}</svg>`;
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
    const points = output.points;
    const entries = selectedHistory(points);
    const latest = points.at(-1);
    const first = entries[0]; const last = entries.at(-1);
    $('index-value').textContent = latest ? fmt(latest.value) : '等待行情';
    $('index-asof').textContent = latest ? `${latest.date} · 基准 ${fmt(Number(applied.baseValue), 0)}` : '尚无可计算交易日';
    $('index-range-label').textContent = `区间收益 · ${range === 'all' ? '全部' : `${range} 天`}`;
    const returnPct = first && last && first.value !== 0 ? (last.value / first.value - 1) * 100 : null;
    $('index-return').textContent = Number.isFinite(returnPct) ? `${returnPct > 0 ? '+' : ''}${fmt(returnPct)}%` : '—';
    $('index-return').classList.toggle('is-positive', Number.isFinite(returnPct) && returnPct > 0);
    $('index-return').classList.toggle('is-negative', Number.isFinite(returnPct) && returnPct < 0);
    $('index-observations').textContent = `${entries.length} 个有效估算日`;
    let peak = -Infinity; let drawdown = 0;
    for (const point of entries) { peak = Math.max(peak, point.value); if (peak > 0) drawdown = Math.min(drawdown, point.value / peak - 1); }
    $('index-drawdown').textContent = entries.length ? `${fmt(drawdown * 100)}%` : '—';
    const scenario = output.scenarioPct;
    $('index-scenario').textContent = Number.isFinite(scenario) ? `${scenario > 0 ? '+' : ''}${fmt(scenario)}%` : '—';
    $('index-scenario').classList.toggle('is-positive', Number.isFinite(scenario) && scenario > 0);
    $('index-scenario').classList.toggle('is-negative', Number.isFinite(scenario) && scenario < 0);
    $('index-scenario-note').textContent = `利率 ${Number(applied.rateShockBp) > 0 ? '+' : ''}${applied.rateShockBp} bp · 利差 ${Number(applied.creditShockBp) > 0 ? '+' : ''}${applied.creditShockBp} bp`;
    const statusText = market.status === 'success' ? '行情更新' : market.status === 'stale' ? '最近交易日数据' : market.status === 'error' ? '行情读取异常' : '行情状态待确认';
    $('index-model-note').textContent = `${statusText}${latest ? ` · 曲线日期 ${latest.date}` : ''} · 信用与地方债收益使用自设利差代理`;
    renderChart(points);
  }

  function updateFromTarget(target) {
    if (target.matches('[data-bucket][data-key]')) {
      const bucket = config.buckets.find((item) => item.id === target.dataset.bucket);
      if (bucket) bucket[target.dataset.key] = target.value === '' ? NaN : Number(target.value);
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
  }
  init();
})();
