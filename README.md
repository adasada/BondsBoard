# 债市日观

国债与国开债日度收益率监控页面，支持手机和桌面浏览器。行情由 GitHub Actions 定时采集后写入 `public/data/market.json`，页面从静态 JSON 读取，不需要浏览器跨域请求数据源。

## 本地预览

由于页面通过 JSON 文件读取行情，请从仓库目录启动本地 HTTP 服务：

```powershell
python -m http.server 8000
```

然后访问 `http://localhost:8000`。

## 数据与口径

- 数据源：中国货币网债券收盘收益率曲线，展示国债与政策性金融债（国开行）到期收益率
- 更新时间：GitHub Actions 计划于北京时间每日 20:00 执行；定时任务可能延迟，遇休市日则保留最近一个交易日
- 期限：3 个月、6 个月、1 年、2 年、3 年、5 年、7 年、10 年、15 年、20 年、30 年
- 变化量：收益率差值乘以 100，单位为基点（bp）
- 首次运行回填最近 90 个自然日；后续每日重刷最近 7 日，保留近 90 日有效交易日
- 脚本使用 Python 标准库，不读取密钥或写入账号凭据

页面展示行情仅供课程学习，不构成投资建议。中国货币网的数据产品使用、转载和公开展示条件请以上游官方规则及授权为准。部署前请确认适用于公开网页展示。

## GitHub Pages 与定时任务

免费 GitHub Pages 需要公开仓库。仓库需启用 GitHub Pages（Settings → Pages → Deploy from a branch → `main` / `/ (root)`），并允许 Actions 写仓库内容（Settings → Actions → General → Workflow permissions → Read and write permissions）。启用后访问仓库 Pages 页面提供的网址。

工作流位于 `.github/workflows/daily-update.yml`，每日北京时间 20:00 定时运行并可在 Actions 页面手动触发。它提交新生成的行情 JSON 到 `main` 分支，Pages 随后发布更新。提交仅在数据或检查状态发生变化时产生。定时任务可能延迟；GitHub 公开仓库长时间无活动时可能自动停用计划任务，需要回到 Actions 手动启用。

## 手动更新

```powershell
python scripts/update_market.py
```

若上游当天尚未发布数据，脚本会保留最近行情并更新检查状态；采集请求失败时退出非零，避免把错误内容覆盖到站点数据。
