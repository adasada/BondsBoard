(() => {
  'use strict';

  const STORAGE_KEY = 'bondsboard.appearance.v1';
  const PALETTES = {
    dawn: { page: '#f3f5fa', surface: '#ffffff', ink: '#202d43', muted: '#64748b', primary: '#4263a1', secondary: '#248a83', gold: '#a97b29', lilac: '#8772b5', dark: false },
    aurora: { page: '#0d1628', surface: '#18253d', ink: '#e5edfc', muted: '#a3b4ce', primary: '#94b5ff', secondary: '#61dac4', gold: '#e8bd73', lilac: '#b9a1ef', dark: true },
    garden: { page: '#edf5ef', surface: '#fbfef9', ink: '#203f35', muted: '#5a7869', primary: '#387558', secondary: '#397e9d', gold: '#a57b2b', lilac: '#8b71ad', dark: false },
    sunset: { page: '#f9eee2', surface: '#fffaf2', ink: '#553c35', muted: '#8b6c5e', primary: '#ae5140', secondary: '#487d7b', gold: '#a17a28', lilac: '#9b7096', dark: false },
    terminal: { page: '#101915', surface: '#18241e', ink: '#dcebe1', muted: '#9eb8a6', primary: '#8bddad', secondary: '#82c5e4', gold: '#e0c27d', lilac: '#c3a6e5', dark: true },
  };
  const PRESETS = [
    { id: 'dawn', name: '晨间纸白', tag: '安静，亦有层次', glyph: '◒', controls: 'soft', background: 'aurora', motion: 'all', entrance: 'cascade', refresh: 'glow', chartMotion: 'draw', ambient: 'drift', font: 'sans', radius: 16 },
    { id: 'aurora', name: '极光夜航', tag: '玻璃与流动的光', glyph: '✦', controls: 'glass', background: 'contours', motion: 'all', entrance: 'rise', refresh: 'pulse', chartMotion: 'fade', ambient: 'drift', font: 'sans', radius: 22 },
    { id: 'garden', name: '薄荷花园', tag: '让数字轻轻呼吸', glyph: '❋', controls: 'soft', background: 'contours', motion: 'all', entrance: 'cascade', refresh: 'pulse', chartMotion: 'dots', ambient: 'drift', font: 'sans', radius: 24 },
    { id: 'sunset', name: '落日手账', tag: '纸张、细线与暖意', glyph: '◴', controls: 'outline', background: 'plain', motion: 'all', entrance: 'zoom', refresh: 'flip', chartMotion: 'draw', ambient: 'off', font: 'serif', radius: 8 },
    { id: 'terminal', name: '绿洲终端', tag: '坐标里的市场脉搏', glyph: '⌘', controls: 'terminal', background: 'grid', motion: 'all', entrance: 'rise', refresh: 'glow', chartMotion: 'dots', ambient: 'scan', font: 'mono', radius: 3 },
  ];
  const OPTIONS = { palette: Object.keys(PALETTES), controls: ['soft', 'glass', 'outline', 'terminal'], background: ['plain', 'aurora', 'grid', 'contours'], motion: ['all', 'off'], entrance: ['rise', 'cascade', 'zoom', 'off'], refresh: ['glow', 'pulse', 'flip', 'off'], chartMotion: ['draw', 'fade', 'dots', 'off'], ambient: ['drift', 'scan', 'off'], font: ['sans', 'serif', 'mono'], density: ['comfortable', 'compact'] };
  const fromPreset = (preset) => ({ palette: preset.id, controls: preset.controls, background: preset.background, motion: preset.motion, entrance: preset.entrance, refresh: preset.refresh, chartMotion: preset.chartMotion, ambient: preset.ambient, font: preset.font, radius: preset.radius, motionSpeed: 1, density: 'comfortable', colors: {} });
  const defaults = () => fromPreset(PRESETS[0]);
  const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const isColor = (value) => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);

  function validate(value) {
    if (!isObject(value)) throw new Error('配置应为 JSON 对象');
    const result = defaults();
    for (const [key, allowed] of Object.entries(OPTIONS)) {
      const legacyMotion = key === 'motion' && ['reveal', 'float', 'scan'].includes(value[key]) ? 'all' : value[key];
      if (legacyMotion !== undefined && !allowed.includes(legacyMotion)) throw new Error(`不支持的配置项：${key}`);
      if (legacyMotion !== undefined) result[key] = legacyMotion;
    }
    if (value.radius !== undefined) {
      if (!Number.isInteger(value.radius) || value.radius < 0 || value.radius > 28) throw new Error('圆角应为 0 到 28 的整数');
      result.radius = value.radius;
    }
    if (value.motionSpeed !== undefined) {
      if (typeof value.motionSpeed !== 'number' || value.motionSpeed < .5 || value.motionSpeed > 2 || Math.round(value.motionSpeed * 10) !== value.motionSpeed * 10) throw new Error('动画速度应为 0.5 到 2.0 的 0.1 倍整数步进');
      result.motionSpeed = value.motionSpeed;
    }
    if (value.colors !== undefined) {
      if (!isObject(value.colors)) throw new Error('自定义颜色格式错误');
      for (const key of ['primary', 'secondary', 'page']) {
        if (value.colors[key] === undefined) continue;
        if (!isColor(value.colors[key])) throw new Error('颜色应为六位十六进制值');
        result.colors[key] = value.colors[key];
      }
    }
    return result;
  }

  let config = defaults();
  let saved = [];
  let storageAvailable = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const stored = JSON.parse(raw);
      if (stored.version !== 1) throw new Error('配置版本不支持');
      config = validate(stored.config);
      if (Array.isArray(stored.saved)) saved = stored.saved.slice(0, 12).flatMap((entry) => {
        try { return [{ name: String(entry.name).slice(0, 24), config: validate(entry.config) }]; } catch { return []; }
      });
    }
  } catch { storageAvailable = false; }

  const root = document.documentElement;
  const hexRgb = (hex) => hex.slice(1).match(/../g).map((part) => parseInt(part, 16));
  const luminance = (hex) => hexRgb(hex).map((v) => v / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  const contrastInk = (hex) => luminance(hex) > .179 ? '#142334' : '#ffffff';

  function apply() {
    const palette = PALETTES[config.palette];
    const colors = { ...palette, ...config.colors };
    for (const key of Object.keys(OPTIONS)) root.dataset[key] = config[key];
    root.dataset.mode = palette.dark ? 'dark' : 'light';
    for (const key of ['page', 'surface', 'ink', 'muted', 'gold', 'lilac']) root.style.setProperty(`--${key}`, colors[key]);
    root.style.setProperty('--navy', colors.primary);
    root.style.setProperty('--teal', colors.secondary);
    root.style.setProperty('--accent-rgb', hexRgb(colors.primary).join(', '));
    root.style.setProperty('--secondary-rgb', hexRgb(colors.secondary).join(', '));
    root.style.setProperty('--surface-rgb', hexRgb(colors.surface).join(', '));
    root.style.setProperty('--on-accent', contrastInk(colors.primary));
    // Custom page colors keep the header readable without changing card colors.
    const pageDark = luminance(colors.page) < .179;
    root.style.setProperty('--page-ink', pageDark ? '#e5edfc' : '#202d43');
    root.style.setProperty('--page-muted', pageDark ? '#aabbd3' : '#5b6b80');
    root.style.setProperty('--radius', `${config.radius}px`);
    root.style.setProperty('--motion-scale', config.motionSpeed);
    root.style.setProperty('--motion-duration', `${.55 * config.motionSpeed}s`);
    root.style.setProperty('--motion-long', `${.95 * config.motionSpeed}s`);
    root.style.setProperty('--ambient-duration', `${15 * config.motionSpeed}s`);
    root.style.colorScheme = palette.dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', colors.page);
  }
  apply();

  window.addEventListener('bondsboard:data-refresh', (event) => {
    const body = document.body;
    if (!body) return;
    body.dataset.updateState = !event.detail.ok ? 'error' : event.detail.initial ? 'initial' : event.detail.changed ? 'changed' : 'checked';
    body.classList.remove('data-cycle');
    void body.offsetWidth;
    body.classList.add('data-cycle');
    window.clearTimeout(body.dataCycleTimeout);
    body.dataCycleTimeout = window.setTimeout(() => body.classList.remove('data-cycle'), 1800 * config.motionSpeed);
  });

  document.addEventListener('DOMContentLoaded', () => {
    const $ = (id) => document.getElementById(id);
    const dialog = $('skin-dialog');
    const feedback = (message) => { $('skin-feedback').textContent = message; };

    function persist() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, config, saved }));
        storageAvailable = true;
      } catch { storageAvailable = false; }
      feedback(storageAvailable ? '已自动保存，下次打开仍然生效' : '当前调整已生效；浏览器无法保存，请导出备份');
    }

    function syncControls() {
      for (const key of Object.keys(OPTIONS)) $(`skin-${key}`).value = config[key];
      $('skin-radius').value = config.radius;
      $('skin-radius-value').textContent = `${config.radius} px`;
      $('skin-motionSpeed').value = config.motionSpeed;
      $('skin-motionSpeed-value').textContent = `${config.motionSpeed.toFixed(1)}×`;
      for (const key of ['primary', 'secondary', 'page']) $(`skin-${key}`).value = config.colors[key] || PALETTES[config.palette][key];
      let activeName = '自定义搭配';
      document.querySelectorAll('[data-preset]').forEach((button) => {
        const active = JSON.stringify(config) === JSON.stringify(fromPreset(PRESETS.find((preset) => preset.id === button.dataset.preset)));
        button.setAttribute('aria-pressed', String(active));
        if (active) activeName = PRESETS.find((preset) => preset.id === button.dataset.preset).name;
      });
      $('skin-current').textContent = activeName;
    }

    function update() {
      apply();
      syncControls();
      persist();
    }

    for (const preset of PRESETS) {
      const palette = PALETTES[preset.id];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'skin-preset';
      button.dataset.preset = preset.id;
      button.style.setProperty('--preview-page', palette.page);
      button.style.setProperty('--preview-surface', palette.surface);
      button.style.setProperty('--preview-color', palette.primary);
      button.style.setProperty('--preview-secondary', palette.secondary);
      button.innerHTML = `<span class="preset-preview" aria-hidden="true"><span class="preset-orbit">${preset.glyph}</span><span class="preset-mini"><i></i><i></i><i></i><svg viewBox="0 0 100 30"><path d="M0 24 15 18 30 22 48 8 65 12 82 4 100 8"/></svg></span></span><strong>${preset.name}</strong><small>${preset.tag}</small><span class="preset-check" aria-hidden="true">✓</span>`;
      button.addEventListener('click', () => { config = fromPreset(preset); update(); });
      $('skin-presets').append(button);
    }

    document.querySelectorAll('[data-skin-field]').forEach((input) => input.addEventListener('input', () => {
      const key = input.dataset.skinField;
      config[key] = ['radius', 'motionSpeed'].includes(key) ? Number(input.value) : input.value;
      update();
    }));
    document.querySelectorAll('[data-skin-color]').forEach((input) => input.addEventListener('input', () => {
      config.colors[input.dataset.skinColor] = input.value;
      update();
    }));

    function renderSaved() {
      $('skin-saved').replaceChildren();
      if (!saved.length) {
        const empty = document.createElement('p');
        empty.className = 'skin-hint';
        empty.textContent = '喜欢的配色与效果，存成一套，随时切换。';
        $('skin-saved').append(empty);
      }
      saved.forEach((entry, index) => {
        const row = document.createElement('div');
        row.className = 'saved-look';
        const use = document.createElement('button');
        use.type = 'button';
        use.className = 'saved-use';
        use.textContent = entry.name;
        const swatch = document.createElement('i');
        swatch.style.background = entry.config.colors.primary || PALETTES[entry.config.palette].primary;
        use.prepend(swatch);
        use.addEventListener('click', () => { config = validate(entry.config); update(); feedback(`已应用「${entry.name}」`); });
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'saved-remove';
        remove.textContent = '×';
        remove.setAttribute('aria-label', `删除搭配 ${entry.name}`);
        remove.addEventListener('click', () => {
          saved.splice(index, 1); persist(); renderSaved();
          ($('skin-saved').querySelector('.saved-remove') || $('skin-name')).focus();
        });
        row.append(use, remove);
        $('skin-saved').append(row);
      });
    }

    $('skin-save-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const name = $('skin-name').value.trim();
      if (!name) { feedback('请为搭配填写名称'); return; }
      if (saved.length >= 12) { feedback('最多收藏 12 套搭配，请先删除一套'); return; }
      saved.push({ name, config: validate(config) });
      $('skin-name').value = '';
      persist(); renderSaved();
      if (storageAvailable) feedback(`已收藏「${name}」`);
    });

    $('skin-open').addEventListener('click', () => dialog.showModal());
    $('skin-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (event) => {
      const rect = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
    });
    dialog.addEventListener('close', () => $('skin-open').focus());
    $('skin-reset').addEventListener('click', () => { config = defaults(); update(); feedback(storageAvailable ? '已恢复晨间纸白，收藏的搭配仍然保留' : '已恢复默认；浏览器无法保存，请导出备份'); });
    $('skin-export').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify({ version: 1, config }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'bondsboard-appearance.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      feedback('已导出当前搭配，可在其他浏览器导入');
    });
    $('skin-import').addEventListener('click', () => $('skin-import-file').click());
    $('skin-import-file').addEventListener('change', async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      try {
        if (file.size > 32768) throw new Error('文件超过 32 KB');
        const imported = JSON.parse(await file.text());
        if (!isObject(imported) || imported.version !== 1) throw new Error('请选择本工具导出的版本 1 配置');
        const next = validate(imported.config);
        config = next;
        update();
        if (storageAvailable) feedback('已导入搭配并自动保存');
      } catch (error) { feedback(`导入失败：${error.message}。原搭配保留。`); }
      event.target.value = '';
    });
    syncControls();
    renderSaved();
    if (!storageAvailable) feedback('未能读取本地配置，已使用默认外观；可导入备份');
  });
})();
