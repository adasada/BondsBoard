# 债市日观

国债与国开债日度收益率监控页面，支持手机和桌面浏览器。页面从 `public/data/market.json` 读取行情，采集脚本负责更新这个文件，GitHub Actions 负责在云端定时运行采集脚本。

## 1. 使用前准备

- 本地使用：Python 3.10 或以上版本，以及 Chrome、Edge 等现代浏览器；工作流使用 Python 3.12。
- 手动采集：需要联网访问中国货币网；已有行情文件时，可以断网查看本地页面。
- GitHub 部署：需要仓库管理权限；本地同步代码时还需安装 Git。
- 项目使用 Python 标准库与原生 HTML/CSS/JavaScript，无须安装 npm 或 pip 依赖，也没有构建步骤。

本文命令使用 Windows PowerShell，项目路径为 `D:\SourcesV2\BondsBoard`。先检查 Python：

```powershell
Set-Location -LiteralPath 'D:\SourcesV2\BondsBoard'
python --version
```

如果系统只提供 `py` 命令，可以将后文的 `python` 替换为 `py -3`，并确认版本符合要求。

## 2. 本地启动、访问、停止与重启

### 启动

在 PowerShell 中运行：

```powershell
Set-Location -LiteralPath 'D:\SourcesV2\BondsBoard'
python -m http.server 8000 --bind 127.0.0.1
```

出现 `Serving HTTP on ... port 8000` 后，在浏览器打开 [本地网页](http://127.0.0.1:8000/)。服务在前台持续运行，终端暂时不能输入其他命令属于正常现象；需要执行其他操作时另开一个 PowerShell 窗口。

请通过 HTTP 地址访问，直接双击 `index.html` 可能因浏览器限制而无法加载行情 JSON。本命令仅允许本机访问。

### 正常停止

1. 回到运行 `http.server` 的 PowerShell 窗口。
2. 按 **Ctrl+C**。
3. 等待出现 `Keyboard interrupt received, exiting.` 或返回 PowerShell 提示符，服务即已停止。

关闭浏览器标签页不会停止服务。停止后，已打开的页面可能仍显示旧内容，但重新加载和获取行情将失败。需要确认端口是否已释放时，在 PowerShell 中运行：

```powershell
Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue |
    Select-Object LocalAddress, LocalPort, OwningProcess
```

没有输出表示当前没有进程监听该端口。如果之前使用的是 `8765` 或其他端口，请把命令中的 `8000` 替换为实际端口。

### 找不到原来的终端时停止

先用上面的查询命令查看 `OwningProcess`。假设它显示 `12345`，继续检查对应进程；以下示例中的 `12345` 必须替换为查询到的实际进程号：

```powershell
Get-CimInstance Win32_Process -Filter 'ProcessId = 12345' |
    Select-Object ProcessId, Name, CommandLine
```

核对它确实是本项目启动的 Python HTTP 服务、命令行中的端口也一致，再停止该进程：

```powershell
Stop-Process -Id 12345
```

随后重新查询端口，确认没有监听。请逐个核对进程，不要批量结束所有 Python 进程，以免中断其他程序。

### 重启与端口冲突

重启就是先停止，再重新执行启动命令。如果启动时报 `WinError 10048` 或“地址已在使用”，说明该端口被占用，可以核对并停止旧服务，也可以换用新端口：

```powershell
python -m http.server 8001 --bind 127.0.0.1
```

此时访问 [8001 端口网页](http://127.0.0.1:8001/)，后续停止和端口查询也使用 `8001`。

## 3. 页面如何使用

| 区域 | 使用方式与含义 |
| --- | --- |
| 行情日期 | 代表数据对应的交易日期，不等于打开页面的日期 |
| 关键指标 | 查看 10 年国债、10 年国开债、两者利差及国债 10Y−1Y 期限利差 |
| 收益率曲线 | 对比国债、国开债及上一有效交易日的曲线 |
| 历史走势 | 下拉选择国债、国开债或利差；切换 7、30、90 天区间 |
| 关键期限明细 | 切换国债或国开债，查看各期限收益率、日变化及前一交易日数值 |
| 每日简报 | 根据已有收盘曲线变化自动整理文字说明 |
| 刷新按钮 | 重新读取网站上的行情 JSON；不会启动 Python 采集脚本 |
| 最近检查 | 表示采集脚本最近一次检查时间，与行情日期分别展示 |

页面打开后每 10 分钟重新读取一次行情 JSON。历史区间按最新行情日期向前计算自然日，只绘制文件中存在的交易日数据；选择“90 天”不代表一定有 90 个交易日。

## 4. 本地手动更新行情

保持网页服务运行，**另开一个 PowerShell 窗口**，执行：

```powershell
Set-Location -LiteralPath 'D:\SourcesV2\BondsBoard'
python scripts/update_market.py
$LASTEXITCODE
```

脚本执行一次后会自行退出。紧接着查看的退出码为 `0` 表示采集完成，非 `0` 表示失败；请求有超时和重试，执行中可能需要等待。需要中途取消时，在该采集窗口按 **Ctrl+C**。

成功后，`public/data/market.json` 会更新，点击网页的刷新按钮即可查看，无须重启 HTTP 服务。服务器启动本身不会采集行情，浏览器的刷新按钮也只读取现有文件。

若当天尚未发布行情，脚本会保留最近交易日数据，并更新检查时间与状态。采集失败时通常会保留历史行情、写入错误状态并以非零退出；如果原 JSON 已损坏或文件无法读写，可能直接报错退出，需要先修复文件或权限。

可以检查当前文件状态：

```powershell
Get-Content -LiteralPath '.\public\data\market.json' -Raw -Encoding UTF8 |
    ConvertFrom-Json |
    Select-Object status, latestDate, checkedAt, lastError
```

| 页面状态 | 含义与处理 |
| --- | --- |
| 已更新 | 本次采集已取得当天行情 |
| 最近交易日 / 暂无新行情 | 最近行情日期早于检查日期；周末、节假日或上游尚未发布时可能正常出现 |
| 更新异常 | 本次采集失败，检查终端输出或 Actions 日志，以及 JSON 的 `lastError` |
| 暂无数据 | 尚未取得有效行情，检查采集是否完成及文件内容 |

**本地服务不会每天自动执行采集，也不会自动拉取 GitHub 的提交。** 本地可以手动执行脚本；云端每日采集按下一节配置。

## 5. GitHub 云端定时采集与网页发布

### 启用每日采集

1. 将项目上传至 GitHub，确保默认分支为 `main`，且包含 `.github/workflows/daily-update.yml`。当前工作流固定检出并推送 `main`。
2. 在仓库 **Settings → Actions → General** 中允许工作流运行，并在 **Workflow permissions** 中允许 **Read and write permissions**。组织策略、分支保护也需要允许机器人写入行情文件。
3. 打开 **Actions → Daily bond curve update**；如出现启用提示，先启用工作流。
4. 点击 **Run workflow**，选择 `main` 并运行一次。等待完成，检查日志及 `public/data/market.json` 的 `checkedAt`、`latestDate` 和 `status`。

工作流计划于 **北京时间每天 20:00（UTC 12:00）** 采集，运行后将行情或检查状态提交到远端 `main`。电脑关机不影响 GitHub 云端任务。计划时间不是准点保证，需以实际运行记录为准。

工作流失败时也会尝试提交脚本生成的错误状态，最后将本次运行标记为失败；因此“出现机器人提交”不能单独证明采集成功，应同时检查运行结果和数据状态。

### 初次发布 GitHub Pages

在支持 GitHub Pages 的仓库中，进入 **Settings → Pages → Build and deployment**，选择 **Deploy from a branch → main → / (root)** 并保存。免费账户可使用公开仓库；私有仓库是否支持取决于账户计划。发布完成后，访问 Pages 设置页给出的站点地址。

**当前自动发布限制：** 本仓库的每日工作流使用 `GITHUB_TOKEN` 推送数据，没有显式部署 Pages 的步骤。该令牌产生的提交不会触发按分支发布的 Pages 构建，因此每日采集成功后，线上网页仍可能停留在旧版本。要实现完整的每日自动上线，需要补充显式的 Pages 部署工作流；仅按以上设置启用分支发布还不足以完成这个闭环。参见 [GitHub Pages 发布来源说明](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)。

### 停止、恢复与检查云端任务

| 操作 | GitHub 中的入口 | 效果 |
| --- | --- | --- |
| 停止后续采集 | Actions → Daily bond curve update → 右上角 `…` → Disable workflow | 禁用工作流的后续触发；已有运行不会因此取消 |
| 取消正在执行的采集 | 打开对应运行记录 → Cancel workflow | 取消这一次运行；不影响以后计划触发，已提交的数据也不会自动回退 |
| 恢复采集 | Actions → Daily bond curve update → Enable workflow | 恢复工作流；可再点 Run workflow 验证 |
| 查看结果与错误 | 打开运行记录及各步骤日志 | 核对采集、提交是否成功，定位失败原因 |
| 下线网页 | Settings → Pages → Unpublish site | 下线已发布站点；如需同时停止采集，还要禁用上述工作流 |

`Unpublish site` 位于 Pages 设置中站点地址旁的 `…` 菜单。它移除当前部署，后续新的 Pages 部署仍可让站点重新上线。需要恢复时，按当前分支发布方式重新确认发布来源，再由有权限的用户向发布分支提交并推送正常变更，等待部署完成。参见 [GitHub Pages 下线与恢复说明](https://docs.github.com/en/pages/getting-started-with-github-pages/unpublishing-a-github-pages-site)。

公开仓库连续 60 天没有仓库活动时，GitHub 会自动禁用计划任务；Fork 的公开仓库计划任务默认也可能未启用。遇到长期未运行时先检查工作流状态。禁用与恢复规则参见 [GitHub 工作流启停说明](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows)。

### 把云端更新同步到本地

如果使用 GitHub 定时采集，远端 JSON 的变化不会自动出现在本机目录中。确认本地修改已保存或妥善提交后，可同步：

```powershell
Set-Location -LiteralPath 'D:\SourcesV2\BondsBoard'
git status
git pull --ff-only origin main
```

随后刷新本地页面。如果 Git 提示本地修改冲突或不能快进，先处理本地与远端差异，不要直接覆盖本地行情文件或丢弃修改。

## 6. 手机在同一局域网访问

如果只在本机查看，使用第 2 节的启动命令即可。需要手机访问时，先停止原服务，再在服务终端运行：

```powershell
Set-Location -LiteralPath 'D:\SourcesV2\BondsBoard'
python -m http.server 8000 --bind 0.0.0.0
```

另开一个 PowerShell 窗口，查看电脑当前网卡的 IPv4 地址：

```powershell
ipconfig
```

例如电脑地址为 `192.168.1.10`，手机连接同一局域网后访问 `http://192.168.1.10:8000/`。如果防火墙拦截，按需允许 Python 在可信的专用网络中通信。

该方式会开放当前项目目录的静态文件浏览，仅用于可信局域网预览；不要将 Python 开发服务器直接暴露到公网。停止方式仍是在服务终端按 **Ctrl+C**。

## 7. 常见问题

| 现象 | 排查与处理 |
| --- | --- |
| `python` 无法识别，或版本过旧 | 安装符合要求的 Python 并重新打开终端，或检查 `py -3 --version` |
| 启动后显示目录列表或 404 | 确认当前目录为 `D:\SourcesV2\BondsBoard`，其中存在 `index.html` 与 `public/data/market.json` |
| 页面无法访问 | 核对地址与实际端口，检查服务终端是否仍在运行；局域网访问还需检查网卡地址和防火墙 |
| 停止后页面还有内容 | 浏览器保留了已渲染内容；以端口监听检查结果为准 |
| 数据一直没变 | 对比行情日期与检查时间，检查采集日志；本地确认是否运行脚本或拉取了远端数据，线上确认是否完成发布 |
| 点击刷新没有采集新行情 | 刷新只读取 JSON，本地另开终端运行采集脚本，云端使用 Run workflow |
| 采集失败、超时或返回异常内容 | 检查网络与上游可用性、终端错误或 `lastError`；稍后重试，不要把错误页面手动保存成行情文件 |
| Actions 提交时报 403 或 push 被拒绝 | 检查工作流写权限、组织策略和 `main` 分支保护；当前流程需要允许提交数据 |
| 云端已更新但本地没变 | 执行 Git 同步，或在本机独立采集，再刷新页面 |
| 云端 JSON 已更新但 Pages 没变 | 检查是否存在成功的 Pages 发布记录，并注意第 5 节的自动发布限制 |
| 长期停更后历史中间缺了一段 | 日常采集只重刷近 7 个自然日，无法自动补齐更早的缺口；按下一节重新回填 |

### 备份、恢复与重新回填

在手动调整行情文件前先备份，备份文件放在系统临时目录，避免被静态网站一同公开：

```powershell
$marketBackupPath = Join-Path $env:TEMP ('BondsBoard-market-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')
Copy-Item -LiteralPath 'D:\SourcesV2\BondsBoard\public\data\market.json' -Destination $marketBackupPath
$marketBackupPath
```

记下输出的备份路径。需要恢复时，在同一 PowerShell 会话中运行以下命令；如果已换窗口，先把 `$marketBackupPath` 设为之前记录的完整备份路径。恢复会覆盖当前行情文件，完成后刷新网页，还原的是备份时的数据。

```powershell
Copy-Item -LiteralPath $marketBackupPath -Destination 'D:\SourcesV2\BondsBoard\public\data\market.json'
```

如果需要补齐近 90 个自然日的数据，在备份后将行情 JSON 中的 `bootstrapComplete` 改为 `false`，保存，再运行 `python scripts/update_market.py`。脚本会重新回填该窗口并在成功后自动标记为 `true`。此操作会覆盖窗口内的行情值，且不能恢复 90 天窗口之前的数据。

## 8. 数据口径与项目文件

- 数据源：[中国货币网债券收盘收益率曲线](https://www.chinamoney.com.cn/chinese/bkcurvclosedy/)，展示国债与政策性金融债（国开行）到期收益率；不是盘中实时成交行情或单只债券报价。
- 期限：3 个月、6 个月、1 年、2 年、3 年、5 年、7 年、10 年、15 年、20 年、30 年。
- 收益率单位为 `%`；变化量为收益率数值之差乘以 100，单位为基点 `bp`。例如 2.00% 升至 2.01% 是上升 1 bp。
- 日变化与上一条有效交易日记录比较；休市日不人为生成行情。
- 首次采集回填最近 90 个自然日，之后每次重刷最近 7 个自然日，保留最近 90 个自然日窗口内的有效交易日记录。
- 采集脚本使用 Python 标准库，不需要数据源账号或 API 密钥。

| 文件 | 用途 |
| --- | --- |
| `index.html` | 页面结构 |
| `styles.css` | 桌面与手机样式 |
| `app.js` | 读取数据、绘图、切换指标与刷新 |
| `public/data/market.json` | 网页读取的行情、历史数据及检查状态 |
| `scripts/update_market.py` | 单次采集、校验、合并与保存 |
| `.github/workflows/daily-update.yml` | GitHub 云端每日采集和提交配置 |

## 9. 结束使用时的操作

| 使用场景 | 结束操作 |
| --- | --- |
| 本地预览结束 | 在 HTTP 服务终端按 Ctrl+C，必要时确认端口已释放 |
| 本地采集结束 | 正常执行完成会自动退出；中途停止则在采集终端按 Ctrl+C |
| 暂停云端每日采集 | Disable workflow；如有正在运行的任务，再单独 Cancel workflow |
| 线上网页下线 | 在 Pages 设置中 Unpublish site，并按需要停止云端采集 |

这几种运行方式各自独立：停止本地服务不会停止 GitHub 定时任务或下线 Pages；停止采集后网页仍可展示最后一次已发布的行情。

页面展示行情仅供课程学习，不构成投资建议。中国货币网数据的使用、转载和公开展示应遵循上游官方规则及授权；公开部署前请确认相应使用条件。
