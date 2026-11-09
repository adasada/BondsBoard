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
  };

  const cloneDefaults = () => JSON.parse(JSON.stringify(DEFAULTS));
  const validate = (config) => {
    if (!config || !Array.isArray(config.buckets) || config.buckets.length !== BUCKETS.length) return '组合配置不完整';
    const ids = new Set(config.buckets.map((bucket) => bucket.id));
    if (BUCKETS.some((bucket) => !ids.has(bucket.id))) return '组合类别不完整';
    for (const bucket of config.buckets) {
      const definition = BUCKETS.find((item) => item.id === bucket.id);
      const fields = definition.curve ? ['weight', 'tenor', 'duration', 'spreadBp'] : ['weight', 'ratePct'];
      if (fields.some((key) => !Number.isFinite(Number(bucket[key])))) return `${definition.label}参数无效`;
      if (bucket.weight < 0 || bucket.weight > 100) return `${definition.label}权重需在 0–100%`;
      if (definition.curve && (!TENORS.includes(Number(bucket.tenor)) || bucket.duration < 0 || bucket.duration > 30 || bucket.spreadBp < 0 || bucket.spreadBp > 1000)) return `${definition.label}期限、久期或利差超出范围`;
      if (!definition.curve && (bucket.ratePct < 0 || bucket.ratePct > 20)) return '现金收益率需在 0–20%';
    }
    const total = config.buckets.reduce((sum, bucket) => sum + Number(bucket.weight), 0);
    if (Math.abs(total - 100) > 0.01) return '权重合计需为 100%';
    if (![config.leverage, config.feePct, config.fundingPct, config.baseValue, config.rateShockBp, config.creditShockBp].every((value) => Number.isFinite(Number(value)))) return '全局参数无效';
    if (config.leverage < 1 || config.leverage > 2 || config.feePct < 0 || config.feePct > 5 || config.fundingPct < 0 || config.fundingPct > 15 || config.baseValue < 1 || config.baseValue > 100000 || config.rateShockBp < -500 || config.rateShockBp > 500 || config.creditShockBp < -500 || config.creditShockBp > 1000) return '全局参数超出允许范围';
    return null;
  };
  const yieldAt = (row, curve, tenor) => {
    const value = row?.curves?.[curve]?.[String(tenor)];
    return Number.isFinite(Number(value)) && value !== null && value !== '' ? Number(value) : null;
  };
  const dayGap = (left, right) => {
    const a = Date.parse(`${left}T00:00:00Z`);
    const b = Date.parse(`${right}T00:00:00Z`);
    return Number.isFinite(a) && Number.isFinite(b) ? (a - b) / 86400000 : 0;
  };
  const activeBuckets = (config) => config.buckets.filter((bucket) => Number(bucket.weight) > 0).map((bucket) => ({ ...BUCKETS.find((item) => item.id === bucket.id), ...bucket }));
  const isCreditLike = (id) => ['local', 'credit', 'financial'].includes(id);

  function calculate(history, config) {
    const error = validate(config);
    if (error) return { error, points: [], scenarioPct: null };
    const buckets = activeBuckets(config);
    const rows = [...(Array.isArray(history) ? history : [])].filter((row) => row && typeof row.date === 'string').sort((a, b) => a.date.localeCompare(b.date));
    const points = [];
    let value = Number(config.baseValue);
    let previous = null;
    for (const row of rows) {
      let portfolioReturn = 0;
      let available = true;
      if (!previous) {
        available = buckets.every((bucket) => !bucket.curve || yieldAt(row, bucket.curve, bucket.tenor) !== null);
        if (available) points.push({ date: row.date, value, dailyReturn: 0 });
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
          if (oldYield === null || newYield === null) { available = false; break; }
          const carryPct = oldYield + Number(bucket.spreadBp) / 100;
          const dy = (newYield - oldYield) / 100;
          const duration = Number(bucket.duration);
          const convexity = duration * (duration + 1);
          bucketReturn = carryPct / 100 * gap / 365 - duration * dy + 0.5 * convexity * dy * dy;
        }
        portfolioReturn += weight * bucketReturn;
      }
      if (!available) { previous = row; continue; }
      const debt = Math.max(0, Number(config.leverage) - 1);
      const totalReturn = Number(config.leverage) * portfolioReturn - debt * Number(config.fundingPct) / 100 * gap / 365 - Number(config.feePct) / 100 * gap / 365;
      value *= 1 + totalReturn;
      points.push({ date: row.date, value, dailyReturn: totalReturn });
      previous = row;
    }
    const rateShock = Number(config.rateShockBp) / 10000;
    const spreadShock = Number(config.creditShockBp) / 10000;
    const shockReturn = buckets.reduce((sum, bucket) => {
      if (!bucket.curve) return sum;
      const duration = Number(bucket.duration);
      const convexity = duration * (duration + 1);
      const localSpread = isCreditLike(bucket.id) ? spreadShock : 0;
      const change = -duration * (rateShock + localSpread) + 0.5 * convexity * rateShock * rateShock;
      return sum + Number(bucket.weight) / 100 * change;
    }, 0) * Number(config.leverage);
    return { error: null, points, scenarioPct: shockReturn * 100 };
  }

  return { BUCKETS, TENORS, DEFAULTS, cloneDefaults, validate, calculate };
});
