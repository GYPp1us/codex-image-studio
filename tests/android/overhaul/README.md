# 隔离 Android WebView 验收

该测试在单独的 `site.arcol.imagestudio.qa` 包内加载本地拦截的合成 fixture。它检查亮/暗主题与浅/深自定义强调色的组件状态计算样式和文字对比，短横屏按钮命中、重绘旋转、IME，以及订阅、上传、名称保存和删除的并发反馈。网络写入由测试脚本替代，不调用真实账户或模型。截图和 API 35 的单次结果不代表全部设备和系统版本。

使用现成的测试签名目录，先在无模拟器运行时准备；脚本不会生成或复制签名材料：

```powershell
./tests/android/overhaul/run.ps1 -PrepareOnly -SigningDir C:/absolute/path/to/test-signing
```

记录输出的 `Prepared QA project` 绝对路径。启动已获授权的隔离设备并等待启动完成后，明确指定序列号运行：

```powershell
./tests/android/overhaul/run.ps1 -DeviceSerial emulator-5578 -PreparedProject C:/absolute/path/to/prepared-project
```

运行前再次核对准备时所有静态文件的 SHA-256 与当前源码一致；源码变更后必须重新准备。脚本不会清除测试应用数据，也不会启动或停止模拟器。代理启动的模拟器必须在主动使用结束后立即按记录的 PID、命令行、AVD 和端口优雅关闭并核实退出；不要操作其他人的设备。输出 `PASS` 表示本测试通过；主题明细可从设备 `logcat -s QA_MATRIX:I '*:S'` 查看。仅在用户授权且明确目标为隔离设备时运行。
