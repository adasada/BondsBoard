(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  if (root) root.BondsBoardIndexModel = model;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TENORS = [0.25, 0.5, 1, 2, 3, 5, 7, 10, 15, 20, 30];
  const BUCKETS = [
    { id: 'treasury', label: '国债', curve: 'treasury', weight: 15, tenor: 5, duration: 4.5, spreadBp: 0, color: 'var(--navy)' },
    { id: 'policy', label: '政策性金融债', curve: 'policy', weight: 15, tenor: 5, duration: 4.2, spreadBp: 0, color: 'var(--teal)' },
    { id: 'local', label: '地方债代理', curve: 'treasury', weight: 10, tenor: 7, duration: 5.8, spreadBp: 35, color: 'var(--gold)' },
    { id: 'credit', label: '信用债代理', curve: 'policy', weight: 35, tenor: 3, duration: 2.4, spreadBp: 80, color: 'var(--lilac)' },
    { id: 'financial', label: '金融债代理', curve: 'policy', weight: 15, tenor: 3, duration: 2.5, spreadBp: 55, color: 'var(--red)' },
    { id: 'cash', label: '现金', curve: null, weight: 10, ratePct: 1.2, color: 'var(--green)' },
  ];
  const DEFAULTS = {
    buckets: BUCKETS.map(({ id, weight, tenor, duration, spreadBp, ratePct }) => ({ id, weight, tenor, duration, spreadBp, ratePct })),
    leverage: 1.05,
    feePct: 0.2,
    fundingPct: 1.8,
    baseValue: 1000,
    rateShockBp: 25,
    creditShockBp: 50,
    forecastRateBp: 0,
    forecastCreditBp: 0,
    forecastDate: '',
  };

  const cloneDefaults = () => JSON.parse(JSON.stringify(DEFAULTS));
  const validate = (config) => {
    if (!config || !Array.isArray(config.buckets) || config.buckets.length !== BUCKETS.length) return '组合配置不完整';
    const ids = new Set(config.buckets.map((bucket) => bucket?.id));
    if (BUCKETS.some((bucket) => !ids.has(bucket.id))) return '组合类别不完整';
    for (const bucket of config.buckets) {
      const definition = BUCKETS.find((item) => item.id === bucket.id);
      const fields = definition.curve ? ['weight', 'tenor', 'duration', 'spreadBp'] : ['weight', 'ratePct'];
      if (fields.some((key) => bucket[key] === null || bucket[key] === undefined || bucket[key] === '' || !Number.isFinite(Number(bucket[key])))) return `${definition.label}参数无效`;
      if (Number(bucket.weight) < 0 || Number(bucket.weight) > 100) return `${definition.label}权重需在 0–100%`;
      if (definition.curve && (!TENORS.includes(Number(bucket.tenor)) || Number(bucket.duration) < 0 || Number(bucket.duration) > 30 || Number(bucket.spreadBp) < 0 || Number(bucket.spreadBp) > 1000)) return `${definition.label}期限、久期或利差超出范围`;
      if (!definition.curve && (Number(bucket.ratePct) < 0 || Number(bucket.ratePct) > 20)) return '现金收益率需在 0–20%';
    }
    const total = config.buckets.reduce((sum, bucket) => sum + Number(bucket.weight), 0);
    if (Math.abs(total - 100) > 0.01) return '权重合计需为 100%';
    const globals = ['leverage', 'feePct', 'fundingPct', 'baseValue', 'rateShockBp', 'creditShockBp', 'forecastRateBp', 'forecastCreditBp'];
    if (globals.some((key) => config[key] === null || config[key] === undefined || config[key] === '' || !Number.isFinite(Number(config[key])))) return '全局参数无效';
    if (Number(config.leverage) < 1 || Number(config.leverage) > 2 || Number(config.feePct) < 0 || Number(config.feePct) > 5 || Number(config.fundingPct) < 0 || Number(config.fundingPct) > 15 || Number(config.baseValue) < 1 || Number(config.baseValue) > 100000 || Number(config.rateShockBp) < -500 || Number(config.rateShockBp) > 500 || Number(config.creditShockBp) < -500 || Number(config.creditShockBp) > 1000 || Number(config.forecastRateBp) < -500 || Number(config.forecastRateBp) > 500 || Number(config.forecastCreditBp) < -500 || Number(config.forecastCreditBp) > 1000) return '全局参数超出允许范围';
    if (config.forecastDate && !validDate(config.forecastDate)) return '预估日期无效';
    return null;
  };
  const yieldAt = (row, curve, tenor) => {
    const series = row?.curves?.[curve];
    if (!series) return null;
    const direct = series[String(tenor)] ?? series[tenor];
    if (direct !== null && direct !== undefined && direct !== '' && Number.isFinite(Number(direct))) return Number(direct);
    // A requested tenor can be reconstructed from the two surrounding published tenors.
    const known = Object.entries(series).filter(([, value]) => value !== null && value !== undefined && value !== '').map(([key, value]) => ({ tenor: Number(key), value: Number(value) })).filter((item) => Number.isFinite(item.tenor) && Number.isFinite(item.value)).sort((a, b) => a.tenor - b.tenor);
    const lower = known.filter((item) => item.tenor < tenor).at(-1);
    const upper = known.find((item) => item.tenor > tenor);
    if (lower && upper) return lower.value + (upper.value - lower.value) * (tenor - lower.tenor) / (upper.tenor - lower.tenor);
    return null;
  };
  const dayGap = (left, right) => {
    const a = Date.parse(`${left}T00:00:00Z`);
    const b = Date.parse(`${right}T00:00:00Z`);
    return Number.isFinite(a) && Number.isFinite(b) ? (a - b) / 86400000 : 0;
  };
  const chinaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const validDate = (date) => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
  const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
  const activeBuckets = (config) => config.buckets.filter((bucket) => Number(bucket.weight) > 0).map((bucket) => ({ ...BUCKETS.find((item) => item.id === bucket.id), ...bucket }));
  const isCreditLike = (id) => ['local', 'credit', 'financial'].includes(id);

  function calculate(history, config, today = chinaToday()) {
    const error = validate(config);
    if (error) return { error, points: [], scenarioPct: null };
    const buckets = activeBuckets(config);
    const rows = [...(Array.isArray(history) ? history : [])].filter((row) => row && validDate(row.date) && row.date <= today).sort((a, b) => a.date.localeCompare(b.date));
    const points = [];
    let value = Number(config.baseValue);
    let previous = null;
    let skippedRows = 0;
    let interpolatedRows = 0;
    for (const row of rows) {
      if (previous && row.date <= previous.date) continue;
      const available = buckets.every((bucket) => !bucket.curve || yieldAt(row, bucket.curve, bucket.tenor) !== null);
      if (!available) { skippedRows += 1; continue; }
      const interpolated = buckets.some((bucket) => bucket.curve && (row.curves?.[bucket.curve]?.[String(bucket.tenor)] === null || row.curves?.[bucket.curve]?.[String(bucket.tenor)] === undefined || row.curves?.[bucket.curve]?.[String(bucket.tenor)] === ''));
      if (interpolated) interpolatedRows += 1;
      let portfolioReturn = 0;
      if (!previous) {
        points.push({ date: row.date, value, dailyReturn: 0, kind: interpolated ? 'tenor-estimate' : 'history' });
        previous = row;
        continue;
      }
      const gap = previous ? dayGap(row.date, previous.date) : 0;
      if (gap <= 0) continue;
      for (const bucket of buckets) {
        const weight = Number(bucket.weight) / 100;
        let bucketReturn;
        if (!bucket.curve) {
          bucketReturn = Number(bucket.ratePct) / 100 * gap / 365;
        } else {
          const oldYield = yieldAt(previous, bucket.curve, bucket.tenor);
          const newYield = yieldAt(row, bucket.curve, bucket.tenor);
          const carryPct = oldYield + Number(bucket.spreadBp) / 100;
          const dy = (newYield - oldYield) / 100;
          const duration = Number(bucket.duration);
          const convexity = duration * (duration + 1);
          bucketReturn = carryPct / 100 * gap / 365 - duration * dy + 0.5 * convexity * dy * dy;
        }
        portfolioReturn += weight * bucketReturn;
      }
      const debt = Math.max(0, Number(config.leverage) - 1);
      const totalReturn = Number(config.leverage) * portfolioReturn - debt * Number(config.fundingPct) / 100 * gap / 365 - Number(config.feePct) / 100 * gap / 365;
      // Fill intervening dates retrospectively between two usable observations.
      // This path uses both endpoints and must never be described as a live forecast.
      const endValue = value * (1 + totalReturn);
      const dailyReturn = Math.pow(1 + totalReturn, 1 / gap) - 1;
      for (let offset = 1; offset <= gap; offset += 1) {
        points.push({ date: addDays(previous.date, offset), value: offset === gap ? endValue : value * Math.pow(1 + dailyReturn, offset), dailyReturn, kind: offset < gap ? 'gap-estimate' : interpolated ? 'tenor-estimate' : 'history' });
      }
      value = endValue;
      previous = row;
    }
    const rateShock = Number(config.rateShockBp) / 10000;
    const spreadShock = Number(config.creditShockBp) / 10000;
    const shockReturn = buckets.reduce((sum, bucket) => {
      if (!bucket.curve) return sum;
      const duration = Number(bucket.duration);
      const convexity = duration * (duration + 1);
      const localSpread = isCreditLike(bucket.id) ? spreadShock : 0;
      const dy = rateShock + localSpread;
      const change = -duration * dy + 0.5 * convexity * dy * dy;
      return sum + Number(bucket.weight) / 100 * change;
    }, 0) * Number(config.leverage);
    const forecastPoints = [];
    let forecastError = null;
    const targetDate = config.forecastDate || today;
    const lastRow = previous;
    const lastPoint = points.at(-1);
    if (points.length && targetDate < points[0].date) forecastError = `目标日期早于可回溯起点 ${points[0].date}，历史曲线未覆盖该日期`;
    if (lastRow && lastPoint && targetDate > lastRow.date) {
      const gap = dayGap(targetDate, lastRow.date);
      if (gap > 365) forecastError = '预估日期距最近有效曲线超过 365 天，请缩短预估区间';
      else for (let offset = 1; offset <= gap; offset += 1) {
        let portfolioReturn = 0;
        for (const bucket of buckets) {
          const weight = Number(bucket.weight) / 100;
          let bucketReturn;
          if (!bucket.curve) {
            bucketReturn = Number(bucket.ratePct) / 100 * offset / 365;
          } else {
            const currentYield = yieldAt(lastRow, bucket.curve, bucket.tenor);
            const localSpreadShock = isCreditLike(bucket.id) ? Number(config.forecastCreditBp) / 10000 : 0;
            const dy = (Number(config.forecastRateBp) / 10000 + localSpreadShock) * offset / gap;
            const duration = Number(bucket.duration);
            const convexity = duration * (duration + 1);
            bucketReturn = (currentYield + Number(bucket.spreadBp) / 100) / 100 * offset / 365 - duration * dy + 0.5 * convexity * dy * dy;
          }
          portfolioReturn += weight * bucketReturn;
        }
        const debt = Math.max(0, Number(config.leverage) - 1);
        const projectedReturn = Number(config.leverage) * portfolioReturn - debt * Number(config.fundingPct) / 100 * offset / 365 - Number(config.feePct) / 100 * offset / 365;
        if (!Number.isFinite(projectedReturn) || projectedReturn <= -1) {
          forecastError = '当前假设产生非正点位，久期近似超出适用范围，请减小变化幅度、费用或杠杆';
          forecastPoints.length = 0;
          break;
        }
        forecastPoints.push({ date: addDays(lastRow.date, offset), value: lastPoint.value * (1 + projectedReturn), totalReturn: projectedReturn, days: offset, afterDate: lastRow.date, kind: 'forecast' });
      }
    }
    return { error: null, points, forecastPoints, forecastPoint: forecastPoints.at(-1) || null, forecastError, skippedRows, interpolatedRows, scenarioPct: shockReturn * 100, today, targetDate };
  }

  return { BUCKETS, TENORS, DEFAULTS, cloneDefaults, validate, calculate, chinaToday };
});
