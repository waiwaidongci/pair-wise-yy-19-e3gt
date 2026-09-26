"use strict";

/*
 * 页面操作层
 * 原有：样本录入、矿物/偏光筛选、并排对比、导出观察清单
 * 新增：逐颗粒度登记、满 20 颗出统计与四级柱状图、旧统计失效留档、对比准入控制
 */
const state = Store.load();

const form = document.querySelector("#sampleForm");
const photoInput = document.querySelector("#photoInput");
const sampleGrid = document.querySelector("#sampleGrid");
const comparePane = document.querySelector("#comparePane");
const mineralFilter = document.querySelector("#mineralFilter");
const polarFilter = document.querySelector("#polarFilter");

const grainDialog = document.querySelector("#grainDialog");
const sampleDialog = document.querySelector("#sampleDialog");
const grainForm = document.querySelector("#grainForm");
const grainDialogSub = document.querySelector("#grainDialogSub");
const grainDupLive = document.querySelector("#grainDupLive");
const grainConfirmLine = grainForm.querySelector(".confirm-line");
const grainFormMsg = document.querySelector("#grainFormMsg");
const statsBadge = document.querySelector("#statsBadge");
const statsPanel = document.querySelector("#statsPanel");
const grainTableBody = document.querySelector("#grainTableBody");
const statsHistory = document.querySelector("#statsHistory");
const sampleEditForm = document.querySelector("#sampleEditForm");
const sampleEditMsg = document.querySelector("#sampleEditMsg");

let pendingPhoto = "";
let openSampleId = null;
let grainNotice = ""; // 弹窗重渲染后保留的操作提示

// 圆度下拉选项由规则层提供
grainForm.roundness.append(
  ...GrainRules.ROUNDNESS_LEVELS.map((name) => new Option(name, name))
);

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[ch]));
}

function readFileAsDataUrl(file) {
  return new Promise((resolve) => {
    if (!file) return resolve("");
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.readAsDataURL(file);
  });
}

function findSample(id) {
  return state.samples.find((sample) => sample.id === id) || null;
}

function formatDiameter(value) {
  return value === null || value === undefined ? "—" : Number(value).toFixed(3);
}

function formatPercent(value) {
  return `${value.toFixed(1)}%`;
}

function formatTime(iso) {
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}

/* ---------------- 筛选 ---------------- */

function filteredSamples() {
  const mineral = mineralFilter.value.trim();
  const polarization = polarFilter.value;
  return state.samples.filter((sample) => {
    const mineralMatch = !mineral || sample.minerals.includes(mineral);
    const polarMatch = !polarization || sample.polarization === polarization;
    return mineralMatch && polarMatch;
  });
}

/* ---------------- 粒度统计视图 ---------------- */

function gradeBar(percent) {
  return `
    <div class="grade-bar">
      <div class="grade-bar-fill" style="height:${percent}%"></div>
    </div>`;
}

function gradeChart(stats, { compact = false } = {}) {
  return `
    <div class="grade-chart ${compact ? "compact" : ""}">
      ${stats.grades.map((grade) => `
        <div class="grade-col">
          <span class="grade-pct">${formatPercent(grade.percent)}</span>
          ${gradeBar(grade.percent)}
          <span class="grade-name">${grade.name}</span>
          ${compact ? "" : `<span class="grade-bound">${grade.bounds}</span>`}
        </div>
      `).join("")}
    </div>`;
}

function statsSummaryBlock(sample, stats) {
  if (stats.status !== "ready") {
    return `
      <p class="pill pill-pending">待补测</p>
      <p class="warn-text">${escapeHtml(stats.reason)}</p>`;
  }
  return `
    <div class="stats-numbers">
      <div><span>平均粒径</span><strong>${formatDiameter(stats.mean)} mm</strong></div>
      <div><span>分选系数 S₀</span><strong>${stats.sorting.toFixed(3)}</strong>
        <em>${escapeHtml(GrainRules.describeSorting(stats.sorting))}</em></div>
      <div><span>颗粒数</span><strong>${stats.count} 颗</strong></div>
    </div>
    ${gradeChart(stats)}`;
}

function renderStatsPanel(sample) {
  const stats = GrainRules.computeStats(sample.grains);
  statsBadge.textContent = stats.status === "ready"
    ? `已达标 · ${stats.count} 颗`
    : `待补测 · ${stats.count}/${GrainRules.REQUIRED_COUNT} 颗`;
  statsBadge.className = `pill ${stats.status === "ready" ? "pill-ready" : "pill-pending"}`;
  statsPanel.innerHTML = statsSummaryBlock(sample, stats);
  return stats;
}

function renderGrainTable(sample, stats) {
  if (!sample.grains.length) {
    grainTableBody.innerHTML = `<tr><td colspan="5" class="empty-cell">还没有登记颗粒。</td></tr>`;
    return;
  }
  grainTableBody.innerHTML = sample.grains.map((grain, index) => {
    const abnormal = stats.abnormalIds.includes(grain.id);
    return `
      <tr class="${abnormal ? "abnormal-row" : ""}">
        <td>${index + 1}${abnormal ? ' <span class="tag-abnormal" title="φ标度Tukey围栏外">异常</span>' : ""}</td>
        <td>${formatDiameter(grain.diameter)}</td>
        <td>${escapeHtml(grain.roundness)}</td>
        <td>${escapeHtml(grain.point)}</td>
        <td><button type="button" class="link-btn" data-grain-delete="${grain.id}">删除</button></td>
      </tr>`;
  }).join("");
}

function renderStatsHistory(sample) {
  if (!sample.statsHistory || !sample.statsHistory.length) {
    statsHistory.innerHTML = `<p class="hint">暂无历史结果。编号、采样地点或偏光类型改动后，失效的旧统计会保存在这里。</p>`;
    return;
  }
  statsHistory.innerHTML = sample.statsHistory.map((item) => `
    <details class="history-item">
      <summary>
        <span>${formatTime(item.archivedAt)}</span>
        <em>失效原因：${escapeHtml(item.reason)}</em>
      </summary>
      <div class="history-body">
        <p class="hint">原身份：${escapeHtml(item.identity)} · 平均粒径 ${formatDiameter(item.stats.mean)} mm
          · S₀ ${item.stats.sorting ? item.stats.sorting.toFixed(3) : "—"}
          （${escapeHtml(GrainRules.describeSorting(item.stats.sorting))}）· ${item.stats.count} 颗</p>
        ${item.stats.grades.map((grade) => `
          <span class="history-grade">${grade.name} ${formatPercent(grade.percent)}</span>`).join("")}
      </div>
    </details>
  `).join("");
}

/* ---------------- 弹窗 ---------------- */

function openModal(dialog) {
  dialog.hidden = false;
}

function closeModal(dialog) {
  dialog.hidden = true;
}

function openGrainDialog(sampleId) {
  openSampleId = sampleId;
  grainNotice = "";
  const sample = findSample(sampleId);
  if (!sample) return;
  grainDialogSub.textContent =
    `${sample.code} · ${sample.location || "未记录地点"} · ${sample.polarization}`;
  grainForm.reset();
  resetDuplicateWarning();
  grainFormMsg.hidden = true;
  grainFormMsg.textContent = "";
  renderGrainDialog();
  openModal(grainDialog);
  grainForm.diameter.focus();
}

function renderGrainDialog() {
  const sample = findSample(openSampleId);
  if (!sample) {
    closeModal(grainDialog);
    return;
  }
  const stats = renderStatsPanel(sample);
  renderGrainTable(sample, stats);
  renderStatsHistory(sample);
  if (grainNotice) {
    grainFormMsg.textContent = grainNotice;
    grainFormMsg.className = "hint ok";
    grainFormMsg.hidden = false;
  }
}

function resetDuplicateWarning() {
  grainDupLive.hidden = true;
  grainDupLive.textContent = "";
  grainConfirmLine.hidden = true;
  grainForm.confirmDuplicate.checked = false;
}

function openSampleDialog(sampleId) {
  const sample = findSample(sampleId);
  if (!sample) return;
  openSampleId = sampleId;
  sampleEditMsg.hidden = true;
  sampleEditForm.code.value = sample.code;
  sampleEditForm.location.value = sample.location || "";
  sampleEditForm.magnification.value = sample.magnification || "";
  sampleEditForm.polarization.value = sample.polarization;
  sampleEditForm.minerals.value = sample.minerals || "";
  sampleEditForm.texture.value = sample.texture || "";
  sampleEditForm.comment.value = sample.comment || "";
  openModal(sampleDialog);
}

/* ---------------- 样本卡片与对比 ---------------- */

function grainBadge(sample) {
  const stats = GrainRules.computeStats(sample.grains);
  if (stats.status === "ready") {
    return `<span class="grain-state ready">粒度已达标（${stats.count}颗，均值 ${formatDiameter(stats.mean)} mm）</span>`;
  }
  return `<span class="grain-state pending">粒度待补测（${stats.count}/${GrainRules.REQUIRED_COUNT}颗）</span>`;
}

function render() {
  const rows = filteredSamples();
  sampleGrid.innerHTML = rows.length ? rows.map((sample) => {
    const stats = GrainRules.computeStats(sample.grains);
    const canCompare = stats.status === "ready";
    const checked = state.compare.includes(sample.id) ? "checked" : "";
    return `
      <article class="sample-card">
        ${sample.photo ? `<img src="${sample.photo}" alt="${escapeHtml(sample.code)}显微照片">` : "<div class=\"photo-placeholder\"></div>"}
        <div class="sample-body">
          <h3>${escapeHtml(sample.code)}</h3>
          <p>${escapeHtml(sample.location || "未记录地点")} · ${escapeHtml(sample.magnification || "未记录倍数")} · ${escapeHtml(sample.polarization)}</p>
          <p>矿物：${escapeHtml(sample.minerals || "未记录")}</p>
          <p>结构：${escapeHtml(sample.texture || "未记录")}</p>
          <p>${escapeHtml(sample.comment || "未填写批注")}</p>
          ${grainBadge(sample)}
          <div class="card-actions">
            <label title="${canCompare ? "" : "粒度统计数据不足或含异常值，不能参加并排对比"}">
              <input type="checkbox" data-compare="${sample.id}" ${checked} ${canCompare ? "" : "disabled"}>对比
            </label>
            <button type="button" data-grains="${sample.id}">粒度测量</button>
            <button type="button" data-edit="${sample.id}">编辑</button>
            <button type="button" data-delete="${sample.id}">删除</button>
          </div>
        </div>
      </article>`;
  }).join("") : "<p>还没有样本，先从左侧录入一张薄片照片。</p>";

  const compareSamples = state.compare
    .map((id) => state.samples.find((sample) => sample.id === id))
    .filter(Boolean)
    .filter((sample) => GrainRules.computeStats(sample.grains).status === "ready")
    .slice(0, 2);

  if (!compareSamples.length) {
    comparePane.innerHTML = "<p>勾选两张粒度已达标的样本卡片后可并排对比；待补测样本不能参加。</p>";
    return;
  }

  const mergedGrades = compareSamples.map((sample) => {
    const stats = GrainRules.computeStats(sample.grains);
    return { sample, stats };
  });

  comparePane.innerHTML = `
    ${mergedGrades.map(({ sample, stats }) => `
      <article class="compare-item">
        ${sample.photo ? `<img src="${sample.photo}" alt="${escapeHtml(sample.code)}对比图">` : ""}
        <h3>${escapeHtml(sample.code)}</h3>
        <p>${escapeHtml(sample.location || "未记录地点")} · ${escapeHtml(sample.polarization)}</p>
        <p>${escapeHtml(sample.minerals || "未记录矿物")}</p>
        <p>${escapeHtml(sample.texture || "未记录结构")}</p>
        <div class="compare-stats">
          <div><span>平均粒径</span><strong>${formatDiameter(stats.mean)} mm</strong></div>
          <div><span>分选系数 S₀</span><strong>${stats.sorting.toFixed(3)}</strong>
            <em>${escapeHtml(GrainRules.describeSorting(stats.sorting))}</em></div>
        </div>
      </article>
    `).join("")}
    <div class="compare-chart card-block">
      <h3>四个粒级占比对比</h3>
      <div class="compare-chart-grid">
        ${GrainRules.GRADE_ORDER.map((gradeName) => {
          const index = GrainRules.GRADE_ORDER.indexOf(gradeName);
          return `
            <div class="compare-grade-group">
              <div class="compare-bars">
                ${mergedGrades.map(({ stats }, seriesIndex) => `
                  <div class="compare-bar-slot" title="${escapeHtml(gradeName)} ${formatPercent(stats.grades[index].percent)}">
                    <div class="compare-bar series-${seriesIndex}" style="height:${stats.grades[index].percent}%"></div>
                  </div>`).join("")}
              </div>
              <span class="grade-name">${gradeName}</span>
            </div>`;
        }).join("")}
      </div>
      <div class="compare-legend">
        ${mergedGrades.map(({ sample }, i) => `
          <span><i class="legend-swatch series-${i}"></i>${escapeHtml(sample.code)}</span>`).join("")}
      </div>
      ${mergedGrades.length === 2 ? `
        <p class="hint">平均粒径相差
          ${Math.abs(mergedGrades[0].stats.mean - mergedGrades[1].stats.mean).toFixed(3)} mm。</p>` : ""}
    </div>`;
}

/* ---------------- 原有：录入 ---------------- */

photoInput.addEventListener("change", async () => {
  pendingPhoto = await readFileAsDataUrl(photoInput.files[0]);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  if (!pendingPhoto && photoInput.files[0]) {
    pendingPhoto = await readFileAsDataUrl(photoInput.files[0]);
  }
  state.samples.unshift({
    id: crypto.randomUUID(),
    photo: pendingPhoto,
    code: data.get("code").trim(),
    location: data.get("location").trim(),
    magnification: data.get("magnification").trim(),
    polarization: data.get("polarization"),
    minerals: data.get("minerals").trim(),
    texture: data.get("texture").trim(),
    comment: data.get("comment").trim(),
    grains: [],
    statsHistory: [],
    createdAt: new Date().toISOString()
  });
  pendingPhoto = "";
  photoInput.value = "";
  form.reset();
  Store.save(state);
  render();
});

/* ---------------- 新增：粒度登记 ---------------- */

grainForm.point.addEventListener("input", () => {
  const sample = findSample(openSampleId);
  if (!sample) return;
  const point = grainForm.point.value.trim();
  const dup = point && sample.grains.some((g) => String(g.point).trim() === point);
  if (dup) {
    grainDupLive.textContent = "该测点已登记过，重复测量需勾选确认后才能保存。";
    grainDupLive.hidden = false;
    grainConfirmLine.hidden = false;
  } else {
    resetDuplicateWarning();
  }
});

grainForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const sample = findSample(openSampleId);
  if (!sample) return;

  const data = new FormData(grainForm);
  const result = GrainRules.validateEntry({
    diameter: data.get("diameter"),
    roundness: data.get("roundness"),
    point: data.get("point")
  }, sample.grains);

  // 硬错误优先：越界粒径等情况不保存
  if (Object.keys(result.errors).length) {
    grainFormMsg.textContent = Object.values(result.errors).join("；");
    grainFormMsg.className = "hint error";
    grainFormMsg.hidden = false;
    grainNotice = "";
    return;
  }

  // 同一测点重复输入：必须显式确认，否则只提醒、不保存
  if (result.duplicateOf && !grainForm.confirmDuplicate.checked) {
    grainFormMsg.textContent = "同一测点重复输入：请勾选确认框后再登记。";
    grainFormMsg.className = "hint warn";
    grainFormMsg.hidden = false;
    grainNotice = "";
    return;
  }

  sample.grains.push({
    id: crypto.randomUUID(),
    diameter: Number(result.diameter.toFixed(4)),
    roundness: result.roundness,
    point: result.point,
    measuredAt: new Date().toISOString()
  });

  const before = GrainRules.computeStats(sample.grains.slice(0, -1));
  const after = GrainRules.computeStats(sample.grains);
  if (before.status !== "ready" && after.status === "ready") {
    grainNotice = `已登记第 ${after.count} 颗，累计满 ${GrainRules.REQUIRED_COUNT} 颗，统计已生成并可参加并排对比。`;
  } else if (after.status === "pending" && after.abnormalIds.length) {
    grainNotice = `已登记，但当前有 ${after.abnormalIds.length} 颗异常值，统计停在待补测。`;
  } else {
    grainNotice = `已登记第 ${after.count} 颗（${after.count}/${GrainRules.REQUIRED_COUNT}）。`;
  }

  grainForm.reset();
  resetDuplicateWarning();
  Store.save(state);
  renderGrainDialog();
  render();
  grainForm.diameter.focus();
});

/* ---------------- 新增：样本信息编辑（旧统计失效留档） ---------------- */

sampleEditForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const sample = findSample(openSampleId);
  if (!sample) return;

  const data = new FormData(sampleEditForm);
  const after = {
    code: data.get("code").trim(),
    location: data.get("location").trim(),
    magnification: data.get("magnification").trim(),
    polarization: data.get("polarization"),
    minerals: data.get("minerals").trim(),
    texture: data.get("texture").trim(),
    comment: data.get("comment").trim()
  };

  if (!after.code) {
    sampleEditMsg.textContent = "样本编号不能为空。";
    sampleEditMsg.className = "hint error";
    sampleEditMsg.hidden = false;
    return;
  }

  const changed = GrainRules.changedIdentity(sample, after);
  const oldStats = GrainRules.computeStats(sample.grains);
  // 仅当旧统计本来有效（满20且无异常）时留档；待补测本就没有可查的结果
  if (changed.length && oldStats.status === "ready") {
    sample.statsHistory.push({
      archivedAt: new Date().toISOString(),
      reason: `改动${changed.join("、")}，旧统计失效`,
      identity: `${sample.code}｜${sample.location || "未记录地点"}｜${sample.polarization}`,
      stats: oldStats
    });
  }

  Object.assign(sample, after);
  Store.save(state);
  closeModal(sampleDialog);
  render();
  if (!grainDialog.hidden) renderGrainDialog();
});

/* ---------------- 卡片事件委托 ---------------- */

sampleGrid.addEventListener("click", (event) => {
  const target = event.target;

  if (target.dataset.grains) {
    openGrainDialog(target.dataset.grains);
    return;
  }
  if (target.dataset.edit) {
    openSampleDialog(target.dataset.edit);
    return;
  }
  if (target.dataset.delete) {
    const deleteId = target.dataset.delete;
    state.samples = state.samples.filter((sample) => sample.id !== deleteId);
    state.compare = state.compare.filter((id) => id !== deleteId);
    if (openSampleId === deleteId) {
      closeModal(grainDialog);
      closeModal(sampleDialog);
      openSampleId = null;
    }
    Store.save(state);
    render();
  }
});

grainTableBody.addEventListener("click", (event) => {
  const deleteGrainId = event.target.dataset.grainDelete;
  if (!deleteGrainId) return;
  const sample = findSample(openSampleId);
  if (!sample) return;
  sample.grains = sample.grains.filter((grain) => grain.id !== deleteGrainId);
  grainNotice = "已删除该颗，统计按当前测量重算。";
  Store.save(state);
  renderGrainDialog();
  render();
});

sampleGrid.addEventListener("change", (event) => {
  const id = event.target.dataset.compare;
  if (!id) return;
  if (event.target.checked) {
    state.compare = [id, ...state.compare.filter((item) => item !== id)].slice(0, 2);
  } else {
    state.compare = state.compare.filter((item) => item !== id);
  }
  Store.save(state);
  render();
});

/* ---------------- 弹窗关闭 ---------------- */

document.querySelectorAll("[data-modal-close]").forEach((button) => {
  button.addEventListener("click", () => {
    closeModal(document.getElementById(button.dataset.modalClose));
    grainNotice = "";
  });
});

[grainDialog, sampleDialog].forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeModal(dialog);
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeModal(grainDialog);
    closeModal(sampleDialog);
    grainNotice = "";
  }
});

/* ---------------- 原有：筛选、导出 ---------------- */

[mineralFilter, polarFilter].forEach((field) => field.addEventListener("input", render));

document.querySelector("#exportBtn").addEventListener("click", () => {
  const checklist = state.samples.map((sample) => {
    const stats = GrainRules.computeStats(sample.grains);
    return {
      样本编号: sample.code,
      采样地点: sample.location,
      放大倍数: sample.magnification,
      偏光类型: sample.polarization,
      主要矿物: sample.minerals,
      颗粒结构: sample.texture,
      老师批注: sample.comment,
      粒度状态: stats.status === "ready" ? "已达标" : "待补测",
      已测颗粒数: stats.count,
      平均粒径_mm: stats.status === "ready" ? Number(stats.mean.toFixed(3)) : null,
      分选系数: stats.status === "ready" && stats.sorting ? Number(stats.sorting.toFixed(3)) : null,
      粒级占比: Object.fromEntries(stats.grades.map((g) => [g.name, Number(g.percent.toFixed(1))]))
    };
  });
  const blob = new Blob([JSON.stringify(checklist, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "thin-section-checklist.json";
  link.click();
  URL.revokeObjectURL(link.href);
});

/* 启动时清理对比栏：旧版本可能勾选了粒度未达标的样本 */
state.compare = state.compare.filter((id) => {
  const sample = findSample(id);
  return sample && GrainRules.computeStats(sample.grains).status === "ready";
});

render();
