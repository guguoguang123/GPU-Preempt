# GPU-Preempt

用于 AutoDL 普通容器实例的 Chrome / Edge 浏览器扩展：指定实例和机器，在设定时间窗口内自动重试有卡开机。

## 功能

- 指定实例精确名称或完整 ID，同时核对机器号。
- 设置开始时间、结束时间和重试间隔，默认 5 秒。
- 明确缺卡后继续重试；开机中等待；确认运行后停止。
- 到期、限流、验证码或未知错误时停止。
- 保存设置，面板可收起；刷新页面后需手动重新开始。

## 安装

1. 点击仓库的 **Code → Download ZIP** 并解压，或者下载并解压 [扩展压缩包](GPU-Preempt-extension.zip)。
2. Chrome 地址栏输入 `chrome://extensions`；Edge 输入 `edge://extensions`。
3. 开启“开发者模式”，点击“加载已解压的扩展程序”。
4. 下载完整项目时，选择其中的 `extension` 目录；下载扩展压缩包时，选择解压后直接包含 `manifest.json` 的目录。
5. 打开或刷新 AutoDL 容器实例列表页面，右下角会出现面板。

不需要在开发者控制台粘贴脚本。若已运行旧版控制台脚本或油猴脚本，请先停止并禁用旧版，再刷新页面，避免重复运行。

## 使用

填写自己的实例和机器号（例如 `sim / 018机`），点击“检查目标”，核对日志。设置开始、结束时间后点击“开始等待”。时间使用电脑本机时区，同一时间只在一个标签页运行。

保持页面打开、电脑不休眠。后台节流、网络与网页响应会使实际间隔超过 5 秒；上一轮未返回结果时不会重复提交。截止时间只停止后续请求，已提交的请求仍可能完成。

**开机成功后平台正常计费。停止抢卡不会关闭实例。**

## 文件

| 路径 | 用途 |
| --- | --- |
| `extension/` | 可加载的 Manifest V3 扩展 |
| `GPU-Preempt-extension.zip` | 扩展安装压缩包 |
| `autodl_gpu_watch.user.js` | 油猴／控制台备用版本，与扩展二选一 |
| `autodl_gpu_watch.test.cjs` | 离线行为检查 |
| `AutoDL抢卡使用说明.md` | 详细说明 |

## 验证

安装 Node.js 后，在项目根目录运行：

```sh
node --check extension/content.js
node --check extension/background.js
node autodl_gpu_watch.test.cjs
```

已通过定时、停止条件、5 秒重试、限流优先级和扩展包一致性离线检查。测试不连接 AutoDL，也不代表对所有网页版本的兼容保证；网页结构或提示变化可能需要调整。

## 权限

扩展只匹配 `https://www.autodl.com/console/*`，仅申请保存设置所需的 `storage` 权限。不需要开发者 Token，不读取 Cookie，不向第三方上传数据。

本项目是非官方页面辅助工具，与 AutoDL 无隶属关系。

