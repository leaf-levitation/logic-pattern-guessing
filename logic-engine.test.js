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

test("判断的答案转换为布尔候选域", () => {
  const uncertainAnswer = engine.evaluateExpression({
    type: "answerValue",
    slots: { predicate: compare(random(1, 3), "gt", 2) }
  });
  const certainAnswer = engine.evaluateExpression({
    type: "answerValue",
    slots: { predicate: compare(atom(3), "gt", 2) }
  });

  assert.deepEqual(uncertainAnswer.values, [true, false]);
  assert.deepEqual(certainAnswer.values, [true]);
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

test("第(N)问、问题编号、行号在回答中可用", () => {
  const program = engine.parse([
    "[回答 <第 (1) 问?>]",
    "[回答 <第 (2) 问?>]",
    "[回答 <比较 (问题编号) 等于 (3) 吗?>]",
    "[回答 <比较 (行号) 等于 (4) 吗?>]"
  ].join("\n"));

  const execution = engine.execute(program);
  assert.equal(execution.outputs.length, 4);
  assert.equal(execution.outputs[0].result.code, "T");
  assert.equal(execution.outputs[1].result.code, "T");
  assert.equal(execution.outputs[2].result.code, "T");
  assert.equal(execution.outputs[3].result.code, "T");

  const printed = program.map((entry) => engine.printCommand(entry)).join("\n");
  assert.match(printed, /\[回答 <第 \(1\) 问>]/);
  assert.match(printed, /\[回答 <\(问题编号\) 等于 \(3\) 吗\?>]/);
  assert.match(printed, /\[回答 <\(行号\) 等于 \(4\) 吗\?>]/);
});

test("第(N)问、行号在回答外被调用时返回 I", () => {
  const directIsQuestion = engine.evaluatePredicate({ type: "isQuestion", slots: { value: { kind: "atom", value: "1" } } });
  assert.equal(directIsQuestion.code, "I");

  const directLine = engine.evaluateExpression({ type: "currentLine", slots: {} });
  assert.equal(directLine.ok, false);
});
