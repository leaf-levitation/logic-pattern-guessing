(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LogicEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MAX_VALUES = 1000;
  const LOGIC_LABELS = {
    T: "是",
    F: "否",
    U: "不确定",
    I: "无法回答"
  };
  const TYPE_LABELS = {
    int: "整数",
    float: "浮点数",
    boolean: "布尔值",
    string: "字符串"
  };

  function valueKey(value) {
    return `${typeof value}:${Object.is(value, -0) ? 0 : value}`;
  }

  function unique(values) {
    const seen = new Set();
    return values.filter((value) => {
      const key = valueKey(value);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function sampleEvenly(values, limit = MAX_VALUES) {
    const deduplicated = unique(values);
    if (deduplicated.length <= limit) return deduplicated;

    const sampled = [];
    for (let index = 0; index < limit; index += 1) {
      const sourceIndex = Math.round(index * (deduplicated.length - 1) / (limit - 1));
      sampled.push(deduplicated[sourceIndex]);
    }
    return unique(sampled);
  }

  function normalizeValues(type, values) {
    const normalized = unique(values);
    if (type === "int" || type === "float") normalized.sort((a, b) => a - b);
    if (type === "boolean") normalized.sort((a, b) => Number(b) - Number(a));
    return sampleEvenly(normalized, MAX_VALUES);
  }

  function domain(type, values, source = "") {
    const normalized = normalizeValues(type, values);
    if (!normalized.length) return valueError("没有可用的候选值");
    return { ok: true, type, values: normalized, source };
  }

  function valueError(message) {
    return { ok: false, error: message };
  }

  function cloneValue(result) {
    if (!result || !result.ok) return valueError(result?.error || "无效的值");
    return domain(result.type, result.values.slice(), result.source);
  }

  function isNumeric(result) {
    return result?.ok && (result.type === "int" || result.type === "float");
  }

  function variableNameIsValid(name) {
    return /^[\p{L}_][\p{L}\p{N}_]*$/u.test(name);
  }

  function readVariable(environment, name) {
    const result = environment instanceof Map ? environment.get(name) : environment?.[name];
    if (!result) return valueError(`变量 $${name} 尚未赋值`);
    return cloneValue(result);
  }

  function parseQuotedString(source) {
    if (source[0] === '"') {
      try {
        return JSON.parse(source);
      } catch {
        return null;
      }
    }

    const body = source.slice(1, -1);
    return body.replace(/\\([\\'])/g, "$1");
  }

  function parseAtom(raw, environment = new Map()) {
    const source = String(raw ?? "").trim();
    if (!source) return valueError("请输入一个值");

    if (source.startsWith("$")) {
      const name = source.slice(1).trim();
      if (!variableNameIsValid(name)) return valueError("变量引用格式应为 $变量名");
      return readVariable(environment, name);
    }

    if ((source.startsWith('"') && source.endsWith('"')) ||
        (source.startsWith("'") && source.endsWith("'"))) {
      const parsed = parseQuotedString(source);
      if (parsed === null) return valueError("字符串引号或转义格式不正确");
      return domain("string", [parsed], source);
    }

    if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(source)) {
      const number = Number(source);
      if (!Number.isFinite(number)) return valueError("数值超出可计算范围");
      return domain(Number.isInteger(number) && !source.includes(".") ? "int" : "float", [number], source);
    }

    return domain("string", [source], source);
  }

  function evaluateInput(input, environment = new Map(), context = null) {
    if (typeof input === "string" || typeof input === "number" || typeof input === "boolean") {
      return parseAtom(String(input), environment);
    }
    if (!input) return valueError("积木孔位尚未填写");
    if (input.kind === "atom") return parseAtom(input.value, environment);
    return evaluateExpression(input, environment, context);
  }

  function numericType(left, right, operator) {
    if (operator === "div") return "float";
    return left.type === "int" && right.type === "int" ? "int" : "float";
  }

  function calculate(operator, left, right) {
    if (operator === "add") return left + right;
    if (operator === "sub") return left - right;
    if (operator === "mul") return left * right;
    return left / right;
  }

  function arithmetic(node, environment, context = null) {
    const left = evaluateInput(node.slots?.left, environment, context);
    if (!left.ok) return left;
    const right = evaluateInput(node.slots?.right, environment, context);
    if (!right.ok) return right;
    if (!isNumeric(left) || !isNumeric(right)) return valueError("四则运算只接受整数或浮点数");

    const operator = node.operator || "add";
    if (operator === "div" && right.values.some((value) => value === 0)) {
      return valueError("除数的候选值中包含 0");
    }

    const values = [];
    for (const leftValue of left.values) {
      for (const rightValue of right.values) {
        const result = calculate(operator, leftValue, rightValue);
        if (!Number.isFinite(result)) return valueError("运算结果超出可计算范围");
        values.push(result);
      }
    }

    return domain(numericType(left, right, operator), sampleEvenly(values), "arithmetic");
  }

  function integerPoints(start, end, limit = MAX_VALUES) {
    const first = Math.ceil(start);
    const last = Math.floor(end);
    if (first > last) return [];

    const count = last - first + 1;
    if (count <= limit) return Array.from({ length: count }, (_, index) => first + index);

    const points = [];
    for (let index = 0; index < limit; index += 1) {
      points.push(Math.round(first + index * (last - first) / (limit - 1)));
    }
    return unique(points);
  }

  function randomDomain(node, environment, context = null) {
    const from = evaluateInput(node.slots?.from, environment, context);
    if (!from.ok) return from;
    const to = evaluateInput(node.slots?.to, environment, context);
    if (!to.ok) return to;
    if (!isNumeric(from) || !isNumeric(to)) return valueError("随机变量的两个端点必须是数值");

    const values = [];
    for (const start of from.values) {
      for (const end of to.values) {
        if (start > end) return valueError("随机变量的起点不能大于终点");
        const points = integerPoints(start, end);
        if (!points.length) return valueError(`区间 ${start} 到 ${end} 内没有整数`);
        values.push(...points);
      }
    }

    return domain("int", sampleEvenly(values), "random");
  }

  function logic(code, detail = "", stats = null) {
    return { code, label: LOGIC_LABELS[code], detail, stats };
  }

  function logicError(message) {
    return logic("I", message);
  }

  function compatibleForEquality(left, right) {
    return (isNumeric(left) && isNumeric(right)) || left.type === right.type;
  }

  function relationResult(left, right, predicate, description) {
    let trueCount = 0;
    let falseCount = 0;

    for (const leftValue of left.values) {
      for (const rightValue of right.values) {
        if (predicate(leftValue, rightValue)) trueCount += 1;
        else falseCount += 1;
      }
    }

    const code = trueCount && falseCount ? "U" : trueCount ? "T" : "F";
    const detail = `${description}：真 ${trueCount} / 假 ${falseCount}`;
    return logic(code, detail, { trueCount, falseCount, total: trueCount + falseCount });
  }

  function compare(node, environment, context = null) {
    const left = evaluateInput(node.slots?.left, environment, context);
    if (!left.ok) return logicError(left.error);
    const right = evaluateInput(node.slots?.right, environment, context);
    if (!right.ok) return logicError(right.error);

    const operator = node.operator || "gt";
    if (operator === "eq") {
      const numericPair = isNumeric(left) && isNumeric(right);
      if (numericPair) {
        return relationResult(left, right, (a, b) => Number(a) === Number(b), "候选组合");
      }
      if (left.type !== right.type) return logicError("等于判断的两侧类型不兼容");
      return relationResult(left, right, (a, b) => a === b, "候选组合");
    }

    if (!isNumeric(left) || !isNumeric(right)) {
      return logicError("大于和小于判断只接受整数或浮点数");
    }

    return relationResult(
      left,
      right,
      operator === "lt" ? (a, b) => a < b : (a, b) => a > b,
      "候选组合"
    );
  }

  function contains(node, environment, context = null) {
    const left = evaluateInput(node.slots?.left, environment, context);
    if (!left.ok) return logicError(left.error);
    const right = evaluateInput(node.slots?.right, environment, context);
    if (!right.ok) return logicError(right.error);

    return relationResult(left, right, (a, b) => String(a).includes(String(b)), "子串组合");
  }

  function negate(result) {
    if (result.code === "T") return { ...result, code: "F", label: LOGIC_LABELS.F };
    if (result.code === "F") return { ...result, code: "T", label: LOGIC_LABELS.T };
    return { ...result };
  }

  function evaluatePredicate(node, environment = new Map(), context = null) {
    if (!node) return logicError("六边形孔位中缺少判断积木");
    let result;
    if (node.type === "compare") result = compare(node, environment, context);
    else if (node.type === "contains") result = contains(node, environment, context);
    else if (node.type === "not") result = negate(evaluatePredicate(node.slots?.predicate, environment, context));
    else if (node.type === "isQuestion") result = isQuestion(node, environment, context);
    else return logicError("该积木不能作为判断条件");

    if (context && typeof context.condition === "function") {
      try {
        result = context.condition(result, node, context);
      } catch (err) {
        return logicError(err?.message || "关卡条件变换失败");
      }
    }
    return result;
  }

  function negateTandF(result) {
    if (!result || typeof result.code !== "string") return result;
    if (result.code === "T") return { ...result, code: "F", label: LOGIC_LABELS.F };
    if (result.code === "F") return { ...result, code: "T", label: LOGIC_LABELS.T };
    return result;
  }

  function buildCondition(spec) {
    if (!spec || spec === "truth") return null;
    if (spec === "alwaysLie") {
      return (result) => negateTandF(result);
    }
    if (spec === "lieIfLong") {
      return (result, node, context) => {
        if (!node) return result;
        const text = charCountText(node, context || {});
        if (countChars(text) >= 10) return negateTandF(result);
        return result;
      };
    }
    if (spec === "lieIfOddLine") {
      return (result, node, context) => {
        const line = Number(context && context.line);
        if (Number.isFinite(line) && Math.abs(line) % 2 === 1) return negateTandF(result);
        return result;
      };
    }
    if (spec === "isAnswerIs") {
      return (result, node, context) => {
        if (!node) return result;
        const text = charCountText(node, context || {});
        if (text.includes("是")) {
          return { ...result, code: "T", label: LOGIC_LABELS.T };
        }
        return result;
      };
    }
    return null;
  }

  function isQuestion(node, environment, context) {
    if (!context || context.question == null || Number.isNaN(Number(context.question))) {
      return logicError("第几问 只能在回答指令中使用");
    }
    const value = evaluateInput(node.slots?.value, environment, context);
    if (!value.ok) return logicError(value.error);
    if (!isNumeric(value)) return logicError("第几问 的参数需要整数");
    const raw = Number(value.values[0]);
    if (!Number.isInteger(raw)) {
      return logicError(`第几问 的参数必须是整数，收到 ${raw}`);
    }
    const x = raw;
    const y = Number(context.question);
    if (x === y) {
      const hypothesis = context.hypothesis;
      if (hypothesis) {
        return logic(hypothesis, `假设本题回答为 ${LOGIC_LABELS[hypothesis]}`, null);
      }
      return logic("U", `第 ${x} 问 自我引用`, null);
    }
    if (x > y || x <= 0) {
      return logicError(`第 ${x} 问 不存在或尚未到来`);
    }
    const prior = context.answers && context.answers[x - 1];
    if (!prior) return logicError(`第 ${x} 问 尚未回答`);
    return logic(prior.code, `第 ${x} 问 的回答是 ${prior.label}`, prior.stats);
  }

  function combineAnswerHypotheses(kept) {
    if (!kept.length) {
      return logic("I", "假设 T / F / U 均与本题回答矛盾 → 无法回答", null);
    }
    const codes = new Set(kept.map((entry) => entry.code));
    if (codes.has("T") && codes.has("F")) {
      return logic("U", "假设 T 与 F 均不矛盾 → 不确定", null);
    }
    if (codes.has("T")) return kept.find((entry) => entry.code === "T");
    if (codes.has("F")) return kept.find((entry) => entry.code === "F");
    if (codes.has("U")) return kept.find((entry) => entry.code === "U");
    return kept[0];
  }

  function evaluateAnswerPredicate(predicate, environment, context) {
    const candidates = [];
    const kept = [];
    for (const hypothesis of ["T", "F", "U"]) {
      const hypothesisContext = { ...context, hypothesis };
      const candidate = evaluatePredicate(predicate, environment, hypothesisContext);
      candidates.push(candidate);
      if (candidate.code === hypothesis) {
        kept.push(candidate);
      }
    }
    if (!kept.length) {
      // 如果所有候选结果都来自结构性错误（例如第几问 越界），透传第一条细节。
      if (candidates.length && candidates.every((c) => c.code === "I")) {
        return candidates[0];
      }
      return combineAnswerHypotheses(kept);
    }
    return combineAnswerHypotheses(kept);
  }

  function answerValue(node, environment, context = null) {
    const answer = evaluatePredicate(node.slots?.predicate, environment, context);
    return domain("string", [LOGIC_LABELS[answer.code]], "answer");
  }

  class CharCountError extends Error {}

  // 计算“字数”时忽略的字符：积木自带的空格、括号、花括号、$。
  const CHAR_COUNT_IGNORE = /[()<>{}$[\]（）\s]/g;

  function countChars(text) {
    return Array.from(text.replace(CHAR_COUNT_IGNORE, "")).length;
  }

  // 生成一段仅用于计数的原始文本；除 第x问 外的积木一律不求值，只拼接其文字表示。
  function charCountText(node, context) {
    if (!node) return "";
    if (node.kind === "atom") return String(node.value ?? "");
    switch (node.type) {
      case "arithmetic":
        return charCountText(node.slots?.left, context)
          + operatorLabel(node.operator, "value")
          + charCountText(node.slots?.right, context);
      case "random":
        return "从" + charCountText(node.slots?.from, context) + "到"
          + charCountText(node.slots?.to, context) + "的随机变量";
      case "answerValue":
        return charCountText(node.slots?.predicate, context) + "的答案";
      case "answerCharCount":
        return charCountText(node.slots?.predicate, context) + "的字数";
      case "currentLine":
        return "行号";
      case "currentQuestion":
        return "问题编号";
      case "compare":
        return charCountText(node.slots?.left, context)
          + operatorLabel(node.operator, "predicate")
          + charCountText(node.slots?.right, context) + "吗?";
      case "contains":
        return charCountText(node.slots?.left, context) + "含有"
          + charCountText(node.slots?.right, context) + "吗?";
      case "not":
        return charCountText(node.slots?.predicate, context) + "不成立" + "吗?";
      case "isQuestion":
        return isQuestionCharText(node, context);
      default:
        return "";
    }
  }

  function isQuestionCharText(node, context) {
    // 字数计算中，<第(x)问> 默认按字面 “第X问” 计入；若 x 对应一个已经
    // 回答的问题（0 < x ≤ y，y = 已答数），则展开为该问的判断文本，
    // 并以 “已答 x-1” 为新边界递归展开其中的嵌套 <第(z)问>。
    // 任何无法解析/越界/参数非整数的情况都静默回落为字面，
    // 因此内层 “第 100 问” 之类的判断永远不会阻断总字数。
    const literal = "第" + charCountText(node.slots?.value, context) + "问";
    if (!context || context.answeredCount == null) return literal;

    const environment = context.environment || new Map();
    let x;
    try {
      const value = evaluateInput(node.slots?.value, environment, context);
      if (!value.ok || !isNumeric(value)) return literal;
      const raw = Number(value.values[0]);
      if (!Number.isInteger(raw)) return literal;
      x = raw;
    } catch {
      return literal;
    }

    const y = Number(context.answeredCount);
    if (x <= 0 || x > y) return literal;

    const prior = context.questionPredicates && context.questionPredicates[x - 1];
    if (!prior) return literal;
    return charCountText(prior, { ...context, answeredCount: x - 1 });
  }

  function answerCharCount(node, environment, context = null) {
    const countContext = { ...(context || {}), environment };
    try {
      const text = charCountText(node.slots?.predicate, countContext);
      return domain("int", [countChars(text)], "charCount");
    } catch (error) {
      if (error instanceof CharCountError) return valueError(error.message);
      throw error;
    }
  }

  // 供 UI 使用：计算判断积木的字数。缺省静态模式（第x问 计字面），传入上下文则按规则递归。
  function questionCharCount(predicate, context = null) {
    const countContext = { ...(context || {}) };
    try {
      return { ok: true, count: countChars(charCountText(predicate, countContext)) };
    } catch (error) {
      if (error instanceof CharCountError) return { ok: false, error: error.message };
      throw error;
    }
  }

  function evaluateExpression(node, environment = new Map(), context = null) {
    if (!node) return valueError("圆角孔位中缺少变量积木或值");
    if (node.type === "arithmetic") return arithmetic(node, environment, context);
    if (node.type === "random") return randomDomain(node, environment, context);
    if (node.type === "answerValue") return answerValue(node, environment, context);
    if (node.type === "answerCharCount") return answerCharCount(node, environment, context);
    if (node.type === "currentLine") {
      if (!context) return valueError("行号 只能在回答指令中使用");
      return domain("int", [Number(context.line)], "currentLine");
    }
    if (node.type === "currentQuestion") {
      if (!context) return valueError("问题编号 只能在回答指令中使用");
      return domain("int", [Number(context.question)], "currentQuestion");
    }
    if (node.kind === "atom") return parseAtom(node.value, environment);
    return valueError("该积木不能作为变量值");
  }

  function execute(commands, options = {}) {
    const environment = new Map();
    const outputs = [];
    const steps = [];
    const loopStack = [];
    const answerHistory = [];
    const questionPredicates = [];
    const MAX_LOOP_ITERATIONS = 64;
    const conditionFn = typeof options.condition === "function" ? options.condition : null;
    let questionCount = 0;

    function snapshotEnvironment() {
      const captured = new Map();
      for (const [key, value] of environment.entries()) {
        captured.set(key, cloneValue(value));
      }
      return captured;
    }

    function runSubCommands(subCommands, label, lineOffset = 0, enclosingLine = null, topLevelIndex = null) {
      for (let subIndex = 0; subIndex < subCommands.length; subIndex += 1) {
        const subCommand = subCommands[subIndex];
        const sourceLine = lineOffset + subIndex + 1;
        const effectiveTopLevel = topLevelIndex !== null ? topLevelIndex : (subIndex + 1);
        let line;
        if (subCommand.type === "repeat") {
          line = sourceLine;
        } else if (subCommand.type === "answer") {
          line = effectiveTopLevel;
        } else {
          line = enclosingLine !== null ? enclosingLine : sourceLine;
        }
        if (subCommand.type === "assign") {
          const name = String(subCommand.name || "").trim();
          if (!variableNameIsValid(name)) {
            const failed = valueError("变量名应以中文、字母或下划线开头");
            steps.push({ index: steps.length, line, type: "assign", name, result: failed, scope: label });
            continue;
          }
          const countContext = {
            answeredCount: questionCount,
            questionPredicates,
            environment
          };
          const result = evaluateInput(subCommand.slots?.value, environment, countContext);
          environment.set(name, result);
          steps.push({ index: steps.length, line, type: "assign", name, result, scope: label });
          continue;
        }

        if (subCommand.type === "answer") {
          questionCount += 1;
          questionPredicates[questionCount - 1] = subCommand.slots?.predicate;
          const context = {
            line,
            question: questionCount,
            answers: answerHistory,
            questionPredicates,
            answeredCount: questionCount - 1,
            condition: conditionFn
          };
          const result = evaluateAnswerPredicate(subCommand.slots?.predicate, environment, context);
          answerHistory[questionCount - 1] = result;
          outputs.push({ index: steps.length, line, question: questionCount, result, scope: label });
          steps.push({ index: steps.length, line, question: questionCount, type: "answer", result, scope: label });
          continue;
        }

        if (subCommand.type === "repeat") {
          const countContext = {
            answeredCount: questionCount,
            questionPredicates,
            environment
          };
          const countResult = evaluateInput(subCommand.slots?.count, environment, countContext);
          if (!countResult.ok || countResult.type !== "int") {
            const failed = logicError("重复次数必须是整数");
            steps.push({ index: steps.length, line, type: "repeat", result: failed, scope: label });
            continue;
          }
          const iterations = countResult.values.reduce((acc, value) => acc * value, 1);
          if (!Number.isInteger(iterations) || iterations < 0) {
            const failed = logicError("重复次数需要为非负整数");
            steps.push({ index: steps.length, line, type: "repeat", result: failed, scope: label });
            continue;
          }
          const guard = subCommand.guard || { iterations: 0 };
          for (let iteration = 0; iteration < iterations; iteration += 1) {
            guard.iterations += 1;
            if (guard.iterations > MAX_LOOP_ITERATIONS) {
              const failed = logicError(`循环执行超过 ${MAX_LOOP_ITERATIONS} 次，已自动停止`);
              steps.push({ index: steps.length, line, type: "repeat", result: failed, scope: label });
              return;
            }
            const scopeLabel = `${label} · 第 ${iteration + 1} 次`;
            runSubCommands(subCommand.body || [], scopeLabel, sourceLine, sourceLine, effectiveTopLevel);
            if (subCommand.body?.length) {
              const finished = steps[steps.length - 1];
              if (finished?.result?.code === "I" && subCommand.failFast) return;
            }
          }
          continue;
        }

        steps.push({ index: steps.length, line, type: "unknown", result: valueError("无法执行的指令积木"), scope: label });
      }
    }

    runSubCommands(commands, "顶层");
    void snapshotEnvironment;

    return { environment, outputs, steps };
  }

  function displayScalar(value, type) {
    if (type === "string") return `“${value}”`;
    if (type === "boolean") return value ? "true" : "false";
    return String(value);
  }

  function summarizeValue(result, visible = 6) {
    if (!result?.ok) return result?.error || "求值失败";
    const values = result.values.map((value) => displayScalar(value, result.type));
    if (values.length === 1) return values[0];
    const shown = values.slice(0, visible).join("、");
    return `{ ${shown}${values.length > visible ? " …" : ""} } · ${values.length} 个候选`;
  }

  const PREDICATE_OPEN = "<";
  const PREDICATE_CLOSE = ">";
  const VALUE_OPEN = "(";
  const VALUE_CLOSE = ")";
  const SCOPE_OPEN = "{";
  const SCOPE_CLOSE = "}";

  const COMMAND_KEYWORDS = {
    "回答": { type: "answer" },
    "赋值": { type: "assign" },
    "重复": { type: "repeat" }
  };

  const PREDICATE_KEYWORDS = {
    "比较": { type: "compare", expects: ["left", "operator", "right"] },
    "含有": { type: "contains", expects: ["left", "right"] },
    "不成立": { type: "not", expects: ["predicate"] }
  };

  const VALUE_KEYWORDS = [
    { name: ["从"], type: "random" },
    { name: ["行号"], type: "currentLine" },
    { name: ["问题编号"], type: "currentQuestion" }
  ];

  const ARITHMETIC_OPERATORS = {
    "加": "add",
    "减": "sub",
    "乘": "mul",
    "除以": "div"
  };

  const COMPARE_OPERATORS = {
    "大于": "gt",
    "等于": "eq",
    "小于": "lt"
  };

  function tokenize(source) {
    const tokens = [];
    let buffer = "";
    let i = 0;

    function push() {
      if (buffer.length) {
        tokens.push({ kind: "word", value: buffer });
        buffer = "";
      }
    }

    while (i < source.length) {
      const char = source[i];
      if (char === " " || char === "\n" || char === "\t" || char === "，") {
        push();
        i += 1;
        continue;
      }
      if (char === PREDICATE_OPEN || char === PREDICATE_CLOSE ||
          char === VALUE_OPEN || char === VALUE_CLOSE ||
          char === SCOPE_OPEN || char === SCOPE_CLOSE ||
          char === "[" || char === "]" ||
          char === "=") {
        push();
        tokens.push({ kind: "char", value: char });
        i += 1;
        continue;
      }
      if (char === "“" || char === "”") {
        push();
        i += 1;
        continue;
      }
      if (char === "\"") {
        push();
        let end = source.indexOf("\"", i + 1);
        if (end < 0) end = source.length;
        tokens.push({ kind: "word", value: source.slice(i, end + 1) });
        i = end + 1;
        continue;
      }
      buffer += char;
      i += 1;
    }
    push();

    const merged = [];
    for (let j = 0; j < tokens.length; j += 1) {
      merged.push(tokens[j]);
    }
    return merged;
  }

  class ParseError extends Error {
    constructor(message, index) {
      super(message);
      this.index = index;
    }
  }

  function parse(source) {
    const tokens = tokenize(source);
    let position = 0;

    function peek() {
      return tokens[position];
    }

    function take() {
      const token = tokens[position];
      position += 1;
      return token;
    }

    function expectChar(value) {
      const token = peek();
      if (!token || token.kind !== "char" || token.value !== value) {
        throw new ParseError(`需要符号 ${value}`, position);
      }
      take();
    }

    function expectWord(message) {
      const token = peek();
      if (!token || token.kind !== "word") {
        throw new ParseError(message, position);
      }
      return take();
    }

    function parseAtomWord(token) {
      return { kind: "atom", value: token.value };
    }

    function parseValue() {
      const node = parsePrimaryValue();
      return parseArithmeticSuffix(node);
    }

    function parseArithmeticSuffix(left) {
      const token = peek();
      if (!token || token.kind !== "word") return left;
      const operator = ARITHMETIC_OPERATORS[token.value];
      if (!operator) return left;
      take();
      const right = parseValue();
      return {
        id: createTempId(),
        type: "arithmetic",
        operator,
        slots: { left, right }
      };
    }

    function parsePrimaryValue() {
      const token = peek();
      if (!token) throw new ParseError("缺少变量或数值", position);
      if (token.kind === "char" && token.value === PREDICATE_OPEN) {
        const predicate = parsePredicate();
        const after = peek();
        if (after && after.kind === "word" && (after.value === "的答案" || after.value === "的字数" || after.value === "的")) {
          take();
          let suffix = after.value;
          if (after.value === "的") {
            const tail = peek();
            if (!tail || tail.kind !== "word" || (tail.value !== "答案" && tail.value !== "字数")) {
              throw new ParseError("<...> 之后只能接 “的答案”或“的字数”", position);
            }
            suffix = "的" + tail.value;
            take();
          }
          return {
            id: createTempId(),
            type: suffix === "的字数" ? "answerCharCount" : "answerValue",
            slots: { predicate }
          };
        }
        return predicate;
      }
      if (token.kind === "char" && token.value === SCOPE_OPEN) {
        throw new ParseError("花括号只能跟在循环积木后面", position);
      }
      if (token.kind === "char" && token.value === VALUE_OPEN) {
        take();
        const node = parseValue();
        expectChar(VALUE_CLOSE);
        return node;
      }
      if (token.kind === "word") {
        const result = matchValueKeyword();
        if (result) return result;
        return parseAtomWord(take());
      }
      throw new ParseError("无法解析的变量积木", position);
    }

    function matchValueKeyword() {
      for (const keyword of VALUE_KEYWORDS) {
        let ok = true;
        for (let offset = 0; offset < keyword.name.length; offset += 1) {
          const probe = tokens[position + offset];
          if (!probe || probe.kind !== "word" || probe.value !== keyword.name[offset]) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        for (let offset = 0; offset < keyword.name.length; offset += 1) take();
        if (keyword.type === "answerValue") {
          const predicate = parsePredicate();
          return {
            id: createTempId(),
            type: "answerValue",
            slots: { predicate }
          };
        }
        if (keyword.type === "random") {
          const from = parseValue();
          const toToken = expectWord("从…到…的随机变量 中缺少 “到”");
          if (toToken.value !== "到") throw new ParseError("从…到…的随机变量 中第二个端点需要 “到”", position);
          const to = parseValue();
          const tailToken = peek();
          if (!tailToken || tailToken.kind !== "word" || !(tailToken.value === "的随机变量" || tailToken.value === "的")) {
            throw new ParseError("从…到…的随机变量 语法应为 “从(...)到(...)的随机变量”", position);
          }
          take();
          if (tailToken.value === "的") {
            const tailNext = peek();
            if (!tailNext || tailNext.kind !== "word" || tailNext.value !== "随机变量") {
              throw new ParseError("从…到…的随机变量 缺少 “随机变量”", position);
            }
            take();
          }
          return {
            id: createTempId(),
            type: "random",
            slots: { from, to }
          };
        }
        if (keyword.type === "answerValue") {
          const predicate = parsePredicate();
          return {
            id: createTempId(),
            type: "answerValue",
            slots: { predicate }
          };
        }
        if (keyword.type === "arithmetic") {
          const left = parseValue();
          const right = parseValue();
          return {
            id: createTempId(),
            type: "arithmetic",
            operator: keyword.operator,
            slots: { left, right }
          };
        }
        return {
          id: createTempId(),
          type: keyword.type,
          slots: {}
        };
      }
      return null;
    }

    function parsePredicate() {
      const node = parsePredicateInner();
      // 后缀形式：<inner> 不成立 吗?
      const lookahead = tokens[position + 1];
      if (peek() && peek().kind === "word" && peek().value === "不成立"
          && lookahead && lookahead.kind === "word" && lookahead.value === "吗?") {
        take(); // 不成立
        take(); // 吗?
        return { id: createTempId(), type: "not", slots: { predicate: node } };
      }
      return node;
    }

    function parsePredicateInner() {
      const token = peek();
      if (!token) throw new ParseError("缺少判断条件", position);
      if (token.kind === "char" && token.value === PREDICATE_OPEN) {
        take();
        const inner = parsePredicate();
        expectChar(PREDICATE_CLOSE);
        return inner;
      }
      if (token.kind === "char" && token.value === VALUE_OPEN) {
        const left = parseValue();
        return finishPredicateWithLeft(left);
      }
      if (token.kind === "word" && token.value === "第") {
        take();
        const value = parseValue();
        const tail = peek();
        if (!tail || tail.kind !== "word" || !(tail.value === "问" || tail.value === "问?")) {
          throw new ParseError("第(N)问 缺少结尾的 “问”", position);
        }
        take();
        if (peek() && peek().kind === "word" && peek().value === "吗?") take();
        return { id: createTempId(), type: "isQuestion", slots: { value } };
      }
      if (token.kind === "word" && PREDICATE_KEYWORDS[token.value]) {
        const keyword = PREDICATE_KEYWORDS[token.value];
        take();
        const node = { id: createTempId(), type: keyword.type, slots: {} };
        for (const slotName of keyword.expects) {
          if (slotName === "operator") {
            const operator = expectWord("比较需要 大于/等于/小于 运算符");
            if (!COMPARE_OPERATORS[operator.value]) {
              throw new ParseError(`未知的比较运算符 ${operator.value}`, position);
            }
            node.operator = COMPARE_OPERATORS[operator.value];
            continue;
          }
          if (slotName === "predicate") {
            node.slots[slotName] = parsePredicate();
            continue;
          }
          node.slots[slotName] = parseValue();
        }
        if (peek() && peek().kind === "word" && peek().value === "吗?") take();
        return node;
      }
      if (token.kind === "word" && matchValueKeyword()) {
        throw new ParseError("圆角矩形中的内容不是判断积木", position);
      }
      throw new ParseError("无法解析的判断积木", position);
    }

    function finishPredicateWithLeft(left) {
      const token = peek();
      if (token && token.kind === "word" && COMPARE_OPERATORS[token.value]) {
        take();
        const node = {
          id: createTempId(),
          type: "compare",
          operator: COMPARE_OPERATORS[token.value],
          slots: { left, right: parseValue() }
        };
        if (peek() && peek().kind === "word" && peek().value === "吗?") take();
        return node;
      }
      if (!token || token.kind !== "word" || !PREDICATE_KEYWORDS[token.value]) {
        throw new ParseError("(value) 之后需要判断关键字（大于/等于/小于/含有）", position);
      }
      const keyword = PREDICATE_KEYWORDS[token.value];
      if (keyword.type === "not") {
        throw new ParseError("不成立 应包裹在另一个判断积木中，不能作为 (value) 后的关键字", position);
      }
      take();
      const node = { id: createTempId(), type: keyword.type, slots: { left } };
      for (const slotName of keyword.expects) {
        if (slotName === "left" && node.slots.left) continue;
        if (slotName === "operator") {
          const operator = expectWord("比较需要 大于/等于/小于 运算符");
          if (!COMPARE_OPERATORS[operator.value]) {
            throw new ParseError(`未知的比较运算符 ${operator.value}`, position);
          }
          node.operator = COMPARE_OPERATORS[operator.value];
          continue;
        }
        if (slotName === "predicate") {
          node.slots[slotName] = parsePredicate();
          continue;
        }
        node.slots[slotName] = parseValue();
      }
      if (peek() && peek().kind === "word" && peek().value === "吗?") take();
      return node;
    }

    function parseScope() {
      const token = peek();
      if (!token) throw new ParseError("缺少作用域内容", position);
      if (token.kind !== "char" || token.value !== SCOPE_OPEN) {
        throw new ParseError("循环积木后必须跟 { ... } 作用域", position);
      }
      take();
      const body = [];
      while (peek() && !(peek().kind === "char" && peek().value === SCOPE_CLOSE)) {
        body.push(parseCommand());
      }
      expectChar(SCOPE_CLOSE);
      return body;
    }

    function parseCommand() {
      const token = peek();
      if (!token) throw new ParseError("缺少指令积木", position);
      const bracketed = token.kind === "char" && token.value === "[";
      if (bracketed) take();
      const command = parseCommandBody();
      if (bracketed) expectChar("]");
      return command;
    }

    function parseCommandBody() {
      const token = peek();
      if (!token) throw new ParseError("缺少指令积木", position);
      if (token.kind !== "word" || !COMMAND_KEYWORDS[token.value]) {
        throw new ParseError(`未知的指令积木 ${token?.value || ""}`, position);
      }
      const keyword = COMMAND_KEYWORDS[token.value];
      take();
      if (keyword.type === "answer") {
        const predicate = parsePredicate();
        return { id: createTempId(), type: "answer", slots: { predicate } };
      }
      if (keyword.type === "assign") {
        const nameToken = parseAssignName();
        if (peek()?.kind === "char" && peek().value === "=") {
          take();
        }
        const value = parseValue();
        return {
          id: createTempId(),
          type: "assign",
          name: nameToken,
          slots: { value }
        };
      }
      if (keyword.type === "repeat") {
        const count = parseValue();
        const body = parseScope();
        return {
          id: createTempId(),
          type: "repeat",
          slots: { count },
          body
        };
      }
      throw new ParseError("无法识别的指令类型", position);
    }

    function parseAssignName() {
      const token = peek();
      if (token && token.kind === "char" && token.value === VALUE_OPEN) {
        take();
        const name = expectWord("赋值后需要变量名");
        expectChar(VALUE_CLOSE);
        return name.value;
      }
      return expectWord("赋值后需要变量名").value;
    }

    const program = [];
    while (peek()) {
      program.push(parseCommand());
    }
    return program;
  }

  function createTempId() {
    return `text-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function printValue(node) {
    if (!node) return "()";
    if (node.kind === "atom") return `(${node.value})`;
    if (node.type === "arithmetic") {
      return `(${printValue(node.slots.left)} ${operatorLabel(node.operator, "value")} ${printValue(node.slots.right)})`;
    }
    if (node.type === "random") {
      return `(从${printValue(node.slots.from)}到${printValue(node.slots.to)}的随机变量)`;
    }
    if (node.type === "answerValue") {
      return `(<${printPredicate(node.slots.predicate)}>的答案)`;
    }
    if (node.type === "answerCharCount") {
      return `(<${printPredicate(node.slots.predicate)}>的字数)`;
    }
    if (node.type === "currentLine") return "(行号)";
    if (node.type === "currentQuestion") return "(问题编号)";
    if (node.type === "compare" || node.type === "contains" || node.type === "not" || node.type === "isQuestion") {
      return `<${printPredicate(node)}>`;
    }
    return `(${printValue(node)})`;
  }

  function printPredicate(node) {
    if (!node) return "判断缺失";
    if (node.type === "compare") {
      return `${printValue(node.slots.left)} ${operatorLabel(node.operator, "predicate")} ${printValue(node.slots.right)} 吗?`;
    }
    if (node.type === "contains") {
      return `${printValue(node.slots.left)} 含有 ${printValue(node.slots.right)} 吗?`;
    }
    if (node.type === "not") {
      return `${printPredicate(node.slots.predicate)} 不成立 吗?`;
    }
    if (node.type === "isQuestion") {
      return `第 ${printValue(node.slots.value)} 问`;
    }
    return `<未知判断 ${node.type}>`;
  }

  function printCommand(command, line = null) {
    if (command.type === "assign") {
      return `[赋值 (${command.name}) = ${printValue(command.slots.value)}]`;
    }
    if (command.type === "answer") {
      const tag = Number.isInteger(line) && line > 0 ? `  # L${line}` : "";
      return `[回答 <${printPredicate(command.slots.predicate)}>]${tag}`;
    }
    if (command.type === "repeat") {
      const body = (command.body || []).map((entry) => `  ${printCommand(entry)}`).join("\n");
      return `[重复 ${printValue(command.slots.count)} {\n${body}\n}]`;
    }
    return `[未知积木 ${command.type}]`;
  }

  function operatorLabel(operator, context) {
    const map = context === "value"
      ? { add: "加", sub: "减", mul: "乘", div: "除以" }
      : { gt: "大于", eq: "等于", lt: "小于" };
    return map[operator] || operator;
  }

  return {
    MAX_VALUES,
    LOGIC_LABELS,
    TYPE_LABELS,
    domain,
    valueError,
    parseAtom,
    evaluateInput,
    evaluateExpression,
    evaluatePredicate,
    execute,
    integerPoints,
    negate,
    negateTandF,
    buildCondition,
    summarizeValue,
    variableNameIsValid,
    parse,
    printCommand,
    printValue,
    printPredicate,
    charCount: questionCharCount
  };
});
