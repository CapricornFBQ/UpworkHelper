# UpworkHelper Long-Term Implementation Plan

本文档作为后续实施依据。目标不是把插件做成 Upwork 自动化工具，而是做成一个本地、手动触发、长期积累的 Upwork 决策系统。

## 0. 当前基线

当前版本已经具备：

- Chrome MV3 插件骨架。
- Options 保存 OpenAI API Key、提取模型、评分模型。
- Popup 手动触发当前页 DOM 采集。
- Side Panel 展示 Opportunity、Snapshots、Notes、Score。
- 本地 `chrome.storage.local` 保存 settings 和 opportunities。
- OpenAI Responses API 两阶段处理：字段提取和 100 分评分。
- 不做自动刷新、自动翻页、自动打开页面、自动提交 proposal。

当前已确认的基线差异和需要修正的歧义：

- 代码中新建 Opportunity 的状态是 `draft`；长期状态模型已收敛为 `draft` legacy alias、`captured`、`scored`、`archived`。v0.2 必须明确迁移和读取兼容规则。
- 当前 capture 只判断当前页是否是普通 `http(s)` 页面；非 Upwork 页面也可能被用户手动采集。严格模式下必须只允许 `hostname === "www.upwork.com"`，不能用字符串包含判断。
- 当前 Side Panel capture 会优先把页面追加到用户选中的 Opportunity；如果当前页 jobKey 和已选 Opportunity 的 jobKey 不一致，必须阻止或要求用户确认，避免把不同岗位的 snapshot 混进同一机会。
- 当前 `score:opportunity` 会自动执行字段提取和评分，尚未给用户确认 AI 字段的机会。后续必须拆分提取、人工确认、评分三个步骤。
- 当前 `extractedProfile` 是 flat JSON，没有字段级来源、confidence、evidence、selectorId、snapshotId。后续不能直接在 flat 结构上继续叠加人工修正。
- 早期长期计划只列出数据类型名；本文后续已补 canonical contract、schema version、迁移、导入导出和验证规则。后续实现必须以这些补齐后的章节为准。
- 当前风险边界是原则描述，后续每个版本都必须有可执行的静态检查和人工验证清单。

当前主要代码：

- `manifest.json`
- `src/background/background.js`
- `src/popup/popup.html`
- `src/popup/popup.js`
- `src/options/options.html`
- `src/options/options.js`
- `src/sidepanel/sidepanel.html`
- `src/sidepanel/sidepanel.js`
- `src/styles.css`

## 1. 长期需要达到的目标

长期目标是形成一个个人 Upwork 决策数据库和执行工具，覆盖从岗位发现、信息采集、评分、proposal 生成、投标记录、结果追踪到长期复盘的完整闭环。

### 目标 1：可靠的信息提取和人工校正

插件必须能从用户手动采集的页面 DOM 中提取岗位、客户、预算、竞争状态等字段，并允许用户人工修正。AI 提取结果不能被默认视为事实。

### 目标 2：建立 My Profile / Portfolio

保存用户自己的能力、案例、报价、偏好和拒绝条件。它用于判断真实匹配度、推荐相关案例、生成更精准的 proposal。

### 目标 3：生成可编辑 Proposal Draft

基于 Opportunity、评分结果、My Profile、Portfolio Cases 生成 proposal 草稿。插件只生成草稿，不自动填写或提交 Upwork proposal。

### 目标 4：追踪投标结果

记录每一次机会是否投标、connects 成本、报价、是否被 viewed、是否回复、是否 interview、是否 hired、是否 lost。第一阶段全部手动记录，后续仅允许用户手动打开相关页面后点击采集更新。

### 目标 5：跨 Opportunity 的长期客户记录

对同一个雇主形成 ClientRecord。如果以后再次遇到同一个客户，插件能提示历史记录、之前评分、投标结果和风险备注。

### 目标 6：长期 Analytics 和评分校准

基于历史机会和结果统计回复率、面试率、成交率、不同分数段表现、不同技能方向表现、不同 proposal 模板表现，并反向校准评分规则。

### 目标 7：页面元素点选修正

当 Upwork DOM 变化或 AI 提取不稳时，允许用户手动点选页面元素并绑定到字段，比如 budget、proposal count、client spend。

### 目标 8：保持低自动化风险边界

所有数据采集都必须由用户手动触发。禁止自动刷新、自动翻页、自动打开岗位、后台监控、自动填写 proposal、自动提交 proposal、auto-apply。

## 2. 每一个目标的具体实现计划

### 2.0 跨目标工程规格

这些约束优先级高于单个功能点。任何版本实现前，都必须先满足这些规格，否则长期数据会变得不可迁移、不可解释。

#### 2.0.1 状态模型

不要把 Opportunity 的生命周期和投标结果混成一个字段。

建议拆成两个状态维度：

```js
opportunity.status = "draft" | "captured" | "scored" | "archived"
outcome.status = "not_applied" | "skipped" | "applied" | "viewed" | "replied" | "interviewing" | "hired" | "lost"
```

兼容规则：

- 旧数据中的 `draft` 必须继续可读。
- 如果后续迁移到 `captured`，必须提供一次性 migration。
- Proposal Draft 的状态不要复用 `draft`，应使用 `proposalDraft.status`。

#### 2.0.2 数据模型契约

每个长期存储模型都必须定义字段 contract，不只写类型名。

每个模型至少包含：

```js
{
  id,
  schemaVersion,
  createdAt,
  updatedAt
}
```

AI 或 prompt 生成的长期结果还必须包含：

```js
{
  model,
  promptVersion,
  scoreVersion, // 仅评分相关结果必填；其他结果写 null 或 "not_applicable"
  inputSnapshotIds,
  inputProfileVersion
}
```

必须新增 `uosc_meta` 保存全局 schema version 和 migration 状态。

#### 2.0.3 字段级 Profile 模型

`ExtractedProfile`、`UserCorrectedProfile`、selector 结果必须合并到统一字段对象，避免 silent overwrite。

字段结构必须支持多来源，单个 `source` 字段只能作为 legacy alias：

```js
{
  value,
  valueKind,
  effectiveSource,
  sources,
  confidence,
  evidenceRefs,
  correctedAt,
  correctedBy
}
```

有效字段生成优先级：

1. `user_corrected`
2. `selector`
3. `ai_extracted`
4. `manual_note`

如果不同来源对同一字段给出不同值，必须记录到 `conflicts[]` 并在 UI 显示，不能静默覆盖。

#### 2.0.4 Capture 域名边界

必须明确二选一：

- 严格模式：只允许 `https://www.upwork.com/*`。
- 扩展研究模式：允许用户手动 capture 任意 `http(s)` 页面，但必须显示 `platform: unknown` 和隐私提示，并通过 `allowedHosts` 控制。

默认建议：只启用 Upwork；其他 host 需要用户显式加入 `allowedHosts`。

严格模式的具体规则：

- 只允许 `new URL(tab.url).hostname === "www.upwork.com"`。
- `platform` 只能来自 host 白名单，不能用 `url.includes("upwork.com")` 推断。
- 如果用户选择了已有 Opportunity，且当前页提取到的 `jobKey` 与该 Opportunity 的 `jobKey` 不一致，capture 必须失败并提示用户新建 Opportunity 或显式确认追加。
- 如果当前页无法提取 `jobKey`，只能追加到用户明确选择的 Opportunity；不能自动合并到最近记录。

#### 2.0.5 Storage、备份和迁移

长期数据库不能只依赖隐式的 `chrome.storage.local` 数组结构。

必须补充：

- `uosc_meta`：保存 `schemaVersion`、`migratedAt`、`lastBackupAt`。
- Export JSON：导出长期数据和去敏后的 settings；`settings.apiKey` 必须置空或省略，不能进入导出文件。
- Import JSON：导入前校验 schema version。
- Snapshot retention：支持清理原始全文，只保留 extracted fields、evidence、DOM summary。
- Migration helper：任何新增 storage key 前先保证旧数据可读。
- API Key 属于敏感 settings，默认不导出；引入 content script 后必须调用 `chrome.storage.local.setAccessLevel()` 或拆分 storage，防止 content script 读取 API Key。

#### 2.0.6 Prompt 和评分版本

所有 `ScoreResult`、`ProposalDraft`、`ExtractedProfile` 必须记录：

- `model`
- `modelSnapshot` 或 `modelAliasUsed`，如 API 返回或配置可获得
- `promptVersion`
- `scoreVersion`，仅评分相关结果适用
- `createdAt`
- `inputSnapshotIds`
- `inputProfileVersion`，如适用

Analytics 必须按 `scoreVersion` / `promptVersion` 分组，不能把不同评分规则的历史结果直接混算。

v0.2 必须先定义常量：

```js
SCHEMA_VERSION = 1
EXTRACT_PROMPT_VERSION = "extract_v1"
SCORE_PROMPT_VERSION = "score_prompt_v1"
SCORE_RULE_VERSION = "score_rules_v1"
PROPOSAL_PROMPT_VERSION = "proposal_prompt_v1"
```

#### 2.0.7 Outcome 事件模型

投标结果必须以事件流作为事实来源，而不是只保存最终状态。

建议 `OutcomeEvent`：

```js
{
  id,
  opportunityId,
  eventType,
  occurredAt,
  recordedAt,
  source,
  snapshotId,
  notes
}
```

`outcome.status` 可以从事件流派生并缓存。手动记录和页面 capture 更新都必须追加事件，不互相覆盖。

#### 2.0.8 Analytics 样本和公式

每个统计项必须定义 numerator / denominator。低样本量时只展示描述性统计，不输出评分校准建议。

必须支持时间窗口：

```js
last_30_days
last_90_days
all_time
```

校准建议必须显示使用的样本量和 score/prompt version。

#### 2.0.9 低自动化风险验证

每个版本都必须检查：

- 没有对 Upwork 页面使用后台 `setInterval` / `chrome.alarms` 轮询。
- 没有 `chrome.tabs.create` / `chrome.tabs.update` 自动打开 Upwork 页面。
- 没有对 Upwork 表单执行 `.click()`、`.submit()`、键盘输入、自动赋值。
- 没有调用 Upwork 非公开接口。
- Selector picking 只在用户点击后启动，结束后清理 overlay 和事件监听。
- 没有 `fetch` / `XMLHttpRequest` / `webRequest` 调用 Upwork 页面或接口。
- 所有 `chrome.scripting.executeScript` 调用都必须能追溯到用户点击触发的 message handler。

#### 2.0.10 最小测试策略

每个阶段至少验证：

- `manifest.json` 是合法 JSON。
- 所有 JS 文件语法可解析。
- 旧 `uosc_opportunities` 数据可读取。
- Capture、Score、Notes 不回退。
- OpenAI JSON schema 有 fixture 或 fake response 覆盖。
- 没有新增违反低自动化边界的 API 调用。

### 2.1 可靠的信息提取和人工校正

实现计划：

1. 在 Side Panel 增加 `Extracted Fields` 区域。
2. 将当前 `score:opportunity` 中的提取动作拆成独立 `profile:extract`。
3. Score 前先显示 AI 提取字段，并明确字段是否已人工确认。
4. 用户可以编辑字段并保存为 `userCorrectedProfile`。
5. 评分时只使用 `effectiveProfile`。
6. 如果用户未确认 AI 字段，允许评分，但 `ScoreResult.profileReviewed` 必须为 `false`，UI 必须提示可信度较低。
7. 对每个字段使用 2.0.3 的字段级结构。
8. 每个字段保留来源：
   - `ai_extracted`
   - `user_corrected`
   - `selector`
   - `manual_note`
9. 每个字段记录 confidence 和 evidence。
10. 缺失字段不允许被静默填充，必须显示在 `missing_fields`。
11. 字段冲突必须显示在 `conflicts[]`。

验收标准：

- AI 提取字段可见、可编辑、可保存。
- 修改字段后重新评分，结果使用修改后的字段。
- 缺失字段显示明确，不硬猜。
- 未确认 AI 字段时，评分结果能显示 `profileReviewed: false`。
- 冲突字段不会静默覆盖。

### 2.2 My Profile / Portfolio

实现计划：

1. Options 页面增加 `My Profile` 分区。
2. 增加 Portfolio Cases 管理。
3. 每个案例支持技能标签、成果、链接、适用关键词。
4. 评分时把 My Profile 输入给 scoring prompt。
5. Proposal Draft 生成时自动挑选最相关 Portfolio Cases。
6. 增加拒绝条件，例如最低预算、免费测试、纯低价 CRUD。
7. My Profile / Portfolio 增加导入、导出和一键清空入口。
8. 评分和 proposal 引用个人信息时，必须只使用用户显式保存的内容。

验收标准：

- 能保存和编辑个人技能、报价、偏好、案例。
- 评分结果能引用用户自己的案例和能力。
- Proposal Draft 能使用相关案例，而不是泛泛而谈。
- 删除或清空 My Profile 后，评分和 proposal 不再引用已删除内容。

### 2.3 Proposal Draft 生成

实现计划：

1. Side Panel 增加 `Generate Proposal` 按钮。
2. 新增 proposal prompt，输入 Opportunity、ScoreResult、MyProfile、PortfolioCases。
3. 输出结构：
   - opening line
   - fit summary
   - relevant proof
   - scope boundary
   - questions to ask
   - suggested rate / bid
   - final proposal text
4. Proposal 保存到 `uosc_proposal_drafts`，Opportunity 只保存 `currentProposalDraftId`。
5. 支持手动编辑和复制。
6. 不自动写入 Upwork 页面，不自动提交。
7. `ProposalDraft` 保存 `templateId`、`promptVersion`、`model`、`inputProfileVersion`、`inputScoreResultId`、`selectedPortfolioCaseRefs`。
8. 输出必须包含 `assumptions[]`、`unsupportedClaims[]`、`questionsToAsk[]`。如果 prompt 输出使用 `questions_to_ask`，只能在 OpenAI adapter 层转换。
9. Proposal 不允许编造未在 My Profile / Portfolio / Opportunity 中出现的经验、成果或承诺。
10. 所有报价建议必须显示依据；缺失信息必须进入问题清单，不能伪装成确定事实。
11. 每条 proof / claim 必须带 `sourceRefs[]`，来源限定为 Opportunity field、Snapshot evidence、My Profile、Portfolio Case、Notes。

验收标准：

- 能生成 proposal 草稿。
- 草稿可以保存、编辑、复制。
- 不调用任何页面点击、输入、提交行为。
- `unsupportedClaims` 必须可见；非空时 UI 显示风险警告，复制仍可用但不能隐藏风险。
- 复制操作只复制文本，不写入 Upwork 页面。

### 2.4 投标结果追踪

实现计划：

1. 按 2.0.1 拆分 `opportunity.status` 和 `outcome.status`。
2. Opportunity 自身只表示记录生命周期：
   - `draft`
   - `captured`
   - `scored`
   - `archived`
3. Outcome 表示投标结果：
   - `not_applied`
   - `skipped`
   - `applied`
   - `viewed`
   - `replied`
   - `interviewing`
   - `hired`
   - `lost`
4. Side Panel 增加 `Outcome` 区域。
5. 用户手动记录 connects、bid、proposal sent time、结果。
6. 所有结果变化都写入 `OutcomeEvent`，最终 status 从事件流派生。
7. 支持用户打开 Upwork proposal/messages/contract 页面后手动点击 `Capture current page`，提取状态并追加 snapshot 和 event。
8. 手动事件和 capture 事件不互相覆盖。
9. 只做本地搜索和本地统计，不后台自动扫描 Upwork。

验收标准：

- 每个 Opportunity 能记录投标状态和结果。
- 能搜索已投、未投、回复、成交、失败。
- 可以导出单个机会的投标记录。
- 每次状态变化有事件记录和来源。
- viewed/replied/interview/hired/lost 的时间线可追溯。

### 2.5 跨 Opportunity 的 ClientRecord

实现计划：

1. 从 snapshot / extractedProfile 中提取 client identity。
2. Client matching 分成三档：
   - `exact`：有稳定 client URL/id。
   - `probable`：多个字段高度一致，但需要用户确认。
   - `manual`：用户手动选择。
3. 只有 `exact` 可以自动关联；`probable` 只能提示，不能自动合并。
4. 创建 `ClientRecord`。
5. 同一个客户的多个 Opportunity 关联到同一个 ClientRecord。
6. Side Panel 中展示历史：
   - seen count
   - previous opportunities
   - average score
   - previous outcomes
   - user notes
   - red flags
7. 用户可以手动合并或拆分客户记录，避免名称识别错误。
8. `ClientRecord` 保存 `mergeHistory[]` 和 `splitHistory[]`。

验收标准：

- 同一个客户再次出现时能提示历史记录。
- 可以人工修正 client identity。
- 客户历史不会污染到不相关机会。
- probable match 不会自动污染 ClientRecord。
- 客户合并和拆分可追溯。

### 2.6 Analytics 和评分校准

实现计划：

1. 新增 History / Analytics 页面。
2. 基于 OutcomeEvent 统计：
   - total opportunities
   - applied count
   - viewed rate
   - reply rate
   - interview rate
   - hired rate
   - average connects spent
3. 按维度分组：
   - score band
   - skill tags
   - client type
   - budget realism
   - proposal template
   - timing window
4. 增加校准建议：
   - 哪类岗位应该提高优先级
   - 哪类岗位应该降级
   - 哪些 red flags 实际影响最大
5. 每个指标定义 numerator / denominator。
6. Analytics 默认按 `scoreVersion` / `promptVersion` 分组。
7. 支持时间窗口：
   - `last_30_days`
   - `last_90_days`
   - `all_time`
8. 低样本量时只展示描述性统计，不输出强校准建议。

验收标准：

- 能看到长期统计。
- 能按分数段和技能方向过滤。
- 能把实际结果反馈到后续评分建议中。
- 每个指标能解释 numerator / denominator。
- 校准建议显示样本量和使用的评分版本。

### 2.7 页面元素点选修正

实现计划：

1. Side Panel 增加 `Selector Assist`。
2. 用户选择字段名，例如 `budget`。
3. 插件注入临时 selector picking script。
4. 用户点击页面元素。
5. 保存 selector、sampleText、fieldKey、host、pageType。
6. 下次 capture 时优先读取已保存 selector。
7. 如果 selector 失效，必须显示失败原因、旧 sampleText 和当前页面 pageType。
8. 回退到 DOM visible text 和 AI extract 只能作为当次 capture 的补充，不能隐藏 selector failure。
9. 选择模式结束后必须清理页面 overlay 和事件监听。

验收标准：

- 能手动绑定页面元素到字段。
- 绑定后下次 capture 自动提取该字段。
- selector 失效时有明确提示。
- selector 失效不会被 fallback 静默掩盖。
- 不产生后台监听 Upwork 页面的行为。

### 2.8 风险边界

实现计划：

1. 所有 capture 必须来自用户点击。
2. 不增加后台轮询。
3. 不增加自动 tab create / update。
4. 不调用 Upwork 非公开接口。
5. 不自动填写或提交 proposal。
6. README 和 UI 中明确说明手动边界。
7. 每个版本增加静态检查：
   - `setInterval`
   - `chrome.alarms`
   - `chrome.tabs.create`
   - `chrome.tabs.update`
   - `.click()`
   - `.submit()`
   - 自动给 Upwork 表单赋值或派发输入事件
8. 明确允许的自动行为只限插件自身 UI，例如打开 Side Panel；不能自动操作 Upwork 页面。

验收标准：

- 代码中没有 `setInterval` 轮询 Upwork。
- 代码中没有自动打开 Upwork 页面的逻辑。
- 代码中没有对 Upwork 表单执行自动输入、点击、提交。
- Selector picking 必须由用户点击启动，并能完整清理。

## 3. 实现计划的具体代码清单

下面是按目标拆分的代码清单。实现时应尽量小步提交，每个阶段先保证当前功能不回退。

### 3.1 基础拆分

新增文件：

- `src/background/constants.js`
- `src/background/storage.js`
- `src/background/messages.js`
- `src/background/capture.js`
- `src/background/openai.js`
- `src/background/scoring.js`
- `src/background/proposal.js`
- `src/background/analytics.js`
- `src/background/selectors.js`

修改文件：

- `src/background/background.js`

迁移职责：

- storage 读写迁移到 `storage.js`。
- DOM capture 迁移到 `capture.js`。
- OpenAI 请求迁移到 `openai.js`。
- scoring prompt/schema 迁移到 `scoring.js`。
- runtime message router 迁移到 `messages.js`。

### 3.2 数据模型

新增数据类型：

```js
Settings
MyProfile
PortfolioCase
Opportunity
Snapshot
ExtractedProfile
UserCorrectedProfile
ScoreResult
ProposalDraft
OutcomeEvent
ClientRecord
FieldSelector
AnalyticsSummary
```

新增 storage keys：

```js
uosc_meta
uosc_settings
uosc_opportunities
uosc_snapshots
uosc_opportunity_profiles
uosc_score_results
uosc_note_revisions
uosc_my_profile
uosc_portfolio_cases
uosc_proposal_drafts
uosc_client_records
uosc_outcome_events
uosc_field_selectors
uosc_analytics_cache // 可选，只能作为派生缓存
```

建议新增文件：

- `src/shared/types.js`
- `src/shared/schema.js`

字段 contract 以第 10 节 canonical registry 为准。本节只列实施拆分清单，不能再作为业务字段来源；v0.1 的嵌套字段只允许在 migration / legacy mapper 中读取。

### 3.3 字段提取可编辑

新增文件：

- `src/sidepanel/extracted-fields.js`
- `src/sidepanel/extracted-fields.css` 或继续合并到 `src/styles.css`

修改文件：

- `src/sidepanel/sidepanel.html`
- `src/sidepanel/sidepanel.js`
- `src/background/messages.js`
- `src/background/storage.js`
- `src/background/scoring.js`

新增 message types：

```js
profile:extract
profile:getExtracted
profile:saveCorrections
profile:clearCorrections
score:opportunity
```

新增字段：

```js
opportunity.extractedProfile
opportunity.userCorrectedProfile
opportunity.effectiveProfile
opportunity.profileOverrideUpdatedAt
```

### 3.4 My Profile / Portfolio

新增文件：

- `src/options/profile-section.js`
- `src/options/portfolio-section.js`

修改文件：

- `src/options/options.html`
- `src/options/options.js`
- `src/background/messages.js`
- `src/background/storage.js`
- `src/background/scoring.js`
- `src/background/proposal.js`

新增 message types：

```js
myProfile:get
myProfile:save
portfolio:list
portfolio:create
portfolio:update
portfolio:delete
```

新增 storage：

```js
uosc_my_profile
uosc_portfolio_cases
```

### 3.5 Proposal Draft

新增文件：

- `src/background/proposal.js`
- `src/sidepanel/proposal-panel.js`

修改文件：

- `src/sidepanel/sidepanel.html`
- `src/sidepanel/sidepanel.js`
- `src/background/messages.js`
- `src/background/openai.js`
- `src/background/storage.js`

新增 message types：

```js
proposal:generate
proposal:list
proposal:update
proposal:delete
```

新增字段：

```js
opportunity.currentProposalDraftId
uosc_proposal_drafts[]
```

### 3.6 投标结果追踪

新增文件：

- `src/sidepanel/outcome-panel.js`
- `src/background/outcomes.js`

修改文件：

- `src/sidepanel/sidepanel.html`
- `src/sidepanel/sidepanel.js`
- `src/background/messages.js`
- `src/background/storage.js`

新增 message types：

```js
outcome:list
outcome:create
outcome:update
outcome:delete
opportunities:updateStatus
```

新增 storage：

```js
uosc_outcome_events
```

新增 opportunity status enum：

```js
draft
captured
scored
archived
```

新增 outcome status enum：

```js
not_applied
skipped
applied
viewed
replied
interviewing
hired
lost
```

### 3.7 ClientRecord

新增文件：

- `src/background/clients.js`
- `src/sidepanel/client-panel.js`

修改文件：

- `src/background/capture.js`
- `src/background/scoring.js`
- `src/background/messages.js`
- `src/background/storage.js`
- `src/sidepanel/sidepanel.html`
- `src/sidepanel/sidepanel.js`

新增 message types：

```js
clients:list
clients:get
clients:update
clients:merge
clients:split
```

新增 storage：

```js
uosc_client_records
```

### 3.8 Analytics

新增页面：

- `src/analytics/analytics.html`
- `src/analytics/analytics.js`

修改文件：

- `manifest.json` 可增加可访问页面入口，或从 options/sidepanel 打开。
- `src/styles.css`
- `src/background/messages.js`
- `src/background/analytics.js`

新增 message types：

```js
analytics:getSummary
analytics:getByScoreBand
analytics:getBySkill
analytics:getByClientType
analytics:getByTemplate
```

### 3.9 Selector Assist

新增文件：

- `src/content/selector-picker.js`
- `src/background/selectors.js`
- `src/sidepanel/selector-panel.js`

修改文件：

- `manifest.json`
- `src/background/capture.js`
- `src/background/messages.js`
- `src/sidepanel/sidepanel.html`
- `src/sidepanel/sidepanel.js`

新增 message types：

```js
selectors:list
selectors:create
selectors:update
selectors:delete
selectors:startPicking
selectors:extractForCurrentPage
```

新增 storage：

```js
uosc_field_selectors
```

注意：

- selector picking 只能在用户点击后启动。
- 选择模式结束后必须清理页面 overlay 和事件监听。

## 4. 实施顺序

建议版本顺序：

```text
v0.2 规格补齐 + storage/schema/migration 基础拆分，不增加新功能
v0.3 字段提取可编辑 + effectiveProfile + profileReviewed
v0.4 My Profile / Portfolio
v0.5 Proposal Draft
v0.6 投标结果追踪 + OutcomeEvent
v0.7 ClientRecord
v0.8 Analytics
v0.9 Selector Assist
```

每个版本完成后至少验证：

- Chrome 插件可以加载。
- `manifest.json` 是合法 JSON。
- 所有 JS 文件语法可解析。
- Options 保存正常。
- 当前页 Capture 正常。
- Opportunity 数据不丢。
- 旧 `draft` 状态数据可读取。
- Score 正常。
- OpenAI JSON schema 有 fixture 或 fake response 覆盖。
- 没有新增后台自动化行为。
- 没有新增自动打开 Upwork、自动填写 Upwork、自动提交 Upwork 的行为。

## 5. 非目标

以下功能不进入计划，除非后续明确重新评估风险：

- 自动刷新 Upwork。
- 自动扫描岗位列表。
- 自动打开多个岗位。
- 自动投 proposal。
- 自动填写 proposal 表单。
- 自动提交 proposal。
- 后台监控 Upwork 页面变化。
- 调用 Upwork 非公开接口。

## 6. 最小补充清单

以下问题会影响最终规格，进入 v0.2 之前必须确认：

1. Capture 是否只允许 Upwork，还是允许用户配置其他研究站点。
2. 旧 `draft` 状态是否保留，还是迁移为 `captured`。
3. 原始 snapshot 全文是否需要长期保留，还是只保留 evidence 和结构化字段。
4. Analytics 输出校准建议的最小样本量。
5. Proposal Draft 默认语言、语气、长度和报价策略。
6. My Profile / Portfolio 是否需要导入导出和一键清空。
7. 是否需要给非 Upwork capture 增加单独隐私确认。

## 7. 当前完善结论

长期方向保持不变：本地、手动触发、低自动化风险、长期积累决策数据库。

但正式开发顺序必须调整：先补齐状态机、数据模型、迁移策略、风险验证清单，再实现新功能。否则后续最容易出现旧数据不兼容、AI 字段和人工字段覆盖规则不清、ClientRecord 误合并、Analytics 因评分版本变化而失真的问题。

## 8. 审阅补充：仍缺失和歧义点

本节基于当前代码和本文档交叉检查，作为进入 v0.2 前的补齐清单。未确认项必须保留 `[假设]` 标记，不能在实现中静默采用。

### 8.1 必须先消除的直接歧义

1. Capture 范围和权限模型仍不一致。
   - 证据：当前 `manifest.json` 只声明 `https://www.upwork.com/*` 和 OpenAI host permission，但代码只校验 `http(s)`，非 Upwork 页面会被标记为 `platform: unknown`。
   - 证据：当前代码用 `sourceUrl.includes("upwork.com")` 推断 platform，可能误判非官方 host。
   - 证据：Side Panel capture 会传入当前选中的 opportunityId；background 会优先追加到该 Opportunity。当前页 jobKey 和已有 Opportunity jobKey 不一致时，存在混入错误 snapshot 的风险。
   - Chrome 官方文档说明 `activeTab` 只在用户调用扩展后临时授予当前 tab 权限；`chrome.storage.local` 默认也有容量上限，长期 snapshot 不能无限堆积。
   - 修复建议：v0.2 默认采用严格模式，只允许 `hostname === "www.upwork.com"`。扩展研究模式必须等 `allowedHosts`、隐私提示、权限失败提示、导入导出风险说明都完成后再开启。capture 追加已有 Opportunity 时必须校验 jobKey 一致，无法确认时要求用户显式确认。

2. `draft` / `captured` 的最终语义还没有落到迁移规则。
   - 证据：当前新建 Opportunity 在 capture 成功后仍写入 `status: "draft"`，长期计划又新增 `captured`。
   - 修复建议：`draft` 仅作为 legacy alias 保留；v0.2 迁移时把 `draft + snapshots.length > 0 + no scoreResult` 转为 `captured`，把 `scoreResult != null` 转为 `scored`。读取层必须继续兼容旧 `draft`。

3. `ProfileField` 早期单 `source` 示例不足以表达同一字段的多来源冲突。
   - 修复建议：以 10.3 的 `sources[] + effectiveSource + conflicts[]` 为准。`value` 只表示当前有效值，不能覆盖原始 AI、selector、人工值。

4. 评分和 proposal 的版本常量必须在实现中固化。
   - 修复建议：以 10.4 的版本常量为准。任何长期结果都保存这些版本或明确写 `not_applicable`，不允许只保存 model。

5. Outcome 事件流必须按枚举、payload 和派生规则实现。
   - 修复建议：以 10.3 的 `OutcomeEvent.eventType`、payload 契约和状态派生规则为准。终态之后如果用户继续记录事件，必须显示“状态被新事件覆盖”的历史，而不是删除旧事件。

6. Analytics 的统计公式还没有具体 numerator / denominator。
   - 修复建议：v0.8 前先写公式表。示例：`reply_rate = replied_or_later / applied`，`hired_rate = hired / applied`，`viewed_rate = viewed_or_later / applied`。未投机会不能进入这些 denominator。

7. ClientRecord 的 exact match 条件不够严格。
   - 修复建议：只有稳定 client URL/id 才能 exact 自动关联。客户名称、国家、评分、总花费只能进入 probable match，必须用户确认后合并。

8. Proposal 的 unsupported claims 目前只靠 prompt 约束，不是可验证流程。
   - 修复建议：proposal 输出中的每条 proof/claim 必须带 `sourceRefs[]`，来源限定为 opportunity field、snapshot evidence、My Profile、Portfolio Case、Notes。`unsupportedClaims.length > 0` 时 UI 必须显示警告，复制按钮仍可用但必须让用户看见风险。

9. Storage 长期容量和写入并发未设计。
   - 证据：当前所有 Opportunity 作为一个数组整体读写，snapshot text 单条最高 70000 chars。
   - 修复建议：v0.2 增加 `storage.getBytesInUse()` 容量提示、snapshot retention 策略、写入 revision 或简单 mutex，避免 popup / sidepanel 同时写入时丢更新。

10. Import / Export 的隐私边界不完整。
    - 修复建议：默认不导出 OpenAI API Key；导出 My Profile、Portfolio、snapshots 时必须在 UI 标明包含个人资料和页面文本。Import 必须先校验 `schemaVersion`、创建备份，再写入 storage。

### 8.2 可直接采用的默认决策

以下默认决策用于减少 v0.2 的阻塞；如果后续选择不同方案，必须更新本节并保留迁移说明。

1. `[已确认]` Capture 默认严格限制 Upwork：`new URL(tab.url).hostname === "www.upwork.com"`。其他 host 暂不进入 v0.2。
2. `[已确认]` 新数据不再写 `draft`；新 capture 后状态为 `captured`，评分成功后为 `scored`。
3. `[已确认]` 旧 `draft` 迁移规则：`draft + snapshots.length > 0 + no scoreResult -> captured`；`scoreResult != null -> scored`；读取层继续兼容旧 `draft`。
4. `[已确认]` v0.2 测试先用 plain Node 脚本和静态扫描，不引入 Jest / Vitest。
5. `[已确认]` v0.2 不新增 proposal、analytics、selector picking 等业务功能，只做 schema、migration、storage 拆分、list/detail、archive、API Key 边界和风险检查。
6. `[假设]` 原始 snapshot text 默认保留，但显示容量占用；用户可以手动清理为 `redacted` 或 `compacted`。
7. `[假设]` Analytics 校准建议最小样本：`applied >= 20`；不足时只展示描述性统计。
8. `[假设]` Proposal 默认英文、短篇、直接、以问题和证据为中心，不承诺未验证结果。
9. `[假设]` My Profile / Portfolio 支持导入、导出、一键清空，但不导出 API Key。

### 8.3 v0.2 必须落地的规格内容

v0.2 不是功能版本，目标是把长期数据基础打稳。实现时必须把这些规格落到代码、测试和 migration：

1. `schemaVersion = 1` 的完整 storage contract。
2. `Opportunity.status`、`OutcomeEvent.eventType`、`ProposalDraft.status` 的枚举表。
3. `ProfileField` 多来源结构和 conflict 展示规则。
4. v0.1 -> v0.2 migration 规则，包括备份 key、幂等性、失败回滚策略。
5. Snapshot retention 策略：`full`、`redacted`、`compacted`、`deleted_reference_only`。
6. Prompt / score version 常量表。
7. Risk static check 命令清单。
8. 手动验证 checklist：Options 保存、capture、notes、score、旧数据读取、容量提示。

### 8.4 v0.2 实现完成定义

v0.2 只有满足以下条件才算完成：

1. 不新增 proposal、analytics、selector picking 等新功能。
2. 旧 `uosc_opportunities` 能无损读取，并能迁移到 `schemaVersion = 1`。
3. 迁移前自动写入本地备份 key，迁移可重复执行且不会重复修改同一条记录。
4. Capture 域名策略在代码、UI、README、本文档中一致。
5. 所有长期生成物都保存 model、promptVersion、scoreVersion 或明确标记“不适用”。
6. API Key 不被 export；引入 content script 后，content script 不能读取包含 API Key 的 settings storage。
7. Risk static check 能检查 `setInterval`、`chrome.alarms`、`chrome.tabs.create`、`chrome.tabs.update`、`.click()`、`.submit()`、输入事件派发、Upwork `fetch` / `XMLHttpRequest`。
8. `manifest.json` 可被 JSON parser 解析，所有 JS 文件通过 syntax check。
9. OpenAI 调用可用 fake response fixture 验证 JSON schema 解析，不依赖真实 API 才能跑基础验证。

### 8.5 参考依据

- Chrome storage 官方文档：`chrome.storage.local` 默认本地容量限制为 10 MB，可通过 `unlimitedStorage` 提升。https://developer.chrome.com/docs/extensions/reference/api/storage
- Chrome activeTab 官方文档：`activeTab` 是用户调用扩展后授予当前 tab 的临时权限，可配合 `scripting.executeScript()`。https://developer.chrome.com/docs/extensions/activeTab

### 8.6 v0.2 静态检查命令清单

这些命令必须进入 v0.2 验收脚本；命中后需要人工判断是否属于插件 UI 自身行为或 Upwork 页面行为。

```sh
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"
node --check src/background/background.js
node --check src/popup/popup.js
node --check src/sidepanel/sidepanel.js
node --check src/options/options.js
rg -n "setInterval|chrome\\.alarms|chrome\\.tabs\\.(create|update)|\\.submit\\(|dispatchEvent|XMLHttpRequest|webRequest" src manifest.json
rg -n "\\.click\\(|\\.value\\s*=|fetch\\(" src
rg -n "upwork\\.com|api\\.upwork|www\\.upwork\\.com" src manifest.json
rg -n "questions_to_ask|total_score|decision_summary|hard_red_flags|missing_info_checklist|recommended_bid_strategy|proposal_angle" src
```

检查规则：

- `chrome.sidePanel.open`、插件 UI button 的点击监听、Options 表单赋值可以允许，但必须不操作 Upwork 页面 DOM。
- `fetch("https://api.openai.com/v1/responses")` 可以允许；任何 Upwork host 的 `fetch` / `XMLHttpRequest` 都禁止。
- legacy snake_case 只能出现在 OpenAI adapter、migration 或 fixture 中，不能成为 UI / storage 主字段。

## 9. 数据流审阅：CRUD、汇总和长期保存

本节专门审阅数据从来源、写入、读取、修改、删除、汇总使用到长期保存的完整链路。结论：当前 v0.1 数据流简单但过度集中；长期计划已经列出部分模型，但还缺少事实表归属、级联删除、汇总缓存失效、版本历史和读取投影规则。

### 9.1 当前 v0.1 实际数据流

当前代码只有两个长期 storage key：

```js
uosc_settings
uosc_opportunities
```

实际流向：

1. Settings：
   - 来源：Options 表单。
   - 写入：`settings:save` 合并默认值后写入 `uosc_settings`。
   - 读取：`settings:get` 返回完整 settings；`score:opportunity` 读取 API key、模型、reasoning effort。
   - 缺口：没有 reset、export/import、API key 排除导出规则、settings schemaVersion。

2. Capture：
   - 来源：Popup / Side Panel 用户点击 `Capture current page`。
   - 写入：background 读取 active tab，注入 `captureVisibleDom()`，生成 snapshot，并追加到 `opportunity.snapshots[]`。
   - 合并规则：如果 URL 中能提取 Upwork jobKey，只能追加到相同 jobKey 的 Opportunity；如果用户传入 opportunityId 但 jobKey 不一致，必须阻止或显式确认。无法提取 jobKey 时只能追加到用户明确选择的 Opportunity。
   - 缺口：没有 snapshot 单独 CRUD、没有 retention 状态、没有 snapshot 删除/脱敏/压缩、没有 capture source 记录到可审计事件。

3. Opportunity：
   - 来源：第一次 capture 自动创建。
   - 写入：`uosc_opportunities` 数组整体重写。
   - 读取：Popup 和 Side Panel 的 `opportunities:list` 都读取完整 Opportunity 对象。
   - 修改：capture 追加 snapshot；notes 覆盖；score 覆盖 extractedProfile 和 scoreResult。
   - 删除：Side Panel `Delete` 直接 hard delete，过滤数组后重写 storage。
   - 缺口：长期计划要 archive，但当前是 hard delete；没有 revision，Popup 和 Side Panel 同时写入可能互相覆盖。

4. ExtractedProfile / ScoreResult：
   - 来源：`score:opportunity`。
   - 写入：每次 score 都重新调用 extract，再调用 score，最后覆盖 `opportunity.extractedProfile` 和 `opportunity.scoreResult`。
   - 读取：Side Panel 只展示 scoreResult，不展示 extractedProfile。
   - 缺口：没有 score history、没有 profile review、没有 input hash、没有 notes 修改后的 stale 标记、没有 promptVersion/scoreVersion。

5. Notes：
   - 来源：Side Panel 文本框。
   - 写入：`opportunities:updateNotes` 覆盖 `opportunity.notes`。
   - 使用：下次 scoring prompt 会包含 notes。
   - 缺口：notes 改动不会让已有 ScoreResult 标记为 stale；没有 notes history；无法知道某次 score 使用的是哪版 notes。

### 9.2 当前数据流的矛盾点

1. 长期数据库目标和 hard delete 矛盾。
   - 当前 `opportunities:delete` 是物理删除。
   - 长期计划要求追踪、复盘、Analytics、ClientRecord 历史；这些都需要 archive 优先。
   - 修复建议：默认 `opportunities:archive`，另设 `opportunities:deletePermanent`，且 permanent delete 必须说明会删除 snapshots、scores、proposals、outcome links。

2. 列表读取和长期 snapshot 保存矛盾。
   - 当前 `opportunities:list` 返回完整对象，包含 snapshots 原文。
   - Popup 只需要 id/title/score label，却会拿到完整文本。
   - 修复建议：新增 `opportunities:listSummary`，只返回 id、title、status、updatedAt、snapshotCount、currentScore。详情页用 `opportunities:get` 再取完整数据。

3. 单一 `scoreResult` 和版本化 Analytics 矛盾。
   - Analytics 要按 scoreVersion/promptVersion 分组。
   - 如果每次重新评分都覆盖 `scoreResult`，旧版本分数和当时决策会丢失。
   - 修复建议：ScoreResult 必须 append-only，使用 `currentScoreResultId` 指向当前结果。可以存在 `uosc_score_results`，或至少 `opportunity.scoreResults[]`。

4. `proposalDrafts[]` 嵌套在 Opportunity，但 OutcomeEvent 独立存储，数据归属不一致。
   - Proposal 是长期事实，也需要版本、编辑历史、复制状态、模板统计。
   - 修复建议：长期方案改为 `uosc_proposal_drafts` 独立事实表，Opportunity 只保存 `currentProposalDraftId` 或 draft count。

5. Snapshot 被嵌套保存，但 selector、evidence、profile field 都要引用 snapshotId。
   - 嵌套结构可以引用，但不利于 retention、按 snapshot 删除、导入校验和容量管理。
   - 修复建议：新增 `uosc_snapshots`，或至少在 storage 层提供 snapshot repository，禁止业务代码直接遍历和修改嵌套数组。

6. Outcome event sourcing 和 `outcome:update/delete` 矛盾。
   - 如果 OutcomeEvent 是事实来源，直接 update/delete 会破坏审计链。
   - 修复建议：取消普通 update/delete，改为 `outcome:appendEvent`、`outcome:voidEvent`、`outcome:appendCorrection`。UI 可以显示为编辑，但底层必须保留修正记录。

7. ClientRecord 汇总字段和 Opportunity 删除/拆分规则缺失。
   - ClientRecord 展示 seen count、average score、previous outcomes。
   - 如果 Opportunity archive/delete、client split/merge 后不重算，汇总会污染。
   - 修复建议：ClientRecord 不保存不可追溯的最终统计，只保存 identity、notes、merge/split history；统计从 Opportunity、ScoreResult、OutcomeEvent 派生或带 cache invalidation。

8. My Profile / Portfolio 被评分和 proposal 使用，但没有输入版本锁定。
   - 如果用户修改或清空 My Profile，旧 score/proposal 仍需要知道当时使用了哪版 profile。
   - 修复建议：`MyProfile` 和 `PortfolioCase` 必须有 version；ScoreResult / ProposalDraft 保存 `inputProfileVersion` 和 `selectedPortfolioCaseRefs`。

9. AnalyticsSummary 类型存在，但没有事实来源、缓存 key 和失效规则。
   - 修复建议：Analytics 默认实时派生；如缓存，必须存 `uosc_analytics_cache`，并记录 `builtFromRevision`、`filters`、`scoreVersion`、`promptVersion`、`createdAt`。任何 Opportunity、ScoreResult、OutcomeEvent、ProposalDraft 变动都使相关 cache 失效。

10. Import / Export 和 cascade 关系缺失。
    - 如果导入 Opportunity 但没有导入 snapshots/scores/outcomes，会形成断链。
    - 修复建议：Export manifest 必须列出包含的 entity types、counts、schemaVersion、createdAt。Import 必须先做 referential integrity check，再写入。

### 9.3 推荐的长期事实表归属

推荐把长期数据拆成事实表和派生缓存，不把所有内容塞进 `uosc_opportunities`。

```js
uosc_meta
uosc_settings
uosc_opportunities
uosc_snapshots
uosc_opportunity_profiles
uosc_score_results
uosc_note_revisions
uosc_my_profile
uosc_portfolio_cases
uosc_proposal_drafts
uosc_outcome_events
uosc_client_records
uosc_field_selectors
uosc_analytics_cache // 可选，只能作为派生缓存
```

归属规则：

- `Opportunity`：机会身份和当前指针，不直接承载大文本和历史评分。
- `Snapshot`：原始页面文本、DOM summary、retention 状态、capture 证据。
- `OpportunityProfile`：AI 提取、selector 提取、人工修正、effective profile、conflicts。
- `ScoreResult`：append-only，保存输入快照、profile version、notes revision、prompt/score version。
- `ProposalDraft`：append-only + editable revision，保存 sourceRefs 和 unsupportedClaims。
- `OutcomeEvent`：append-only 事件流，最终 outcomeSummary 只能派生或缓存。
- `ClientRecord`：客户身份和人工备注；历史统计派生。
- `AnalyticsSummary`：派生结果，不是事实来源。

### 9.4 CRUD 和汇总使用矩阵

| 数据 | Create | Read | Update | Delete / Archive | 汇总使用 | 长期保存要求 |
| --- | --- | --- | --- | --- | --- | --- |
| Settings | `settings:save` 首次保存 | `settings:get` | `settings:save` | `settings:reset` | OpenAI 调用配置 | API key 不导出；加 schemaVersion |
| Opportunity | capture 创建 | `listSummary` / `get` | title、status、clientRecordId、notes 指针 | 默认 archive，谨慎 permanent delete | 列表、Client、Analytics 主索引 | 只保存身份和指针 |
| Snapshot | capture 追加 | by opportunityId / snapshotId | retention 状态、redacted text | 可 redact / compact / delete | Evidence、profile、score 输入 | 保留 sourceUrl、capturedAt、hash |
| OpportunityProfile | extract 创建版本 | get current / history | 人工 correction 生成新版本 | archive version | score/proposal 输入 | 保存 sources、conflicts、reviewedAt |
| ScoreResult | score 创建 | current / history | 不更新，只能重新评分 | archive result | Analytics、proposal 输入 | append-only，保存版本和输入引用 |
| Notes | 用户创建/修改 | opportunity detail | 新 revision | 可清空但保留 revision 供旧 score 引用 | score/proposal 输入 | ScoreResult 保存 notesRevision |
| MyProfile | 用户保存 | options / score / proposal | 新 version | clear 生成新 version | fit scoring、proposal | 旧结果保留 inputProfileVersion |
| PortfolioCase | 用户创建 | list/get | 新 version 或 update | archive 优先 | proposal、Analytics by case/template | ProposalDraft 保存 case version |
| ProposalDraft | generate 创建 | list/get | 编辑生成 revision | archive/delete draft | proposal template analytics | 保存 sourceRefs、unsupportedClaims |
| OutcomeEvent | append event | list by opportunity | correction event | void event，不物理删除 | reply/interview/hired rates | append-only，状态派生 |
| ClientRecord | exact/manual 创建 | list/get | notes、identity、merge/split | archive | client history | merge/split history 可追溯 |
| FieldSelector | 用户点选创建 | list/get | update selector version | delete/archive | capture/profile extraction | 保存 host、pageType、fieldKey、failure history |
| AnalyticsSummary | 派生或缓存 | get summary | rebuild cache | invalidate cache | UI 展示 | 不能作为事实来源 |

### 9.5 必须补齐的 message contract

当前计划里的 message types 还不够完整。进入实现前必须补齐：

```js
data:getStorageUsage
data:export
data:importPreview
data:importCommit
data:createBackup

settings:get
settings:save
settings:reset

opportunities:listSummary
opportunities:get
opportunities:archive
opportunities:restore
opportunities:deletePermanent

snapshots:list
snapshots:get
snapshots:redact
snapshots:compact
snapshots:delete

profile:extract
profile:getCurrent
profile:listVersions
profile:saveCorrection
profile:markReviewed

scores:create
scores:list
scores:get
scores:setCurrent
scores:archive

notes:update
notes:listRevisions

myProfile:get
myProfile:save
myProfile:clear
myProfile:listVersions

portfolio:list
portfolio:get
portfolio:create
portfolio:update
portfolio:archive

proposal:generate
proposal:list
proposal:get
proposal:updateDraft
proposal:archive

outcome:appendEvent
outcome:voidEvent
outcome:listEvents
outcome:getSummary

clients:list
clients:get
clients:update
clients:merge
clients:split

selectors:list
selectors:create
selectors:update
selectors:archive
selectors:startPicking
selectors:extractForCurrentPage

analytics:getSummary
analytics:invalidateCache
```

### 9.6 级联和引用完整性规则

必须明确这些规则，否则长期数据会出现孤儿记录或错误汇总：

1. Archive Opportunity：
   - 不删除 snapshots、scores、proposals、outcome events。
   - Analytics 默认排除 archived，可提供 includeArchived 过滤。

2. Permanent delete Opportunity：
   - 必须删除或标记 orphan 的 snapshots、profiles、scores、proposal drafts、outcome events。
   - ClientRecord 不删除，但相关派生统计必须失效。

3. Delete Snapshot：
   - 如果 ScoreResult / ProfileField / ProposalDraft 引用该 snapshot，不能直接删除原始记录；只能 redacted 或 compact，并保留 evidence hash。

4. Clear My Profile / Portfolio：
   - 不回写旧 ScoreResult / ProposalDraft。
   - 新评分和新 proposal 不能引用已清空内容。

5. Merge / Split ClientRecord：
   - 只修改 Opportunity 的 clientRecordId 或 ClientRecord identity mapping。
   - 必须记录 mergeHistory / splitHistory，并使 client analytics cache 失效。

6. Re-score：
   - 创建新的 ScoreResult。
   - 不覆盖旧 ScoreResult。
   - 更新 Opportunity.currentScoreResultId，并记录 previousScoreResultId。

7. Edit ProposalDraft：
   - 修改草稿文本应生成 revision。
   - Analytics 统计 template 表现时必须区分 generated version 和 edited version。

### 9.7 v0.2 数据流最小修复计划

v0.2 至少完成以下数据流修复，不新增业务功能：

1. 把 `opportunities:list` 拆成 summary 和 detail 两类读取，避免列表页读取 snapshot 原文。
2. 新增 `uosc_meta`，记录 schemaVersion、storageRevision、lastMigrationAt、lastBackupAt。
3. 新增 migration，把旧 Opportunity 补齐 schemaVersion、status、snapshot ids、score ids 的兼容字段。
4. 新增 storage usage 读取和容量提示。
5. 将 hard delete 改为 archive，保留 permanent delete 的内部实现但 UI 默认不暴露。
6. ScoreResult 增加 id、model、promptVersion、scoreVersion、inputSnapshotIds、inputProfileVersion、notesRevision。
7. Notes 增加 revision 或至少 `notesUpdatedAt`，score 后如果 notes 更新，UI 标记 score stale。
8. 明确 snapshot retention 状态：`full`、`redacted`、`compacted`、`deleted_reference_only`。
9. Export / Import preview 必须做 entity count 和引用完整性检查。
10. Analytics 在 v0.2 不实现 UI，但先定义只从事实表派生，不能从缓存反推事实。
11. Capture 严格校验 host 和 jobKey，避免非 Upwork 页面或不同 job 混入已有 Opportunity。
12. 保护 API Key storage；新增 content script 前必须验证 content script 不能读取 `apiKey`。

### 9.8 v0.2 当前实施状态

截至当前代码，v0.2 数据基础已落地：

1. `src/shared/schema.js` 统一导出 schema、storage key、状态枚举、prompt / score version 常量。
2. `src/shared/adapters.js` 统一承接 OpenAI snake_case response 到 canonical storage 字段的映射和分数 clamp。
3. background 已拆出 `uosc_meta`、`uosc_snapshots`、`uosc_opportunity_profiles`、`uosc_score_results`、`uosc_note_revisions`，并保留旧数据迁移兼容。
4. Options 已提供 storage usage、backup、export、import preview、import commit；导出结果不包含 API Key。
5. `scripts/validate_v0_2.mjs` 已覆盖 JS syntax、风险静态扫描、adapter fake response、import validation 的有效/失败路径。
6. MCP / Playwright 已用 mocked `chrome.runtime` 验证 Options 数据 UI 的导出、预览导入、确认导入流程。

仍未进入 v0.2 的内容：

1. Profile 字段人工确认、字段冲突 UI、`effectiveProfile` 是 v0.3。
2. ProposalDraft adapter 和 proposal fixture 是 v0.5，不能放进 v0.2 验收。
3. Snapshot retention 的实际清理按钮和压缩/脱敏策略 UI 尚未实现；当前 v0.2 只定义状态并保留数据结构。
4. 完整 Chrome unpacked extension runtime smoke 仍需人工或专门 Playwright persistent extension context 验证；当前 MCP 测试覆盖 Options UI，不等同于真实扩展上下文。

### 9.9 当前业务闭环、测试缺口和修复依据

本节记录基于当前代码的闭环审计结果。后续完善代码时，必须优先补齐这里列出的真实业务逻辑测试；不能只用静态扫描或 mocked UI 流程替代。

#### 9.9.1 当前已存在的业务闭环

| 业务闭环 | 当前真实入口 | 当前 CRUD 状态 | 当前测试状态 | 结论 |
| --- | --- | --- | --- | --- |
| Settings | `settings:get`、`settings:save` | 读、保存/更新；没有 reset/delete | 没有专门测试 | 闭环存在，但缺少保存后读取、API Key 保留和 export 脱敏测试 |
| Opportunity + Snapshot Capture | `capture:currentPage`、`opportunities:listSummary`、`opportunities:get` | capture 创建 Opportunity/Snapshot；list/detail 读取；追加 snapshot 更新 Opportunity | 没有真实 handler 测试 | 核心闭环存在，但 capture 是当前最大未测风险 |
| Opportunity archive/restore/delete | `opportunities:archive`、`opportunities:restore`、`opportunities:deletePermanent` | archive 软删除；restore 恢复；permanent delete 级联删除关联数据 | 没有真实 handler 测试 | 逻辑存在，但级联删除和列表过滤未被测试保护 |
| Notes revision | `opportunities:updateNotes`、`notes:update` | 每次保存创建 revision；detail 读取 current revision；没有删除 | 没有真实 handler 测试 | 数据模型存在，但 stale score 判断未实现 |
| Profile + Score | `score:opportunity` | 调 OpenAI 提取 profile，再评分，创建 `OpportunityProfile` 和 `ScoreResult`，更新 current ids | 只有 adapter fake response 测试；没有完整 score handler 测试 | 评分闭环存在，但没有 fake OpenAI 的端到端业务测试 |
| Backup / Export / Import | `data:createBackup`、`data:export`、`data:importPreview`、`data:importCommit` | backup 创建备份；export 导出脱敏 settings；preview 校验；commit 备份后替换本地数据并保留当前 API Key | `data:importPreview` 有真实 handler 测试；Options UI 是 mocked runtime | 只有 import preview 被真实覆盖；export/import commit/backup 仍需测试 |
| Migration | 所有 background message handler 前的 `ensureMigrated()` | 旧 embedded Opportunity 迁移到 v1 分表结构 | 没有 legacy fixture 测试 | 数据安全风险高，必须补旧数据样本测试 |
| 风险边界 | `scripts/validate_v0_2.mjs` 静态扫描 | 检查自动化高风险 API 和 Upwork 私有 API 文本 | 有静态测试 | 只能证明代码文本没有命中，不能替代扩展运行时 smoke |

#### 9.9.2 已确认测试是否调用真实业务逻辑

当前 `scripts/validate_v0_2.mjs` 已真实调用：

1. `src/shared/adapters.js` 的 `mapRawProfileFields()`。
2. `src/shared/adapters.js` 的 `normalizeRawScore()`。
3. background 注册到 `chrome.runtime.onMessage` 的真实 handler，但目前只覆盖 `data:importPreview`。
4. manifest JSON parse、JS syntax check、风险关键字静态扫描。

当前 MCP / Playwright 已覆盖：

1. Options 页面加载。
2. storage usage 显示。
3. export button、import preview button、commit import button 的 UI 流程。
4. 导出文本不包含 mocked API Key。

MCP / Playwright 当前没有覆盖真实 background 业务逻辑，因为测试注入的是 mocked `chrome.runtime.sendMessage`。因此它只能证明 Options UI 按钮和状态文案流程正确，不能证明 `data:export`、`data:importCommit`、`data:createBackup` 的真实实现正确。

#### 9.9.3 必须新增的真实业务逻辑测试

新增测试必须通过真实 background message handler 调用业务入口。建议在 `scripts/validate_v0_2.mjs` 或拆出的 `scripts/background_harness.mjs` 中统一 mock `chrome.storage.local`、`chrome.tabs.query`、`chrome.scripting.executeScript`、`fetch`，然后发送真实 message。

必须补齐的 case：

1. Settings：
   - `settings:save` 后 `settings:get` 能读回归一化 settings。
   - API Key 会 trim。
   - export 永远不包含真实 API Key。
   - import commit 必须保留当前本地 API Key，不能被导入文件覆盖为空或旧值。

2. Migration：
   - legacy `uosc_opportunities` 内嵌 `snapshots`、`extractedProfile`、`scoreResult`、`notes` 时，会迁移成分表数据。
   - 迁移会创建 backup key。
   - 迁移幂等：第二次调用任意 handler 不会重复生成 snapshot/profile/score/note。
   - `draft + snapshots` 迁移为 `captured`，已有 score 迁移为 `scored`。

3. Capture：
   - 非 `https://www.upwork.com/*` 页面必须拒绝。
   - Upwork 页面无可读文本必须拒绝。
   - 新 job 首次 capture 会创建 Opportunity 和 Snapshot。
   - 同一 jobKey 重复 capture 会追加到同一个 Opportunity。
   - 用户选择已有 Opportunity 且 jobKey 不一致时必须拒绝。
   - archived Opportunity 不能追加 snapshot。
   - `opportunities:listSummary` 不能返回 `Snapshot.text` 原文。
   - `opportunities:get` 必须返回 snapshots detail。

4. Notes：
   - 保存 notes 会创建新 `OpportunityNoteRevision`。
   - detail 只显示当前 revision 文本。
   - 多次保存 notes 后旧 revision 仍保留。
   - 若当前 score 的 `notesRevisionId` 不是 current notes revision，UI/detail 必须能标记 score stale。当前尚未实现，必须先补实现再补测试。

5. Score：
   - 没有 API Key 时 `score:opportunity` 必须拒绝。
   - 没有 snapshots 时必须拒绝。
   - fake OpenAI 返回 profile 和 score 时，真实 `score:opportunity` 会创建 `OpportunityProfile`、`ScoreResult`，更新 Opportunity 为 `scored`。
   - OpenAI score 超过范围时会 clamp 到 0-100，dimension score/confidence 也会 clamp。
   - OpenAI 返回 invalid JSON 或 HTTP error 时不能写入半成品 profile/score。

6. Archive / Restore / Permanent Delete：
   - archive 后默认 list 不返回该 Opportunity。
   - restore 后 status 根据是否有 score 回到 `scored` 或 `captured`。
   - permanent delete 会删除 Opportunity、Snapshots、Profiles、Scores、Notes。
   - permanent delete 不应删除其他 Opportunity 的关联数据。

7. Backup / Export / Import：
   - `data:createBackup` 会写入 backup key，并更新 meta。
   - `data:export` 的 `manifest.entityCounts` 与真实数据数量一致。
   - `data:importPreview` 拒绝未知顶层 key、缺 required field、未知 entity field、坏引用、错误 schemaVersion。
   - `data:importCommit` 会先 backup，再替换业务数据，并保留当前 API Key。

#### 9.9.4 已确认潜在问题和修复方案

1. 测试覆盖不足。
   - 问题：当前只有 import preview 通过真实 background handler 测过，大多数 CRUD 只存在代码实现，没有回归测试。
   - 修复：建立 background harness，以真实 message handler 为唯一入口补齐 9.9.3 的 case。

2. Migration 无样本测试。
   - 问题：迁移影响长期本地数据，失败会导致旧数据丢失、重复或引用断裂。
   - 修复：新增 legacy fixture，验证迁移前 backup、迁移后分表、幂等和引用完整性。

3. Capture 无运行时测试。
   - 问题：capture 涉及 active tab、host 限制、DOM 注入、jobKey 合并、snapshot 写入，是当前核心入口。
   - 修复：mock `tabs.query` 和 `scripting.executeScript`，通过 `capture:currentPage` 真实 handler 测成功和失败路径。

4. Score 持有 storage lock 等待网络。
   - 问题：`scoreOpportunity()` 在 `withStorageLock()` 内调用 OpenAI。网络慢或失败时会阻塞其他 storage 写入。
   - 修复：先在 lock 内读取稳定快照并记录 scoring 状态，释放 lock 后调用 OpenAI，最后再用 lock 写回；写回时校验 Opportunity 仍存在且 revision 未冲突。

5. Score stale 未实现。
   - 问题：ScoreResult 已保存 `notesRevisionId`，但 notes 更新后 UI/detail 没有明确标记旧 score 已过期。
   - 修复：在 `hydrateOpportunity()` 或 detail view model 中增加 `scoreStale`，当 `currentScoreResult.notesRevisionId !== currentNotesRevisionId` 时为 true；Side Panel 显示需要重新评分。

6. `data:export` 和 `data:importCommit` 真实逻辑缺测试。
   - 问题：API Key 脱敏和导入时保留当前 API Key 是安全边界，但目前主要靠代码审查和 UI mock。
   - 修复：通过真实 handler 测 export 文本不含 API Key，import commit 后 settings.apiKey 仍等于导入前本地值。

7. Archive/restore/permanent delete 无级联测试。
   - 问题：永久删除若过滤条件错误，可能留下孤儿记录或误删其他 Opportunity 数据。
   - 修复：构造两个 Opportunity 的关联数据，测试只删除目标 Opportunity 的关联记录。

8. Options UI 的 MCP 测试不是扩展运行时 smoke。
   - 问题：mocked `chrome.runtime` 不等同于真实 Chrome extension context。
   - 修复：后续增加 Chrome unpacked extension smoke；至少人工加载扩展验证 Options、Popup、SidePanel、capture、score fake API 或真实 API 前置失败路径。

9. SidePanel 保存 notes 缺少错误处理。
   - 问题：`saveNotes()` 没有 try/catch，后台失败时 UI 状态不明确。
   - 修复：给 save notes 加 busy/error handling，并新增失败路径 UI 测试。

10. 未实现业务域不应被误判为完成。
    - 问题：MyProfile、Portfolio、ProposalDraft、OutcomeEvent、ClientRecord、Analytics、Selector 目前只有 schema key 或文档计划，没有完整业务闭环。
    - 修复：保持在后续版本实施；每个新业务域进入实现前，必须先写 CRUD contract 和真实 handler 测试清单。

#### 9.9.5 后续修复优先级

1. P0：建立 background harness，并补 migration、capture、export/import commit、archive/delete 的真实 handler 测试。
2. P0：修复 score 持 lock 等待网络的问题，补 fake OpenAI 完整 `score:opportunity` 测试。
3. P1：实现 `scoreStale`，补 notes revision 测试。
4. P1：补 Settings 保存/读取/API Key 安全边界测试。
5. P1：补 Chrome unpacked extension smoke，确认真实扩展上下文可加载。
6. P2：补 Snapshot retention UI 和测试。
7. P2：进入 v0.3 Profile review 前，补 `effectiveProfile`、conflict UI 和字段级 correction 测试。

## 10. 字段唯一性契约：防止业务字段错位

本节解决一个强约束：每一个业务概念必须只有一个 canonical 数据结构和字段路径。Create、Read、Update、Delete、汇总、长期存储必须指向同一个字段，不能出现“新增写 A 字段、查询读 B 字段、更新改 C 字段、汇总用 D 字段”的错位。

### 10.1 当前已确认的字段错位风险

1. `ScoreResult` 文档 contract 和 UI/实际 OpenAI schema 不一致。
   - 证据：当前 Side Panel 读取 `scoreResult.decision_summary`、`hard_red_flags`、`missing_info_checklist`、`recommended_bid_strategy`、`proposal_angle`。
   - 证据：当前长期计划的 `ScoreResult` 最小 contract 只列了 `total_score`、`decision`、`dimensions`、`confidence`，缺少上述 UI 使用字段。
   - 修复：`ScoreResult` contract 必须以 canonical schema 为准，UI、Analytics、Proposal 都只能读同一个 canonical 字段。

2. `ExtractedProfile` 当前是 OpenAI 原始 snake_case flat JSON，长期计划又要求 `ProfileField` 字段级结构。
   - 证据：当前 extraction schema 输出 `job_description_summary`、`proposal_count`、`raw_evidence`、`missing_fields`。
   - 修复：OpenAI 原始字段只能进入 adapter，长期存储必须归一化为 `OpportunityProfile.fields.<fieldKey>`。新代码不能继续把 raw OpenAI JSON 直接当业务模型使用。

3. Proposal 字段命名混用 camelCase 和 snake_case。
   - 证据：prompt 输出可能继续使用 `questions_to_ask`，但长期存储 canonical 使用 `questionsToAsk`。
   - 修复：内部长期存储统一 camelCase：`questionsToAsk`、`unsupportedClaims`。如 prompt 输出使用 snake_case，必须在 OpenAI adapter 层转换。

4. `Opportunity.title` 和 `Snapshot.title` 语义不同但字段名相同。
   - 证据：capture 创建 `snapshot.title`，同时创建 `opportunity.title = normalizeTitle(snapshot.title)`。
   - 修复：长期 canonical 使用 `Opportunity.title` 表示机会标题，`Snapshot.pageTitle` 表示页面标题。v0.1 的 `snapshot.title` 作为 legacy alias 迁移到 `pageTitle`。

5. `mainUrl` 和 `sourceUrl` 容易被误用。
   - 证据：`Opportunity.mainUrl` 当前来自首次 snapshot 的 `sourceUrl`，但后续 snapshot 可能来自 proposal/messages/client 页面。
   - 修复：`Opportunity.mainUrl` 只表示机会主页面 URL；`Snapshot.sourceUrl` 只表示该次 capture 的页面 URL。任何 summary/link 必须明确读哪个字段。

6. Notes 当前是 `Opportunity.notes` 字符串，但长期需要版本引用。
   - 证据：当前 scoring prompt 直接读取 `opportunity.notes`。
   - 修复：canonical 改为 `Opportunity.currentNotesRevisionId` + `OpportunityNoteRevision.text`。v0.1 的 `notes` 只作为 legacy alias 迁移。

7. Outcome 的 `outcome.status` 和 `OutcomeEvent.eventType` 必须使用统一 payload 字段对应表。
   - 修复：状态只能从事件流派生；connects、bid、viewed/replied/interview/hired/lost 时间都必须写入 10.3 定义的事件 payload 或专用字段，不能散落在 Opportunity 上。

8. Settings、MyProfile、PortfolioCase、ClientRecord、AnalyticsSummary 必须有 canonical 字段表和 validator。
   - 修复：字段表已在 10.3 补齐；v0.2 实现时必须从 `src/shared/schema.js` 生成 validator / mapper，不能由各模块临时发明字段名。

### 10.2 命名和归一化规则

1. 内部长期存储字段统一使用 camelCase。
2. OpenAI prompt/schema、导入文件、旧 storage 可以使用 snake_case 或旧字段名，但必须在 adapter / migration 层转换。
3. 禁止 UI、Analytics、Proposal、ClientRecord 直接读取 raw OpenAI JSON 字段。
4. 禁止同一业务概念同时存在两个可写字段。旧字段只能是 read-only legacy alias，读到后立即迁移或归一化。
5. 字段名必须表达单位和形态：
   - 原始文本用 `*Text`，例如 `budgetText`。
   - 数值用明确单位，例如 `connectsSpent`、`hourlyRateMin`、`fixedBudgetAmount`。
   - 派生状态用 `*Summary` 或 `current*Id`，不能伪装成事实来源。
6. 每个 derived/cache 字段必须标明事实来源字段和失效条件。

### 10.3 Canonical 字段注册表

以下字段名作为长期内部 canonical registry。实现时必须从这里生成 schema / validator / mapper，不能在各模块手写不同字段。

#### Settings

```js
Settings = {
  schemaVersion,
  updatedAt,
  apiKey,
  extractModel,
  scoreModel,
  proposalModel,
  language,
  reasoningEffort,
  captureMode,
  allowedHosts,
  exportPreferences
}
```

字段归属：

- `apiKey`：只用于 background OpenAI 调用；默认不导出，不进入 analytics，不进入 prompt。
- `captureMode`：`strict_upwork` 或 `allowed_hosts`；v0.2 默认 `strict_upwork`。
- `allowedHosts`：仅扩展研究模式使用；严格模式下忽略。
- 引入 content script 后，必须保证 content script 不能读取 `apiKey`。

#### MyProfile

```js
MyProfile = {
  id,
  schemaVersion,
  version,
  createdAt,
  updatedAt,
  displayName,
  title,
  summary,
  skillTags,
  serviceCategories,
  strengths,
  preferredProjects,
  rejectRules,
  rateCard,
  availability,
  proposalPreferences,
  languagePreferences,
  archivedAt
}
```

字段归属：

- `rejectRules`：最低预算、免费测试、低价 CRUD、不可接受风险等硬性拒绝条件。
- `rateCard`：必须表达币种和单位，例如 hourly / fixed / minimumProjectBudget。
- ScoreResult / ProposalDraft 必须记录使用的 `inputProfileVersion`，用户修改或清空 MyProfile 不回写旧结果。

#### PortfolioCase

```js
PortfolioCase = {
  id,
  schemaVersion,
  version,
  createdAt,
  updatedAt,
  title,
  summary,
  skillTags,
  outcome,
  proofPoints,
  links,
  applicableKeywords,
  sourceRefs,
  archivedAt
}
```

字段归属：

- `proofPoints` 只能保存用户明确填写或可追溯来源，不能由 proposal prompt 编造。
- ProposalDraft 引用案例时必须保存 case id 和 case version，避免案例后来修改导致旧 proposal 无法追溯。

#### Opportunity

```js
Opportunity = {
  id,
  schemaVersion,
  createdAt,
  updatedAt,
  title,
  mainUrl,
  jobKey,
  platform,
  status,
  clientRecordId,
  snapshotIds,
  currentProfileId,
  currentScoreResultId,
  currentProposalDraftId,
  currentNotesRevisionId,
  archivedAt
}
```

字段归属：

- `title`：机会标题，只由 capture 初次创建、用户改名、profile 确认流程更新。
- `mainUrl`：机会主页面 URL，不等于每次 capture 的 URL。
- `snapshotIds`：只保存引用，不嵌入 snapshot 原文。
- `current*Id`：只保存当前指针，不保存历史事实。

#### Snapshot

```js
Snapshot = {
  id,
  opportunityId,
  schemaVersion,
  createdAt,
  capturedAt,
  sourceUrl,
  pageTitle,
  pageType,
  platform,
  text,
  textHash,
  domSummary,
  stats,
  retentionState
}
```

字段归属：

- `sourceUrl`：该 snapshot 的来源页面。
- `pageTitle`：浏览器页面标题；v0.1 `snapshot.title` 迁移到这里。
- `text`：原始可见文本；`retentionState != "full"` 时可能为空，但必须保留 `textHash`。
- `retentionState`：只能是 `full`、`redacted`、`compacted`、`deleted_reference_only`。

#### EvidenceRef

```js
EvidenceRef = {
  id,
  snapshotId,
  sourceUrl,
  textHash,
  quoteText,
  domPath,
  fieldKey,
  createdAt
}
```

字段归属：

- `quoteText` 保存短证据片段或摘要，不保存不可追溯的大段原文。
- 当 Snapshot 被 redacted / compacted 后，EvidenceRef 必须仍能通过 `snapshotId`、`sourceUrl`、`textHash` 解释来源。
- ScoreDimension、ProfileField、ProposalDraft 的 `evidenceRefs` / `sourceRefs` 必须引用该结构，不能保存孤立自由文本。

#### OpportunityProfile

```js
OpportunityProfile = {
  id,
  opportunityId,
  schemaVersion,
  version,
  createdAt,
  updatedAt,
  model,
  promptVersion,
  inputSnapshotIds,
  fields,
  missingFieldKeys,
  conflicts,
  reviewedAt,
  reviewedBy
}
```

字段 key 注册表：

```js
profile.fields = {
  jobTitle,
  descriptionSummary,
  requiredSkills,
  budgetText,
  pricingType,
  proposalCountText,
  connectsCostText,
  postedTimeText,
  interviewsText,
  invitesSentText,
  hiresText,
  clientPaymentVerifiedText,
  clientRatingText,
  clientTotalSpendText,
  clientHireRateText,
  clientAvgHourlyPaidText,
  clientType,
  testTaskSignal,
  longTermSignal
}
```

legacy OpenAI 字段映射：

| Legacy / prompt field | Canonical field |
| --- | --- |
| `title` | `jobTitle` |
| `job_description_summary` | `descriptionSummary` |
| `required_skills` | `requiredSkills` |
| `budget` | `budgetText` |
| `hourly_or_fixed` | `pricingType` |
| `proposal_count` | `proposalCountText` |
| `connects_cost` | `connectsCostText` |
| `posted_time` | `postedTimeText` |
| `client_total_spend` | `clientTotalSpendText` |
| `client_avg_hourly_paid` | `clientAvgHourlyPaidText` |
| `raw_evidence` | `fields.*.sources[].evidenceRefs` |
| `missing_fields` | `missingFieldKeys` |

#### ProfileField

```js
ProfileField = {
  value,
  valueKind,
  effectiveSource,
  sources,
  confidence,
  evidenceRefs,
  correctedAt,
  correctedBy
}

ProfileFieldSource = {
  source,
  value,
  confidence,
  evidenceRefs,
  snapshotId,
  selectorId,
  createdAt
}
```

字段归属：

- `value`：当前有效值。
- `sources[]`：所有来源值，不能被覆盖。
- `effectiveSource`：当前 value 选自哪个来源。
- `evidenceRefs`：引用 evidence，不保存不可追溯的自由文本。

#### ScoreResult

```js
ScoreResult = {
  id,
  opportunityId,
  schemaVersion,
  createdAt,
  model,
  promptVersion,
  scoreVersion,
  inputSnapshotIds,
  inputProfileId,
  inputProfileVersion,
  notesRevisionId,
  profileReviewed,
  totalScore,
  decision,
  decisionSummary,
  timingPriority,
  dimensions,
  hardRedFlags,
  risks,
  missingInfoChecklist,
  recommendedBidStrategy,
  proposalAngle,
  confidence,
  archivedAt
}
```

legacy ScoreResult 字段映射：

| Legacy / prompt field | Canonical field |
| --- | --- |
| `total_score` | `totalScore` |
| `decision_summary` | `decisionSummary` |
| `timing_priority` | `timingPriority` |
| `hard_red_flags` | `hardRedFlags` |
| `missing_info_checklist` | `missingInfoChecklist` |
| `recommended_bid_strategy` | `recommendedBidStrategy` |
| `proposal_angle` | `proposalAngle` |

#### ScoreDimension

```js
ScoreDimension = {
  key,
  nameZh,
  nameEn,
  score,
  maxScore,
  confidence,
  evidenceRefs,
  missingFieldKeys,
  reasoning
}
```

legacy 字段映射：`name_zh -> nameZh`、`name_en -> nameEn`、`max_score -> maxScore`、`missing_fields -> missingFieldKeys`。

#### OpportunityNoteRevision

```js
OpportunityNoteRevision = {
  id,
  opportunityId,
  schemaVersion,
  text,
  createdAt,
  createdBy
}
```

字段归属：

- 新评分只读取 `Opportunity.currentNotesRevisionId` 指向的 revision。
- 旧评分通过 `ScoreResult.notesRevisionId` 追溯当时输入。
- v0.1 `Opportunity.notes` 是 legacy alias，不再作为新写入字段。

#### ProposalDraft

```js
ProposalDraft = {
  id,
  opportunityId,
  schemaVersion,
  createdAt,
  updatedAt,
  status,
  templateId,
  model,
  promptVersion,
  inputProfileId,
  inputProfileVersion,
  inputScoreResultId,
  selectedPortfolioCaseRefs,
  assumptions,
  unsupportedClaims,
  questionsToAsk,
  openingLine,
  fitSummary,
  relevantProof,
  scopeBoundary,
  suggestedRateOrBid,
  finalText,
  sourceRefs,
  revisions,
  archivedAt
}
```

legacy / prompt 字段映射：`questions_to_ask -> questionsToAsk`、`inputScoreId -> inputScoreResultId`。

#### OutcomeEvent 和 OutcomeSummary

```js
OutcomeEvent = {
  id,
  opportunityId,
  schemaVersion,
  eventType,
  occurredAt,
  recordedAt,
  source,
  snapshotId,
  payload,
  notes,
  correctionOfEventId,
  voidedAt
}

OutcomeSummary = {
  opportunityId,
  status,
  appliedAt,
  viewedAt,
  repliedAt,
  interviewAt,
  hiredAt,
  lostAt,
  connectsSpent,
  bidAmount,
  bidType,
  derivedFromEventIds,
  updatedAt
}
```

字段归属：

- `OutcomeSummary` 是派生缓存，不是事实来源。
- `connectsSpent`、`bidAmount`、`bidType` 必须来自 `OutcomeEvent.payload`。

事件类型枚举：

```js
OutcomeEvent.eventType =
  "marked_not_applied" |
  "marked_skipped" |
  "proposal_sent" |
  "proposal_viewed" |
  "client_replied" |
  "interview_started" |
  "hired" |
  "lost" |
  "manual_note" |
  "capture_detected_status" |
  "correction" |
  "voided"
```

事件 payload 契约：

```js
proposal_sent.payload = {
  connectsSpent,
  bidAmount,
  bidCurrency,
  bidType,
  proposalDraftId,
  proposalTextRevisionId
}

capture_detected_status.payload = {
  detectedStatus,
  confidence,
  evidenceRefs
}

correction.payload = {
  correctedEventId,
  correctedFields,
  reason
}
```

状态派生规则：

1. 忽略 `voidedAt != null` 的事件。
2. 按 `occurredAt` 排序；同一时间按 `recordedAt` 排序。
3. `hired`、`lost`、`marked_skipped` 是终态，但后续新事件可以覆盖当前派生状态；旧终态事件必须保留在 timeline。
4. `proposal_viewed`、`client_replied`、`interview_started`、`hired`、`lost` 都隐含 `applied`。
5. `OutcomeSummary.derivedFromEventIds` 必须列出参与派生的事件 id。

#### ClientRecord

```js
ClientRecord = {
  id,
  schemaVersion,
  createdAt,
  updatedAt,
  primaryClientKey,
  identitySources,
  displayName,
  notes,
  redFlags,
  mergeHistory,
  splitHistory,
  archivedAt
}
```

字段归属：

- `seenCount`、`averageScore`、`previousOutcomes` 不作为事实字段保存，只能派生或缓存。

#### FieldSelector

```js
FieldSelector = {
  id,
  schemaVersion,
  createdAt,
  updatedAt,
  host,
  pageType,
  fieldKey,
  selector,
  sampleText,
  version,
  lastUsedAt,
  lastFailure
}
```

字段归属：

- `fieldKey` 必须来自 `OpportunityProfile.fields` 注册表，不能自由输入。

#### AnalyticsSummary

```js
AnalyticsSummary = {
  id,
  schemaVersion,
  createdAt,
  filters,
  scoreVersion,
  promptVersion,
  window,
  metrics,
  sampleSizes,
  builtFromRevision
}
```

字段归属：

- `metrics` 只来自 Opportunity、ScoreResult、ProposalDraft、OutcomeEvent 的派生计算。
- `AnalyticsSummary` 不能被任何业务逻辑当作事实反写。

### 10.4 固定枚举和版本常量

v0.2 必须先把这些常量放进 `src/shared/schema.js`，实现和测试都引用同一份定义。

```js
SCHEMA_VERSION = 1

OpportunityStatus = [
  "draft", // legacy read alias only
  "captured",
  "scored",
  "archived"
]

ProposalDraftStatus = [
  "generated",
  "edited",
  "archived"
]

SnapshotRetentionState = [
  "full",
  "redacted",
  "compacted",
  "deleted_reference_only"
]

PromptVersions = {
  extractPromptVersion: "extract_v1",
  scorePromptVersion: "score_prompt_v1",
  scoreRuleVersion: "score_rules_v1",
  proposalPromptVersion: "proposal_prompt_v1"
}
```

规则：

- 新写入 Opportunity 不再使用 `draft`；只有 legacy mapper 可以读到 `draft`。
- `scoreVersion` 对应 `scoreRuleVersion`。非评分结果必须写 `scoreVersion: null` 或 `"not_applicable"`，不能省略导致 analytics 分组歧义。
- Prompt 输出可以使用 snake_case，但 adapter 后的长期存储只能使用 camelCase。

### 10.5 CRUD 字段一致性规则

每个模块实现前必须写明 CRUD 对应字段：

| 业务动作 | Create 写入 | Read 读取 | Update 修改 | Delete / Archive | 汇总读取 |
| --- | --- | --- | --- | --- | --- |
| Capture Opportunity | `Opportunity` + `Snapshot` | `Opportunity.mainUrl`、`snapshotIds` | `snapshotIds`、`updatedAt` | archive Opportunity | snapshot count |
| Edit notes | `OpportunityNoteRevision.text` | current revision | 新建 revision，更新 `currentNotesRevisionId` | 清空也建 revision | score/proposal input |
| Extract profile | `OpportunityProfile.fields` | current profile | correction 新建 source/version | archive profile version | score/proposal input |
| Score | `ScoreResult` | `currentScoreResultId` | re-score 新建 result | archive result | score bands、decision |
| Generate proposal | `ProposalDraft` | draft id/history | edit 新建 revision | archive draft | template/case outcome |
| Record outcome | `OutcomeEvent` | event stream + derived summary | correction event | void event | reply/interview/hired rates |
| Match client | `ClientRecord` + `Opportunity.clientRecordId` | client id + derived history | merge/split history | archive client | client history |
| Selector picking | `FieldSelector.fieldKey` | selectors by host/pageType/fieldKey | new selector version | archive selector | selector success/failure |

实现检查规则：

1. 每个 message handler 只能写自己拥有的 canonical 字段。
2. Read API 不能返回旧字段名作为主字段；legacy 字段只能在 migration/debug 输出中出现。
3. UI 只能读 summary/detail view model，不能绕过 repository 直接读 raw storage。
4. Analytics 只能读 canonical facts，不能读 UI label 或 prompt 原始字段。
5. OpenAI adapter 必须显式声明 input mapper 和 output mapper。
6. 每个字段如果参与汇总，必须在字段注册表里标明 numerator / denominator 或派生规则。

### 10.6 v0.2 字段一致性验收

v0.2 必须补上字段一致性测试，不允许只靠人工检查：

1. 新增 `src/shared/schema.js`，导出 canonical field constants。
2. 新增 legacy mapper 测试：v0.1 `total_score` 必须映射到 `totalScore`，`decision_summary` 必须映射到 `decisionSummary`。
3. 新增 list/detail contract 测试：`listSummary` 不包含 `Snapshot.text`。
4. 新增 score fixture 测试：OpenAI snake_case fake response 经 adapter 后只保存 camelCase canonical fields。
5. Proposal fixture 测试不属于 v0.2；v0.5 引入 ProposalDraft adapter 时必须新增 `questions_to_ask -> questionsToAsk` 验收。
6. 新增 notes stale 测试：notes revision 更新后，旧 ScoreResult 仍引用旧 `notesRevisionId`，当前 Opportunity 指向新 revision。
7. 新增 import validation：发现未知可写字段、缺失 required canonical field、引用不存在 id 时拒绝导入。
