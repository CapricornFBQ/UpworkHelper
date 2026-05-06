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

### 2.1 可靠的信息提取和人工校正

实现计划：

1. 在 Side Panel 增加 `Extracted Fields` 区域。
2. Score 前先显示 AI 提取字段。
3. 用户可以编辑字段并保存为 `userCorrectedProfile`。
4. 评分时优先使用人工修正结果。
5. 每个字段保留来源：
   - `ai_extracted`
   - `user_corrected`
   - `selector`
   - `manual_note`
6. 每个字段记录 confidence 和 evidence。
7. 缺失字段不允许被静默填充，必须显示在 `missing_fields`。

验收标准：

- AI 提取字段可见、可编辑、可保存。
- 修改字段后重新评分，结果使用修改后的字段。
- 缺失字段显示明确，不硬猜。

### 2.2 My Profile / Portfolio

实现计划：

1. Options 页面增加 `My Profile` 分区。
2. 增加 Portfolio Cases 管理。
3. 每个案例支持技能标签、成果、链接、适用关键词。
4. 评分时把 My Profile 输入给 scoring prompt。
5. Proposal Draft 生成时自动挑选最相关 Portfolio Cases。
6. 增加拒绝条件，例如最低预算、免费测试、纯低价 CRUD。

验收标准：

- 能保存和编辑个人技能、报价、偏好、案例。
- 评分结果能引用用户自己的案例和能力。
- Proposal Draft 能使用相关案例，而不是泛泛而谈。

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
4. Proposal 保存到 `opportunity.proposalDrafts[]`。
5. 支持手动编辑和复制。
6. 不自动写入 Upwork 页面，不自动提交。

验收标准：

- 能生成 proposal 草稿。
- 草稿可以保存、编辑、复制。
- 不调用任何页面点击、输入、提交行为。

### 2.4 投标结果追踪

实现计划：

1. Opportunity 增加状态流转：
   - `new`
   - `scored`
   - `skipped`
   - `applied`
   - `viewed`
   - `replied`
   - `interviewing`
   - `hired`
   - `lost`
   - `archived`
2. Side Panel 增加 `Outcome` 区域。
3. 用户手动记录 connects、bid、proposal sent time、结果。
4. 支持用户打开 Upwork proposal/messages/contract 页面后手动点击 `Capture current page`，提取状态并追加 snapshot。
5. 只做本地搜索和本地统计，不后台自动扫描 Upwork。

验收标准：

- 每个 Opportunity 能记录投标状态和结果。
- 能搜索已投、未投、回复、成交、失败。
- 可以导出单个机会的投标记录。

### 2.5 跨 Opportunity 的 ClientRecord

实现计划：

1. 从 snapshot / extractedProfile 中提取 client identity。
2. 创建 `ClientRecord`。
3. 同一个客户的多个 Opportunity 关联到同一个 ClientRecord。
4. Side Panel 中展示历史：
   - seen count
   - previous opportunities
   - average score
   - previous outcomes
   - user notes
   - red flags
5. 用户可以手动合并或拆分客户记录，避免名称识别错误。

验收标准：

- 同一个客户再次出现时能提示历史记录。
- 可以人工修正 client identity。
- 客户历史不会污染到不相关机会。

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

验收标准：

- 能看到长期统计。
- 能按分数段和技能方向过滤。
- 能把实际结果反馈到后续评分建议中。

### 2.7 页面元素点选修正

实现计划：

1. Side Panel 增加 `Selector Assist`。
2. 用户选择字段名，例如 `budget`。
3. 插件注入临时 selector picking script。
4. 用户点击页面元素。
5. 保存 selector、sampleText、fieldName、host、pageType。
6. 下次 capture 时优先读取已保存 selector。
7. 如果 selector 失效，回退到 DOM visible text 和 AI extract。

验收标准：

- 能手动绑定页面元素到字段。
- 绑定后下次 capture 自动提取该字段。
- selector 失效时有明确提示。

### 2.8 风险边界

实现计划：

1. 所有 capture 必须来自用户点击。
2. 不增加后台轮询。
3. 不增加自动 tab create / update。
4. 不调用 Upwork 非公开接口。
5. 不自动填写或提交 proposal。
6. README 和 UI 中明确说明手动边界。

验收标准：

- 代码中没有 `setInterval` 轮询 Upwork。
- 代码中没有自动打开 Upwork 页面的逻辑。
- 代码中没有对 Upwork 表单执行自动输入、点击、提交。

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
uosc_settings
uosc_opportunities
uosc_my_profile
uosc_portfolio_cases
uosc_client_records
uosc_outcome_events
uosc_field_selectors
```

建议新增文件：

- `src/shared/types.js`
- `src/shared/schema.js`

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
profile:getExtracted
profile:saveCorrections
profile:clearCorrections
score:opportunity
```

新增字段：

```js
opportunity.extractedProfile
opportunity.userCorrectedProfile
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
opportunity.proposalDrafts[]
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

新增 status enum：

```js
new
scored
skipped
applied
viewed
replied
interviewing
hired
lost
archived
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
v0.2 基础拆分 + 字段提取可编辑
v0.3 My Profile / Portfolio
v0.4 Proposal Draft
v0.5 投标结果追踪
v0.6 ClientRecord
v0.7 Analytics
v0.8 Selector Assist
```

每个版本完成后至少验证：

- Chrome 插件可以加载。
- Options 保存正常。
- 当前页 Capture 正常。
- Opportunity 数据不丢。
- Score 正常。
- 没有新增后台自动化行为。

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

