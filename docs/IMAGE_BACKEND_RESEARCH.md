# 出图链路调研：codex exec 之外的两种做法

调研日期：2026-11-01。仅文档，不改代码。

参考对象：

- [LeemanCheung/dsh-image-gen](https://github.com/LeemanCheung/dsh-image-gen)（`627642a`，DeepSeek Harness 插件）
- [Jon-Vii/pi-imagegen](https://github.com/Jon-Vii/pi-imagegen)（`2ca6348`，Pi 插件 + 本地工作室）
- 交叉验证依据：[openai/codex](https://github.com/openai/codex) 源码，`rust-v0.164.0`（即 `deploy/install.sh` 固定的 `@openai/codex@0.164.0`）与 2026-10-31 的 `main`（`67f0994`）。

## 结论（TL;DR）

1. **我们设置的模型 / 强度 / 比例，在工具层面都没有生效。** Codex 0.164.0 的内置 `imagegen` 工具把模型写死为 `gpt-image-2`，`size`、`quality` 写死为 `auto`，工具参数里也没有这些字段。`IMAGE_REQUIREMENTS` 里的 “GPT-Image-2.5 Sunburst / effort max” 只能变成提示词文字。
2. **这段文字还会被塞进图像提示词本身**（我们明确要求 agent “Include this exact model and effort request in the prompt passed to the image-generation tool”），对每一张图都是噪声，甚至可能被画成字。
3. **每张图前面都多跑一轮 `gpt-6.1-sol` / `xhigh` 的 agent**，慢、耗额度，失败只能从 agent 日志里猜。
4. 两个参考项目都绕开了 agent，直接用订阅 OAuth 调 ChatGPT 后端：dsh 调 `codex/images/generations`，pi 调 `codex/responses` + 托管 `image_generation` 工具。两者都能把模型、尺寸作为真正的参数传过去。
5. 订阅端是否真的按请求返回 2.5 模型 / 指定尺寸，**目前只有 dsh 自己的一次实测**，需要用一个已登录的 ChatGPT 订阅做小规模探测才能定案（见文末）。

## 现状：codex-image-studio 怎么出图

`app.py:1388` 每个任务启动一次：

```
codex exec --json --ephemeral ... -m gpt-6.1-sol -c model_reasoning_effort="xhigh" --enable image_generation [-i reference-N.png ...] -
```

stdin 是 `DEFAULT_CALL_PROMPT`（`app.py:47-60`），其中：

- `IMAGE_REQUIREMENTS`：要求 Sunburst + effort max，“如果工具没有显式参数就写进提示词”；
- `Requested aspect ratio: {ratio}`：比例同样只是文字；
- 参考图通过 `-i` 作为对话图片附带，由 agent 自己决定怎么交给工具。

Codex 0.164.0 中实际发出的请求（`codex-rs/ext/image-generation/src/tool.rs`）：

```rust
const IMAGE_MODEL: &str = "gpt-image-2";   // :65
const MAX_EDIT_IMAGES: usize = 5;          // :66

struct ImagegenArgs {                      // :96，deny_unknown_fields
    prompt: String,
    transparent_background: bool,
    referenced_image_paths: Option<Vec<AbsolutePathBuf>>,  // ≤5
    num_last_images_to_include: Option<usize>,             // 1–5
}

// 生成与编辑两条分支都是：
model: IMAGE_MODEL, quality: Some(ImageQuality::Auto), size: Some("auto")
```

也就是说，无论 agent 多“听话”，发往后端的永远是 `gpt-image-2 / auto / auto`；唯一能显式控制的只有透明背景和参考图。

## 三种链路对比

| | codex-image-studio（现状） | dsh-image-gen | pi-imagegen |
|---|---|---|---|
| 路径 | `codex exec` → agent → `imagegen` 工具 | 直接 POST `chatgpt.com/backend-api/codex/images/generations` | 直接 POST `chatgpt.com/backend-api/codex/responses`，带托管 `image_generation` 工具 |
| 鉴权 | Codex CLI 登录文件 | 订阅 OAuth + `chatgpt-account-id` + `x-codex-image-turn-id` | 订阅 OAuth + `chatgpt-account-id`（从 JWT 解出） |
| 模型 / 尺寸 / 质量 | 不可控（写死） | 请求体字段 | 工具配置字段 |
| 额外 LLM 回合 | 有，`xhigh` | 无 | 有，但可 `reasoning` 关闭 / low |
| 参考图 / 编辑 | ≤5 张，经 agent | 仅 API Key 路径（`/images/edits` multipart） | `input_image`（data URL） |
| 渐进帧 | 无 | 仅 API Key 路径（SSE partial，≤3） | 未启用 |
| 失败信息 | 解析 agent 日志 | HTTP 状态 + 错误码，区分可重试 | HTTP 状态 / `response.failed` |

## 交叉验证

| 说法 | 来源 | 结论 |
|---|---|---|
| 订阅端存在 `codex/images/generations`，需要 `x-codex-image-turn-id` | dsh | ✅ Codex `backend.rs` 使用同一路径与同名 header（`X_CODEX_IMAGE_TURN_ID_HEADER`），并额外带 originator / turn metadata |
| 订阅端**没有**编辑接口，参考图只能走 API Key | dsh | ❌ 已过时。Codex 0.164.0 就在用 `codex/images/edits`，JSON 体 `{"images":[{"image_url":"data:..."}|{"file_id":...}],"prompt":...,"model":...}`，最多 5 张。我们现在的参考图其实已经经由它发出。**没有 `mask` 字段**，所以局部重绘仍需“裁切 → 编辑 → 回贴”的现有思路 |
| 订阅端接受 `gpt-image-2.5-flare` / `sunburst` 并回显模型 | dsh（2026-09-11 自测） | ⚠️ 无法从源码确认：Codex 自身从不发送这两个名字 |
| 订阅端不按字面执行 `size` / `quality`，自行决定（如 `high` → 1774×887） | dsh（同上） | ⚠️ 未验证；若属实，“比例”需要在服务端裁切或改用其他路径 |
| `codex/responses` + 托管 `image_generation` 工具可用，工具配置里的 `model` / `size` 生效 | pi | ⚠️ 合理（早期 Codex 即走托管工具），但订阅端是否尊重 `size`、是否支持 `partial_images` 未验证 |

## 对本项目的建议

### P0：出图改为直连（后端）

- 新建一个 `image_backend.py`：用 Codex CLI 已有的登录文件（`CODEX_HOME` 下，`cli_auth_credentials_store="file"`）取 token，直接调用 `images/generations` / `images/edits`。token 过期时可以继续让 `codex` 子进程刷新，或参照 dsh `src/codex.ts` 的刷新窗口逻辑（提前 5 分钟）。
- 模型、尺寸、质量、透明背景作为真实参数传递；删除 `IMAGE_REQUIREMENTS`，不要再把模型名写进图像提示词。
- “润色提示词”保留为可选的独立一步（仍可用 agent 或一次普通文本调用），与出图解耦。
- 安全边界照搬 dsh 的做法：固定第一方域名、`redirect` 视为错误、限制响应体大小、只对 429 / 5xx / 网络错误重试，审核拦截与用户输入错误立即失败。
- 保留 `codex exec` 作为回退开关，直到直连路径在线上稳定。

### P1：如实显示“请求 vs 实际”

- 任务记录同时保存 `requested_*` 与实际返回的 `model` / `size` / `quality`（以及 `generation_id`、响应头 `x-codex-imagegen-request-id`，和返回时的 `usage`）。
- 详情页显示实际值；若与请求不符（例如比例被忽略），明确提示，而不是暗示已按要求生成。

### P2：可借鉴的界面细节

- **再来一张 / 变体**（pi）：查看器里一键 Rerun（同参数重跑）、Vary（带原提示词进入编辑）。
- **批次分组**（pi）：同一批次的结果在作品页以组的形式并排对比。
- **草图作参考**（pi）：画布涂几笔直接当参考图，适合局部重绘。
- **显影动画**（dsh）：结果到达时由模糊到清晰的过渡，并支持 `prefers-reduced-motion`。与现有 demo 的思路一致，属于打磨项。

## 待验证（需要 ChatGPT 订阅）

建议写一个只打印状态码、返回的 model / size / quality / usage 的探测脚本（不打印任何凭据），共 4–6 次请求：

1. `images/generations`，`model: gpt-image-2`，显式 `size`（如 `1024x1536`）；
2. 同上，`model: gpt-image-2.5-sunburst`，`quality: high`；
3. `images/edits`，1 张参考图；
4. `responses` + 托管 `image_generation`，`size` 显式、`partial_images: 2`，观察是否有 partial 事件。

结果决定 P0 是“只省掉 agent 开销”，还是同时能真正提供 Sunburst 与指定比例。
