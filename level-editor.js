(function () {
  "use strict";

  const engine = window.LogicEngine;
  const LABELS = engine.LOGIC_LABELS;

  const STORAGE_KEYS = {
    levels: "guess-conditions:levels",
    manual: "guess-conditions:manual"
  };

  const CONDITION_OPTIONS = [
    { value: "truth", label: "按事实回答（入门）" },
    { value: "alwaysLie", label: "一律说谎" },
    { value: "lieIfLong", label: "按字数说谎（≥10 反转）" },
    { value: "lieIfOddLine", label: "按行号说谎（奇数行反转）" },
    { value: "isAnswerIs", label: "有「是」则回答是" }
  ];

  const ANSWER_CODES = ["T", "F", "U", "I"];

  let data = { levels: [] };
  let manualText = "";
  let currentLevelId = null;
  let saveTimer = null;

  const elements = {
    levelList: document.querySelector("#level-list"),
    levelDetail: document.querySelector("#level-detail"),
    addLevelButton: document.querySelector("#add-level-button"),
    manualTextarea: document.querySelector("#manual-textarea"),
    importButton: document.querySelector("#import-button"),
    importFile: document.querySelector("#import-file"),
    exportButton: document.querySelector("#export-button"),
    resetButton: document.querySelector("#reset-button"),
    backButton: document.querySelector("#back-button"),
    tabs: document.querySelectorAll(".editor-tab"),
    panes: document.querySelectorAll(".editor-pane"),
    status: document.querySelector("#editor-status")
  };

  async function loadDefaults() {
    if (window.GUESS_DATA && window.GUESS_DATA.levels && window.GUESS_DATA.levels.levels.length) {
      data = window.GUESS_DATA.levels;
      if (typeof window.GUESS_DATA.manual === "string") {
        manualText = window.GUESS_DATA.manual;
      }
    }
    try {
      const [levelsRes, manualRes] = await Promise.all([
        fetch("data/levels.json"),
        fetch("data/manual.txt")
      ]);
      if (levelsRes.ok) {
        const parsed = await levelsRes.json();
        if (parsed && Array.isArray(parsed.levels) && parsed.levels.length) {
          data = parsed;
        }
      }
      if (manualRes.ok) {
        const text = await manualRes.text();
        if (text) manualText = text;
      }
    } catch (error) {
      console.warn("载入 data/ 默认文件失败，使用内嵌默认数据", error);
    }
  }

  function loadStored() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.levels);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.levels) && parsed.levels.length) {
          data = parsed;
        }
      }
    } catch {}
    const storedManual = localStorage.getItem(STORAGE_KEYS.manual);
    if (storedManual !== null) manualText = storedManual;
  }

  function markDirty() {
    if (elements.status) {
      elements.status.textContent = "修改未保存…";
      elements.status.dataset.state = "dirty";
    }
    saveAll();
  }

  function saveAll(immediate = false) {
    clearTimeout(saveTimer);
    if (immediate) {
      commitSave();
    } else {
      saveTimer = setTimeout(commitSave, 220);
    }
  }

  function commitSave() {
    try {
      localStorage.setItem(STORAGE_KEYS.levels, JSON.stringify(data));
      localStorage.setItem(STORAGE_KEYS.manual, manualText);
    } catch (error) {
      console.error("保存失败", error);
      return;
    }
    if (elements.status) {
      elements.status.textContent = "已同步到本地 · " + new Date().toLocaleTimeString();
      elements.status.dataset.state = "saved";
    }
  }

  function makeId() {
    return "level-" + Math.random().toString(36).slice(2, 8);
  }

  function getCurrentLevel() {
    return data.levels.find((entry) => entry.id === currentLevelId) || null;
  }

  function renderLevelList() {
    elements.levelList.replaceChildren();
    data.levels.forEach((level, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "level-list-item";
      if (level.id === currentLevelId) item.classList.add("is-active");
      const title = document.createElement("span");
      title.textContent = `${index + 1}. ${level.title || "(未命名)"}`;
      item.append(title);
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = level.condition || "truth";
      item.append(badge);
      item.addEventListener("click", () => selectLevel(level.id));
      elements.levelList.append(item);
    });
  }

  function selectLevel(id) {
    currentLevelId = id;
    renderLevelList();
    renderLevelDetail();
  }

  function addLevel() {
    const newLevel = {
      id: makeId(),
      title: "新关卡",
      subtitle: "",
      hint: "",
      condition: "truth",
      demoProgram: ["[回答 <比较 (3) 大于 (2) 吗?>]"],
      tests: []
    };
    data.levels.push(newLevel);
    selectLevel(newLevel.id);
    markDirty();
  }

  function deleteCurrentLevel() {
    if (!currentLevelId) return;
    if (!confirm("确定要删除这个关卡吗？此操作不可撤销。")) return;
    const index = data.levels.findIndex((entry) => entry.id === currentLevelId);
    if (index < 0) return;
    data.levels.splice(index, 1);
    const fallback = data.levels[Math.max(0, index - 1)];
    currentLevelId = fallback ? fallback.id : data.levels[0]?.id || null;
    renderLevelList();
    renderLevelDetail();
    markDirty();
  }

  function moveLevel(id, direction) {
    const index = data.levels.findIndex((entry) => entry.id === id);
    const newIndex = index + direction;
    if (index < 0 || newIndex < 0 || newIndex >= data.levels.length) return;
    const [level] = data.levels.splice(index, 1);
    data.levels.splice(newIndex, 0, level);
    renderLevelList();
    renderLevelDetail();
    markDirty();
  }

  function buildField(label, control) {
    const row = document.createElement("div");
    row.className = "form-row";
    const lab = document.createElement("label");
    lab.textContent = label;
    row.append(lab, control);
    return row;
  }

  function makeInput(value, onInput) {
    const input = document.createElement("input");
    input.value = value || "";
    input.addEventListener("input", onInput);
    return input;
  }

  function makeTextarea(value, rows, onInput) {
    const ta = document.createElement("textarea");
    ta.rows = rows;
    ta.value = value || "";
    ta.addEventListener("input", onInput);
    return ta;
  }

  function makeSelect(value, options, onChange) {
    const select = document.createElement("select");
    options.forEach((option) => {
      const opt = document.createElement("option");
      opt.value = option.value;
      opt.textContent = option.label;
      if (option.value === value) opt.selected = true;
      select.append(opt);
    });
    select.addEventListener("change", () => onChange(select.value));
    return select;
  }

  function makeExpectedItem(level, test, index) {
    const item = document.createElement("span");
    item.className = "expected-item";
    const label = document.createElement("span");
    label.textContent = `第 ${index + 1} 问`;
    item.append(label);
    const select = document.createElement("select");
    ANSWER_CODES.forEach((code) => {
      const opt = document.createElement("option");
      opt.value = code;
      opt.textContent = `${code}（${LABELS[code]}）`;
      if (test.expectedOutputs[index] === code) opt.selected = true;
      select.append(opt);
    });
    select.addEventListener("change", () => {
      test.expectedOutputs[index] = select.value;
      markDirty();
    });
    item.append(select);
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "×";
    removeBtn.title = "移除";
    removeBtn.addEventListener("click", () => {
      test.expectedOutputs.splice(index, 1);
      renderLevelDetail();
      markDirty();
    });
    item.append(removeBtn);
    return item;
  }

  function makeTestEditor(level, test, index) {
    const wrap = document.createElement("div");
    wrap.className = "test-editor";

    const head = document.createElement("div");
    head.className = "test-editor-head";
    const title = document.createElement("span");
    title.className = "test-editor-title";
    title.textContent = `预测题 ${index + 1}`;
    head.append(title);
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "remove-test";
    removeBtn.textContent = "删除";
    removeBtn.addEventListener("click", () => {
      if (!confirm("确定要删除这个预测题吗？")) return;
      level.tests = level.tests.filter((entry) => entry !== test);
      renderLevelDetail();
      markDirty();
    });
    head.append(removeBtn);
    wrap.append(head);

    const programInput = makeTextarea(test.program || "", 3, () => {
      test.program = programInput.value;
      markDirty();
    });
    wrap.append(buildField("测试程序", programInput));

    test.expectedOutputs = test.expectedOutputs || [];
    const expectedRow = document.createElement("div");
    expectedRow.className = "form-row";
    const expectedLabel = document.createElement("label");
    expectedLabel.textContent = "预期输出（按回答顺序）";
    expectedRow.append(expectedLabel);
    const expectedList = document.createElement("div");
    expectedList.className = "expected-list";
    test.expectedOutputs.forEach((_, eIdx) => {
      expectedList.append(makeExpectedItem(level, test, eIdx));
    });
    const addExpectedBtn = document.createElement("button");
    addExpectedBtn.type = "button";
    addExpectedBtn.className = "add-expected";
    addExpectedBtn.textContent = "+ 添加预期输出";
    addExpectedBtn.addEventListener("click", () => {
      test.expectedOutputs.push("T");
      renderLevelDetail();
      markDirty();
    });
    expectedList.append(addExpectedBtn);
    expectedRow.append(expectedList);
    wrap.append(expectedRow);

    return wrap;
  }

  function renderLevelDetail() {
    const level = getCurrentLevel();
    elements.levelDetail.replaceChildren();
    if (!level) {
      const empty = document.createElement("div");
      empty.className = "editor-empty";
      empty.textContent = "请选择左侧的关卡进行编辑。";
      elements.levelDetail.append(empty);
      return;
    }

    const form = document.createElement("form");
    form.className = "level-form";
    form.addEventListener("submit", (event) => event.preventDefault());

    form.append(buildField("标题", makeInput(level.title, () => {
      level.title = form.querySelector("input").value;
      renderLevelList();
      markDirty();
    })));

    form.append(buildField("副标题", makeInput(level.subtitle, () => {
      level.subtitle = form.querySelectorAll("input")[1].value;
      markDirty();
    })));

    form.append(buildField("关卡提示", makeTextarea(level.hint, 2, () => {
      level.hint = form.querySelectorAll("textarea")[0].value;
      markDirty();
    })));

    form.append(buildField("隐藏条件", makeSelect(
      level.condition || "truth",
      CONDITION_OPTIONS,
      (value) => {
        level.condition = value;
        renderLevelList();
        markDirty();
      }
    )));

    form.append(buildField("示例程序（每行一条 [回答 ...] 指令）", makeTextarea(
      (level.demoProgram || []).join("\n"),
      6,
      () => {
        const textareas = form.querySelectorAll("textarea");
        level.demoProgram = textareas[1].value.split(/\r?\n/).filter((line) => line.trim().length);
        markDirty();
      }
    )));

    const testsHead = document.createElement("div");
    testsHead.className = "section-heading";
    const testsTitle = document.createElement("h3");
    testsTitle.textContent = "预测题";
    testsHead.append(testsTitle);
    const addTestBtn = document.createElement("button");
    addTestBtn.type = "button";
    addTestBtn.className = "add-test";
    addTestBtn.textContent = "+ 新增预测题";
    addTestBtn.addEventListener("click", () => {
      level.tests = level.tests || [];
      level.tests.push({
        id: "test-" + Math.random().toString(36).slice(2, 6),
        program: "[回答 <比较 (3) 大于 (2) 吗?>]",
        expectedOutputs: ["T"]
      });
      renderLevelDetail();
      markDirty();
    });
    testsHead.append(addTestBtn);
    form.append(testsHead);

    const testsList = document.createElement("div");
    testsList.className = "tests-editor";
    (level.tests || []).forEach((test, index) => {
      testsList.append(makeTestEditor(level, test, index));
    });
    form.append(testsList);

    const actions = document.createElement("div");
    actions.className = "form-actions";

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "button button-ghost danger";
    deleteBtn.textContent = "删除关卡";
    deleteBtn.addEventListener("click", deleteCurrentLevel);
    actions.append(deleteBtn);

    const right = document.createElement("div");
    right.className = "right";
    const index = data.levels.findIndex((entry) => entry.id === level.id);
    const moveUp = document.createElement("button");
    moveUp.type = "button";
    moveUp.className = "button button-ghost";
    moveUp.textContent = "↑ 上移";
    moveUp.disabled = index === 0;
    moveUp.addEventListener("click", () => moveLevel(level.id, -1));
    right.append(moveUp);

    const moveDown = document.createElement("button");
    moveDown.type = "button";
    moveDown.className = "button button-ghost";
    moveDown.textContent = "↓ 下移";
    moveDown.disabled = index === data.levels.length - 1;
    moveDown.addEventListener("click", () => moveLevel(level.id, 1));
    right.append(moveDown);

    actions.append(right);
    form.append(actions);

    elements.levelDetail.append(form);
  }

  function renderManual() {
    elements.manualTextarea.value = manualText;
  }

  function exportJSON() {
    const payload = {
      version: 1,
      levels: data.levels,
      manual: manualText
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "guess-conditions-export.json";
    document.body.append(a);
    a.click();
    document.body.remove(a);
    URL.revokeObjectURL(url);
  }

  function importJSON(file) {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        if (parsed && Array.isArray(parsed.levels)) data.levels = parsed.levels;
        if (typeof parsed.manual === "string") manualText = parsed.manual;
        saveAll(true);
        currentLevelId = data.levels[0]?.id || null;
        renderLevelList();
        renderLevelDetail();
        renderManual();
        alert("导入成功。");
      } catch (error) {
        alert("导入失败：" + error.message);
      }
    };
    reader.readAsText(file);
  }

  async function resetToDefaults() {
    if (!confirm("确定要恢复默认数据吗？本地修改将丢失。")) return;
    localStorage.removeItem(STORAGE_KEYS.levels);
    localStorage.removeItem(STORAGE_KEYS.manual);
    data = { levels: [] };
    manualText = "";
    await loadDefaults();
    currentLevelId = data.levels[0]?.id || null;
    renderLevelList();
    renderLevelDetail();
    renderManual();
    saveAll(true);
  }

  elements.addLevelButton.addEventListener("click", addLevel);
  elements.importButton.addEventListener("click", () => elements.importFile.click());
  elements.importFile.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (file) importJSON(file);
    event.target.value = "";
  });
  elements.exportButton.addEventListener("click", exportJSON);
  elements.resetButton.addEventListener("click", resetToDefaults);
  elements.backButton.addEventListener("click", () => {
    window.location.href = "index.html";
  });
  elements.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.tab;
      elements.tabs.forEach((other) => other.classList.toggle("is-active", other === tab));
      elements.panes.forEach((pane) => {
        pane.hidden = pane.dataset.pane !== target;
      });
    });
  });
  elements.manualTextarea.addEventListener("input", () => {
    manualText = elements.manualTextarea.value;
    markDirty();
  });

  (async function bootstrap() {
    await loadDefaults();
    loadStored();
    currentLevelId = data.levels[0]?.id || null;
    renderLevelList();
    renderLevelDetail();
    renderManual();
    if (elements.status) {
      elements.status.textContent = "已同步到本地";
      elements.status.dataset.state = "saved";
    }
  })();
})();
