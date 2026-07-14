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
  type: "contains",
  slots: { left, right: wrap(right) }
});
const compare = (left, operator, right) => ({
  type: "compare",
  operator,
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
    type: "contains",
    slots: { left: atom('"逻辑工坊"'), right: atom('"工坊"') }
  };
  const no = {
    type: "contains",
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
    "[赋值 (命中) = (<含有 (从(1)到(10)的随机变量) (2) 吗?>的答案)]",
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

test("文字语法解析保留 contains 节点的 left/right 槽位", () => {
  const program = engine.parse("[回答 <含有 ($点数) (6) 吗?>]");
  const predicate = program[0].slots.predicate;
  assert.equal(predicate.type, "contains");
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

test("嵌套重复保留各自行号，内部积木使用最近重复", () => {
  const program = engine.parse([
    "[回答 <比较 (行号) 等于 (1) 吗?>]",   // line 1
    "[重复 (1) {",                          // line 2 — outer
    "  [回答 <比较 (行号) 等于 (2) 吗?>]",   // line 3 — should use outer's line=2
    "  [重复 (1) { [回答 <比较 (行号) 等于 (4) 吗?>] }]", // line 4 — inner repeat keeps own line; answer inside uses line=4
    "}]"
  ].join("\n"));

  const execution = engine.execute(program);
  assert.deepEqual(
    execution.outputs.map((output) => output.result.code),
    ["T", "T", "T"]
  );
  assert.equal(execution.outputs[0].line, 1);
  assert.equal(execution.outputs[1].line, 2); // uses outer repeat's line
  assert.equal(execution.outputs[2].line, 4); // uses innermost repeat's line
});

test("三层以上重复嵌套仍按最内层重复标行号", () => {
  const program = engine.parse([
    "[回答 <比较 (行号) 等于 (1) 吗?>]",   // L1 — top-level answer
    "[重复 (1) {",                          // L2 — outer repeat opens
    "  [回答 <比较 (行号) 等于 (2) 吗?>]",   // L3 — outer body, uses outer's line=2
    "  [重复 (1) {",                        // L4 — middle repeat opens (in outer body)
    "    [回答 <比较 (行号) 等于 (4) 吗?>]", // L5 — middle body, uses middle's line=4
    "    [重复 (1) { [回答 <比较 (行号) 等于 (6) 吗?>] } ]", // L6 — inner repeat (in middle body); its answer uses inner's line=6
    "} ]",                                  // close middle scope `}` and middle bracket `]`
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
    [1, 2, 4, 6]
  );
});

test("嵌套重复内层与外层同源行号时分别标记", () => {
  // 测试两个并列的重复块，一个内嵌重复一个外层直接回答
  const program = engine.parse([
    "[回答 <比较 (行号) 等于 (1) 吗?>]",   // line 1
    "[重复 (1) { [回答 <比较 (行号) 等于 (2) 吗?>] }]", // line 2 — outer only, answer uses outer line=2
    "[重复 (1) { [重复 (1) { [回答 <比较 (行号) 等于 (4) 吗?>] }] }]", // line 3 outer, line 4 inner — answer uses inner line=4
    "[回答 <比较 (行号) 等于 (4) 吗?>]"    // line 4
  ].join("\n"));

  const execution = engine.execute(program);
  assert.deepEqual(
    execution.outputs.map((output) => output.result.code),
    ["T", "T", "T", "T"]
  );
  assert.deepEqual(
    execution.outputs.map((output) => output.line),
    [1, 2, 4, 4]
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

test("buildCondition：truth 返回 null，其他都返回函数", () => {
  assert.equal(engine.buildCondition("truth"), null);
  assert.equal(engine.buildCondition(null), null);
  assert.equal(typeof engine.buildCondition("alwaysLie"), "function");
  assert.equal(typeof engine.buildCondition("lieIfLong"), "function");
  assert.equal(typeof engine.buildCondition("lieIfOddLine"), "function");
  assert.equal(typeof engine.buildCondition("isAnswerIs"), "function");
});

test("关卡条件：alwaysLie 把每个判断的 T/F 反转，U/I 不变", () => {
  const condition = engine.buildCondition("alwaysLie");
  const program = [
    "[回答 <比较 (3) 大于 (2) 吗?>]",          // 3>2 = T -> F
    "[回答 <比较 (1) 大于 (5) 吗?>]",          // 1>5 = F -> T
    "[回答 <比较 (从(1)到(3)的随机变量) 大于 (2) 吗?>]"  // U -> U
  ];
  const execution = engine.execute(engine.parse(program.join("\n")), { condition });
  assert.deepEqual(execution.outputs.map((o) => o.result.code), ["F", "T", "U"]);
});

test("关卡条件：alwaysLie 会作用于 not 内部的判断", () => {
  // 内层 3>2 = T -> lie -> F；外层 not(F) = T -> lie -> F
  const condition = engine.buildCondition("alwaysLie");
  const program = ["[回答 <不成立 <比较 (3) 大于 (2) 吗?> 吗?>]"];
  const execution = engine.execute(engine.parse(program.join("\n")), { condition });
  assert.equal(execution.outputs[0].result.code, "F");
});

test("关卡条件：lieIfLong 按问题字数反转，长问题才说谎", () => {
  const condition = engine.buildCondition("lieIfLong");
  // “3大于2吗?” 5 字 -> T； “3大于5吗?” 5 字 -> F；
  // “3大于2吗?不成立吗?” 11 字 -> not(T)=F -> lie -> T；
  // “3大于5吗?不成立吗?” 11 字 -> not(F)=T -> lie -> F
  const program = [
    "[回答 <比较 (3) 大于 (2) 吗?>]",
    "[回答 <比较 (3) 大于 (5) 吗?>]",
    "[回答 <不成立 <比较 (3) 大于 (2) 吗?> 吗?>]",
    "[回答 <不成立 <比较 (3) 大于 (5) 吗?> 吗?>]"
  ];
  const execution = engine.execute(engine.parse(program.join("\n")), { condition });
  assert.deepEqual(execution.outputs.map((o) => o.result.code), ["T", "F", "T", "F"]);
});

test("关卡条件：lieIfOddLine 仅在奇数行反转判断", () => {
  const condition = engine.buildCondition("lieIfOddLine");
  // 行 1(奇): T->F；行 2(偶): T 不变；行 3(奇): T->F
  const program = [
    "[回答 <比较 (3) 大于 (2) 吗?>]",
    "[回答 <比较 (3) 大于 (2) 吗?>]",
    "[回答 <比较 (3) 大于 (2) 吗?>]"
  ];
  const execution = engine.execute(engine.parse(program.join("\n")), { condition });
  assert.deepEqual(execution.outputs.map((o) => o.result.code), ["F", "T", "F"]);
});

test("关卡条件：isAnswerIs 强制含“是”字的判断回答“是”", () => {
  const condition = engine.buildCondition("isAnswerIs");
  // “3大于2吗?” 没有 “是” -> 正常 T；
  // “1大于5吗?” 没有 “是” -> 正常 F；
  // “是等于否吗?” 含 “是” -> 强制 T（基底是 F）；
  // “是等于是吗?” 含 “是” -> 强制 T（基底也是 T）
  const program = [
    "[回答 <比较 (3) 大于 (2) 吗?>]",
    "[回答 <比较 (1) 大于 (5) 吗?>]",
    "[回答 <比较 (\"是\") 等于 (\"否\") 吗?>]",
    "[回答 <比较 (\"是\") 等于 (\"是\") 吗?>]"
  ];
  const execution = engine.execute(engine.parse(program.join("\n")), { condition });
  assert.deepEqual(execution.outputs.map((o) => o.result.code), ["T", "F", "T", "T"]);
});

test("execute 不带 condition 时保持原行为", () => {
  const program = [
    "[回答 <比较 (3) 大于 (2) 吗?>]",
    "[回答 <比较 (1) 大于 (5) 吗?>]"
  ];
  const execution = engine.execute(engine.parse(program.join("\n")));
  assert.deepEqual(execution.outputs.map((o) => o.result.code), ["T", "F"]);
});
