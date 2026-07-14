(function () {
  "use strict";

  const engine = window.LogicEngine;

  const categories = [
    { id: "command", label: "指令积木", color: "#f39b32" },
    { id: "predicate", label: "判断积木", color: "#7057df" },
    { id: "value", label: "变量积木", color: "#12a997" }
  ];

  const definitions = {
    answer: {
      type: "answer",
      category: "command",
      shape: "command",
      description: "执行六边形里的判断，并把推理结果（T 是 / F 否 / U 不确定 / I 无法回答）追加到回答面板。",
      parts: [
        { kind: "text", text: "回答" },
        { kind: "slot", name: "predicate", accept: "predicate", placeholder: "判断" }
      ]
    },
    assign: {
      type: "assign",
      category: "command",
      shape: "command",
      description: "把圆角积木的值存入左侧变量名，后续可通过 $变量名 引用。",
      parts: [
        { kind: "text", text: "赋值" },
        { kind: "name", placeholder: "变量名" },
        { kind: "text", text: "为" },
        { kind: "slot", name: "value", accept: "value", placeholder: "值" }
      ]
    },
    repeat: {
      type: "repeat",
      category: "command",
      shape: "command",
      description: "把花括号里的指令重复执行指定次数（最多 64 次防止死循环）。",
      parts: [
        { kind: "text", text: "重复" },
        { kind: "slot", name: "count", accept: "value", placeholder: "次数" },
        { kind: "scope", name: "body" }
      ]
    },
    compare: {
      type: "compare",
      category: "predicate",
      shape: "predicate",
      description: "按 大于 / 等于 / 小于 比较左右两个候选值，得到 T/F/U/I。",
      parts: [
        { kind: "slot", name: "left", accept: "value", placeholder: "左值" },
        {
          kind: "select",
          name: "operator",
          options: [
            { value: "gt", label: "大于" },
            { value: "eq", label: "等于" },
            { value: "lt", label: "小于" }
          ]
        },
        { kind: "slot", name: "right", accept: "value", placeholder: "右值" },
        { kind: "text", text: "吗？" }
      ]
    },
    contains: {
      type: "contains",
      category: "predicate",
      shape: "predicate",
      description: "判断左侧内容是否“字符串意义上”含有右侧目标；数值也会先转成字符串再判断。",
      parts: [
        { kind: "slot", name: "left", accept: "value", placeholder: "内容" },
        { kind: "text", text: "含有" },
        { kind: "slot", name: "right", accept: "value", placeholder: "目标" },
        { kind: "text", text: "吗？" }
      ]
    },
    not: {
      type: "not",
      category: "predicate",
      shape: "predicate",
      description: "把内部判断的 T / F 翻转，U 与 I 保持不变。",
      parts: [
        { kind: "slot", name: "predicate", accept: "predicate", placeholder: "判断" },
        { kind: "text", text: "不成立吗？" }
      ]
    },
    answerValue: {
      type: "answerValue",
      category: "value",
      shape: "value",
      description: "把判断结果转成回答字符串（T→是、F→否、U→不确定、I→无法回答），可作为赋值或比较的输入。",
      parts: [
        { kind: "slot", name: "predicate", accept: "predicate", placeholder: "判断" },
        { kind: "text", text: "的答案" }
      ]
    },
    answerCharCount: {
      type: "answerCharCount",
      category: "value",
      shape: "value",
      description: "返回方框内问题的字数（忽略积木自带的空格、括号与 $）。除 第x问 外的积木不求值，只按文字表示计数；<第x问> 在 0<x<本题编号 时展开该问的字数，x 等于本题编号视作字符串计入，x 大于本题编号、x≤0 或非整数则报错。",
      parts: [
        { kind: "slot", name: "predicate", accept: "predicate", placeholder: "判断" },
        { kind: "text", text: "的字数" }
      ]
    },
    arithmetic: {
      type: "arithmetic",
      category: "value",
      shape: "value",
      description: "对左右两个数值候选域做 加 / 减 / 乘 / 除以，结果超过 1000 个候选时会均匀压缩。",
      parts: [
        { kind: "slot", name: "left", accept: "value", placeholder: "左值" },
        {
          kind: "select",
          name: "operator",
          options: [
            { value: "add", label: "加" },
            { value: "sub", label: "减" },
            { value: "mul", label: "乘" },
            { value: "div", label: "除以" }
          ]
        },
        { kind: "slot", name: "right", accept: "value", placeholder: "右值" }
      ]
    },
    random: {
      type: "random",
      category: "value",
      shape: "value",
      description: "取 [起点, 终点] 区间内的整数作为候选域；超过 1000 个整数时均匀保留 1000 点。",
      parts: [
        { kind: "text", text: "从" },
        { kind: "slot", name: "from", accept: "value", placeholder: "起点" },
        { kind: "text", text: "到" },
        { kind: "slot", name: "to", accept: "value", placeholder: "终点" },
        { kind: "text", text: "的随机变量" }
      ]
    },
    isQuestion: {
      type: "isQuestion",
      category: "predicate",
      shape: "predicate",
      description: "回放第 N 个历史回答的结果：当 0<N<本题编号 时返回该回答的是/否/不确定/无法回答；N 等于本题编号返回 U（因为回答本身仍是可否）；N 大于本题编号、N≤0 或不是整数返回 I。仅在回答指令的判断孔中可用。",
      parts: [
        { kind: "text", text: "第" },
        { kind: "slot", name: "value", accept: "value", placeholder: "回答编号" },
        { kind: "text", text: "问" }
      ]
    },
    currentLine: {
      type: "currentLine",
      category: "value",
      shape: "value",
      description: "当前回答积木在工作区里的行号。仅在回答指令内可用。",
      parts: [
        { kind: "text", text: "行号" }
      ]
    },
    currentQuestion: {
      type: "currentQuestion",
      category: "value",
      shape: "value",
      description: "当前回答是第几个回答（第几问）。仅在回答指令内可用。",
      parts: [
        { kind: "text", text: "问题编号" }
      ]
    }
  };

  const elements = {
    library: document.querySelector("#block-library"),
    workspace: document.querySelector("#workspace"),
    commandStack: document.querySelector("#command-stack"),
    emptyWorkspace: document.querySelector("#empty-workspace"),
    commandCount: document.querySelector("#command-count"),
    variableList: document.querySelector("#variable-list"),
    variableCount: document.querySelector("#variable-count"),
    resultCount: document.querySelector("#result-count"),
    answerList: document.querySelector("#answer-list"),
    consoleLog: document.querySelector("#console-log"),
    answerTab: document.querySelector("#answer-tab"),
    consoleTab: document.querySelector("#console-tab"),
    answerPane: document.querySelector("#answer-pane"),
    consolePane: document.querySelector("#console-pane"),
    runStatus: document.querySelector("#run-status"),
    runButton: document.querySelector("#run-button"),
    exampleButton: document.querySelector("#example-button"),
    emptyExampleButton: document.querySelector("#empty-example-button"),
    clearButton: document.querySelector("#clear-button"),
    trashZone: document.querySelector("#trash-zone"),
    toast: document.querySelector("#toast"),
    textButton: document.querySelector("#text-button"),
    textModal: document.querySelector("#text-modal"),
    textInput: document.querySelector("#text-input"),
    textApply: document.querySelector("#text-apply"),
    textCopy: document.querySelector("#text-copy"),
    textErrors: document.querySelector("#text-errors")
  };

  let commands = [];
  let activeSlot = null;
  let dragState = null;
  let pointerDrag = null;
  let toastTimer = null;
  let suppressNextClick = false;
  let idSequence = 0;

  const CHAR_WIDTH = 6.6;
  const INPUT_PADDING = 12;

  function measureInputWidth(text, fallback = 14) {
    const safe = String(text ?? "");
    if (!safe) return fallback;
    const glyphs = Array.from(safe);
    let wideCount = 0;
    let narrowCount = 0;
    for (const glyph of glyphs) {
      if (/[　-鿿＀-￯ᄀ-ᇿ가-힯]/.test(glyph)) wideCount += 1;
      else if (glyph.length > 1 || /[A-Za-z0-9_$"'=+!@#%^&*()/\-]/.test(glyph)) narrowCount += 1;
      else narrowCount += 1;
    }
    return Math.max(fallback, Math.round(wideCount * 11 + narrowCount * CHAR_WIDTH + INPUT_PADDING));
  }

  function applyInputWidth(input) {
    const text = (input.value && input.value.length ? input.value : input.placeholder) || "";
    const width = measureInputWidth(text, 14);
    input.parentElement?.style.setProperty("--slot-input-width", `${width}px`);
    input.style.width = `${width}px`;
  }

  function findSlotElement(target) {
    if (target instanceof Element) return target.closest?.(".slot[data-parent-id]");
    if (target && target.parentElement) return target.parentElement.closest?.(".slot[data-parent-id]");
    return null;
  }

  function nextId() {
    idSequence += 1;
    return `block-${Date.now().toString(36)}-${idSequence}`;
  }

  function atom(value = "") {
    return { kind: "atom", value: String(value) };
  }

  function createNode(type) {
    const definition = definitions[type];
    const node = { id: nextId(), type, slots: {} };

    if (definition.parts.some((part) => part.kind === "scope")) {
      node.body = [];
    }

    for (const part of definition.parts) {
      if (part.kind === "slot") {
        node.slots[part.name] = part.accept === "value" ? atom() : null;
      }
      if (part.kind === "select") node[part.name] = part.options[0].value;
      if (part.kind === "name") node.name = "结果";
    }

    return node;
  }

  function isBlockNode(value) {
    return Boolean(value && value.id && definitions[value.type]);
  }

  function partForSlot(node, slotName) {
    return definitions[node.type]?.parts.find((part) => part.kind === "slot" && part.name === slotName);
  }

  function findNode(nodeId) {
    for (let index = 0; index < commands.length; index += 1) {
      const found = findNodeInside(commands[index], nodeId, null, null, index);
      if (found) return found;
    }
    return null;
  }

  function findNodeInside(node, nodeId, parent, slotName, rootIndex, scopeOwner, scopeIndex) {
    if (node.id === nodeId) return { node, parent, slotName, rootIndex, scopeOwner, scopeIndex };
    for (const [name, value] of Object.entries(node.slots || {})) {
      if (!isBlockNode(value)) continue;
      const found = findNodeInside(value, nodeId, node, name, rootIndex, scopeOwner, scopeIndex);
      if (found) return found;
    }
    if (Array.isArray(node.body)) {
      for (let i = 0; i < node.body.length; i += 1) {
        const found = findNodeInside(node.body[i], nodeId, null, null, rootIndex, node, i);
        if (found) return found;
      }
    }
    return null;
  }

  function nodeContains(node, nodeId) {
    if (node.id === nodeId) return true;
    if (Object.values(node.slots || {}).some((value) => isBlockNode(value) && nodeContains(value, nodeId))) {
      return true;
    }
    if (Array.isArray(node.body)) {
      return node.body.some((child) => nodeContains(child, nodeId));
    }
    return false;
  }

  function detachNode(nodeId) {
    const found = findNode(nodeId);
    if (!found) return null;

    if (!found.parent && !found.scopeOwner) {
      return commands.splice(found.rootIndex, 1)[0];
    }

    if (found.scopeOwner) {
      return found.scopeOwner.body.splice(found.scopeIndex, 1)[0];
    }

    const slotDefinition = partForSlot(found.parent, found.slotName);
    found.parent.slots[found.slotName] = slotDefinition.accept === "value" ? atom() : null;
    return found.node;
  }

  function slotTarget(parentId, name) {
    const found = findNode(parentId);
    if (!found) return null;
    const part = partForSlot(found.node, name);
    if (!part) return null;
    return { parent: found.node, part, current: found.node.slots[name] };
  }

  function makeLabel(text) {
    const label = document.createElement("span");
    label.className = "block-label";
    label.textContent = text;
    return label;
  }

  function makeSelect(node, part, preview) {
    const select = document.createElement("select");
    select.className = "block-select";
    select.dataset.nodeId = node.id;
    select.dataset.property = part.name;
    select.draggable = false;
    select.setAttribute("aria-label", "选择运算符");

    for (const optionDefinition of part.options) {
      const option = document.createElement("option");
      option.value = optionDefinition.value;
      option.textContent = optionDefinition.label;
      option.selected = node[part.name] === optionDefinition.value;
      select.append(option);
    }

    if (preview) {
      select.disabled = true;
      select.tabIndex = -1;
    }
    return select;
  }

  function makeNameInput(node, part, preview) {
    if (preview) {
      const previewName = document.createElement("span");
      previewName.className = "slot slot-name-preview";
      previewName.append(makeLabel("变量"));
      return previewName;
    }

    const input = document.createElement("input");
    input.className = "variable-name-input";
    input.value = node.name || "";
    input.placeholder = part.placeholder;
    input.dataset.nodeId = node.id;
    input.dataset.property = "name";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.draggable = false;
    input.setAttribute("aria-label", "变量名");
    return input;
  }

  function makeSlot(node, part, preview) {
    const slot = document.createElement("div");
    slot.className = "slot";
    slot.dataset.accept = part.accept;
    slot.dataset.parentId = node.id;
    slot.dataset.slotName = part.name;
    slot.dataset.slotId = `${node.id}::${part.name}`;

    if (!preview && activeSlot?.parentId === node.id && activeSlot?.name === part.name) {
      slot.classList.add("is-selected");
    }

    if (preview) {
      const placeholder = document.createElement("span");
      placeholder.className = "slot-placeholder";
      placeholder.textContent = part.placeholder;
      slot.append(placeholder);
      return slot;
    }

    const value = node.slots[part.name];
    if (isBlockNode(value)) {
      slot.append(renderBlock(value));
      return slot;
    }

    if (part.accept === "value") {
      const input = document.createElement("input");
      input.className = "slot-input size-fill";
      input.value = value?.value || "";
      input.placeholder = part.placeholder;
      input.dataset.parentId = node.id;
      input.dataset.slotName = part.name;
      input.autocomplete = "off";
      input.spellcheck = false;
      input.draggable = false;
      input.setAttribute("aria-label", `${part.placeholder}，可输入数字、任意文本（默认作为字符串）或 $变量名`);
      slot.append(input);
      const measured = measureInputWidth(input.value || input.placeholder, 14);
      slot.style.setProperty("--slot-input-width", `${measured}px`);
      input.style.width = `${measured}px`;
      return slot;
    }

    const placeholder = document.createElement("span");
    placeholder.className = "slot-placeholder";
    placeholder.textContent = part.placeholder;
    slot.append(placeholder);
    return slot;
  }

  function makeScopeBody(node, part, options) {
    const wrapper = document.createElement("div");
    wrapper.className = "scope-body";
    wrapper.dataset.scopeOwner = node.id;
    wrapper.dataset.scopeName = part.name;

    if (Array.isArray(node.body)) {
      node.body.forEach((child, index) => {
        const entry = document.createElement("div");
        entry.className = "command-entry scope-entry";
        entry.dataset.scopeOwner = node.id;
        entry.dataset.scopeIndex = String(index);

        const badge = document.createElement("span");
        badge.className = "command-index";
        badge.textContent = String(index + 1);
        entry.append(badge, renderBlock(child));
        wrapper.append(entry);
      });
    }

    if (!options.preview && (!Array.isArray(node.body) || node.body.length === 0)) {
      const placeholder = document.createElement("div");
      placeholder.className = "scope-placeholder";
      placeholder.textContent = "把指令积木拖到这里";
      wrapper.append(placeholder);
    }

    return wrapper;
  }

  function renderBlock(node, options = {}) {
    const definition = definitions[node.type];
    const hasScope = definition.parts.some((part) => part.kind === "scope");
    const block = document.createElement("div");
    block.className = `logic-block tone-${definition.category} shape-${definition.shape}${hasScope ? " has-scope" : ""}`;
    block.dataset.nodeId = node.id;
    block.dataset.blockType = node.type;
    block.dataset.shape = definition.shape;
    block.draggable = !options.preview;
    block.tabIndex = options.preview ? -1 : 0;
    block.setAttribute("role", "group");

    const headerParts = definition.parts.filter((part) => part.kind !== "scope");
    const scopeParts = definition.parts.filter((part) => part.kind === "scope");

    if (headerParts.length) {
      const header = document.createElement("div");
      header.className = "block-header";
      for (const part of headerParts) {
        if (part.kind === "text") header.append(makeLabel(part.text));
        if (part.kind === "slot") header.append(makeSlot(node, part, options.preview));
        if (part.kind === "select") header.append(makeSelect(node, part, options.preview));
        if (part.kind === "name") header.append(makeNameInput(node, part, options.preview));
      }
      block.append(header);
    }

    for (const part of scopeParts) {
      block.append(makeScopeBody(node, part, options));
    }

    if (!options.preview && node.type === "answer") {
      const counted = engine.charCount(node.slots?.predicate);
      block.title = counted.ok ? `字数：${counted.count}` : `字数：无法计算（${counted.error}）`;
    }

    return block;
  }

  function renderLibrary() {
    elements.library.replaceChildren();

    for (const category of categories) {
      const section = document.createElement("section");
      section.className = "block-category";
      section.style.setProperty("--category-color", category.color);

      const heading = document.createElement("h3");
      heading.className = "block-category-title";
      const dot = document.createElement("span");
      dot.className = "category-dot";
      heading.append(dot, category.label);

      const list = document.createElement("div");
      list.className = "template-list";

      for (const definition of Object.values(definitions).filter((item) => item.category === category.id)) {
        const card = document.createElement("div");
        card.className = "template-card";
        card.dataset.blockType = definition.type;
        card.dataset.shape = definition.shape;
        card.draggable = true;
        card.tabIndex = 0;
        card.setAttribute("role", "button");
        card.setAttribute("aria-label", `添加${category.label}：${definition.description}`);
        if (definition.description) card.title = definition.description;
        card.append(renderBlock(createNode(definition.type), { preview: true }));
        list.append(card);
      }

      section.append(heading, list);
      elements.library.append(section);
    }

    const libraryCount = document.querySelector(".library-heading .count-badge");
    if (libraryCount) libraryCount.textContent = `${Object.keys(definitions).length} 种`;
  }

  function renderWorkspace() {
    elements.commandStack.replaceChildren();

    commands.forEach((command, index) => {
      const entry = document.createElement("div");
      entry.className = "command-entry";
      entry.dataset.commandIndex = String(index);

      const indexBadge = document.createElement("span");
      indexBadge.className = "command-index";
      indexBadge.textContent = String(index + 1).padStart(2, "0");
      entry.append(indexBadge, renderBlock(command));
      elements.commandStack.append(entry);
    });

    elements.emptyWorkspace.hidden = commands.length > 0;
    elements.commandCount.textContent = `${commands.length} 条指令`;
  }

  function emptyVariables() {
    const empty = document.createElement("div");
    empty.className = "empty-small";
    const icon = document.createElement("span");
    icon.textContent = "$";
    const copy = document.createElement("p");
    copy.textContent = "运行赋值指令后，变量会显示在这里。";
    empty.append(icon, copy);
    elements.variableList.replaceChildren(empty);
    elements.variableCount.textContent = "0";
  }

  function emptyResults() {
    const answer = document.createElement("div");
    answer.className = "empty-small answer-empty";
    const answerIcon = document.createElement("span");
    answerIcon.textContent = "?";
    const answerCopy = document.createElement("p");
    answerCopy.textContent = "“回答”指令的推理结果会出现在这里。";
    answer.append(answerIcon, answerCopy);
    elements.answerList.replaceChildren(answer);

    const consoleEmpty = document.createElement("div");
    consoleEmpty.className = "empty-small console-empty";
    const consoleIcon = document.createElement("span");
    consoleIcon.textContent = ">_";
    const consoleCopy = document.createElement("p");
    consoleCopy.textContent = "运行后，指令执行轨迹、报错与诊断信息会出现在这里。";
    consoleEmpty.append(consoleIcon, consoleCopy);
    elements.consoleLog.replaceChildren(consoleEmpty);

    elements.resultCount.textContent = "0";
  }

  function setActiveTab(target) {
    const showAnswer = target !== "console";
    elements.answerTab.classList.toggle("is-active", showAnswer);
    elements.consoleTab.classList.toggle("is-active", !showAnswer);
    elements.answerTab.setAttribute("aria-selected", String(showAnswer));
    elements.consoleTab.setAttribute("aria-selected", String(!showAnswer));
    elements.answerPane.hidden = !showAnswer;
    elements.consolePane.hidden = showAnswer;
  }

  function renderVariables(environment) {
    elements.variableList.replaceChildren();
    elements.variableCount.textContent = String(environment.size);

    if (!environment.size) {
      emptyVariables();
      return;
    }

    for (const [name, result] of environment.entries()) {
      const row = document.createElement("div");
      row.className = "variable-row";

      const icon = document.createElement("span");
      icon.className = "variable-icon";
      icon.textContent = "$";

      const copy = document.createElement("div");
      copy.className = "variable-copy";
      const title = document.createElement("strong");
      title.textContent = name;
      const summary = document.createElement("small");
      summary.textContent = engine.summarizeValue(result);
      copy.append(title, summary);

      const type = document.createElement("span");
      type.className = "type-chip";
      type.textContent = result.ok ? engine.TYPE_LABELS[result.type] : "I";
      row.append(icon, copy, type);
      elements.variableList.append(row);
    }
  }

  function makeResultCard(code, title, detail) {
    const card = document.createElement("article");
    card.className = "result-card";
    card.dataset.logic = code;

    const head = document.createElement("div");
    head.className = "result-head";
    const codeBadge = document.createElement("span");
    codeBadge.className = "result-code";
    codeBadge.textContent = code;
    const heading = document.createElement("span");
    heading.className = "result-title";
    heading.textContent = title;
    head.append(codeBadge, heading);

    const body = document.createElement("p");
    body.className = "result-detail";
    body.textContent = detail || "判断完成";
    card.append(head, body);
    return card;
  }

  function makeConsoleEntry(level, title, detail) {
    const entry = document.createElement("article");
    entry.className = `console-entry console-${level}`;
    const head = document.createElement("div");
    head.className = "console-head";
    const tag = document.createElement("span");
    tag.className = "console-tag";
    tag.textContent = level === "error" ? "ERR" : level === "warn" ? "WRN" : "LOG";
    const heading = document.createElement("span");
    heading.className = "console-title";
    heading.textContent = title;
    head.append(tag, heading);
    entry.append(head);
    if (detail) {
      const body = document.createElement("p");
      body.className = "console-detail";
      body.textContent = detail;
      entry.append(body);
    }
    return entry;
  }

  function renderResults(execution) {
    const answerCards = [];
    const consoleEntries = [];

    for (const step of execution.steps) {
      const lineLabel = `第${step.line}行`;
      if (step.type === "answer") {
        const title = `${lineLabel} · 第${step.question}问 · ${step.result.label}`;
        answerCards.push(makeResultCard(
          step.result.code,
          title,
          step.result.detail
        ));
        consoleEntries.push(makeConsoleEntry(
          step.result.code === "I" ? "error" : "info",
          title,
          step.result.detail
        ));
      }
      if (step.type === "assign" && !step.result.ok) {
        consoleEntries.push(makeConsoleEntry(
          "error",
          `${lineLabel} · 赋值无法完成`,
          step.result.error
        ));
      }
      if (step.type === "repeat" && step.result?.code === "I") {
        consoleEntries.push(makeConsoleEntry(
          "error",
          `${lineLabel} · ${step.result.label}`,
          step.result.detail
        ));
      }
      if (step.type === "unknown") {
        consoleEntries.push(makeConsoleEntry(
          "error",
          `${lineLabel} · 指令无法执行`,
          step.result.error
        ));
      }
    }

    if (!consoleEntries.length) {
      consoleEntries.push(makeConsoleEntry("info", "就绪", "尚未运行逻辑，点击“运行逻辑”查看执行轨迹。"));
    }

    elements.answerList.replaceChildren(...(answerCards.length ? answerCards : [makeEmptyAnswer()]));
    elements.consoleLog.replaceChildren(...consoleEntries);
    elements.resultCount.textContent = String(answerCards.length);

    if (!answerCards.length) {
      const empty = elements.answerList.firstElementChild;
      empty?.classList.add("answer-empty");
    }
  }

  function makeEmptyAnswer() {
    const empty = document.createElement("div");
    empty.className = "empty-small answer-empty";
    const icon = document.createElement("span");
    icon.textContent = "?";
    const copy = document.createElement("p");
    copy.textContent = "“回答”指令的推理结果会出现在这里。";
    empty.append(icon, copy);
    return empty;
  }

  function setStatus(state, text) {
    elements.runStatus.dataset.state = state;
    const label = elements.runStatus.querySelector("span:last-child");
    label.textContent = text;
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 2200);
  }

  function programToText() {
    return commands.map((command) => engine.printCommand(command)).join("\n");
  }

  function renderTextErrors(message) {
    elements.textErrors.replaceChildren();
    if (!message) return;
    const error = document.createElement("div");
    error.className = "text-modal-error";
    error.textContent = message;
    elements.textErrors.append(error);
  }

  function openTextModal() {
    elements.textInput.value = programToText();
    renderTextErrors("");
    elements.textModal.hidden = false;
    window.setTimeout(() => {
      elements.textInput.focus();
      elements.textInput.setSelectionRange(0, 0);
      elements.textInput.scrollTop = 0;
    }, 0);
  }

  function closeTextModal() {
    elements.textModal.hidden = true;
  }

  function applyTextProgram() {
    const source = elements.textInput.value.trim();
    if (!source) {
      commands = [];
      activeSlot = null;
      renderWorkspace();
      clearExecution();
      closeTextModal();
      showToast("已清空工作区");
      return;
    }
    try {
      const program = engine.parse(source);
      commands = program;
      activeSlot = null;
      renderWorkspace();
      clearExecution();
      closeTextModal();
      showToast(`已导入 ${program.length} 条指令`);
    } catch (error) {
      renderTextErrors(`解析失败：${error.message}`);
    }
  }

  async function copyTextProgram() {
    const text = elements.textInput.value;
    if (!text) {
      showToast("暂无可复制的文字");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast("已复制到剪贴板");
    } catch {
      elements.textInput.focus();
      elements.textInput.select();
      try {
        document.execCommand("copy");
        showToast("已复制到剪贴板");
      } catch {
        showToast("复制失败，请手动选择文字");
      }
    }
  }

  function runWorkspace() {
    if (!commands.length) {
      showToast("请先添加一条指令");
      return;
    }

    setStatus("idle", "正在推理");
    const execution = engine.execute(commands);
    renderVariables(execution.environment);
    renderResults(execution);

    const hasError = execution.steps.some((step) =>
      step.result?.code === "I" || step.result?.ok === false
    );
    setStatus(hasError ? "error" : "success", hasError ? "运行完成 · 有无法回答的项" : "运行完成");
  }

  function clearExecution() {
    emptyVariables();
    emptyResults();
    setActiveTab("answer");
    setStatus("idle", "等待运行");
  }

  function findOpenSlot(shape) {
    for (const command of commands) {
      const target = findOpenSlotInside(command, shape);
      if (target) return target;
    }
    return null;
  }

  function findOpenSlotInside(node, shape) {
    const definition = definitions[node.type];
    for (const part of definition.parts.filter((item) => item.kind === "slot")) {
      const value = node.slots[part.name];
      const empty = part.accept === "predicate" ? !value : value?.kind === "atom" && !value.value.trim();
      if (part.accept === shape && empty) return { parentId: node.id, name: part.name };
      if (isBlockNode(value)) {
        const nested = findOpenSlotInside(value, shape);
        if (nested) return nested;
      }
    }
    if (Array.isArray(node.body)) {
      for (const child of node.body) {
        const nested = findOpenSlotInside(child, shape);
        if (nested) return nested;
      }
    }
    return null;
  }

  function scopeTarget(ownerId) {
    const found = findNode(ownerId);
    if (!found) return null;
    return { owner: found.node, definition: definitions[found.node.type] };
  }

  function insertIntoSlot(target, node) {
    const found = slotTarget(target.parentId, target.name);
    if (!found || found.part.accept !== definitions[node.type].shape) return false;
    if (isBlockNode(found.current) && found.current.id !== node.id) return false;
    found.parent.slots[target.name] = node;
    return true;
  }

  function quickAdd(type) {
    const definition = definitions[type];
    const node = createNode(type);

    if (definition.shape === "command") {
      commands.push(node);
      activeSlot = null;
      renderWorkspace();
      clearExecution();
      showToast("已添加到指令末尾");
      return;
    }

    let target = activeSlot;
    if (target) {
      const found = slotTarget(target.parentId, target.name);
      if (!found || found.part.accept !== definition.shape) target = null;
    }
    target ||= findOpenSlot(definition.shape);

    if (!target || !insertIntoSlot(target, node)) {
      showToast(definition.shape === "predicate" ? "请先添加并选择一个六边形孔" : "请先添加并选择一个圆角孔");
      return;
    }

    activeSlot = null;
    renderWorkspace();
    clearExecution();
  }

  function collectCompatibleTargets() {
    if (!dragState) return [];
    const out = [];
    const shape = dragState.shape;
    const slotSelector = `.slot[data-parent-id][data-accept="${shape}"]`;

    document.querySelectorAll(slotSelector).forEach((slot) => {
      if (dragState.source === "workspace" && dragState.rootSlotId && slot.dataset.slotId === dragState.rootSlotId) return;
      if (dragState.source === "workspace") {
        const dragged = findNode(dragState.nodeId)?.node;
        if (!dragged) return;
        const target = slotTarget(slot.dataset.parentId, slot.dataset.slotName);
        if (!target) return;
        if (nodeContains(dragged, target.parent.id)) return;
        if (isBlockNode(target.current) && target.current.id !== dragState.nodeId) return;
      } else {
        const target = slotTarget(slot.dataset.parentId, slot.dataset.slotName);
        if (!target) return;
        if (isBlockNode(target.current)) return;
      }
      const rect = slot.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      out.push({ element: slot, rect, kind: "slot", parentId: slot.dataset.parentId, name: slot.dataset.slotName });
    });

    if (shape === "command") {
      document.querySelectorAll(".scope-body[data-scope-owner]").forEach((scope) => {
        if (dragState.source === "workspace") {
          const dragged = findNode(dragState.nodeId)?.node;
          if (!dragged) return;
          if (nodeContains(dragged, scope.dataset.scopeOwner)) return;
        }
        const rect = scope.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        out.push({ element: scope, rect, kind: "scope", ownerId: scope.dataset.scopeOwner });
      });
    }

    return out;
  }

  function pickNestedTarget(point) {
    if (!dragState) return null;
    const matches = collectCompatibleTargets().filter((entry) => {
      const { rect } = entry;
      return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
    });
    if (!matches.length) return null;
    matches.sort((a, b) => {
      const areaA = a.rect.width * a.rect.height;
      const areaB = b.rect.width * b.rect.height;
      if (areaA !== areaB) return areaA - areaB;
      if (a.rect.width !== b.rect.width) return a.rect.width - b.rect.width;
      return a.rect.top - b.rect.top;
    });
    return matches[0];
  }

  function validateDropTarget(element, point) {
    if (!dragState) return null;

    const trash = element?.closest?.("#trash-zone");
    if (trash && dragState.source === "workspace") return { kind: "trash" };

    const hit = pickNestedTarget(point);
    if (hit) {
      if (hit.kind === "slot") {
        const target = slotTarget(hit.parentId, hit.name);
        if (!target) return null;
        if (dragState.source === "workspace" && dragState.rootSlotId === `${target.parent.id}::${target.part.name}`) return null;
        return { kind: "slot", parentId: target.parent.id, name: target.part.name };
      }
      if (hit.kind === "scope") {
        if (dragState.source === "workspace") {
          const dragged = findNode(dragState.nodeId)?.node;
          if (!dragged) return null;
          if (nodeContains(dragged, hit.ownerId)) return null;
        }
        return { kind: "scope", ownerId: hit.ownerId };
      }
    }

    if (dragState.shape !== "command") return null;
    const workspace = element?.closest?.("#workspace");
    if (!workspace) return null;
    if (dragState.source === "workspace") {
      const dragged = findNode(dragState.nodeId)?.node;
      if (!dragged) return null;
      const preview = simulateWorkspaceDrop(dragged);
      if (preview === "empty") return null;
    }
    return { kind: "workspace" };
  }

  function clearDropFeedback() {
    document.querySelectorAll(".is-compatible, .is-incompatible, .is-drop-target, .is-pending-empty").forEach((element) => {
      element.classList.remove("is-compatible", "is-incompatible", "is-drop-target", "is-pending-empty");
    });
  }

  function dragOriginSlot() {
    if (dragState?.source !== "workspace" || !dragState.nodeId) return null;
    const found = findNode(dragState.nodeId);
    if (!found || !found.parent) return null;
    return `${found.parent.id}::${found.slotName}`;
  }

  function simulateWorkspaceDrop(node) {
    const index = commands.indexOf(node);
    if (index < 0) return "ok";
    if (commands.length === 1) return "empty";
    return "ok";
  }

  function updateDropFeedback(element, point) {
    clearDropFeedback();
    if (!dragState) return null;

    document.querySelectorAll(".slot[data-accept]").forEach((slot) => {
      slot.classList.toggle("is-incompatible", slot.dataset.accept !== dragState.shape);
    });

    const target = validateDropTarget(element, point);
    if (target?.kind === "slot") {
      document.querySelector(`.slot[data-parent-id="${CSS.escape(target.parentId)}"][data-slot-name="${CSS.escape(target.name)}"]`)?.classList.add("is-compatible");
    } else if (target?.kind === "scope") {
      document.querySelector(`.scope-body[data-scope-owner="${CSS.escape(target.ownerId)}"]`)?.classList.add("is-drop-target");
    } else if (target?.kind === "workspace") {
      elements.workspace.parentElement?.classList.add("is-drop-target");
    } else if (target?.kind === "trash") {
      elements.trashZone.classList.add("is-drop-target");
    } else if (dragState.source === "workspace" && dragState.shape === "command") {
      const dragged = findNode(dragState.nodeId)?.node;
      if (dragged && simulateWorkspaceDrop(dragged) === "empty") {
        elements.commandStack.classList.add("is-pending-empty");
      }
    }
    return target;
  }

  function cleanupDrag() {
    clearDropFeedback();
    document.body.classList.remove("is-dragging");
    document.querySelectorAll(".is-drag-source").forEach((element) => element.classList.remove("is-drag-source"));
    document.querySelectorAll(".drag-ghost").forEach((element) => element.remove());
    dragState = null;
  }

  function performDrop(target) {
    if (!target || !dragState) return false;

    if (target.kind === "trash") {
      if (dragState.source !== "workspace") return false;
      detachNode(dragState.nodeId);
      activeSlot = null;
      renderWorkspace();
      clearExecution();
      showToast("积木已删除");
      return true;
    }

    let node;
    if (dragState.source === "template") {
      node = createNode(dragState.type);
    } else {
      const found = findNode(dragState.nodeId);
      if (!found) return false;
      if (target.kind === "slot" && found.parent?.id === target.parentId && found.slotName === target.name) {
        return true;
      }
      node = detachNode(dragState.nodeId);
    }

    if (!node) return false;

    if (target.kind === "workspace") {
      commands.push(node);
    } else if (target.kind === "scope") {
      const owner = scopeTarget(target.ownerId)?.owner;
      if (!owner) return false;
      owner.body ||= [];
      owner.body.push(node);
    } else if (!insertIntoSlot(target, node)) {
      if (definitions[node.type].shape === "command") commands.push(node);
      else showToast("目标孔位已被占用");
      renderWorkspace();
      return false;
    }

    activeSlot = null;
    renderWorkspace();
    clearExecution();
    return true;
  }

  function dragDescriptor(target) {
    const template = target.closest(".template-card");
    if (template) {
      const definition = definitions[template.dataset.blockType];
      return {
        source: "template",
        type: definition.type,
        shape: definition.shape,
        visual: template.querySelector(".logic-block")
      };
    }

    const block = target.closest("#workspace .logic-block");
    if (block) {
      const found = findNode(block.dataset.nodeId);
      const origin = found?.parent ? `${found.parent.id}::${found.slotName}` : null;
      return {
        source: "workspace",
        type: block.dataset.blockType,
        shape: block.dataset.shape,
        nodeId: block.dataset.nodeId,
        originSlot: origin,
        visual: block
      };
    }
    return null;
  }

  function loadExample() {
    const chance = createNode("random");
    chance.slots.from = atom("0");
    chance.slots.to = atom("9");

    const assignChance = createNode("assign");
    assignChance.name = "点数";
    assignChance.slots.value = chance;

    const membership = createNode("contains");
    membership.slots.left = atom("$点数");
    membership.slots.right = atom("2");
    const answerMembership = createNode("answer");
    answerMembership.slots.predicate = membership;

    const doubled = createNode("arithmetic");
    doubled.operator = "mul";
    doubled.slots.left = atom("$点数");
    doubled.slots.right = atom("2");
    const assignDoubled = createNode("assign");
    assignDoubled.name = "加倍";
    assignDoubled.slots.value = doubled;

    const comparison = createNode("compare");
    comparison.operator = "gt";
    comparison.slots.left = atom("$加倍");
    comparison.slots.right = atom("10");
    const comparisonAnswer = createNode("answerValue");
    comparisonAnswer.slots.predicate = comparison;
    const assignConclusion = createNode("assign");
    assignConclusion.name = "结论";
    assignConclusion.slots.value = comparisonAnswer;

    const belowZero = createNode("compare");
    belowZero.operator = "lt";
    belowZero.slots.left = atom("$点数");
    belowZero.slots.right = atom("0");
    const negation = createNode("not");
    negation.slots.predicate = belowZero;
    const answerNegation = createNode("answer");
    answerNegation.slots.predicate = negation;

    const assignText = createNode("assign");
    assignText.name = "问候";
    assignText.slots.value = atom('"逻辑工坊"');
    const textContains = createNode("contains");
    textContains.slots.left = atom("$问候");
    textContains.slots.right = atom('"工坊"');
    const answerText = createNode("answer");
    answerText.slots.predicate = textContains;

    const loop = createNode("repeat");
    loop.slots.count = atom("2");
    const loopCompare = createNode("compare");
    loopCompare.operator = "lt";
    loopCompare.slots.left = atom("$点数");
    loopCompare.slots.right = atom("8");
    const loopAnswer = createNode("answer");
    loopAnswer.slots.predicate = loopCompare;
    const loopAnswerSix = createNode("answer");
    const loopContains = createNode("contains");
    loopContains.slots.left = atom("$点数");
    loopContains.slots.right = atom("6");
    loopAnswerSix.slots.predicate = loopContains;
    loop.body = [loopAnswer, loopAnswerSix];

    commands = [assignChance, answerMembership, assignDoubled, assignConclusion, answerNegation, assignText, answerText, loop];
    activeSlot = null;
    renderWorkspace();
    clearExecution();
    showToast("示例已载入，点击“运行逻辑”查看结果");
  }

  elements.library.addEventListener("click", (event) => {
    const template = event.target.closest(".template-card");
    if (!template || suppressNextClick) return;
    quickAdd(template.dataset.blockType);
  });

  elements.library.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const template = event.target.closest(".template-card");
    if (!template) return;
    event.preventDefault();
    quickAdd(template.dataset.blockType);
  });

  elements.commandStack.addEventListener("input", (event) => {
    const input = event.target;
    if (input.matches(".slot-input")) {
      const found = slotTarget(input.dataset.parentId, input.dataset.slotName);
      if (found) found.parent.slots[input.dataset.slotName] = atom(input.value);
      applyInputWidth(input);
    }
    if (input.matches(".variable-name-input")) {
      const found = findNode(input.dataset.nodeId);
      if (found) found.node.name = input.value;
    }
    clearExecution();
  });

  elements.commandStack.addEventListener("change", (event) => {
    const select = event.target.closest(".block-select");
    if (!select) return;
    const found = findNode(select.dataset.nodeId);
    if (found) found.node[select.dataset.property] = select.value;
    clearExecution();
  });

  elements.commandStack.addEventListener("click", (event) => {
    const slot = event.target.closest(".slot[data-parent-id]");
    if (!slot) return;
    activeSlot = { parentId: slot.dataset.parentId, name: slot.dataset.slotName };
    document.querySelectorAll(".slot.is-selected").forEach((item) => item.classList.remove("is-selected"));
    slot.classList.add("is-selected");
  });

  elements.commandStack.addEventListener("dblclick", (event) => {
    if (event.target.closest("input, select")) return;
    const block = event.target.closest(".logic-block");
    if (!block) return;
    event.preventDefault();
    detachNode(block.dataset.nodeId);
    activeSlot = null;
    renderWorkspace();
    clearExecution();
    showToast("积木已删除");
  });

  document.addEventListener("dragstart", (event) => {
    if (event.target.closest("input, select")) {
      event.preventDefault();
      return;
    }
    const descriptor = dragDescriptor(event.target);
    if (!descriptor) return;
    dragState = { ...descriptor, rootSlotId: descriptor.originSlot };
    event.dataTransfer.effectAllowed = descriptor.source === "template" ? "copy" : "move";
    event.dataTransfer.setData("text/plain", descriptor.type);
    document.body.classList.add("is-dragging");
    window.setTimeout(() => descriptor.visual?.classList.add("is-drag-source"), 0);
  });

  document.addEventListener("dragover", (event) => {
    if (!dragState) return;
    const point = { x: event.clientX, y: event.clientY };
    const target = updateDropFeedback(event.target, point);
    if (!target) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = dragState.source === "template" ? "copy" : "move";
  });

  document.addEventListener("drop", (event) => {
    if (!dragState) return;
    const point = { x: event.clientX, y: event.clientY };
    const target = validateDropTarget(event.target, point);
    if (target) {
      event.preventDefault();
      performDrop(target);
    }
    cleanupDrag();
  });

  document.addEventListener("dragend", cleanupDrag);

  document.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" || event.button !== 0 || event.target.closest("input, select, button")) return;
    const descriptor = dragDescriptor(event.target);
    if (!descriptor) return;
    pointerDrag = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      descriptor,
      started: false,
      ghost: null
    };
  });

  document.addEventListener("pointermove", (event) => {
    if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - pointerDrag.originX, event.clientY - pointerDrag.originY);
    if (!pointerDrag.started && distance < 7) return;

    if (!pointerDrag.started) {
      pointerDrag.started = true;
      dragState = { ...pointerDrag.descriptor, rootSlotId: pointerDrag.descriptor.originSlot };
      pointerDrag.ghost = pointerDrag.descriptor.visual.cloneNode(true);
      pointerDrag.ghost.removeAttribute("tabindex");
      pointerDrag.ghost.classList.add("drag-ghost");
      document.body.append(pointerDrag.ghost);
      pointerDrag.descriptor.visual.classList.add("is-drag-source");
      document.body.classList.add("is-dragging");
    }

    event.preventDefault();
    pointerDrag.ghost.style.left = `${event.clientX + 13}px`;
    pointerDrag.ghost.style.top = `${event.clientY + 13}px`;
    updateDropFeedback(document.elementFromPoint(event.clientX, event.clientY), { x: event.clientX, y: event.clientY });
  }, { passive: false });

  function finishPointerDrag(event) {
    if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
    if (pointerDrag.started) {
      const element = document.elementFromPoint(event.clientX, event.clientY);
      const target = validateDropTarget(element, { x: event.clientX, y: event.clientY });
      performDrop(target);
      suppressNextClick = true;
      window.setTimeout(() => { suppressNextClick = false; }, 250);
      cleanupDrag();
    }
    pointerDrag = null;
  }

  document.addEventListener("pointerup", finishPointerDrag);
  document.addEventListener("pointercancel", finishPointerDrag);

  elements.answerTab.addEventListener("click", () => setActiveTab("answer"));
  elements.consoleTab.addEventListener("click", () => setActiveTab("console"));

  elements.runButton.addEventListener("click", runWorkspace);
  elements.exampleButton.addEventListener("click", loadExample);
  elements.emptyExampleButton.addEventListener("click", loadExample);
  elements.textButton.addEventListener("click", openTextModal);
  elements.textApply.addEventListener("click", applyTextProgram);
  elements.textCopy.addEventListener("click", copyTextProgram);
  elements.textModal.addEventListener("click", (event) => {
    if (event.target.closest("[data-close]")) closeTextModal();
  });
  elements.textInput.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      applyTextProgram();
    }
  });
  elements.clearButton.addEventListener("click", () => {
    if (!commands.length) {
      showToast("工作区已经是空的");
      return;
    }
    commands = [];
    activeSlot = null;
    renderWorkspace();
    clearExecution();
    showToast("工作区已清空");
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!elements.textModal.hidden) {
        closeTextModal();
        return;
      }
      activeSlot = null;
      document.querySelectorAll(".slot.is-selected").forEach((slot) => slot.classList.remove("is-selected"));
      cleanupDrag();
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && elements.textModal.hidden) {
      runWorkspace();
    }
  });

  renderLibrary();
  renderWorkspace();
  emptyVariables();
  emptyResults();
})();
