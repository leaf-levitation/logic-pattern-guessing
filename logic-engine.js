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
    let result;
    if (typeof input === "string" || typeof input === "number" || typeof input === "boolean") {
      result = parseAtom(String(input), environment);
    } else if (!input) {
      result = valueError("积木孔位尚未填写");
    } else if (input.kind === "atom") {
      result = parseAtom(input.value, environment);
    } else {
      result = evaluateExpression(input, environment, context);
    }

    if (context?.runtime?.transformValue) {
      try {
        const transformed = context.runtime.transformValue(result, input, environment, context);
        if (transformed) result = transformed;
      } catch (err) {
        return valueError(err?.message || "值变换失败");
      }
    }
    return result;
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
    const name = operatorName(operator);

    // 1) 先查运行时知识库覆写
    const override = lookupRelationOverride(context, name, left, right);
    if (override) return override;

    // 2) 内置实现
    if (operator === "eq") {
      const numericPair = isNumeric(left) && isNumeric(right);
      if (numericPair) {
        return relationResult(left, right, (a, b) => Number(a) === Number(b), "候选组合");
      }
      if (left.type !== right.type) return logicError("等于判断的两侧类型不兼容");
      return relationResult(left, right, (a, b) => a === b, "候选组合");
    }

    if (operator === "contains") {
      return relationResult(left, right, (a, b) => String(a).includes(String(b)), "子串组合");
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

  function relationCheck(node, environment, context = null) {
    const left = evaluateInput(node.slots?.left, environment, context);
    if (!left.ok) return logicError(left.error);
    const right = evaluateInput(node.slots?.right, environment, context);
    if (!right.ok) return logicError(right.error);
    const name = node.name || "";
    const override = lookupRelationOverride(context, name, left, right);
    if (override) return override;
    // 内置关系名回退
    const op = nameToOperator(name);
    if (op) {
      return compare({ ...node, operator: op, slots: node.slots }, environment, context);
    }
    return logic("I", `未声明的关系 ${name}`, null);
  }

  function lookupRelationOverride(context, name, left, right) {
    if (!name || !context || !context.runtime) return null;
    const relations = context.runtime.relations;
    if (!relations) return null;
    const map = relations.get(name);
    if (!map) return null;
    for (const lv of left.values) {
      const lk = valueKey(lv);
      const inner = map.get(lk);
      if (!inner) return null;
      for (const rv of right.values) {
        const rk = valueKey(rv);
        if (inner.has(rk)) return logic(inner.get(rk), `关系 ${name} 被覆写`, null);
      }
    }
    return null;
  }

  const OPERATOR_TO_NAME = { gt: "大于", eq: "等于", lt: "小于", contains: "含有" };
  const NAME_TO_OPERATOR = { "大于": "gt", "等于": "eq", "小于": "lt", "含有": "contains" };

  function operatorName(operator) {
    return OPERATOR_TO_NAME[operator] || null;
  }

  function nameToOperator(name) {
    return NAME_TO_OPERATOR[name] || null;
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
    else if (node.type === "not") result = negate(evaluatePredicate(node.slots?.predicate, environment, context));
    else if (node.type === "isQuestion") result = isQuestion(node, environment, context);
    else if (node.type === "relationCheck") result = relationCheck(node, environment, context);
    else return logicError("该积木不能作为判断条件");

    if (context && context.runtime && typeof context.runtime.transformPredicateResult === "function") {
      try {
        result = context.runtime.transformPredicateResult(result, node, context);
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
    if (!spec) return null;
    if (typeof spec === "string") {
      if (spec === "truth") return null;
      if (spec === "alwaysLie") {
        return { transformPredicateResult: (result) => negateTandF(result) };
      }
      if (spec === "lieIfLong") {
        return {
          transformPredicateResult: (result, node, context) => {
            if (!node) return result;
            const text = charCountText(node, context || {});
            if (countChars(text) >= 10) return negateTandF(result);
            return result;
          }
        };
      }
      if (spec === "lieIfOddLine") {
        return {
          transformPredicateResult: (result, _node, context) => {
            const line = Number(context && context.line);
            if (Number.isFinite(line) && Math.abs(line) % 2 === 1) return negateTandF(result);
            return result;
          }
        };
      }
      if (spec === "isAnswerIs" || spec === "answerByPriority") {
      return {
        transformPredicateResult: (result, node, context) => {
          if (!node) return result;
          const text = charCountText(node, context || {});
          if (text.includes("是")) return { ...result, code: "T", label: LOGIC_LABELS.T };
          if (text.includes("否")) return { ...result, code: "F", label: LOGIC_LABELS.F };
          if (text.includes("不确定")) return { ...result, code: "U", label: LOGIC_LABELS.U };
          if (text.includes("无法回答")) return { ...result, code: "I", label: LOGIC_LABELS.I };
          return result;
        }
      };
    }
    if (spec === "allNumbersTo1") {
      return {
        transformValue: (domain) => {
          if (!domain || !domain.ok) return domain;
          if (domain.type !== "int" && domain.type !== "float") return domain;
          return { ...domain, values: [1], source: "allNumbersTo1" };
        }
      };
    }
    if (spec === "allLineAndQuestionTo0") {
      return compileValueTransform({ currentLine: 0, currentQuestion: 0 });
    }
    if (spec === "innerBlocksAsText") {
      return {
        transformValue: (domain, input) => {
          if (input && (input.type === "currentLine" || input.type === "currentQuestion"
              || input.type === "arithmetic" || input.type === "random"
              || input.type === "answerValue" || input.type === "answerCharCount"
              || input.type === "isQuestion" || input.type === "relationCheck")) {
            // 内部积木视作纯文字：跳过原求值，返回 charCountText 字符串域。
            const text = charCountText(input, {});
            return { ok: true, type: "string", values: [text], source: "innerBlocksAsText" };
          }
          return domain;
        }
      };
    }
    return null;
    }
    if (typeof spec === "object") {
      return compileCondition(spec);
    }
    return null;
  }

  function normalizeRuntime(options) {
    const userRuntime = (options && options.runtime) || {};
    const runtime = {
      transformPredicateResult: typeof userRuntime.transformPredicateResult === "function"
        ? userRuntime.transformPredicateResult : null,
      transformValue: typeof userRuntime.transformValue === "function"
        ? userRuntime.transformValue : null,
      transformAssignment: typeof userRuntime.transformAssignment === "function"
        ? userRuntime.transformAssignment : null,
      transformQuestion: typeof userRuntime.transformQuestion === "function"
        ? userRuntime.transformQuestion : null,
      resolveAnswer: typeof userRuntime.resolveAnswer === "function"
        ? userRuntime.resolveAnswer : null,
    };

    if (options && typeof options.condition === "function") {
      runtime.transformPredicateResult = options.condition;
    }
    return runtime;
  }

  // ===== 关卡条件 DSL 编译器 =====
  // spec = { when?: { ... }, transform?: { ... } }
  // 编译产物 = Runtime fragment { transformPredicateResult }

  const VALID_WHEN_KEYS = new Set([
    "charCount", "line", "questionNumber", "previousAnswer", "questionTextContains"
  ]);
  const VALID_TRANSFORM_KEYS = new Set(["flipTandF", "fix", "xorWithPrev"]);
  const VALID_NUMERIC_OPS = new Set(["eq", "ne", "gt", "gte", "lt", "lte"]);
  const VALID_FIX_CODES = new Set(["T", "F", "U"]);

  function compileCondition(spec) {
    if (!spec || typeof spec !== "object") return null;
    const when = spec.when || {};
    const transform = spec.transform || {};

    if (typeof when !== "object") {
      throw new Error("compileCondition: when 必须是对象");
    }
    if (typeof transform !== "object") {
      throw new Error("compileCondition: transform 必须是对象");
    }

    validateWhenClause(when);
    validateTransformClause(transform);

    // 没指定任何 transform -> 等价于 passthrough，直接返回 null
    if (Object.keys(transform).length === 0) return null;

    return {
      transformPredicateResult: (result, node, context) => {
        if (!matchWhenClause(when, node, context)) return result;
        return applyTransformClause(transform, result, context);
      }
    };
  }

  function validateWhenClause(when) {
    for (const key of Object.keys(when)) {
      if (!VALID_WHEN_KEYS.has(key)) {
        throw new Error(`compileCondition: 未知的 when 子句 "${key}"`);
      }
      if (key === "questionTextContains" && typeof when[key] !== "string") {
        throw new Error(`compileCondition: questionTextContains 必须是字符串`);
      }
      if (key === "previousAnswer") {
        const spec = when[key];
        if (!spec || typeof spec !== "object" || !VALID_FIX_CODES.has(spec.code)) {
          throw new Error(`compileCondition: previousAnswer.code 必须是 "T"/"F"/"U"/"I" 之一`);
        }
      }
      if (key === "charCount" || key === "line" || key === "questionNumber") {
        validateNumericSpec(key, when[key]);
      }
    }
  }

  function validateNumericSpec(key, spec) {
    if (!spec || typeof spec !== "object") {
      throw new Error(`compileCondition: ${key} 必须是对象`);
    }
    for (const op of Object.keys(spec)) {
      if (op !== "odd" && op !== "even" && !VALID_NUMERIC_OPS.has(op)) {
        throw new Error(`compileCondition: ${key}.${op} 不是有效运算符`);
      }
      if ((op === "odd" || op === "even") && spec[op] !== true) {
        throw new Error(`compileCondition: ${key}.${op} 必须为 true`);
      }
      if (VALID_NUMERIC_OPS.has(op) && typeof spec[op] !== "number") {
        throw new Error(`compileCondition: ${key}.${op} 必须是数字`);
      }
    }
  }

  function validateTransformClause(transform) {
    const keys = Object.keys(transform);
    if (keys.length > 1) {
      throw new Error(`compileCondition: transform 只能指定一个操作，当前: ${keys.join(", ")}`);
    }
    for (const key of keys) {
      if (!VALID_TRANSFORM_KEYS.has(key)) {
        throw new Error(`compileCondition: 未知的 transform 操作 "${key}"`);
      }
    }
    if ("fix" in transform && !VALID_FIX_CODES.has(transform.fix)) {
      throw new Error(`compileCondition: transform.fix 必须是 "T"/"F"/"U" 之一，收到 "${transform.fix}"`);
    }
    if ("flipTandF" in transform && transform.flipTandF !== true) {
      throw new Error(`compileCondition: transform.flipTandF 必须为 true`);
    }
    if ("xorWithPrev" in transform && transform.xorWithPrev !== true) {
      throw new Error(`compileCondition: transform.xorWithPrev 必须为 true`);
    }
  }

  function matchWhenClause(when, node, context) {
    for (const [key, value] of Object.entries(when)) {
      if (!matchClause(key, value, node, context)) return false;
    }
    return true;
  }

  function matchClause(key, value, node, context) {
    const ctx = context || {};
    switch (key) {
      case "charCount":
        return node ? matchNumeric(countChars(charCountText(node, ctx)), value) : false;
      case "line":
        return matchNumeric(Number(ctx.line), value);
      case "questionNumber":
        return matchNumeric(Number(ctx.question), value);
      case "previousAnswer": {
        const prev = ctx.answers && ctx.answers[ctx.question - 2];
        return Boolean(prev) && prev.code === value.code;
      }
      case "questionTextContains":
        return node ? charCountText(node, ctx).includes(String(value)) : false;
      default:
        return false;
    }
  }

  function matchNumeric(value, spec) {
    if ("odd" in spec) {
      return Number.isFinite(value) && Math.abs(value) % 2 === 1;
    }
    if ("even" in spec) {
      return Number.isFinite(value) && Math.abs(value) % 2 === 0;
    }
    for (const op of Object.keys(spec)) {
      const target = spec[op];
      switch (op) {
        case "eq": if (value !== target) return false; break;
        case "ne": if (value === target) return false; break;
        case "gt": if (!(value > target)) return false; break;
        case "gte": if (!(value >= target)) return false; break;
        case "lt": if (!(value < target)) return false; break;
        case "lte": if (!(value <= target)) return false; break;
      }
    }
    return true;
  }

  function applyTransformClause(transform, result, context) {
    if ("flipTandF" in transform) return negateTandF(result);
    if ("fix" in transform) {
      return { ...result, code: transform.fix, label: LOGIC_LABELS[transform.fix] };
    }
    if ("xorWithPrev" in transform) return xorWithPrev(result, context);
    return result;
  }

  function xorWithPrev(result, context) {
    const ctx = context || {};
    const prev = ctx.answers && ctx.answers[ctx.question - 2];
    if (!prev) return result;
    if (result.code === "U" || result.code === "I") return result;
    if (prev.code === "U" || prev.code === "I") return result;
    if (prev.code === "T") return negateTandF(result);
    return result;
  }

  // ===== Stage 3: 变量/值变换 DSL =====

  const VALID_VALUE_KEYS = ["currentLine", "currentQuestion", "answerCharCount", "shiftIntAtoms", "shiftFloatAtoms"];
  const VALID_ASSIGNMENT_KEYS = ["shiftBy", "clampMin", "clampMax", "onlyIfNameMatches"];
  const VALID_ANSWER_MODES = ["previousAnswer", "fixed", "rotate", "nth"];

  function compileValueTransform(spec) {
    if (!spec || typeof spec !== "object") return null;
    validateKeySet(spec, VALID_VALUE_KEYS, "compileValueTransform");
    for (const key of VALID_VALUE_KEYS) {
      if (key in spec && (typeof spec[key] !== "number" || !Number.isFinite(spec[key]))) {
        throw new Error(`compileValueTransform: ${key} 必须是有限数字`);
      }
    }
    if (!VALID_VALUE_KEYS.some((k) => k in spec)) return null;

    return {
      transformValue: (domain, input) => {
        if ("currentLine" in spec && input && input.type === "currentLine") {
          return { ok: true, type: "int", values: [Number(spec.currentLine)], source: "overrideCurrentLine" };
        }
        if ("currentQuestion" in spec && input && input.type === "currentQuestion") {
          return { ok: true, type: "int", values: [Number(spec.currentQuestion)], source: "overrideCurrentQuestion" };
        }
        if ("answerCharCount" in spec && input && input.type === "answerCharCount") {
          return { ok: true, type: "int", values: [Number(spec.answerCharCount)], source: "overrideAnswerCharCount" };
        }
        if ("shiftIntAtoms" in spec && input && input.kind === "atom" && domain && domain.ok && domain.type === "int") {
          // 跳过 $变量 引用（用户填入的"数值"只指字面量）
          if (typeof input.value === "string" && input.value.startsWith("$")) return domain;
          return {
            ok: true, type: "int",
            values: domain.values.map((v) => v + Number(spec.shiftIntAtoms)),
            source: "shiftIntAtoms"
          };
        }
        if ("shiftFloatAtoms" in spec && input && input.kind === "atom" && domain && domain.ok && domain.type === "float") {
          if (typeof input.value === "string" && input.value.startsWith("$")) return domain;
          return {
            ok: true, type: "float",
            values: domain.values.map((v) => v + Number(spec.shiftFloatAtoms)),
            source: "shiftFloatAtoms"
          };
        }
        return domain;
      }
    };
  }

  function compileAssignmentTransform(spec) {
    if (!spec || typeof spec !== "object") return null;
    validateKeySet(spec, VALID_ASSIGNMENT_KEYS, "compileAssignmentTransform");
    for (const key of ["shiftBy", "clampMin", "clampMax"]) {
      if (key in spec && (typeof spec[key] !== "number" || !Number.isFinite(spec[key]))) {
        throw new Error(`compileAssignmentTransform: ${key} 必须是有限数字`);
      }
    }
    if ("onlyIfNameMatches" in spec) {
      const matcher = spec.onlyIfNameMatches;
      if (!(matcher instanceof RegExp) && typeof matcher !== "string") {
        throw new Error(`compileAssignmentTransform: onlyIfNameMatches 必须是字符串或正则`);
      }
    }
    const hasNumeric = ["shiftBy", "clampMin", "clampMax"].some((k) => k in spec);
    if (!hasNumeric && !("onlyIfNameMatches" in spec)) return null;

    return {
      transformAssignment: (name, domain) => {
        if ("onlyIfNameMatches" in spec) {
          const m = spec.onlyIfNameMatches;
          const ok = m instanceof RegExp ? m.test(name) : String(name) === m || name.includes(m);
          if (!ok) return domain;
        }
        if (!domain || !domain.ok || domain.type !== "int") return domain;
        let values = domain.values.slice();
        if ("shiftBy" in spec) values = values.map((v) => v + Number(spec.shiftBy));
        if ("clampMin" in spec) values = values.map((v) => Math.max(v, Number(spec.clampMin)));
        if ("clampMax" in spec) values = values.map((v) => Math.min(v, Number(spec.clampMax)));
        return { ok: true, type: "int", values, source: "transformedAssignment" };
      }
    };
  }

  function validateKeySet(spec, validKeys, fnName) {
    for (const key of Object.keys(spec)) {
      if (!validKeys.includes(key)) {
        throw new Error(`${fnName}: 未知的 key "${key}"`);
      }
    }
  }

  // ===== Stage 4: 回答解析 DSL =====

  function compileAnswer(spec) {
    if (!spec || typeof spec !== "object") return null;
    if (!("mode" in spec)) return null;
    const mode = spec.mode;
    if (!VALID_ANSWER_MODES.includes(mode)) {
      throw new Error(`compileAnswer: 未知的 mode "${mode}"`);
    }

    if (mode === "previousAnswer") {
      return {
        resolveAnswer: (_predicate, _env, context) => {
          const prev = context && context.answers && context.answers[context.question - 2];
          if (prev) return prev;
          return logicError("没有上一问的回答");
        }
      };
    }

    if (mode === "fixed") {
      if (!("code" in spec) || !["T", "F", "U"].includes(spec.code)) {
        throw new Error(`compileAnswer: fixed 模式需要 code 为 "T"/"F"/"U" 之一`);
      }
      return {
        resolveAnswer: () => ({
          code: spec.code,
          label: LOGIC_LABELS[spec.code],
          detail: "固定回答",
          stats: null
        })
      };
    }

    if (mode === "rotate") {
      if (!Array.isArray(spec.cycle) || spec.cycle.length === 0) {
        throw new Error(`compileAnswer: rotate 模式需要非空 cycle 数组`);
      }
      for (const code of spec.cycle) {
        if (!["T", "F", "U"].includes(code)) {
          throw new Error(`compileAnswer: cycle 元素必须是 "T"/"F"/"U" 之一，收到 "${code}"`);
        }
      }
      return {
        resolveAnswer: (_predicate, _env, context) => {
          const q = Number(context && context.question) || 1;
          const idx = (q - 1) % spec.cycle.length;
          const code = spec.cycle[idx];
          return { code, label: LOGIC_LABELS[code], detail: `rotate 第 ${idx + 1} 项`, stats: null };
        }
      };
    }

    if (mode === "nth") {
      if (!Number.isInteger(spec.nth) || spec.nth < 1) {
        throw new Error(`compileAnswer: nth 模式需要 nth 为正整数`);
      }
      return {
        resolveAnswer: (_predicate, _env, context) => {
          const ans = context && context.answers && context.answers[spec.nth - 1];
          if (ans) return ans;
          return logicError(`第 ${spec.nth} 问 尚未回答`);
        }
      };
    }

    return null;
  }

  // ===== Stage 3+4 合成器 =====

  function buildRuntime(spec) {
    if (!spec || typeof spec !== "object") return null;

    const runtime = {
      transformPredicateResult: null,
      transformValue: null,
      transformAssignment: null,
      transformQuestion: null,
      resolveAnswer: null,
    };

    if ("condition" in spec) {
      const frag = compileCondition(spec.condition);
      if (frag && frag.transformPredicateResult) {
        runtime.transformPredicateResult = frag.transformPredicateResult;
      }
    }
    if ("value" in spec) {
      const frag = compileValueTransform(spec.value);
      if (frag && frag.transformValue) {
        runtime.transformValue = frag.transformValue;
      }
    }
    if ("assignment" in spec) {
      const frag = compileAssignmentTransform(spec.assignment);
      if (frag && frag.transformAssignment) {
        runtime.transformAssignment = frag.transformAssignment;
      }
    }
    if ("answer" in spec) {
      const frag = compileAnswer(spec.answer);
      if (frag && frag.resolveAnswer) {
        runtime.resolveAnswer = frag.resolveAnswer;
      }
    }

    for (const key of ["transformPredicateResult", "transformValue", "transformAssignment", "transformQuestion", "resolveAnswer"]) {
      if (typeof spec[key] === "function") {
        runtime[key] = spec[key];
      }
    }

    if (Object.values(runtime).every((v) => v === null)) return null;
    return runtime;
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
    if (context?.runtime?.transformQuestion) {
      try {
        const transformed = context.runtime.transformQuestion(predicate, context);
        if (transformed) predicate = transformed;
      } catch (err) {
        return logicError(err?.message || "问题变换失败");
      }
    }
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
      case "relationCheck":
        return charCountText(node.slots?.left, context)
          + (node.name || "")
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
    const runtime = normalizeRuntime(options);
    // 运行时知识库：relations[name][leftKey][rightKey] = code；declaredRelations 为声明过的名字集合。
    // 大于/等于/小于/含有 默认已声明，且可被覆写。
    const relations = new Map();
    const declaredRelations = new Set(["大于", "等于", "小于", "含有"]);
    if (!runtime.relations) runtime.relations = relations;
    if (!runtime.declaredRelations) runtime.declaredRelations = declaredRelations;
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
            environment,
            runtime
          };
          let result = evaluateInput(subCommand.slots?.value, environment, countContext);
          if (runtime.transformAssignment) {
            try {
              const transformed = runtime.transformAssignment(name, result, environment, countContext);
              if (transformed) result = transformed;
            } catch (err) {
              result = valueError(err?.message || "赋值变换失败");
            }
          }
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
            runtime
          };
          let result;
          if (runtime.resolveAnswer) {
            try {
              result = runtime.resolveAnswer(subCommand.slots?.predicate, environment, context);
              if (!result || typeof result.code !== "string") {
                result = logicError("resolveAnswer 返回了非法的结果");
              }
            } catch (err) {
              result = logicError(err?.message || "resolveAnswer 失败");
            }
          } else {
            result = evaluateAnswerPredicate(subCommand.slots?.predicate, environment, context);
          }
          answerHistory[questionCount - 1] = result;
          outputs.push({ index: steps.length, line, question: questionCount, result, scope: label });
          steps.push({ index: steps.length, line, question: questionCount, type: "answer", result, scope: label });
          continue;
        }

        if (subCommand.type === "repeat") {
          const countContext = {
            answeredCount: questionCount,
            questionPredicates,
            environment,
            runtime
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

        if (subCommand.type === "declareRelation") {
          const name = String(subCommand.name || "").trim();
          if (!name) {
            const failed = valueError("关系名不能为空");
            steps.push({ index: steps.length, line, type: "declareRelation", name, result: failed, scope: label });
            continue;
          }
          // 文档 4.13.2：游戏自带关系默认已声明，重复声明无副作用。
          declaredRelations.add(name);
          if (!relations.has(name)) relations.set(name, new Map());
          const okResult = { ok: true, type: "int", values: [1], source: "declareRelation" };
          steps.push({ index: steps.length, line, type: "declareRelation", name, result: okResult, scope: label });
          continue;
        }

        if (subCommand.type === "overrideRelation") {
          const name = String(subCommand.name || "").trim();
          if (!name) {
            const failed = valueError("关系名不能为空");
            steps.push({ index: steps.length, line, type: "overrideRelation", name, result: failed, scope: label });
            continue;
          }
          declaredRelations.add(name);
          const valueContext = {
            answeredCount: questionCount,
            questionPredicates,
            environment,
            runtime
          };
          const leftResult = evaluateInput(subCommand.slots?.left, environment, valueContext);
          if (!leftResult.ok) {
            steps.push({ index: steps.length, line, type: "overrideRelation", name, result: leftResult, scope: label });
            continue;
          }
          const rightResult = evaluateInput(subCommand.slots?.right, environment, valueContext);
          if (!rightResult.ok) {
            steps.push({ index: steps.length, line, type: "overrideRelation", name, result: rightResult, scope: label });
            continue;
          }
          const code = subCommand.code || "T";
          let inner = relations.get(name);
          if (!inner) {
            inner = new Map();
            relations.set(name, inner);
          }
          for (const lv of leftResult.values) {
            const lk = valueKey(lv);
            let row = inner.get(lk);
            if (!row) {
              row = new Map();
              inner.set(lk, row);
            }
            for (const rv of rightResult.values) {
              const rk = valueKey(rv);
              row.set(rk, code);
            }
          }
          const okResult = { ok: true, type: "int", values: [1], source: "overrideRelation" };
          steps.push({ index: steps.length, line, type: "overrideRelation", name, code, result: okResult, scope: label });
          continue;
        }

        steps.push({ index: steps.length, line, type: "unknown", result: valueError("无法执行的指令积木"), scope: label });
      }
    }

    runSubCommands(commands, "顶层");
    void snapshotEnvironment;

    return { environment, outputs, steps, relations, declaredRelations };
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
    "重复": { type: "repeat" },
    "声明": { type: "declareRelation" },
    "覆写": { type: "overrideRelation" }
  };

  const PREDICATE_KEYWORDS = {
    "比较": { type: "compare", expects: ["left", "operator", "right"] },
    "不成立": { type: "not", expects: ["predicate"] }
  };

  const VALID_RELATION_CODES = ["T", "F", "U", "I"];
  const RELATION_CODE_ALIASES = {
    "是": "T",
    "否": "F",
    "不确定": "U",
    "无法回答": "I"
  };
  const RELATION_CODE_ALIASES_REVERSE = {
    "T": "是",
    "F": "否",
    "U": "不确定",
    "I": "无法回答"
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
    "小于": "lt",
    "含有": "contains"
  };

  function tokenize(source) {
    // 4.0 文本表示：忽略全角/半角符号差异（括号、方括号统一为半角）。
    const normalized = String(source ?? "")
      .replace(/（/g, "(")
      .replace(/）/g, ")")
      .replace(/【/g, "[")
      .replace(/】/g, "]");
    const tokens = [];
    let buffer = "";
    let i = 0;

    function push() {
      if (buffer.length) {
        tokens.push({ kind: "word", value: buffer });
        buffer = "";
      }
    }

    while (i < normalized.length) {
      const char = normalized[i];
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
        let end = normalized.indexOf("\"", i + 1);
        if (end < 0) end = normalized.length;
        tokens.push({ kind: "word", value: normalized.slice(i, end + 1) });
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
            const operator = expectWord("比较需要 大于/等于/小于/含有 运算符");
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
      if (token && token.kind === "char" && token.value === VALUE_OPEN) {
        // (name)(right) 吗? → relationCheck
        take();
        const nameToken = expectWord("关系判断需要 (关系名)");
        expectChar(VALUE_CLOSE);
        const right = parseValue();
        if (peek() && peek().kind === "word" && peek().value === "吗?") take();
        return {
          id: createTempId(),
          type: "relationCheck",
          name: nameToken.value,
          slots: { left, right }
        };
      }
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
      if (token && token.kind === "word" && token.value === "不成立") {
        throw new ParseError("不成立 应包裹在另一个判断积木中，不能作为 (value) 后的关键字", position);
      }
      if (token && token.kind === "word") {
        // Any other bare word → relationCheck
        const name = token.value;
        take();
        const right = parseValue();
        if (peek() && peek().kind === "word" && peek().value === "吗?") take();
        return {
          id: createTempId(),
          type: "relationCheck",
          name,
          slots: { left, right }
        };
      }
      throw new ParseError("(value) 之后需要判断关键字（大于/等于/小于/含有 或 (关系名)）", position);
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
      if (keyword.type === "declareRelation") {
        // 声明 (名称) 关系
        const name = parseRelationName();
        const tail = expectWord("声明 需要结尾的 “关系”");
        if (tail.value !== "关系") {
          throw new ParseError("声明 语法应为 “声明 (名称) 关系”", position);
        }
        return {
          id: createTempId(),
          type: "declareRelation",
          name
        };
      }
      if (keyword.type === "overrideRelation") {
        // 覆写 (左值) (关系名) (右值) 为 (T/F/U/I 或 是/否/不确定/无法回答)
        const left = parseValue();
        const relationName = parseRelationName();
        const right = parseValue();
        const wei = expectWord("覆写 需要 “为”");
        if (wei.value !== "为") {
          throw new ParseError("覆写 语法应为 “覆写 (左值) (关系名) (右值) 为 (...)”", position);
        }
        // 允许可选的圆角括号包裹：既支持 "为 是"，也支持 "为 (是)"。
        let codeToken;
        if (peek() && peek().kind === "char" && peek().value === "(") {
          take();
          codeToken = expectWord("覆写 需要 (是/否/不确定/无法回答)");
          expectChar(")");
        } else {
          codeToken = expectWord("覆写 需要 (是/否/不确定/无法回答)");
        }
        let code = null;
        if (VALID_RELATION_CODES.includes(codeToken.value)) {
          code = codeToken.value;
        } else if (RELATION_CODE_ALIASES[codeToken.value]) {
          code = RELATION_CODE_ALIASES[codeToken.value];
        } else {
          throw new ParseError(`覆写 需要 是/否/不确定/无法回答，收到 "${codeToken.value}"`, position);
        }
        return {
          id: createTempId(),
          type: "overrideRelation",
          name: relationName,
          code,
          slots: { left, right }
        };
      }
      throw new ParseError("无法识别的指令类型", position);
    }

    function parseRelationName() {
      const token = peek();
      if (token && token.kind === "char" && token.value === VALUE_OPEN) {
        take();
        const name = expectWord("关系名");
        expectChar(VALUE_CLOSE);
        return name.value;
      }
      return expectWord("关系名").value;
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
    if (node.type === "compare" || node.type === "not" || node.type === "isQuestion" || node.type === "relationCheck") {
      return `<${printPredicate(node)}>`;
    }
    return `(${printValue(node)})`;
  }

  function printPredicate(node) {
    if (!node) return "判断缺失";
    if (node.type === "compare") {
      return `${printValue(node.slots.left)} ${operatorLabel(node.operator, "predicate")} ${printValue(node.slots.right)} 吗?`;
    }
    if (node.type === "not") {
      return `${printPredicate(node.slots.predicate)} 不成立 吗?`;
    }
    if (node.type === "isQuestion") {
      return `第 ${printValue(node.slots.value)} 问`;
    }
    if (node.type === "relationCheck") {
      const name = node.name || "";
      return `${printValue(node.slots.left)} ${name} ${printValue(node.slots.right)} 吗?`;
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
    if (command.type === "declareRelation") {
      return `[声明 (${command.name || ""}) 关系]`;
    }
    if (command.type === "overrideRelation") {
      const code = command.code || "T";
      const name = command.name || "";
      const codeLabel = RELATION_CODE_ALIASES_REVERSE[code] || code;
      return `[覆写 ${printValue(command.slots.left)} ${name} ${printValue(command.slots.right)} 为 (${codeLabel})]`;
    }
    return `[未知积木 ${command.type}]`;
  }

  function operatorLabel(operator, context) {
    const map = context === "value"
      ? { add: "加", sub: "减", mul: "乘", div: "除以" }
      : { gt: "大于", eq: "等于", lt: "小于", contains: "含有" };
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
    compileCondition,
    compileValueTransform,
    compileAssignmentTransform,
    compileAnswer,
    buildRuntime,
    normalizeRuntime,
    summarizeValue,
    variableNameIsValid,
    parse,
    printCommand,
    printValue,
    printPredicate,
    charCount: questionCharCount
  };
});
