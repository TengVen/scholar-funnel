# AGENTS.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. 前端改造代码原则（2026-08-30 用户拍板，转型期间强制）

产品转型（四分页 → 对话 + 论文空间，见 `md/产品原则-2026-08-29.md`）期间，所有改造代码必须遵循：

1. **状态与业务逻辑分离**：组件不持有编排状态；状态在 store/hook，业务决策在 lib/ 纯函数或 agent 层
2. **组件职责单一**：一个文件一个组件；子组件独立成文件，不与页面级编排混居
3. **UI 负责呈现**：JSX 只做展示与事件绑定；数学计算、echarts option、SVG 坐标等一律外移 lib/ 纯函数
4. **数据与事件语义明确**：props/事件命名表达业务语义（onPaperAdopt 而非 onClick1）；禁止裸 fetch/localStorage（已有铁律继续有效）
5. **复杂逻辑抽象复用**：出现第二次的复杂样式/逻辑即抽象（变体函数、纯函数、共享 hook）

配套规范：字号等视觉值必须走 tailwind.config token，禁止新增 `text-[Npx]` 式任意值；改造触达哪个文件，就顺手完成该文件的拆分与外移（规范化搭车）。

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
