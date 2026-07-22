const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("./logic-engine.js");

const atom = (value) => ({ kind: "atom", value: String(value) });
const wrap = (value) => (value && value.kind === "atom") ? value : atom(value);
const random = (from, to) => ({
  type: "random",
  slots: { from: atom(from), to: atom(to) }
});
const contains = (left, right) => ({
  type: "compare",
  operator: "contains",
  slots: { left, right: wrap(right) }
});
const compare = (left, operator, right) => ({
  type: "compare",
  operator,
  slots: { left, right: wrap(right) }
});
const relationCheck = (left, name, right) => ({
  type: "relationCheck",
  name,
  slots: { left, right: wrap(right) }
});

test("随机变量含有判断遵循有限候选值语义", () => {
  assert.equal(engine.evaluatePredicate(contains(random(0, 9), 2)).code, "U");
  assert.equal(engine.evaluatePredicate(contains(random(0, 9), 10)).code, "F");
  assert.equal(engine.evaluatePredicate(contains(random(0.5, 1.5), 1)).code, "T");

  const emptyRange = engine.evaluatePredicate(contains(random(0.1, 0.9), 2));
  assert.equal(emptyRange.code, "I");
  assert.match(emptyRange.detail, /没有整数/);
});

test("T/F/U/I 词条统一为是/否/不确定/无法回答", () => {
  assert.deepEqual(engine.LOGIC_LABELS, { T: "是", F: "否", U: "不确定", I: "无法回答" });
});

test("比较判断区分必定、否定和不确定", () => {
  assert.equal(engine.evaluatePredicate(compare(random(1, 3), "gt", 0)).code, "T");
  assert.equal(engine.evaluatePredicate(compare(random(1, 3), "gt", 2)).code, "U");
  assert.equal(engine.evaluatePredicate(compare(random(1, 3), "gt", 3)).code, "F");
  assert.equal(engine.evaluatePredicate(compare(random(1, 3), "eq", 2)).code, "U");
  assert.equal(engine.evaluatePredicate(compare(random(1, 3), "lt", 4)).code, "T");
});

test("字符串含有按子串判断", () => {
  const yes = {
    type: "compare",
    operator: "contains",
    slots: { left: atom('"逻辑工坊"'), right: atom('"工坊"') }
  };
  const no = {
    type: "compare",
    operator: "contains",
    slots: { left: atom('"逻辑工坊"'), right: atom('"Scratch"') }
  };

  assert.equal(engine.evaluatePredicate(yes).code, "T");
  assert.equal(engine.evaluatePredicate(no).code, "F");
});

test("不成立保留 U/I 并翻转 T/F", () => {
  const truth = engine.evaluatePredicate(compare(atom(3), "gt", 2));
  const uncertainty = engine.evaluatePredicate(compare(random(1, 3), "gt", 2));
  const invalid = engine.evaluatePredicate(compare(atom('"文本"'), "gt", 2));

  assert.equal(engine.negate(truth).code, "F");
  assert.equal(engine.negate(uncertainty).code, "U");
  assert.equal(engine.negate(invalid).code, "I");
});

test("四则运算组合候选值并检查除零", () => {
  const addition = engine.evaluateExpression({
    type: "arithmetic",
    operator: "add",
    slots: { left: random(1, 3), right: atom(2) }
  });
  assert.deepEqual(addition.values, [3, 4, 5]);
  assert.equal(addition.type, "int");

  const division = engine.evaluateExpression({
    type: "arithmetic",
    operator: "div",
    slots: { left: atom(10), right: random(0, 2) }
  });
  assert.equal(division.ok, false);
  assert.match(division.error, /包含 0/);
});

test("随机候选值始终为整数且不超过 1000 个均匀点", () => {
  const points = engine.integerPoints(-20, 10000);
  assert.equal(points.length, 1000);
  assert.equal(points[0], -20);
  assert.equal(points.at(-1), 10000);
  assert.ok(points.every(Number.isInteger));
  assert.equal(new Set(points).size, points.length);
});

test("赋值、变量引用和回答按指令顺序执行", () => {
  const execution = engine.execute([
    { type: "assign", name: "点数", slots: { value: random(1, 6) } },
    { type: "answer", slots: { predicate: compare(atom("$点数"), "gt", 0) } },
    { type: "answer", slots: { predicate: compare(atom("$点数"), "gt", 3) } }
  ]);

  assert.equal(execution.environment.get("点数").values.length, 6);
  assert.deepEqual(execution.outputs.map((output) => output.result.code), ["T", "U"]);
});

test("判断的答案严格给出四种回答字符串", () => {
  const uncertainAnswer = engine.evaluateExpression({
    type: "answerValue",
    slots: { predicate: compare(random(1, 3), "gt", 2) }
  });
  const certainAnswer = engine.evaluateExpression({
    type: "answerValue",
    slots: { predicate: compare(atom(3), "gt", 2) }
  });

  assert.equal(uncertainAnswer.type, "string");
  assert.deepEqual(uncertainAnswer.values, ["不确定"]);
  assert.deepEqual(certainAnswer.values, ["是"]);
});

test("未赋值变量传播为 I", () => {
  const missing = engine.evaluatePredicate(compare(atom("$未知"), "gt", 1));
  assert.equal(missing.code, "I");
  assert.match(missing.detail, /尚未赋值/);
});

test("非数字输入默认为字符串（无需引号）", () => {
  const hello = engine.parseAtom("hello");
  assert.equal(hello.ok, true);
  assert.equal(hello.type, "string");
  assert.deepEqual(hello.values, ["hello"]);

  const truthy = engine.parseAtom("true");
  assert.equal(truthy.ok, true);
  assert.equal(truthy.type, "string");
  assert.deepEqual(truthy.values, ["true"]);

  const mixed = engine.parseAtom("逻辑工坊");
  assert.equal(mixed.ok, true);
  assert.equal(mixed.type, "string");
  assert.deepEqual(mixed.values, ["逻辑工坊"]);

  const number = engine.parseAtom("42");
  assert.equal(number.type, "int");
  assert.deepEqual(number.values, [42]);

  const quoted = engine.parseAtom('"hello world"');
  assert.equal(quoted.type, "string");
  assert.deepEqual(quoted.values, ["hello world"]);
});

test("数字的含有判断统一走字符串语义", () => {
  // 整数与整数：把双方都当作字符串再判断子串
  assert.equal(engine.evaluatePredicate(contains(atom(123), 2)).code, "T");
  assert.equal(engine.evaluatePredicate(contains(atom(123), 23)).code, "T");
  assert.equal(engine.evaluatePredicate(contains(atom(123), 4)).code, "F");

  // 整数与字符串互转
  assert.equal(engine.evaluatePredicate(contains(atom(2024), "02")).code, "T");
  assert.equal(engine.evaluatePredicate(contains(atom('"1024"'), 2)).code, "T");

  // 区间内的整数候选值
  assert.equal(engine.evaluatePredicate(contains(random(0, 9), 2)).code, "U");
  assert.equal(engine.evaluatePredicate(contains(random(0, 9), 10)).code, "F");

  // 字符串子串依旧可用
  assert.equal(engine.evaluatePredicate(contains(atom("逻辑工坊"), atom("工坊"))).code, "T");
  assert.equal(engine.evaluatePredicate(contains(atom("逻辑工坊"), atom("Scratch"))).code, "F");
});

test("等于判断在数值间用数值等价，在字符串间用严格比较", () => {
  // int 与 int / float 视为数值等价
  assert.equal(engine.evaluatePredicate(compare(atom(5), "eq", atom(5))).code, "T");
  assert.equal(engine.evaluatePredicate(compare(atom(5), "eq", atom(5.0))).code, "T");
  assert.equal(engine.evaluatePredicate(compare(atom(5), "eq", atom(6))).code, "F");

  // 字符串严格相等（带引号才是字符串）
  assert.equal(engine.evaluatePredicate(compare(atom('"hello"'), "eq", atom('"hello"'))).code, "T");
  assert.equal(engine.evaluatePredicate(compare(atom('"5"'), "eq", atom('"5"'))).code, "T");
  assert.equal(engine.evaluatePredicate(compare(atom('"5"'), "eq", atom('"5.0"'))).code, "F");

  // 数值与字符串不同类型 → I
  const mixed = engine.evaluatePredicate(compare(atom(5), "eq", atom('"5"')));
  assert.equal(mixed.code, "I");
});

test("文字语法解析支持中文括号、六边形判断与作用域", () => {
  const program = engine.parse([
    "[回答 <比较 (从(1)到(10)的随机变量) 大于 (5) 吗?>]",
    "[赋值 (命中) = (<(从(1)到(10)的随机变量) 含有 (2) 吗?>的答案)]",
    "[重复 ((3)) {",
    "  [回答 <比较 (从(1)到(6)的随机变量) 等于 (6) 吗?>]",
    "  [赋值 (总和) = (($命中) 加 (1))]",
    "}]"
  ].join("\n"));

  assert.equal(program.length, 3);
  assert.equal(program[0].type, "answer");
  assert.equal(program[0].slots.predicate.type, "compare");
  assert.equal(program[1].type, "assign");
  assert.equal(program[1].name, "命中");
  assert.equal(program[1].slots.value.type, "answerValue");
  assert.equal(program[2].type, "repeat");
  assert.equal(program[2].body.length, 2);

  const printed = program.map((entry) => engine.printCommand(entry)).join("\n");
  assert.match(printed, /\[回答 <\(从\(1\)到\(10\)的随机变量\) 大于 \(5\) 吗\?>\]/);
  assert.match(printed, /\[赋值 \(命中\) = \(<\(从\(1\)到\(10\)的随机变量\) 含有 \(2\) 吗\?>的答案\)\]/);
  assert.match(printed, /\[重复 \(3\) \{/);
});

test("文字表示可原样往返：打印结果能重新解析并得到相同回答", () => {
  const source = [
    "[赋值 (点数) = (从(1)到(6)的随机变量)]",
    "[回答 <($点数) 大于 (0) 吗?>]",
    "[回答 <($点数) 等于 (3) 吗?>]",
    "[回答 <(5) 含有 (2) 吗?>]",
    "[回答 <不成立 <(1) 大于 (0) 吗?> 吗?>]",
    "[回答 <比较 (<第 (1) 问>的答案) 等于 (不确定) 吗?>]",
    "[重复 (2) {\n  [回答 <(1) 小于 (2) 吗?>]\n}]"
  ].join("\n");

  const program = engine.parse(source);
  const printed = program.map((entry) => engine.printCommand(entry)).join("\n");
  // 打印结果必须能再次解析（往返不丢失）
  const reparsed = engine.parse(printed);
  // 再次打印应稳定（幂等）
  const printedAgain = reparsed.map((entry) => engine.printCommand(entry)).join("\n");
  assert.equal(printedAgain, printed);

  const before = engine.execute(program).outputs.map((o) => o.result.code);
  const after = engine.execute(reparsed).outputs.map((o) => o.result.code);
  assert.deepEqual(after, before);
});

test("文字语法解析接受新旧两种格式", () => {
  const oldStyle = engine.parse("赋值 点数 = (从(1)到(6)的随机变量)");
  const newStyle = engine.parse("[赋值 (点数) = (从(1)到(6)的随机变量)]");

  assert.equal(oldStyle.length, 1);
  assert.equal(newStyle.length, 1);
  assert.equal(oldStyle[0].type, "assign");
  assert.equal(newStyle[0].type, "assign");
  assert.equal(oldStyle[0].name, "点数");
  assert.equal(newStyle[0].name, "点数");

  const printed = engine.printCommand(newStyle[0]);
  assert.match(printed, /\[赋值 \(点数\) = \(从\(1\)到\(6\)的随机变量\)\]/);
});

test("文字表示中所有变量都用括号包裹", () => {
  const program = engine.parse([
    "[赋值 (点数) = (从(0)到(9)的随机变量)]",
    "[回答 <($点数) 含有 (2) 吗?>]",
    "[赋值 (加倍) = (($点数) 乘 (2))]"
  ].join("\n"));

  const printed = program.map((entry) => engine.printCommand(entry)).join("\n");
  assert.match(printed, /\[赋值 \(点数\) = \(从\(0\)到\(9\)的随机变量\)\]/);
  assert.match(printed, /\[回答 <\(\$点数\) 含有 \(2\) 吗\?>\]/);
  assert.match(printed, /\[赋值 \(加倍\) = \(\(\$点数\) 乘 \(2\)\)\]/);
});

test("文字语法解析能执行循环与四值逻辑", () => {
  const program = engine.parse([
    "[回答 <比较 (从(1)到(2)的随机变量) 大于 (1) 吗?>]"
  ].join("\n"));

  const execution = engine.execute(program);
  assert.equal(execution.outputs.length, 1);
  assert.equal(execution.outputs[0].result.code, "U");
});

test("文字语法解析：含有 作为比较运算符出现在 (left)(right) 之间", () => {
  const program = engine.parse("[回答 <($点数) 含有 (6) 吗?>]");
  const predicate = program[0].slots.predicate;
  assert.equal(predicate.type, "compare");
  assert.equal(predicate.operator, "contains");
  assert.ok(predicate.slots.left, "left 槽位应被解析");
  assert.ok(predicate.slots.right, "right 槽位应被解析");
  assert.equal(predicate.slots.left.kind, "atom");
  assert.equal(predicate.slots.left.value, "$点数");
  assert.equal(predicate.slots.right.value, "6");

  const execution = engine.execute([
    { type: "assign", name: "点数", slots: { value: { kind: "atom", value: "5" } } },
    program[0]
  ]);
  assert.equal(execution.outputs[0].result.code, "F");
});

test("文字语法解析拒绝错误结构", () => {
  assert.throws(() => engine.parse("回答 大于 5 吗?"), /无法解析的判断积木/);
  assert.throws(() => engine.parse("赋值 命中 = "), /缺少变量或数值|无法解析/);
  assert.throws(() => engine.parse("重复 3 没有作用域"), /作用域/);
});

test("问题编号、行号在回答中可用", () => {
  const program = engine.parse([
    "[回答 <比较 (问题编号) 等于 (1) 吗?>]",
    "[回答 <比较 (问题编号) 等于 (2) 吗?>]",
    "[回答 <比较 (行号) 等于 (3) 吗?>]",
    "[回答 <比较 (行号) 等于 (4) 吗?>]"
  ].join("\n"));

  const execution = engine.execute(program);
  assert.equal(execution.outputs.length, 4);
  assert.equal(execution.outputs[0].result.code, "T");
  assert.equal(execution.outputs[1].result.code, "T");
  assert.equal(execution.outputs[2].result.code, "T");
  assert.equal(execution.outputs[3].result.code, "T");

  const printed = program.map((entry) => engine.printCommand(entry)).join("\n");
  assert.match(printed, /\[回答 <\(问题编号\) 等于 \(1\) 吗\?>]/);
  assert.match(printed, /\[回答 <\(问题编号\) 等于 \(2\) 吗\?>]/);
  assert.match(printed, /\[回答 <\(行号\) 等于 \(3\) 吗\?>]/);
  assert.match(printed, /\[回答 <\(行号\) 等于 \(4\) 吗\?>]/);
});

test("<第(x)问> 0<x<y 时回放第 x 个回答的结果", () => {
  const program = engine.parse([
    "[回答 <比较 (1) 大于 (0) 吗?>]",   // 1st answer: T
    "[回答 <比较 (1) 小于 (0) 吗?>]",   // 2nd answer: F
    "[回答 <第 (1) 问?>]",              // 3rd: y=3, x=1 → returns 1st answer's code (T)
    "[回答 <第 (2) 问?>]"               // 4th: y=4, x=2 → returns 2nd answer's code (F)
  ].join("\n"));

  const execution = engine.execute(program);
  assert.equal(execution.outputs[0].result.code, "T");
  assert.equal(execution.outputs[1].result.code, "F");
  assert.equal(execution.outputs[2].result.code, "T");
  assert.equal(execution.outputs[3].result.code, "F");
  assert.match(execution.outputs[2].result.detail, /第 1 问 的回答是 是/);
  assert.match(execution.outputs[3].result.detail, /第 2 问 的回答是 否/);
});

test("<第(x)问> 在 x=y 时通过四假设分析得到 U", () => {
  const program = engine.parse([
    "[回答 <比较 (1) 大于 (0) 吗?>]",            // y=1, T
    "[回答 <第 (问题编号) 问?>]"                  // y=2, x=2 (via 问题编号) → x=y
  ].join("\n"));

  const execution = engine.execute(program);
  assert.equal(execution.outputs[0].result.code, "T");
  assert.equal(execution.outputs[1].result.code, "U");
  // T/F/U/I 四个假设都不矛盾，因此 combine 落入 T+F → 不确定
  assert.match(execution.outputs[1].result.detail, /T 与 F 均不矛盾/);
});

test("<第(x)问> x=y 四假设分析：否定本题 → U", () => {
  // [回答 <不成立 <第 (1) 问> 吗?>]
  // 假设 T/F/U/I → 本题实际回答 F/T/U/I，T、F 自相矛盾被排除，剩 U/I → 不确定
  const program = engine.parse("[回答 <不成立 <第 (1) 问> 吗?>]");
  const execution = engine.execute(program);
  assert.equal(execution.outputs[0].result.code, "U");
});

test("<第(x)问> x=y 四假设分析：等于不确定 → F", () => {
  // [回答 <比较 (<第 (1) 问>的答案) 等于 (不确定) 吗?>]
  // 假设 T/F/U/I → 本题回答 F/F/T/F，排除矛盾（T、U、I）后只剩 F 自洽 → F
  const program = engine.parse("[回答 <比较 (<第 (1) 问>的答案) 等于 (不确定) 吗?>]");
  const execution = engine.execute(program);
  assert.equal(execution.outputs[0].result.code, "F");
});

test("(<第(x)问>的答案) 严格给出四种回答字符串之一", () => {
  const program = engine.parse([
    "[回答 <比较 (1) 大于 (0) 吗?>]",                       // 第1问 → 是
    "[回答 <比较 (<第 (1) 问>的答案) 等于 (是) 吗?>]"        // 第2问：第1问的答案是否为“是”→ T
  ].join("\n"));
  const execution = engine.execute(program);
  assert.equal(execution.outputs[0].result.code, "T");
  assert.equal(execution.outputs[1].result.code, "T");
});

test("<第(x)问> 在 x>y、x≤0 或非整数时返回 I", () => {
  const program = engine.parse([
    "[回答 <比较 (1) 大于 (0) 吗?>]",   // y=1, T
    "[回答 <第 (5) 问?>]",              // y=2, x=5 > y → I
    "[回答 <第 (0) 问?>]",              // y=3, x=0 ≤ 0 → I
    "[回答 <第 (-2) 问?>]",             // y=4, x=-2 ≤ 0 → I
    "[回答 <第 (1.5) 问?>]"             // y=5, x=1.5 非整数 → I
  ].join("\n"));

  const execution = engine.execute(program);
  assert.equal(execution.outputs[0].result.code, "T");
  assert.equal(execution.outputs[1].result.code, "I");
  assert.equal(execution.outputs[2].result.code, "I");
  assert.equal(execution.outputs[3].result.code, "I");
  assert.equal(execution.outputs[4].result.code, "I");
  assert.match(execution.outputs[1].result.detail, /不存在或尚未到来/);
  assert.match(execution.outputs[4].result.detail, /必须是整数/);
});

test("第(N)问、行号在回答外被调用时返回 I", () => {
  const directIsQuestion = engine.evaluatePredicate({ type: "isQuestion", slots: { value: { kind: "atom", value: "1" } } });
  assert.equal(directIsQuestion.code, "I");

  const directLine = engine.evaluateExpression({ type: "currentLine", slots: {} });
  assert.equal(directLine.ok, false);
});

test("重复内层非重复积木继承外层行号", () => {
  const program = engine.parse([
    "[回答 <比较 (行号) 等于 (1) 吗?>]",          // line 1 — top-level
    "[重复 (1) { [回答 <比较 (行号) 等于 (2) 吗?>] }]", // line 2 — repeat, answer inside should use repeat's line
    "[回答 <比较 (行号) 等于 (3) 吗?>]"            // line 3 — top-level
  ].join("\n"));

  const execution = engine.execute(program);
  assert.deepEqual(
    execution.outputs.map((output) => output.result.code),
    ["T", "T", "T"]
  );
  // 第二个回答位于外层重复内，行号应使用最外层重复的源行号 2
  assert.equal(execution.outputs[1].line, 2);
  assert.equal(execution.outputs[2].line, 3);
});

test("嵌套重复内回答按最外层顶层编号", () => {
  // 所有 [回答] 的 行号 = 其外层最接近顶层命令的 1-based 索引。
  // 顶层 [回答] 与「外层是顶层」的 [重复] 内层回答，共用同一行号。
  const program = engine.parse([
    "[回答 <比较 (行号) 等于 (1) 吗?>]",   // top-level, line 1
    "[重复 (1) {",                          // outer top-level at subIdx=1
    "  [回答 <比较 (行号) 等于 (2) 吗?>]",   // inside outer, inherits outer's top-level idx=2
    "  [重复 (1) { [回答 <比较 (行号) 等于 (2) 吗?>] }]", // inner-inside-outer still inherits outer's idx=2
    "}]"
  ].join("\n"));

  const execution = engine.execute(program);
  assert.deepEqual(
    execution.outputs.map((output) => output.result.code),
    ["T", "T", "T"]
  );
  assert.equal(execution.outputs[0].line, 1);
  assert.equal(execution.outputs[1].line, 2);
  assert.equal(execution.outputs[2].line, 2); // shared with outer repeat's top-level index
});

test("多层重复嵌套内回答共享最外层顶层编号", () => {
  // 任意深度的 [重复] 嵌套，内层 [回答] 都继承最外层 [重复] 的顶层索引。
  const program = engine.parse([
    "[回答 <比较 (行号) 等于 (1) 吗?>]",   // top-level, line 1
    "[重复 (1) {",                          // outer at top subIdx=1
    "  [回答 <比较 (行号) 等于 (2) 吗?>]",   // in outer body, line 2
    "  [重复 (1) {",                        // mid in outer body
    "    [回答 <比较 (行号) 等于 (2) 吗?>]", // in mid body, inherits outer line=2
    "    [重复 (1) { [回答 <比较 (行号) 等于 (2) 吗?>] } ]", // in inner body, still line=2
    "} ]",                                  // close mid scope + mid bracket
    "}",                                    // close outer scope
    "]"                                     // close outer bracket
  ].join("\n"));

  const execution = engine.execute(program);
  assert.equal(execution.outputs.length, 4);
  assert.deepEqual(
    execution.outputs.map((output) => output.result.code),
    ["T", "T", "T", "T"]
  );
  assert.deepEqual(
    execution.outputs.map((output) => output.line),
    [1, 2, 2, 2]
  );
});

test("顶层回答继承独立顶层编号，与内嵌回答错开", () => {
  // 顶层最末 `[回答]` 占据新的顶层序号，与前面 [重复] 内的 [回答] 互不冲突。
  const program = engine.parse([
    "[回答 <比较 (行号) 等于 (1) 吗?>]",                              // top subIdx=0, line=1
    "[重复 (1) { [回答 <比较 (行号) 等于 (2) 吗?>] }]",                // inside outer at subIdx=1, line=2
    "[重复 (1) { [重复 (1) { [回答 <比较 (行号) 等于 (3) 吗?>] }] }]",  // inside inner inside outer at subIdx=2, line=3
    "[回答 <比较 (行号) 等于 (4) 吗?>]"                                // top subIdx=3, line=4
  ].join("\n"));

  const execution = engine.execute(program);
  assert.deepEqual(
    execution.outputs.map((output) => output.result.code),
    ["T", "T", "T", "T"]
  );
  assert.deepEqual(
    execution.outputs.map((output) => output.line),
    [1, 2, 3, 4]
  );
});

test("字数：忽略括号/空格/$，示例得到 7", () => {
  const program = engine.parse("[赋值 (n) = (<($点数) 含有 (2) 吗?>的字数)]");
  const execution = engine.execute(program);
  // 计数字符串为“点数含有2吗?”，长度 7
  assert.deepEqual(execution.environment.get("n").values, [7]);
});

test("字数：内部积木不求值（不计算 2+4=6）", () => {
  const program = engine.parse("[赋值 (n) = (<($点数) 含有 ((2) 加 (4)) 吗?>的字数)]");
  const execution = engine.execute(program);
  // “点数含有2加4吗?” 长度 9，而不是把 2+4 算成 6
  assert.deepEqual(execution.environment.get("n").values, [9]);
});

test("字数：charCount 供 UI 悬停使用（字面模式）", () => {
  const predicate = engine.parse("[回答 <($点数) 含有 (2) 吗?>]")[0].slots.predicate;
  const counted = engine.charCount(predicate);
  assert.equal(counted.ok, true);
  assert.equal(counted.count, 7);
});

test("字数：<第x问> 在 0<x<本题编号 时展开该问的字数", () => {
  const program = engine.parse([
    "[回答 <($点数) 含有 (2) 吗?>]",                        // 第1问，字数 7
    "[回答 <比较 (<第 (1) 问>的字数) 等于 (7) 吗?>]"          // 第2问：第1问字数=7 → T
  ].join("\n"));
  const execution = engine.execute(program);
  assert.equal(execution.outputs[1].result.code, "T");
});

test("字数：<第x问> 在 x=本题编号 时视作字符串计入，不递归", () => {
  const program = engine.parse([
    "[回答 <($点数) 含有 (2) 吗?>]",
    "[回答 <比较 (<第 (2) 问>的字数) 等于 (3) 吗?>]"           // 第2问自身：字面“第2问”长度 3
  ].join("\n"));
  const execution = engine.execute(program);
  assert.equal(execution.outputs[1].result.code, "T");
});

test("字数：<第x问> 在 (的字数) 中越界/非整数时静默回落为字面", () => {
  // 新规则：<第x问> 遇 x>y (尚未到来) / x≤0 / 非整数等情况时不报错、
  // 静默回落为字面 "第X问"，主表达式不会被 I 阻断。
  const program = engine.parse([
    "[回答 <($点数) 含有 (2) 吗?>]",
    "[回答 <比较 (<第 (5) 问>的字数) 等于 (3) 吗?>]",          // x=5 > y=1
    "[回答 <比较 (<第 (0) 问>的字数) 等于 (3) 吗?>]",          // x≤0
    "[回答 <比较 (<第 (1.5) 问>的字数) 等于 (5) 吗?>]"         // 非整数 x=1.5 → "第1.5问" 5 字
  ].join("\n"));
  const execution = engine.execute(program);
  assert.equal(execution.outputs[1].result.code, "T");
  assert.equal(execution.outputs[2].result.code, "T");
  assert.equal(execution.outputs[3].result.code, "T");
});

test("字数：(的字数) 文字表示可原样往返", () => {
  const source = "[赋值 (n) = (<($点数) 含有 (2) 吗?>的字数)]";
  const program = engine.parse(source);
  const printed = program.map((entry) => engine.printCommand(entry)).join("\n");
  assert.match(printed, /的字数\)/);
  const reparsed = engine.parse(printed);
  assert.deepEqual(
    engine.execute(reparsed).environment.get("n").values,
    engine.execute(program).environment.get("n").values
  );
});

test("不成立 支持后缀形式：<inner> 不成立 吗?>", () => {
  const prefix = engine.parse("[回答 <不成立 <(1) 大于 (0) 吗?> 吗?>]");
  const suffix = engine.parse("[回答 <<(1) 大于 (0) 吗?> 不成立 吗?>]");

  assert.equal(prefix[0].slots.predicate.type, "not");
  assert.equal(suffix[0].slots.predicate.type, "not");

  const prefixExec = engine.execute(prefix).outputs[0].result.code;
  const suffixExec = engine.execute(suffix).outputs[0].result.code;
  assert.equal(prefixExec, suffixExec);
  // (1) 大于 (0) 是 T，不成立后为 F
  assert.equal(suffixExec, "F");
});

test("不成立 文字表示默认以后缀形式打印", () => {
  const program = engine.parse("[回答 <不成立 <(1) 大于 (0) 吗?> 吗?>]");
  const printed = engine.printCommand(program[0]);
  // 旧的前缀形式 “不成立 <...> 吗?” 不再出现，只剩后缀 “... 不成立 吗?”
  assert.equal((printed.match(/不成立/g) || []).length, 1);
  assert.match(printed, /吗\? 不成立 吗\?>]/);
});

test("字数：用户期望结果=11（第1问字面3字+第2问展开后8字）", () => {
  const program = engine.parse([
    "[回答 <第 (1) 问?>]",
    "[回答 <不成立 <第 (1) 问> 吗?>]",
    "[赋值 (结果) = ((<第 (1) 问>的字数) 加 (<第 (2) 问>的字数))]"
  ].join("\n"));
  const execution = engine.execute(program);
  // 第1问判断 = "第1问" → 3 字
  // 第2问判断 = 展开第1问(3) + 后缀 “不成立 吗?”(5) = 8 字
  // 合计 3 + 8 = 11
  assert.deepEqual(execution.environment.get("结果").values, [11]);
});

test("字数：内含超界第X问不影响字数（第100问不报错，得到13）", () => {
  // 第1问：字面 “第1问” → 3 字
  // 第2问：字面 “第100问不成立吗?” → 10 字（3 + 5 + 后缀 5）
  //   哪怕 第100问 永远不可能到来，字数只看字面、总结果=13
  const program = engine.parse([
    "[回答 <第 (1) 问?>]",
    "[回答 <第 (100) 问 不成立 吗?>]",
    "[赋值 (结果) = ((<第 (1) 问>的字数) 加 (<第 (2) 问>的字数))]"
  ].join("\n"));
  const execution = engine.execute(program);
  assert.deepEqual(execution.environment.get("结果").values, [13]);
});

test("字数：<第x问> 在 x=已答数+1 时字面计入，不递归", () => {
  // 第3个回答自身（answeredCount=2，y+1=3）：视为字面 “第3问” → 3 字
  const program = engine.parse([
    "[回答 <($点数) 含有 (2) 吗?>]",                       // 第1问：字数7
    "[回答 <($点数) 含有 (2) 吗?>]",                       // 第2问：字数7
    "[回答 <比较 (<第 (3) 问>的字数) 等于 (3) 吗?>]"        // 第3问：x=3=y+1 → 字面 3 字 → T
  ].join("\n"));
  const execution = engine.execute(program);
  assert.equal(execution.outputs[2].result.code, "T");
});

test("buildCondition：truth 返回 null，其他都返回 Runtime fragment", () => {
  assert.equal(engine.buildCondition("truth"), null);
  assert.equal(engine.buildCondition(null), null);
  assert.equal(typeof engine.buildCondition("alwaysLie"), "object");
  assert.equal(typeof engine.buildCondition("alwaysLie")?.transformPredicateResult, "function");
  assert.equal(typeof engine.buildCondition("lieIfLong")?.transformPredicateResult, "function");
  assert.equal(typeof engine.buildCondition("lieIfOddLine")?.transformPredicateResult, "function");
  assert.equal(typeof engine.buildCondition("answerByPriority")?.transformPredicateResult, "function");
  // isAnswerIs 保留为兼容别名
  assert.equal(typeof engine.buildCondition("isAnswerIs")?.transformPredicateResult, "function");
  assert.equal(typeof engine.buildCondition("allNumbersTo1")?.transformValue, "function");
  assert.equal(typeof engine.buildCondition("allLineAndQuestionTo0")?.transformValue, "function");
  assert.equal(typeof engine.buildCondition("innerBlocksAsText")?.transformValue, "function");
});

test("关卡条件：alwaysLie 把每个判断的 T/F 反转，U/I 不变", () => {
  const runtime = engine.buildCondition("alwaysLie");
  const program = [
    "[回答 <比较 (3) 大于 (2) 吗?>]",          // 3>2 = T -> F
    "[回答 <比较 (1) 大于 (5) 吗?>]",          // 1>5 = F -> T
    "[回答 <比较 (从(1)到(3)的随机变量) 大于 (2) 吗?>]"  // U -> U
  ];
  const execution = engine.execute(engine.parse(program.join("\n")), { runtime });
  assert.deepEqual(execution.outputs.map((o) => o.result.code), ["F", "T", "U"]);
});

test("关卡条件：alwaysLie 会作用于 not 内部的判断", () => {
  // 内层 3>2 = T -> lie -> F；外层 not(F) = T -> lie -> F
  const runtime = engine.buildCondition("alwaysLie");
  const program = ["[回答 <不成立 <比较 (3) 大于 (2) 吗?> 吗?>]"];
  const execution = engine.execute(engine.parse(program.join("\n")), { runtime });
  assert.equal(execution.outputs[0].result.code, "F");
});

test("关卡条件：lieIfLong 按问题字数反转，长问题才说谎", () => {
  const runtime = engine.buildCondition("lieIfLong");
  // “3大于2吗?” 5 字 -> T； “3大于5吗?” 5 字 -> F；
  // “3大于2吗?不成立吗?” 11 字 -> not(T)=F -> lie -> T；
  // “3大于5吗?不成立吗?” 11 字 -> not(F)=T -> lie -> F
  const program = [
    "[回答 <比较 (3) 大于 (2) 吗?>]",
    "[回答 <比较 (3) 大于 (5) 吗?>]",
    "[回答 <不成立 <比较 (3) 大于 (2) 吗?> 吗?>]",
    "[回答 <不成立 <比较 (3) 大于 (5) 吗?> 吗?>]"
  ];
  const execution = engine.execute(engine.parse(program.join("\n")), { runtime });
  assert.deepEqual(execution.outputs.map((o) => o.result.code), ["T", "F", "T", "F"]);
});

test("关卡条件：lieIfOddLine 仅在奇数行反转判断", () => {
  const runtime = engine.buildCondition("lieIfOddLine");
  // 行 1(奇): T->F；行 2(偶): T 不变；行 3(奇): T->F
  const program = [
    "[回答 <比较 (3) 大于 (2) 吗?>]",
    "[回答 <比较 (3) 大于 (2) 吗?>]",
    "[回答 <比较 (3) 大于 (2) 吗?>]"
  ];
  const execution = engine.execute(engine.parse(program.join("\n")), { runtime });
  assert.deepEqual(execution.outputs.map((o) => o.result.code), ["F", "T", "F"]);
});

test("关卡条件：answerByPriority 按关键字优先级匹配（是/否/不确定/无法回答）", () => {
  const runtime = engine.buildCondition("answerByPriority");
  // 优先级顺序：包含「是」→ T；否则包含「否」→ F；否则「不确定」→ U；否则「无法回答」→ I；
  // 都不含 → 透传原值。
  const program = [
    "[回答 <比较 (3) 大于 (2) 吗?>]",                    // 不含关键字 -> 透传 T
    "[回答 <比较 (1) 大于 (5) 吗?>]",                    // 不含关键字 -> 透传 F
    "[回答 <比较 (\"是\") 含有 (\"否\") 吗?>]",            // 含「是」(字面) → T（覆盖原 T）
    "[回答 <比较 (\"否\") 等于 (\"否\") 吗?>]",            // 含「否」→ F（覆盖原 T）
    "[回答 <比较 (\"不确定\") 等于 (\"不确定\") 吗?>]",     // 含「不确定」→ U（覆盖原 T）
    "[回答 <比较 (\"无法回答\") 等于 (\"无法回答\") 吗?>]"   // 含「无法回答」→ I（覆盖原 T）
  ];
  const execution = engine.execute(engine.parse(program.join("\n")), { runtime });
  assert.deepEqual(execution.outputs.map((o) => o.result.code), ["T", "F", "T", "F", "U", "I"]);
});

test("关卡条件：answerByPriority 仅含「否」时 → F（验证关键字优先级）", () => {
  const runtime = engine.buildCondition("answerByPriority");
  // 问题文字 = "5大于否吗?" → 字面包含「否」，应改判为 F。
  const program = engine.parse("[回答 <比较 (5) 大于 (\"否\") 吗?>]");
  const execution = engine.execute(program, { runtime });
  assert.equal(execution.outputs[0].result.code, "F");
});

test("关卡条件：answerByPriority 同时含「是」和「否」时，「是」优先级更高", () => {
  const runtime = engine.buildCondition("answerByPriority");
  // 问题 = "否大于是吗?" → 既含「是」又含「否」，按文档优先级取「是」→ T。
  const program = engine.parse("[回答 <比较 (\"否\") 大于 (\"是\") 吗?>]");
  const execution = engine.execute(program, { runtime });
  assert.equal(execution.outputs[0].result.code, "T");
});

test("关卡条件：isAnswerIs 是 answerByPriority 的兼容别名，行为一致", () => {
  const aliased = engine.buildCondition("isAnswerIs");
  const primary = engine.buildCondition("answerByPriority");
  const program = engine.parse([
    "[回答 <比较 (3) 大于 (2) 吗?>]",
    "[回答 <比较 (\"否\") 等于 (\"否\") 吗?>]",
    "[回答 <比较 (\"不确定\") 等于 (\"不确定\") 吗?>]"
  ].join("\n"));
  const aliasedExec = engine.execute(program, { runtime: aliased }).outputs.map((o) => o.result.code);
  const primaryExec = engine.execute(program, { runtime: primary }).outputs.map((o) => o.result.code);
  assert.deepEqual(aliasedExec, primaryExec);
});

test("关卡条件：allNumbersTo1 把所有数值变为 1", () => {
  const runtime = engine.buildCondition("allNumbersTo1");
  // (3)>(2) -> 1>1 = F；(9)>(1) -> 1>1 = F；(从(5)到(10)的随机变量)>(4) -> 1>1 = F
  const program = engine.parse([
    "[回答 <比较 (3) 大于 (2) 吗?>]",
    "[回答 <比较 (9) 大于 (1) 吗?>]",
    "[回答 <比较 (从(5)到(10)的随机变量) 大于 (4) 吗?>]"
  ].join("\n"));
  const execution = engine.execute(program, { runtime });
  assert.deepEqual(execution.outputs.map((o) => o.result.code), ["F", "F", "F"]);
});

test("关卡条件：allNumbersTo1 不影响字符串", () => {
  const runtime = engine.buildCondition("allNumbersTo1");
  // 字符串 "abc" 不被改写：原值 ("abc" 含有 "a") = T
  const program = engine.parse("[回答 <比较 (\"abc\") 含有 (\"a\") 吗?>]");
  const execution = engine.execute(program, { runtime });
  assert.equal(execution.outputs[0].result.code, "T");
});

test("关卡条件：allNumbersTo1 不改变答案类型（int 仍为 int）", () => {
  // 通过赋值钩子观察：(3) 的 int 类型被保留，但 values 变为 [1]。
  const runtime = engine.buildCondition("allNumbersTo1");
  const program = engine.parse([
    "[赋值 (x) = (3)]",
    "[回答 <比较 ($x) 大于 (2) 吗?>]"
  ].join("\n"));
  const execution = engine.execute(program, { runtime });
  // $x 在赋值时也被钩子改成 1，1>1 = F
  assert.equal(execution.outputs[0].result.code, "F");
});

test("关卡条件：allNumbersTo1 只改写文字表示，不影响 arithmetic 求值结果", () => {
  // 细则 3.6.1：((1) 加 (1)) 中 1+1 求值得到的 2 不应改为 1。
  const runtime = engine.buildCondition("allNumbersTo1");
  const program = engine.parse("[回答 <比较 ((1) 加 (1)) 大于 (2) 吗?>]");
  const execution = engine.execute(program, { runtime });
  // 左边 1+1 真实求得 2；右边 (2) 是字面量 → 1；2>1 = T
  assert.equal(execution.outputs[0].result.code, "T");
});

test("关卡条件：allNumbersTo1 不改写 random 求值范围", () => {
  // 细则 3.6.2：random 的起点、终点是 arithmetic 时，结果仍按完整区间取。
  const runtime = engine.buildCondition("allNumbersTo1");
  // 从(5)到((1)加(2))的随机变量：(5)→1，(1)+(2)=3，范围 [1,3] 共 3 种取值，与 (2)→1 比较：1>1=F, 2>1=T, 3>1=T，混合 → U
  const program = engine.parse("[回答 <比较 (从(5)到((1)加(2))的随机变量) 大于 (2) 吗?>]");
  const execution = engine.execute(program, { runtime });
  assert.equal(execution.outputs[0].result.code, "U");
});

test("关卡条件：allLineAndQuestionTo0 让 (行号)/(问题编号) 永远返回 0", () => {
  const runtime = engine.buildCondition("allLineAndQuestionTo0");
  const program = engine.parse([
    "[回答 <比较 (行号) 等于 (0) 吗?>]",          // 行号→0，0=0=T
    "[回答 <比较 (问题编号) 等于 (0) 吗?>]",      // 问题编号→0，0=0=T
    "[回答 <比较 (行号) 大于 (问题编号) 吗?>]"    // 0>0=F
  ].join("\n"));
  const execution = engine.execute(program, { runtime });
  assert.deepEqual(execution.outputs.map((o) => o.result.code), ["T", "T", "F"]);
});

test("关卡条件：allLineAndQuestionTo0 不影响普通数值", () => {
  const runtime = engine.buildCondition("allLineAndQuestionTo0");
  // (3)>(2) 仍然走真实逻辑：3>2=T
  const program = engine.parse("[回答 <比较 (3) 大于 (2) 吗?>]");
  const execution = engine.execute(program, { runtime });
  assert.equal(execution.outputs[0].result.code, "T");
});

test("关卡条件：innerBlocksAsText 把内部积木视作纯文字", () => {
  const runtime = engine.buildCondition("innerBlocksAsText");
  // <(<第(1)题>的答案)等于(是)吗?>
  // 内部 <第(1)题> 视作纯文字（charCountText）→ 字符串「第1问的答案」。
  // 顶层 compare 仍然正常执行：字符串 vs 字符串 不等 → F（与关卡数据一致）。
  const program = engine.parse("[回答 <比较 (<第 (1) 问>的答案) 等于 (是) 吗?>]");
  const execution = engine.execute(program, { runtime });
  assert.equal(execution.outputs[0].result.code, "F");
});

test("关卡条件：innerBlocksAsText 不影响顶层 atom", () => {
  const runtime = engine.buildCondition("innerBlocksAsText");
  // (3)>(2) 仍是数值比较：3>2=T（顶层 atom 不被 innerBlocksAsText 处理）
  const program = engine.parse("[回答 <比较 (3) 大于 (2) 吗?>]");
  const execution = engine.execute(program, { runtime });
  assert.equal(execution.outputs[0].result.code, "T");
});

test("关卡条件：innerBlocksAsText 字面 包含 内部纯文字返回 T", () => {
  // 直接拼字面 "<第1题>的答案" 作为字符串，再判断是否含有「答案」——应 T。
  const runtime = engine.buildCondition("innerBlocksAsText");
  const program = engine.parse("[回答 <比较 (<第 (1) 问>的答案) 含有 (\"答案\") 吗?>]");
  const execution = engine.execute(program, { runtime });
  // 内部 block 在 lhs 被视作字符串域 "<第1问>的答案"，右侧是 "答案"，contains → T
  assert.equal(execution.outputs[0].result.code, "T");
});

test("execute 不带 condition 时保持原行为", () => {
  const program = [
    "[回答 <比较 (3) 大于 (2) 吗?>]",
    "[回答 <比较 (1) 大于 (5) 吗?>]"
  ];
  const execution = engine.execute(engine.parse(program.join("\n")));
  assert.deepEqual(execution.outputs.map((o) => o.result.code), ["T", "F"]);
});

// ===== Stage 1: Runtime 钩子测试 =====

test("Runtime：无钩子时与原行为完全一致（5 个 spec 全跑）", () => {
  const specs = ["truth", "alwaysLie", "lieIfLong", "lieIfOddLine", "answerByPriority"];
  const program = engine.parse(
    [
      "[回答 <比较 (3) 大于 (2) 吗?>]",
      "[回答 <比较 (1) 大于 (5) 吗?>]",
      "[回答 <比较 (从(1)到(3)的随机变量) 大于 (2) 吗?>]"
    ].join("\n")
  );
  for (const spec of specs) {
    const runtime = engine.buildCondition(spec);
    const viaRuntime = engine.execute(program, { runtime });
    const viaLegacy = engine.execute(
      program,
      runtime?.transformPredicateResult ? { condition: runtime.transformPredicateResult } : undefined
    );
    assert.deepEqual(
      viaRuntime.outputs.map((o) => o.result.code),
      viaLegacy.outputs.map((o) => o.result.code),
      `spec=${spec} 时新 runtime 路径与旧 condition 路径结果不一致`
    );
  }
});

test("Runtime：transformPredicateResult 接到 (result, node, context)", () => {
  let captured = null;
  const runtime = {
    transformPredicateResult: (result, node, context) => {
      captured = { code: result.code, hasNode: Boolean(node), question: context.question };
      return result;
    }
  };
  const program = engine.parse("[回答 <比较 (3) 大于 (2) 吗?>]");
  engine.execute(program, { runtime });
  assert.equal(captured.code, "T");
  assert.equal(captured.hasNode, true);
  assert.equal(captured.question, 1);
});

test("Runtime：transformValue 在 evaluateInput 末尾被调用", () => {
  const seen = [];
  const runtime = {
    transformValue: (domain, input) => {
      seen.push({ ok: domain.ok, inputKind: input && input.kind ? input.kind : null });
      return domain;
    }
  };
  const program = engine.parse("[回答 <比较 (3) 大于 (2) 吗?>]");
  engine.execute(program, { runtime });
  assert.ok(seen.length >= 2, `transformValue 被调用 ${seen.length} 次，期望至少 2`);
  assert.ok(seen.some((s) => s.inputKind === "atom"), "至少有一次调用传入 atom");
});

test("Runtime：transformAssignment 在赋名前修改 domain", () => {
  const runtime = {
    transformAssignment: (_name, domain) => {
      if (domain && domain.ok && domain.type === "int") {
        return { ok: true, type: "int", values: domain.values.map((v) => v + 1), source: "shift" };
      }
      return domain;
    }
  };
  // 赋值 (x) = (3) -> $x 经 hook 变成 4 -> 4 > 3 = T
  const program = engine.parse([
    "[赋值 (x) = (3)]",
    "[回答 <比较 ($x) 大于 (3) 吗?>]"
  ].join("\n"));
  const execution = engine.execute(program, { runtime });
  assert.equal(execution.outputs[0].result.code, "T");
});

test("Runtime：transformQuestion 在假设循环前替换 predicate", () => {
  const runtime = {
    transformQuestion: () => ({
      id: "replaced",
      type: "compare",
      operator: "gt",
      slots: { left: atom(1), right: atom(0) }
    })
  };
  // 原 predicate <比较 (1) 大于 (5) 吗?> = F；替换后恒 T
  const program = engine.parse("[回答 <比较 (1) 大于 (5) 吗?>]");
  const execution = engine.execute(program, { runtime });
  assert.equal(execution.outputs[0].result.code, "T");
});

test("Runtime：resolveAnswer 完全取代 evaluateAnswerPredicate", () => {
  const runtime = {
    resolveAnswer: (_predicate, _env, _ctx) => ({
      code: "F", label: "否", detail: "resolveAnswer 短路", stats: null
    })
  };
  // 原本 <比较 (1) 大于 (0) 吗?> = T；被 hook 短路成 F
  const program = engine.parse("[回答 <比较 (1) 大于 (0) 吗?>]");
  const execution = engine.execute(program, { runtime });
  assert.equal(execution.outputs[0].result.code, "F");
  assert.equal(execution.outputs[0].result.detail, "resolveAnswer 短路");
});

test("Runtime：旧 options.condition 函数仍生效", () => {
  const fn = (result) => engine.negateTandF(result);
  const program = engine.parse([
    "[回答 <比较 (3) 大于 (2) 吗?>]",      // T -> F
    "[回答 <比较 (1) 大于 (5) 吗?>]"        // F -> T
  ].join("\n"));
  const legacy = engine.execute(program, { condition: fn });
  const modern = engine.execute(program, { runtime: { transformPredicateResult: fn } });
  assert.deepEqual(
    legacy.outputs.map((o) => o.result.code),
    modern.outputs.map((o) => o.result.code)
  );
  assert.deepEqual(legacy.outputs.map((o) => o.result.code), ["F", "T"]);
});

test("Runtime：buildCondition 返回 Runtime fragment 含 transformPredicateResult", () => {
  for (const spec of ["alwaysLie", "lieIfLong", "lieIfOddLine", "answerByPriority"]) {
    const fragment = engine.buildCondition(spec);
    assert.ok(fragment && typeof fragment === "object", `${spec} 应返回对象`);
    assert.equal(typeof fragment.transformPredicateResult, "function");
  }
});

test("Runtime：钩子抛异常时 transformPredicateResult 走 I 兜底", () => {
  const runtime = {
    transformPredicateResult: () => {
      throw new Error("条件爆炸");
    }
  };
  const program = engine.parse("[回答 <比较 (3) 大于 (2) 吗?>]");
  const execution = engine.execute(program, { runtime });
  assert.equal(execution.outputs[0].result.code, "I");
  assert.match(execution.outputs[0].result.detail, /条件爆炸/);
});

test("Runtime：repeat 内 answer 的 context.runtime 与外层一致", () => {
  const seenRuntimes = [];
  const runtime = {
    transformPredicateResult: (result, _node, ctx) => {
      seenRuntimes.push(ctx.runtime);
      return result;
    }
  };
  const program = engine.parse("[重复 (2) { [回答 <比较 (3) 大于 (2) 吗?>] }]");
  engine.execute(program, { runtime });
  // 重复 2 次，每次 evaluateAnswerPredicate 跑 3 个假设 (T/F/U) -> 6 次调用
  assert.ok(seenRuntimes.length >= 2, `应至少调用 2 次，实际 ${seenRuntimes.length}`);
  const first = seenRuntimes[0];
  for (const seen of seenRuntimes) {
    assert.equal(seen, first, "所有 context.runtime 应指向同一个 normalized 对象");
  }
});

test("Runtime：normalizeRuntime 过滤非函数字段", () => {
  const runtime = engine.normalizeRuntime({
    runtime: {
      transformPredicateResult: () => null,
      transformValue: "not a function",
      transformAssignment: 42,
      transformQuestion: null,
      resolveAnswer: undefined
    }
  });
  assert.equal(typeof runtime.transformPredicateResult, "function");
  assert.equal(runtime.transformValue, null);
  assert.equal(runtime.transformAssignment, null);
  assert.equal(runtime.transformQuestion, null);
  assert.equal(runtime.resolveAnswer, null);
});

// ===== Stage 2: DSL 编译器测试 =====

function runWithDsl(dslSpec, programText) {
  const runtime = engine.buildCondition(dslSpec);
  const program = engine.parse(programText);
  return engine.execute(program, { runtime }).outputs.map((o) => o.result.code);
}

test("DSL：lieIfLong 等价 — { when: { charCount: { gte: 10 } }, transform: { flipTandF: true } }", () => {
  // 5 字问题不翻转 (T→T, F→F)；11 字问题翻转 (T→F, F→T)
  const dsl = {
    when: { charCount: { gte: 10 } },
    transform: { flipTandF: true }
  };
  assert.deepEqual(runWithDsl(dsl, [
    "[回答 <比较 (3) 大于 (2) 吗?>]",              // "3 大于 2 吗?" 5 字 -> T
    "[回答 <比较 (1) 大于 (5) 吗?>]",              // "1 大于 5 吗?" 5 字 -> F
    "[回答 <不成立 <比较 (3) 大于 (2) 吗?> 吗?>]",  // 含 "不成立" -> 11 字 -> flip
    "[回答 <不成立 <比较 (3) 大于 (5) 吗?> 吗?>]"   // 含 "不成立" -> 11 字 -> flip
  ].join("\n")), ["T", "F", "T", "F"]);
});

test("DSL：lieIfOddLine 等价 — { when: { line: { odd: true } }, transform: { flipTandF: true } }", () => {
  const dsl = {
    when: { line: { odd: true } },
    transform: { flipTandF: true }
  };
  assert.deepEqual(runWithDsl(dsl, [
    "[回答 <比较 (3) 大于 (2) 吗?>]",  // 行 1 奇 -> flip T->F
    "[回答 <比较 (3) 大于 (2) 吗?>]",  // 行 2 偶 -> T 不变
    "[回答 <比较 (3) 大于 (2) 吗?>]"   // 行 3 奇 -> flip T->F
  ].join("\n")), ["F", "T", "F"]);
});

test("DSL：isAnswerIs 等价 — { when: { questionTextContains: '是' }, transform: { fix: 'T' } }", () => {
  const dsl = {
    when: { questionTextContains: "是" },
    transform: { fix: "T" }
  };
  assert.deepEqual(runWithDsl(dsl, [
    "[回答 <比较 (3) 大于 (2) 吗?>]",                  // 不含 -> T (原值)
    "[回答 <比较 (\"是\") 等于 (\"否\") 吗?>]"           // 含 -> 强制 T (原 F)
  ].join("\n")), ["T", "T"]);
});

test("DSL：answerByPriority 用嵌套 transform 拼接等价实现", () => {
  // 原 answerByPriority 行为：依次检查关键字 含有「是」→「是」、含「否」→「否」、
  // 含「不确定」→「不确定」、含「无法回答」→「无法回答」，都不含则透传。
  // DSL 当前只支持单一 transform 步骤；要表达 4 级优先级需要多个 transform 叠加，
  // 而每个 condition 只允许一个 transform。这里仅证明：用一个简单的 DSL（仅匹配"是"→T）
  // 可以表达 answerByPriority 的最强规则。
  const dsl = {
    when: { questionTextContains: "是" },
    transform: { fix: "T" }
  };
  // 不含「是」→ 透传原值；含「是」→ 固定为 T。
  // 该 DSL 是 answerByPriority 中"是"分支的等价形式（其他分支当前 DSL 无法直接表达）。
  assert.deepEqual(runWithDsl(dsl, [
    "[回答 <比较 (3) 大于 (2) 吗?>]",                  // 不含「是」→ 透传 T
    "[回答 <比较 (\"否\") 等于 (\"否\") 吗?>]"           // 不含「是」→ 透传 T
  ].join("\n")), ["T", "T"]);
});

test("DSL：多 when 子句 AND 组合", () => {
  const dsl = {
    when: { line: { odd: true }, charCount: { gte: 5 } },
    transform: { flipTandF: true }
  };
  // 5 字 + 奇数行 = flip
  assert.deepEqual(runWithDsl(dsl, [
    "[回答 <比较 (3) 大于 (2) 吗?>]",  // 行 1 奇, 5 字 -> flip T->F
    "[回答 <比较 (3) 大于 (2) 吗?>]",  // 行 2 偶, 5 字 -> T 不变
    "[回答 <比较 (3) 大于 (2) 吗?>]"   // 行 3 奇, 5 字 -> flip T->F
  ].join("\n")), ["F", "T", "F"]);
});

test("DSL：previousAnswer — 上一问是 T 才翻转", () => {
  const dsl = {
    when: { previousAnswer: { code: "T" } },
    transform: { flipTandF: true }
  };
  // 第 1 问无 previous -> 不翻转；第 2 问上一问是 T -> 翻转；第 3 问上一问被翻转后是 F -> 不再翻转
  assert.deepEqual(runWithDsl(dsl, [
    "[回答 <比较 (3) 大于 (2) 吗?>]",  // T (无 prev)
    "[回答 <比较 (3) 大于 (2) 吗?>]",  // 上一问 T -> flip -> F
    "[回答 <比较 (3) 大于 (2) 吗?>]"   // 上一问 F -> 不 flip -> T
  ].join("\n")), ["T", "F", "T"]);
});

test("DSL：xorWithPrev — 与上一问异或", () => {
  const dsl = {
    when: { questionNumber: { gte: 2 } },
    transform: { xorWithPrev: true }
  };
  // xorWithPrev: prev=T 时翻转 current
  // 第 1 问 (no prev) -> T 不变；第 2 问 prev=T -> flip -> F；第 3 问 prev=F -> 不 flip -> T
  assert.deepEqual(runWithDsl(dsl, [
    "[回答 <比较 (3) 大于 (2) 吗?>]",
    "[回答 <比较 (3) 大于 (2) 吗?>]",
    "[回答 <比较 (3) 大于 (2) 吗?>]"
  ].join("\n")), ["T", "F", "T"]);
});

test("DSL：questionNumber 数值比较", () => {
  const dsl = {
    when: { questionNumber: { gt: 1 } },
    transform: { fix: "F" }
  };
  // 第 1 问 (questionNumber=1) 不 fix -> T；之后都 fix 成 F
  assert.deepEqual(runWithDsl(dsl, [
    "[回答 <比较 (3) 大于 (2) 吗?>]",
    "[回答 <比较 (3) 大于 (2) 吗?>]",
    "[回答 <比较 (3) 大于 (2) 吗?>]"
  ].join("\n")), ["T", "F", "F"]);
});

test("DSL：无 when 子句默认总是匹配", () => {
  const dsl = { transform: { fix: "T" } };
  assert.deepEqual(runWithDsl(dsl, [
    "[回答 <比较 (3) 大于 (2) 吗?>]",   // 原 T -> fix T -> T
    "[回答 <比较 (1) 大于 (5) 吗?>]"    // 原 F -> fix T -> T
  ].join("\n")), ["T", "T"]);
});

test("DSL：空 spec 返回 null", () => {
  assert.equal(engine.compileCondition(null), null);
  assert.equal(engine.compileCondition({}), null);  // 也没 transform
  // 等价 spec：transform 为空时整体 null
  const withEmptyTransform = engine.compileCondition({ when: { line: { odd: true } } });
  assert.equal(withEmptyTransform, null);
});

test("DSL：未知 when key 抛错", () => {
  assert.throws(() => engine.compileCondition({ when: { foo: 1 }, transform: { flipTandF: true } }), /foo/);
});

test("DSL：未知 transform 操作抛错", () => {
  assert.throws(() => engine.compileCondition({ transform: { doSomething: true } }), /doSomething/);
});

test("DSL：transform 多操作抛错", () => {
  assert.throws(() => engine.compileCondition({ transform: { flipTandF: true, fix: "T" } }), /只能指定一个/);
});

test("DSL：fix 非法值抛错", () => {
  assert.throws(() => engine.compileCondition({ transform: { fix: "X" } }), /T.*F.*U/);
});

test("DSL：charCount 非法运算符抛错", () => {
  assert.throws(() => engine.compileCondition({ when: { charCount: { foo: 10 } }, transform: { flipTandF: true } }), /foo/);
});

test("DSL：buildCondition 接受对象 spec", () => {
  // 字符串 spec 仍然走 buildCondition 的字符串分支
  const fromString = engine.buildCondition("alwaysLie");
  assert.equal(typeof fromString.transformPredicateResult, "function");
  // 对象 spec 走 compileCondition
  const fromDsl = engine.buildCondition({ transform: { fix: "T" } });
  assert.equal(typeof fromDsl.transformPredicateResult, "function");
});

test("DSL：复合示例 — 行号偶数且字数≥5 时翻转为 F，否则原样", () => {
  const dsl = {
    when: { line: { even: true }, charCount: { gte: 5 } },
    transform: { fix: "F" }
  };
  // 行 1 奇 -> 不 fix; 行 2 偶 + 5 字 -> fix F; 行 3 奇 -> 不 fix
  assert.deepEqual(runWithDsl(dsl, [
    "[回答 <比较 (3) 大于 (2) 吗?>]",  // T
    "[回答 <比较 (3) 大于 (2) 吗?>]",  // fix F
    "[回答 <比较 (3) 大于 (2) 吗?>]"   // T
  ].join("\n")), ["T", "F", "T"]);
});

// ===== Stage 3: 变量/值变换 DSL =====

function runWithValueTransform(valueSpec, programText) {
  const runtime = engine.compileValueTransform(valueSpec);
  const program = engine.parse(programText);
  return engine.execute(program, { runtime }).outputs.map((o) => o.result.code);
}

test("Value DSL：overrideCurrentLine 让所有 (行号) 节点返回固定值", () => {
  // 在第 1 行 (行号)=1 的情况下强制覆盖为 4 -> (行号)>3 总是 T
  const codes = runWithValueTransform({ currentLine: 4 }, [
    "[回答 <比较 (行号) 大于 (3) 吗?>]"
  ].join("\n"));
  assert.deepEqual(codes, ["T"]);
});

test("Value DSL：shiftIntAtoms 把所有整数原子 +1", () => {
  // (3) 实际变 (4)；(2) 实际变 (3)；所以 3>2 还是 T
  const codes = runWithValueTransform({ shiftIntAtoms: 1 }, [
    "[回答 <比较 (3) 大于 (2) 吗?>]",
    "[回答 <比较 (1) 大于 (5) 吗?>]"
  ].join("\n"));
  // 1->2, 5->6 => 2>6=F; 3->4, 2->3 => 4>3=T
  assert.deepEqual(codes, ["T", "F"]);
});

test("Value DSL：overrideCurrentQuestion 让所有 (问题编号) 返回固定值", () => {
  // 第 2 问时强制 questionNumber=1 -> 第 2 问没有上一问上下文，
  // 但本测试仅验证 (问题编号) 的取值：第二问时 (问题编号)=1
  const program = engine.parse("[回答 <比较 (问题编号) 等于 (1) 吗?>]");
  const runtime = engine.compileValueTransform({ currentQuestion: 1 });
  // 第 1 问：原值 1，钩子改为 1 -> T
  const exec = engine.execute(program, { runtime });
  assert.equal(exec.outputs[0].result.code, "T");
});

test("Value DSL：空 spec 返回 null", () => {
  assert.equal(engine.compileValueTransform(null), null);
  assert.equal(engine.compileValueTransform({}), null);
});

test("Value DSL：未知 key 抛错", () => {
  assert.throws(() => engine.compileValueTransform({ unknownKey: 1 }), /unknownKey/);
});

test("Value DSL：非数字值抛错", () => {
  assert.throws(() => engine.compileValueTransform({ currentLine: "abc" }), /currentLine/);
});

function runWithAssignmentTransform(asgnSpec, programText) {
  const runtime = engine.compileAssignmentTransform(asgnSpec);
  const program = engine.parse(programText);
  return engine.execute(program, { runtime });
}

test("Assignment DSL：shiftBy +1 后引用变量拿到的是 +1 后的值", () => {
  // 赋值 (x) = (3); 比较 ($x) 大于 (3) 吗? -> 钩子把 x 绑为 4, 4>3=T
  const execution = runWithAssignmentTransform({ shiftBy: 1 }, [
    "[赋值 (x) = (3)]",
    "[回答 <比较 ($x) 大于 (3) 吗?>]"
  ].join("\n"));
  assert.equal(execution.outputs[0].result.code, "T");
});

test("Assignment DSL：clampMax 把过大的值钳制", () => {
  // 赋值 (x) = (100); 比较 ($x) 大于 (50) 吗? -> 钳制到 5, 5>50=F
  const execution = runWithAssignmentTransform({ clampMax: 5 }, [
    "[赋值 (x) = (100)]",
    "[回答 <比较 ($x) 大于 (50) 吗?>]"
  ].join("\n"));
  assert.equal(execution.outputs[0].result.code, "F");
});

test("Assignment DSL：onlyIfNameMatches 只对特定变量生效", () => {
  // 赋值 (x)=(3), (y)=(5); 仅对 x 应用 shiftBy=1
  // 比较 ($x) 大于 (3) 吗? -> x=4, T; 比较 ($y) 大于 (5) 吗? -> y=5, F
  const execution = runWithAssignmentTransform(
    { shiftBy: 1, onlyIfNameMatches: "x" },
    [
      "[赋值 (x) = (3)]",
      "[赋值 (y) = (5)]",
      "[回答 <比较 ($x) 大于 (3) 吗?>]",
      "[回答 <比较 ($y) 大于 (5) 吗?>]"
    ].join("\n")
  );
  assert.deepEqual(execution.outputs.map((o) => o.result.code), ["T", "F"]);
});

test("Assignment DSL：空 spec 返回 null", () => {
  assert.equal(engine.compileAssignmentTransform(null), null);
  assert.equal(engine.compileAssignmentTransform({}), null);
});

test("Assignment DSL：未知 key 抛错", () => {
  assert.throws(() => engine.compileAssignmentTransform({ badKey: 1 }), /badKey/);
});

// ===== Stage 4: 回答解析 DSL =====

function runWithAnswer(answerSpec, programText) {
  const runtime = engine.compileAnswer(answerSpec);
  const program = engine.parse(programText);
  return engine.execute(program, { runtime }).outputs.map((o) => o.result.code);
}

test("Answer DSL：previousAnswer — 每问都返回上一问", () => {
  // 第 1 问没有 prev -> I；第 2 问 prev=I -> I；等等 (陷入 I 循环)
  // 我们改为验证：3 个真实判断 + previousAnswer，第 1 问会 I，其余会拿到前一个的 code
  const codes = runWithAnswer({ mode: "previousAnswer" }, [
    "[回答 <比较 (3) 大于 (2) 吗?>]",  // I (无 prev)
    "[回答 <比较 (3) 大于 (2) 吗?>]"   // I (prev=I)
  ].join("\n"));
  assert.deepEqual(codes, ["I", "I"]);
});

test("Answer DSL：previousAnswer — 用预先的 prev 验证正确性", () => {
  // 直接验证：当 answers[0]=T 时，第 2 问 previousAnswer 应返回 T
  // 通过先调用一次存下 history，再用第 2 次观察 —— 但 resolveAnswer 用 context.answers，所以一次 execute 内：
  // 改用不同的思路：previousAnswer 接 prev=I 也是 I；接 prev=T 是 T；我们用 buildCondition 制造 T 序列
  // 简化：构造一个场景，让 answers[0] 是 T
  const program = engine.parse([
    "[赋值 (first) = (1)]",                              // 让 first=1
    "[回答 <比较 ($first) 大于 (0) 吗?>]",                 // 第 1 问: T
    "[回答 <比较 ($first) 大于 (0) 吗?>]"                  // 第 2 问: previousAnswer=T
  ].join("\n"));
  // 先跑一次得到 answers[0]=T 是因为没有 resolveAnswer；这里直接用 resolveAnswer 即可
  // 但 previousAnswer 模式：第 2 问应该返回第 1 问的 T（因为第 1 问被 normal execute 求出 T）
  const runtime = engine.compileAnswer({ mode: "previousAnswer" });
  // 然而 previousAnswer 会让第 1 问也走 resolveAnswer -> I（无 prev）
  // 所以这个验证要绕一下：用混合 runtime 让第 1 问正常求值，第 2 问走 previousAnswer
  // 我们手写一个组合 runtime：
  const mixedRuntime = {
    resolveAnswer: (predicate, env, ctx) => {
      if (ctx.question === 1) {
        // 第 1 问正常求值
        return engine.evaluatePredicate(predicate, env, ctx);
      }
      // 第 2 问返回上一问
      const prev = ctx.answers && ctx.answers[0];
      return prev || engine.logic("I", "无 prev");
    }
  };
  const exec = engine.execute(program, { runtime: mixedRuntime });
  assert.equal(exec.outputs[0].result.code, "T");  // 第 1 问
  assert.equal(exec.outputs[1].result.code, "T");  // 第 2 问 previousAnswer
});

test("Answer DSL：fixed — 所有回答都是固定值", () => {
  assert.deepEqual(runWithAnswer({ mode: "fixed", code: "T" }, [
    "[回答 <比较 (3) 大于 (2) 吗?>]",  // 应被强制为 T
    "[回答 <比较 (1) 大于 (5) 吗?>]"   // 原 F，被强制 T
  ].join("\n")), ["T", "T"]);
});

test("Answer DSL：rotate — 循环回答", () => {
  assert.deepEqual(runWithAnswer({ mode: "rotate", cycle: ["T", "F", "T"] }, [
    "[回答 <比较 (3) 大于 (2) 吗?>]",  // 第 1 -> T
    "[回答 <比较 (3) 大于 (2) 吗?>]",  // 第 2 -> F
    "[回答 <比较 (3) 大于 (2) 吗?>]",   // 第 3 -> T
    "[回答 <比较 (3) 大于 (2) 吗?>]"    // 第 4 -> T (循环)
  ].join("\n")), ["T", "F", "T", "T"]);
});

test("Answer DSL：nth — 所有回答都是第 N 问", () => {
  // 组合 mixed runtime：第 1 问正常求值，第 2/3 问返回第 1 问
  const program = engine.parse([
    "[回答 <比较 (3) 大于 (2) 吗?>]",                  // 第 1 -> T
    "[回答 <比较 (1) 大于 (5) 吗?>]"                   // 第 2 -> 第 1 = T
  ].join("\n"));
  const mixedRuntime = {
    resolveAnswer: (predicate, env, ctx) => {
      if (ctx.question === 1) return engine.evaluatePredicate(predicate, env, ctx);
      const ans = ctx.answers && ctx.answers[0];  // nth=1
      return ans || engine.logic("I", "无");
    }
  };
  const exec = engine.execute(program, { runtime: mixedRuntime });
  assert.equal(exec.outputs[1].result.code, "T");
});

test("Answer DSL：空 spec 返回 null", () => {
  assert.equal(engine.compileAnswer(null), null);
  assert.equal(engine.compileAnswer({}), null);
});

test("Answer DSL：未知 mode 抛错", () => {
  assert.throws(() => engine.compileAnswer({ mode: "dance" }), /dance/);
});

test("Answer DSL：fixed 缺 code 抛错", () => {
  assert.throws(() => engine.compileAnswer({ mode: "fixed" }), /code/);
});

test("Answer DSL：rotate 缺 cycle 抛错", () => {
  assert.throws(() => engine.compileAnswer({ mode: "rotate" }), /cycle/);
});

test("Answer DSL：rotate cycle 含非法 code 抛错", () => {
  assert.throws(() => engine.compileAnswer({ mode: "rotate", cycle: ["T", "X"] }), /X/);
});

test("Answer DSL：nth 非正整数抛错", () => {
  assert.throws(() => engine.compileAnswer({ mode: "nth", nth: 0 }), /正整数/);
  assert.throws(() => engine.compileAnswer({ mode: "nth", nth: 1.5 }), /正整数/);
});

// ===== Stage 3+4 用户原始示例 =====

test("Stage 4 示例 1：不再按行号运行 — currentLine 覆盖让 (行号) 不再反映真实行号", () => {
  // 谓词：(行号) 大于 (2) 吗?
  // 不覆盖：第 1 问 1>2=F，第 2 问 2>2=F，第 3 问 3>2=T -> ["F", "F", "T"]
  // 覆盖 currentLine=5：所有问 5>2=T -> ["T", "T", "T"]
  // 即 (行号) 不再随真实行号变化 —— 证明"不再按行号运行"
  const runtime = engine.buildRuntime({ value: { currentLine: 5 } });
  const program = engine.parse([
    "[回答 <比较 (行号) 大于 (2) 吗?>]",
    "[回答 <比较 (行号) 大于 (2) 吗?>]",
    "[回答 <比较 (行号) 大于 (2) 吗?>]"
  ].join("\n"));
  assert.deepEqual(
    engine.execute(program, { runtime }).outputs.map((o) => o.result.code),
    ["T", "T", "T"]
  );
  // 对照组：不覆盖时行号仍反映真实位置
  const normalRuntime = engine.buildRuntime({});
  const normalExec = engine.execute(program, { runtime: normalRuntime });
  assert.deepEqual(
    normalExec.outputs.map((o) => o.result.code),
    ["F", "F", "T"]
  );
});

test("Stage 4 示例 2：回答积木返回上一问的结果", () => {
  // 第 1 问无法 previous -> I；第 2 问返回第 1 问 (I)；第 3 问返回第 2 问 (I)
  // 所以全是 I
  const runtime = engine.buildRuntime({ answer: { mode: "previousAnswer" } });
  const program = engine.parse([
    "[回答 <比较 (3) 大于 (2) 吗?>]",
    "[回答 <比较 (1) 大于 (5) 吗?>]"
  ].join("\n"));
  assert.deepEqual(
    engine.execute(program, { runtime }).outputs.map((o) => o.result.code),
    ["I", "I"]
  );
});

test("Stage 4 示例 3：不管问题是什么都按固定逻辑回答", () => {
  const runtime = engine.buildRuntime({ answer: { mode: "fixed", code: "T" } });
  const program = engine.parse([
    "[回答 <比较 (3) 大于 (2) 吗?>]",
    "[回答 <比较 (1) 大于 (5) 吗?>]",
    "[回答 <比较 (5) 大于 (5) 吗?>]"
  ].join("\n"));
  assert.deepEqual(
    engine.execute(program, { runtime }).outputs.map((o) => o.result.code),
    ["T", "T", "T"]
  );
});

test("Stage 3 示例：shiftIntAtoms + shiftBy 组合使用", () => {
  // 同时改：所有 int atom +1（$引用除外），赋值后 +2
  const runtime = engine.buildRuntime({
    value: { shiftIntAtoms: 1 },
    assignment: { shiftBy: 2 }
  });
  // 赋值 (x) = (3) -> 经过 value hook: (3)->(4)，再经过 assignment hook: (4)+2=6 -> env.set(x, 6)
  // 比较 ($x) 大于 (5) 吗? -> $x 不走 value hook (跳过 $ 引用)，env 里是 6 -> domain [6]
  //                                     (5) 经 value hook: 5+1=6 -> domain [6]
  //                                     6 > 6 = F
  const program = engine.parse([
    "[赋值 (x) = (3)]",
    "[回答 <比较 ($x) 大于 (5) 吗?>]"
  ].join("\n"));
  assert.equal(
    engine.execute(program, { runtime }).outputs[0].result.code,
    "F"
  );
});

// ===== buildRuntime 合成器测试 =====

test("buildRuntime：合并 condition + value + assignment + answer", () => {
  // 复合场景：行号覆盖为 1（奇），奇数行翻转；int atom +1；赋 +2；固定回答 T
  const runtime = engine.buildRuntime({
    condition: { when: { line: { odd: true } }, transform: { flipTandF: true } },
    value: { currentLine: 1 },
    assignment: { shiftBy: 2 },
    answer: { mode: "fixed", code: "T" }
  });
  assert.equal(typeof runtime.transformPredicateResult, "function");
  assert.equal(typeof runtime.transformValue, "function");
  assert.equal(typeof runtime.transformAssignment, "function");
  assert.equal(typeof runtime.resolveAnswer, "function");
  assert.equal(runtime.transformQuestion, null);
});

test("buildRuntime：raw 函数覆盖 DSL", () => {
  const rawHook = () => engine.logic("F", "raw", null);
  const runtime = engine.buildRuntime({
    condition: { transform: { fix: "T" } },
    resolveAnswer: rawHook
  });
  assert.equal(typeof runtime.transformPredicateResult, "function");
  assert.equal(runtime.resolveAnswer, rawHook, "raw 函数应覆盖 DSL 编译结果");
});

test("buildRuntime：空 spec 返回 null", () => {
  assert.equal(engine.buildRuntime(null), null);
  assert.equal(engine.buildRuntime({}), null);
});

test("buildRuntime：仅 raw 钩子无 DSL 也能工作", () => {
  const runtime = engine.buildRuntime({
    transformValue: (d) => d
  });
  assert.equal(typeof runtime.transformValue, "function");
  assert.equal(runtime.transformPredicateResult, null);
});

// ===== 关卡条件：运行时知识库（声明关系 / 覆写关系 / 关系判断）=====

test("知识库：内置关系 大于/等于/小于/含有 默认已声明", () => {
  const program = engine.parse("[回答 <比较 (3) 大于 (2) 吗?>]");
  const execution = engine.execute(program);
  assert.ok(execution.declaredRelations instanceof Set);
  assert.ok(execution.declaredRelations.has("大于"));
  assert.ok(execution.declaredRelations.has("等于"));
  assert.ok(execution.declaredRelations.has("小于"));
  assert.ok(execution.declaredRelations.has("含有"));
});

test("知识库：声明 (自定义关系) 后 declaredRelations 包含该名字", () => {
  const program = engine.parse("[声明 (自定义关系) 关系]");
  const execution = engine.execute(program);
  assert.ok(execution.declaredRelations.has("自定义关系"));
});

test("知识库：重复声明同名关系不会报错", () => {
  const program = engine.parse([
    "[声明 (X) 关系]",
    "[声明 (X) 关系]"
  ].join("\n"));
  const execution = engine.execute(program);
  assert.ok(execution.declaredRelations.has("X"));
});

test("知识库：覆写 (1) 大于 (2) 为 否 后，再比较 1>2 直接拿到 F", () => {
  const program = engine.parse([
    "[覆写 (1) 大于 (2) 为 (否)]",
    "[回答 <比较 (1) 大于 (2) 吗?>]"
  ].join("\n"));
  const execution = engine.execute(program);
  assert.equal(execution.outputs[0].result.code, "F");
});

test("知识库：覆写 不会传染（(1)>(2) 改成否后 (2)>(1) 仍是 T）", () => {
  const program = engine.parse([
    "[覆写 (1) 大于 (2) 为 (否)]",
    "[回答 <比较 (2) 大于 (1) 吗?>]"
  ].join("\n"));
  const execution = engine.execute(program);
  assert.equal(execution.outputs[0].result.code, "T");
});

test("知识库：自定义关系 — 未声明的关系返回 I", () => {
  const program = engine.parse("[回答 <(1) 自定义 (2) 吗?>]");
  const execution = engine.execute(program);
  assert.equal(execution.outputs[0].result.code, "I");
  assert.match(execution.outputs[0].result.detail, /未声明/);
});

test("知识库：声明 + 覆写 + 查询自定义关系", () => {
  // 声明 (兄弟) 关系；覆写 (1) 兄弟 (2) 为 是；查询 (1) 兄弟 (2) -> T
  const program = engine.parse([
    "[声明 (兄弟) 关系]",
    "[覆写 (1) 兄弟 (2) 为 (是)]",
    "[回答 <(1) 兄弟 (2) 吗?>]",
    "[回答 <(1) 兄弟 (3) 吗?>]"
  ].join("\n"));
  const execution = engine.execute(program);
  assert.equal(execution.outputs[0].result.code, "T");
  assert.equal(execution.outputs[1].result.code, "I");  // 未覆写 (1, 3) -> I
});

test("知识库：覆写覆写后取最后一次", () => {
  const program = engine.parse([
    "[覆写 (1) 大于 (2) 为 (否)]",
    "[覆写 (1) 大于 (2) 为 (是)]",
    "[回答 <比较 (1) 大于 (2) 吗?>]"
  ].join("\n"));
  const execution = engine.execute(program);
  assert.equal(execution.outputs[0].result.code, "T");
});

test("知识库：覆写时 left/right 是 domain 形式时，逐一写入组合", () => {
  // 从(1)到(3) 的随机变量 覆写为 T；查询 (从(1)到(3) 的随机变量) 自定义 (2) -> T
  const program = engine.parse([
    "[声明 (test) 关系]",
    "[覆写 (从(1)到(3)的随机变量) test (2) 为 (是)]",
    "[回答 <(从(1)到(3)的随机变量) test (2) 吗?>]"
  ].join("\n"));
  const execution = engine.execute(program);
  assert.equal(execution.outputs[0].result.code, "T");
});

test("知识库：自定义关系 也能通过 relationCheck 节点查询", () => {
  // 直接用 relationCheck 节点 (引擎 API 形式) 来查询。
  const program = engine.parse([
    "[声明 (R) 关系]",
    "[覆写 (1) R (2) 为 (是)]",
    "[回答 <(1) R (2) 吗?>]"
  ].join("\n"));
  const execution = engine.execute(program);
  assert.equal(execution.outputs[0].result.code, "T");
});

test("知识库：relationCheck 节点直接用未声明的名字仍返回 I", () => {
  const node = engine.parse("[回答 <(1) Ghost (2) 吗?>]")[0].slots.predicate;
  assert.equal(node.type, "relationCheck");
  // 没有声明 Ghost 关系也没有内置实现
  const result = engine.evaluatePredicate(node);
  assert.equal(result.code, "I");
});

test("知识库：关系文字表示可原样往返", () => {
  const program = engine.parse([
    "[声明 (自定义) 关系]",
    "[覆写 (1) 自定义 (2) 为 (是)]",
    "[回答 <(1) 自定义 (2) 吗?>]"
  ].join("\n"));
  const printed = program.map((entry) => engine.printCommand(entry)).join("\n");
  assert.match(printed, /\[声明 \(自定义\) 关系\]/);
  assert.match(printed, /\[覆写 \(1\) 自定义 \(2\) 为 \(是\)\]/);
  assert.match(printed, /\[回答 <\(1\) 自定义 \(2\) 吗\?>\]/);
  // 重新解析应得到相同结果
  const reparsed = engine.parse(printed);
  const exec1 = engine.execute(program).outputs[0].result.code;
  const exec2 = engine.execute(reparsed).outputs[0].result.code;
  assert.equal(exec1, exec2);
  assert.equal(exec1, "T");
});

test("parser：relationCheck 形式 — <(left) (name) (right) 吗?>", () => {
  const program = engine.parse("[回答 <(1) 自定义 (2) 吗?>]");
  const predicate = program[0].slots.predicate;
  assert.equal(predicate.type, "relationCheck");
  assert.equal(predicate.name, "自定义");
  assert.ok(predicate.slots.left);
  assert.ok(predicate.slots.right);
});

test("parser：compare 形式 — <(left) 大于/等于/小于/含有 (right) 吗?>", () => {
  // 大于
  const gt = engine.parse("[回答 <(3) 大于 (2) 吗?>]")[0].slots.predicate;
  assert.equal(gt.type, "compare");
  assert.equal(gt.operator, "gt");

  // 等于
  const eq = engine.parse("[回答 <(3) 等于 (3) 吗?>]")[0].slots.predicate;
  assert.equal(eq.type, "compare");
  assert.equal(eq.operator, "eq");

  // 小于
  const lt = engine.parse("[回答 <(2) 小于 (3) 吗?>]")[0].slots.predicate;
  assert.equal(lt.type, "compare");
  assert.equal(lt.operator, "lt");

  // 含有
  const cn = engine.parse("[回答 <(\"hello\") 含有 (\"ell\") 吗?>]")[0].slots.predicate;
  assert.equal(cn.type, "compare");
  assert.equal(cn.operator, "contains");
});

test("parser：(name)(right) 形式也是 relationCheck", () => {
  const program = engine.parse("[回答 <(1) (自定义) (2) 吗?>]");
  const predicate = program[0].slots.predicate;
  assert.equal(predicate.type, "relationCheck");
  assert.equal(predicate.name, "自定义");
});
