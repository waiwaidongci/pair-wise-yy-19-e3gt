"use strict";

/*
 * 粒度测量业务规则层
 * 只负责规则与统计计算，不操作 DOM，不读写 localStorage。
 */
const GrainRules = (() => {
  // 粒径合法区间（mm）：小于 0.01 或大于 10 的颗粒不予保存
  const MIN_DIAMETER = 0.01;
  const MAX_DIAMETER = 10;
  // 累计满 20 颗才允许出统计、参加并排对比
  const REQUIRED_COUNT = 20;
  // Powers 圆度分级
  const ROUNDNESS_LEVELS = ["棱角状", "次棱角状", "次圆状", "圆状"];

  // Wentworth 四级粒级（mm）：砾 ≥2；砂 0.0625–2；粉砂 0.0039–0.0625；黏土 <0.0039
  const GRADE_ORDER = ["砾级", "砂级", "粉砂级", "黏土级"];
  const GRADE_BOUNDS = {
    砾级: "≥ 2 mm",
    砂级: "0.0625 – 2 mm",
    粉砂级: "0.0039 – 0.0625 mm",
    黏土级: "< 0.0039 mm"
  };

  function gradeOf(diameter) {
    const d = Number(diameter);
    if (d >= 2) return "砾级";
    if (d >= 0.0625) return "砂级";
    if (d >= 0.0039) return "粉砂级";
    return "黏土级";
  }

  // 校验一颗颗粒的录入内容；errors 为硬错误（阻止保存），duplicateOf 为重复测点提醒
  function validateEntry(entry, existingGrains) {
    const grains = Array.isArray(existingGrains) ? existingGrains : [];
    const errors = {};

    const rawDiameter = typeof entry.diameter === "number"
      ? entry.diameter
      : String(entry.diameter ?? "").trim();
    const diameter = Number(rawDiameter);
    if (rawDiameter === "" || !Number.isFinite(diameter)) {
      errors.diameter = "粒径必须是数字";
    } else if (diameter < MIN_DIAMETER || diameter > MAX_DIAMETER) {
      errors.diameter =
        `粒径 ${diameter} mm 超出允许范围（${MIN_DIAMETER}–${MAX_DIAMETER} mm），本颗不予保存`;
    }

    const roundness = String(entry.roundness ?? "").trim();
    if (!ROUNDNESS_LEVELS.includes(roundness)) {
      errors.roundness = "请选择圆度";
    }

    const point = String(entry.point ?? "").trim();
    if (!point) {
      errors.point = "请填写测点说明";
    }
    const duplicateOf = point
      ? grains.find((grain) => String(grain.point).trim() === point) || null
      : null;

    return { diameter, roundness, point, errors, duplicateOf };
  }

  // 升序序列的分位数（线性插值）
  function quantile(sortedAsc, q) {
    if (!sortedAsc.length) return null;
    const pos = (sortedAsc.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    return sortedAsc[base + 1] !== undefined
      ? sortedAsc[base] + rest * (sortedAsc[base + 1] - sortedAsc[base])
      : sortedAsc[base];
  }

  // Trask 分选系数 S0 = √(Q3/Q1)，越接近 1 分选越好
  function describeSorting(so) {
    if (so === null || !Number.isFinite(so)) return "无法计算";
    if (so < 1.25) return "分选好";
    if (so < 1.5) return "分选较好";
    if (so < 2) return "分选中等";
    if (so < 4) return "分选差";
    return "分选极差";
  }

  /*
   * 依据当前全部已登记颗粒计算统计：
   * - 不满 20 颗：status=pending（数据不足，待补测）
   * - 满 20 颗但检出异常值：status=pending（含异常值，待补测）
   * 异常值在 φ 标度（φ=-log2 d，粒度近似对数正态）上按 Tukey 围栏判定。
   */
  function computeStats(grains) {
    const list = Array.isArray(grains) ? grains : [];
    const count = list.length;
    const diameters = list.map((g) => Number(g.diameter)).sort((a, b) => a - b);

    const mean = count
      ? diameters.reduce((sum, d) => sum + d, 0) / count
      : null;

    let sorting = null;
    let abnormalIds = [];

    if (count >= 2) {
      const q1 = quantile(diameters, 0.25);
      const q3 = quantile(diameters, 0.75);
      sorting = q1 > 0 ? Math.sqrt(q3 / q1) : null;
    }

    if (count >= REQUIRED_COUNT) {
      const phis = diameters.map((d) => -Math.log2(d)).sort((a, b) => a - b);
      const q1Phi = quantile(phis, 0.25);
      const q3Phi = quantile(phis, 0.75);
      const iqr = q3Phi - q1Phi;
      if (iqr > 0) {
        const low = q1Phi - 1.5 * iqr;
        const high = q3Phi + 1.5 * iqr;
        abnormalIds = list
          .filter((g) => {
            const phi = -Math.log2(Number(g.diameter));
            return phi < low || phi > high;
          })
          .map((g) => g.id);
      }
    }

    const gradeCounts = Object.fromEntries(GRADE_ORDER.map((name) => [name, 0]));
    list.forEach((g) => { gradeCounts[gradeOf(g.diameter)] += 1; });
    const grades = GRADE_ORDER.map((name) => ({
      name,
      bounds: GRADE_BOUNDS[name],
      count: gradeCounts[name],
      percent: count ? (gradeCounts[name] / count) * 100 : 0
    }));

    let status;
    let reason;
    if (count < REQUIRED_COUNT) {
      status = "pending";
      reason = `数据不足：已登记 ${count}/${REQUIRED_COUNT} 颗，满 ${REQUIRED_COUNT} 颗后才出统计，当前停在待补测。`;
    } else if (abnormalIds.length) {
      status = "pending";
      reason = `检出 ${abnormalIds.length} 颗粒径异常值（φ 标度 Tukey 围栏外），请复核或继续补测，当前停在待补测。`;
    } else {
      status = "ready";
      reason = "";
    }

    return {
      count,
      mean,
      sorting,
      grades,
      abnormalIds,
      status,
      reason,
      computedAt: new Date().toISOString()
    };
  }

  // 编号、采样地点、偏光类型任一改动都会使旧统计失效
  const IDENTITY_FIELDS = [
    { key: "code", label: "样本编号" },
    { key: "location", label: "采样地点" },
    { key: "polarization", label: "偏光类型" }
  ];

  function changedIdentity(before, after) {
    return IDENTITY_FIELDS
      .filter(({ key }) => String(before[key] ?? "").trim() !== String(after[key] ?? "").trim())
      .map(({ label }) => label);
  }

  return {
    MIN_DIAMETER,
    MAX_DIAMETER,
    REQUIRED_COUNT,
    ROUNDNESS_LEVELS,
    GRADE_ORDER,
    GRADE_BOUNDS,
    gradeOf,
    validateEntry,
    computeStats,
    describeSorting,
    changedIdentity,
    IDENTITY_FIELDS
  };
})();
