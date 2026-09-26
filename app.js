"use strict";

/*
 * 页面操作业务
 * 样本录入、筛选、并排对比、导出等原有操作照常；
 * 粒度测量规则走 GrainRules，数据落盘走 GrainStore。
 */
const form = document.querySelector("#sampleForm");
const photoInput = document.querySelector("#photoInput");
const sampleGrid = document.querySelector("#sampleGrid");
const comparePane = document.querySelector("#comparePane");
const mineralFilter = document.querySelector("#mineralFilter");
const polarFilter = document.querySelector("#polarFilter");
const editBanner = document.querySelector("#editBanner");
const cancelEditBtn = document.querySelector("#cancelEdit");

let pendingPhoto = "";
let editingId = null;
let grainSampleId = null;

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(
    /[&<>"']/g,
    (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]
  );
}

function fixed(value, digits = 3) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : "—";
}

function formatTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve) => {
    if (!file) return resolve("");
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.readAsDataURL(file);
  });
}

function filteredSamples() {
  const mineral = mineralFilter.value.trim();
  const polarization = polarFilter.value;
  return GrainStore.state.samples.filter((sample) => {
    const mineralMatch = !mineral || sample.minerals.includes(mineral);
    const polarMatch = !polarization || sample.polarization === polarization;
    return mineralMatch && polarMatch;
  });
}

/* ---------------- 样本卡片 ---------------- */

function statusBadge(sample) {
  const stats = sample.stats;
  const n = stats && typeof stats.n === "number" ? stats.n : (sample.grains || []).length;
  if (stats && stats.ready) {
    return '<span class="badge badge-ready">统计合格</span>';
  }
  return `<span class="badge badge-pending" title="满 ${GrainRules.MIN_GRAINS} 颗有效颗粒且无异常值后才能出统计、参加对比">待补测（${n}/${GrainRules.MIN_GRAINS}）</span>`;
}

function render() {
  const rows = filteredSamples();
  sampleGrid.innerHTML = rows.length ? rows.map((sample) => {
    const ready = sample.stats && sample.stats.ready;
    const checked = GrainStore.state.compare.includes(sample.id);
    const compareControl = ready
      ? `<label title="勾选后在右侧并排对比"><input type="checkbox" data-compare="${sample.id}" ${checked ? "checked" : ""}>对比</label>`
      : `<label class="compare-locked" title="待补测样本不能参加并排对比：满 ${GrainRules.MIN_GRAINS} 颗且无异常值后自动开放"><input type="checkbox" disabled>对比</label>`;
    return `
    <article class="sample-card">
      ${sample.photo ? `<img src="${sample.photo}" alt="${escapeHtml(sample.code)}显微照片">` : '<div class="photo-placeholder"></div>'}
      <div class="sample-body">
        <h3>${escapeHtml(sample.code)}</h3>
        <p>${escapeHtml(sample.location || "未记录地点")} · ${escapeHtml(sample.magnification || "未记录倍数")} · ${escapeHtml(sample.polarization)}</p>
        <p>矿物：${escapeHtml(sample.minerals || "未记录")}</p>
        <p>结构：${escapeHtml(sample.texture || "未记录")}</p>
        <p>${escapeHtml(sample.comment || "未填写批注")}</p>
        <p class="grain-line">
          ${statusBadge(sample)}
          <a href="#" data-grains="${sample.id}">粒度测量（${(sample.grains || []).length}颗）</a>
        </p>
        <div class="card-actions">
          ${compareControl}
          <span class="action-buttons">
            <button type="button" data-edit="${sample.id}">编辑</button>
            <button type="button" data-delete="${sample.id}">删除</button>
          </span>
        </div>
      </div>
    </article>`;
  }).join("") : "<p>还没有样本，先从左侧录入一张薄片照片。</p>";

  renderCompare();
}

/* ---------------- 并排对比（仅统计合格样本） ---------------- */

function miniGrades(stats) {
  return `
    <div class="mini-bars">
      ${stats.grades.map((grade) => `
        <div class="mini-bar" style="width:${grade.percent}%" title="${grade.label} ${grade.range} mm：${grade.percent.toFixed(1)}%"></div>
      `).join("")}
    </div>
    <p class="mini-legend">
      ${stats.grades.map((g) => `<i class="dot dot-${g.key}"></i>${g.label} ${g.percent.toFixed(0)}%`).join("　")}
    </p>`;
}

function renderCompare() {
  const compareSamples = GrainStore.state.compare
    .map((id) => GrainStore.findSample(id))
    .filter((sample) => sample && sample.stats && sample.stats.ready)
    .slice(0, 2);

  comparePane.innerHTML = compareSamples.length ? compareSamples.map((sample) => {
    const stats = sample.stats;
    return `
    <article class="compare-item">
      ${sample.photo ? `<img src="${sample.photo}" alt="${escapeHtml(sample.code)}对比图">` : ""}
      <h3>${escapeHtml(sample.code)}</h3>
      <p>${escapeHtml(sample.location || "未记录地点")} · ${escapeHtml(sample.polarization)}</p>
      <p>${escapeHtml(sample.minerals || "未记录矿物")} · ${escapeHtml(sample.texture || "未记录结构")}</p>
      <div class="compare-stats">
        <p><strong>平均粒径</strong> ${fixed(stats.mean)} mm</p>
        <p><strong>分选系数</strong> ${fixed(stats.sorting, 2)}（${escapeHtml(stats.sortingLabel)}）</p>
        ${miniGrades(stats)}
      </div>
    </article>`;
  }).join("") : `<p>勾选两张“统计合格”样本卡片后可并排对比。待补测样本需先在“粒度测量”里补满 ${GrainRules.MIN_GRAINS} 颗。</p>`;
}

/* ---------------- 样本录入 / 编辑 ---------------- */

photoInput.addEventListener("change", async () => {
  pendingPhoto = await readFileAsDataUrl(photoInput.files[0]);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  if (!pendingPhoto && photoInput.files[0]) {
    pendingPhoto = await readFileAsDataUrl(photoInput.files[0]);
  }
  const payload = {
    photo: pendingPhoto,
    code: data.get("code").trim(),
    location: data.get("location").trim(),
    magnification: data.get("magnification").trim(),
    polarization: data.get("polarization"),
    minerals: data.get("minerals").trim(),
    texture: data.get("texture").trim(),
    comment: data.get("comment").trim()
  };

  if (editingId) {
    const target = GrainStore.findSample(editingId);
    // 未重新选照片时保留原照片
    if (!(photoInput.files && photoInput.files[0])) payload.photo = target.photo;
    GrainStore.updateSample(editingId, payload);
    exitEditMode();
  } else {
    GrainStore.addSample(payload);
    pendingPhoto = "";
    photoInput.value = "";
    form.reset();
  }
  render();
});

function enterEditMode(id) {
  const sample = GrainStore.findSample(id);
  if (!sample) return;
  editingId = id;
  const fields = form.elements;
  fields.code.value = sample.code;
  fields.location.value = sample.location;
  fields.magnification.value = sample.magnification;
  fields.polarization.value = sample.polarization;
  fields.minerals.value = sample.minerals;
  fields.texture.value = sample.texture;
  fields.comment.value = sample.comment;
  pendingPhoto = sample.photo;
  photoInput.value = "";
  form.querySelector("button[type='submit']").textContent = "保存修改";
  editBanner.hidden = false;
  if (typeof form.scrollIntoView === "function") {
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function exitEditMode() {
  editingId = null;
  pendingPhoto = "";
  photoInput.value = "";
  form.reset();
  form.querySelector("button[type='submit']").textContent = "保存样本";
  editBanner.hidden = true;
}

cancelEditBtn.addEventListener("click", exitEditMode);

/* ---------------- 粒度测量弹窗 ---------------- */

const grainModal = document.querySelector("#grainModal");
const grainModalBody = document.querySelector("#grainModalBody");
const grainModalClose = document.querySelector("#grainModalClose");

function barChart(stats) {
  return `
    <div class="chart">
      ${stats.grades.map((grade) => `
        <div class="chart-col">
          <div class="chart-bar-wrap">
            <div class="chart-bar chart-${grade.key}" style="height:${Math.max(grade.percent, 2)}%" title="${grade.label} ${grade.range} mm：${grade.percent.toFixed(1)}%（${grade.count}颗）"></div>
          </div>
          <span class="chart-value">${grade.percent.toFixed(0)}%</span>
          <span class="chart-label">${grade.label}</span>
          <span class="chart-range">${grade.range} mm</span>
        </div>
      `).join("")}
    </div>`;
}

function statsPanel(sample) {
  const stats = sample.stats;
  if (!stats.ready) {
    const reasons = (stats.reasons || []).map((reason) => `<li>${escapeHtml(reason)}</li>`).join("");
    const anomalyList = (stats.anomalies || []).slice(0, 6)
      .map((item) => `<li>${escapeHtml(item)}</li>`).join("");
    return `
      <div class="stats stats-pending">
        <h4>状态：待补测</h4>
        <div class="progress"><span style="width:${Math.min((stats.n / GrainRules.MIN_GRAINS) * 100, 100)}%"></span></div>
        <p>已登记 <strong>${stats.n}</strong> / ${GrainRules.MIN_GRAINS} 颗，暂不计算统计结果。</p>
        <ul>${reasons}${anomalyList}</ul>
        <p class="stats-note">数据不足或含异常值时停在待补测，且不能参加并排对比。</p>
      </div>`;
  }
  return `
    <div class="stats stats-ready">
      <h4>状态：统计合格（${stats.n} 颗）</h4>
      <div class="stat-grid">
        <div><span>平均粒径</span><strong>${fixed(stats.mean)} mm</strong></div>
        <div><span>分选系数 So</span><strong>${fixed(stats.sorting, 2)}</strong><em>${escapeHtml(stats.sortingLabel)}</em></div>
        <div><span>Q1 / Q3</span><strong>${fixed(stats.q1)} / ${fixed(stats.q3)} mm</strong></div>
      </div>
      <h5>四个粒级占比</h5>
      ${barChart(stats)}
    </div>`;
}

function historyPanel(sample) {
  if (!sample.statsHistory.length) {
    return '<div class="history"><h4>旧结果</h4><p class="history-empty">暂无旧统计。修改编号、采样地点或偏光类型后，旧统计会归档到这里供查阅。</p></div>';
  }
  return `
    <div class="history">
      <h4>旧结果（${sample.statsHistory.length} 份）</h4>
      ${sample.statsHistory.map((entry) => {
        const stats = entry.stats || {};
        return `
        <details class="history-item">
          <summary>${escapeHtml(entry.code || "—")} · 归档于 ${formatTime(entry.archivedAt)}</summary>
          <p>${escapeHtml(entry.reason || "")}</p>
          <p>身份：${escapeHtml(entry.location || "未记录地点")} · ${escapeHtml(entry.polarization || "")}</p>
          ${stats.ready ? `
            <p>平均粒径 ${fixed(stats.mean)} mm；分选系数 ${fixed(stats.sorting, 2)}（${escapeHtml(stats.sortingLabel)}）；${stats.n} 颗</p>
            <p class="history-grades">
              ${stats.grades.map((g) => `${escapeHtml(g.label)} ${g.percent.toFixed(1)}%`).join("　")}
            </p>` : `<p>归档时为待补测（${stats.n || 0} 颗），无统计结果。</p>`}
        </details>`;
      }).join("")}
    </div>`;
}

function renderGrainModal(formMessage) {
  const sample = GrainStore.findSample(grainSampleId);
  if (!sample) return;
  grainModalBody.innerHTML = `
    <div class="grain-layout">
      <div class="grain-left">
        <h3>${escapeHtml(sample.code)} <small>${escapeHtml(sample.location || "未记录地点")} · ${escapeHtml(sample.polarization)}</small></h3>
        <p class="rules-hint">粒径范围 ${GrainRules.MIN_SIZE}–${GrainRules.MAX_SIZE} mm（越界不保存）；测点说明不可重复；满 ${GrainRules.MIN_GRAINS} 颗有效颗粒才出统计。</p>
        <form id="grainForm" class="grain-form">
          <div class="pair">
            <label>粒径 (mm)<input id="grainSize" type="number" step="0.001" min="${GrainRules.MIN_SIZE}" max="${GrainRules.MAX_SIZE}" placeholder="例如 0.32" required></label>
            <label>圆度<select id="grainRoundness" required>
              <option value="">请选择</option>
              ${GrainRules.ROUNDNESS.map((value) => `<option value="${value}">${value}</option>`).join("")}
            </select></label>
          </div>
          <label>测点说明<input id="grainPoint" placeholder="例如 视域中心右上第3颗，石英，单偏光下长轴" required></label>
          <p id="grainError" class="grain-error" role="alert" ${formMessage ? "" : "hidden"}>${escapeHtml(formMessage || "")}</p>
          <button type="submit">登记本颗</button>
        </form>
        <div class="grain-table-wrap">
          <table class="grain-table">
            <thead><tr><th>#</th><th>粒径(mm)</th><th>圆度</th><th>测点说明</th><th></th></tr></thead>
            <tbody>
              ${sample.grains.length ? sample.grains.map((grain, i) => `
                <tr>
                  <td>${i + 1}</td>
                  <td>${fixed(grain.size)}</td>
                  <td>${escapeHtml(grain.roundness)}</td>
                  <td title="${escapeHtml(grain.point)}">${escapeHtml(grain.point)}</td>
                  <td><button type="button" data-grain-delete="${grain.id}" class="link-btn">删除</button></td>
                </tr>`).join("") : '<tr><td colspan="5" class="empty-row">还没有登记颗粒。</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
      <div class="grain-right">
        ${statsPanel(sample)}
        ${historyPanel(sample)}
      </div>
    </div>`;
}

function openGrainModal(id) {
  grainSampleId = id;
  renderGrainModal("");
  grainModal.hidden = false;
}

function closeGrainModal() {
  grainSampleId = null;
  grainModal.hidden = true;
  render();
}

grainModalClose.addEventListener("click", closeGrainModal);
grainModal.addEventListener("click", (event) => {
  // 点击遮罩空白处关闭
  if (event.target === grainModal) closeGrainModal();
});

grainModalBody.addEventListener("submit", (event) => {
  if (event.target.id !== "grainForm" || !grainSampleId) return;
  event.preventDefault();
  const size = document.querySelector("#grainSize").value;
  const roundness = document.querySelector("#grainRoundness").value;
  const point = document.querySelector("#grainPoint").value;
  const result = GrainStore.addGrain(grainSampleId, { size, roundness, point });
  if (!result.ok) {
    // 录入失败：提示重复测点 / 越界，保留输入便于核对修改
    const errorEl = document.querySelector("#grainError");
    errorEl.textContent = result.error;
    errorEl.hidden = false;
    return;
  }
  renderGrainModal("");
  render();
});

grainModalBody.addEventListener("click", (event) => {
  const grainId = event.target.dataset && event.target.dataset.grainDelete;
  if (!grainId || !grainSampleId) return;
  GrainStore.deleteGrain(grainSampleId, grainId);
  renderGrainModal("");
  render();
});

/* ---------------- 卡片事件（删除 / 编辑 / 测量 / 对比） ---------------- */

sampleGrid.addEventListener("click", (event) => {
  const grainsId = event.target.dataset && event.target.dataset.grains;
  if (grainsId) {
    event.preventDefault();
    openGrainModal(grainsId);
    return;
  }
  const editId = event.target.dataset && event.target.dataset.edit;
  if (editId) {
    enterEditMode(editId);
    return;
  }
  const deleteId = event.target.dataset && event.target.dataset.delete;
  if (deleteId) {
    const sample = GrainStore.findSample(deleteId);
    const message = sample
      ? `确定删除样本“${sample.code}”及其全部粒度测量吗？`
      : "确定删除该样本吗？";
    if (window.confirm(message)) {
      GrainStore.deleteSample(deleteId);
      if (editingId === deleteId) exitEditMode();
      render();
    }
  }
});

sampleGrid.addEventListener("change", (event) => {
  const id = event.target.dataset && event.target.dataset.compare;
  if (!id) return;
  GrainStore.setCompare(id, event.target.checked);
  render();
});

[mineralFilter, polarFilter].forEach((field) => field.addEventListener("input", render));

/* ---------------- 导出（原有字段保留，追加粒度结果） ---------------- */

document.querySelector("#exportBtn").addEventListener("click", () => {
  const checklist = GrainStore.state.samples.map((sample) => {
    const stats = sample.stats || {};
    const gradeMap = {};
    (stats.grades || []).forEach((grade) => {
      gradeMap[`${grade.label}占比%`] = Number(grade.percent.toFixed(2));
    });
    return {
      样本编号: sample.code,
      采样地点: sample.location,
      放大倍数: sample.magnification,
      偏光类型: sample.polarization,
      主要矿物: sample.minerals,
      颗粒结构: sample.texture,
      老师批注: sample.comment,
      测量状态: stats.ready ? "统计合格" : "待补测",
      有效颗粒数: stats.n || 0,
      平均粒径mm: stats.ready ? Number(stats.mean.toFixed(4)) : null,
      分选系数: stats.ready ? Number(stats.sorting.toFixed(3)) : null,
      分选评价: stats.ready ? stats.sortingLabel : null,
      ...gradeMap,
      颗粒登记: (sample.grains || []).map((grain, i) => ({
        序号: i + 1,
        粒径mm: grain.size,
        圆度: grain.roundness,
        测点说明: grain.point,
        测量时间: grain.measuredAt
      }))
    };
  });
  const blob = new Blob([JSON.stringify(checklist, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "thin-section-checklist.json";
  link.click();
  URL.revokeObjectURL(link.href);
});

render();
