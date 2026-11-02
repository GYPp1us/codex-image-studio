# 直连数据流真实订阅实测

2026-11-02，在项目 LA 主机的私有临时目录中运行冻结的 `image_backend.py`，读取本项目原有订阅凭据；未启动生产任务或修改服务。只发出三个独立请求，不自动重试，不调用 CLI。合成图片提示词为 `A simple blue triangle on a plain white background, no text.`。

| 请求 | 耗时 | 结果 |
| --- | --- | --- |
| 独立文本润色，`gpt-6.1-sol` | 4.295 秒 | HTTP 200，73 字符正文，回显文本模型 `gpt-6.1-sol`；未配置生图工具 |
| 图片直连，`gpt-image-2` / `1024x1536` / `auto` / 2 partial | 18.490 秒 | HTTP 200 SSE，仅 keepalive 和最终完成事件，无 partial；实际 PNG 1536×1024，回显 `low` |
| Responses 托管图片工具，同样图片参数，派发模型 `gpt-6.1-sol` | 22.441 秒 | HTTP 200，收到两张不同的真实 partial 及最终 PNG；实际 1347×1167，回显 `low` |

Responses 的两张中间帧事件均为 `response.image_generation_call.partial_image`，索引分别为 0、1，在该请求开始后 12.891、16.841 秒完成解码并保存，早于最终结果。两张中间帧与最终图的像素尺寸均为 1347×1167。下载后复核哈希，并逐张查看；画面为白底蓝色三角形，中间帧与最终图有真实差异。并未把最终图的人工模糊版本当作显影。

| 保存的原始图片 | 字节 | SHA-256 |
| --- | ---: | --- |
| 图片直连最终图 | 990130 | `66a3a1a2177e96c92f6cc750607f9189817226e7d17b116515c38b9ba003c2f9` |
| Responses 中间帧 0 | 1008196 | `6e347b622557aadb5aefeeb31d17e0cf935f0a545d3d604c141b3e4919fe1b03` |
| Responses 中间帧 1 | 1006324 | `3b45a249e8f209fab72ecad94c74c950542d9dcbc0250888d4561190b2dbde4f` |
| Responses 最终图 | 1006978 | `889dd65e39ed2de1e0077f37da7b52ca3e3080de5e95a2a543c1a5938a896e52` |

四张图片都经过 Pillow `verify()` 和重新打开后的 `load()`，不是只读取文件头。三个请求的 turn ID、session ID 和 client request ID 均分别生成，报告只保留其哈希。脱敏机器记录见 [JSON](validation/direct-flow-live-20261102.json)，原图保留在本地测试缓存，不混入用户作品或生产数据库。

冻结适配器 SHA-256 为 `52e842a9d214d033e798cfdb7c62cfbe033605f43854bc1245452dddd1ffbb7b`，测试脚本 SHA-256 为 `f1dce41564fe5c24ad1a1dac1364bec0b88a224564aad33b98dbaa4f2df90e6b`。上传后与本地逐一核对；远端目录权限 700、源码和脚本 600。

本次验证了真实协议和事件到达，浏览器展示由隔离数据库、模拟事件及 API35 WebView 验收覆盖；这不是生产页面的端到端生图验收。没有新增参考图编辑实测，也未检验 `sunburst` / `max` 组合。两个通道都没有回显图片模型；Responses 回显的文本派发模型不代表图片模型。尺寸未按请求执行，`auto→low` 则是合法自动选择。不能据此保证订阅端的精确尺寸、底层模型或所有请求均有中间帧。
