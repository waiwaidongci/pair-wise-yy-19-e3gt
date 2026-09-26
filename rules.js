"use strict";

/*
 * 粒度测量业务规则
 * 纯函数文件：不操作 DOM，不读写 localStorage。
 * 页面层（app.js）和本地保存层（store.js）都只通过这里判断规则。
 */
var GrainRules = (() => {
  const MIN_SIZE = 0.01; // 粒径下限（mm），小于该值不保存
  const MAX_SIZE = 10;   // 粒径上限（mm），大于该值不保存
  const MIN_GRAINS = 20; // 累计满 20 颗有效颗粒才出统计

  // Powers 圆度分级
  const ROUNDNESS = ["棱角状", "次棱角状", "次圆状", "圆状", "极圆状"];

  /*
   * 四个粒级（mm），界线取 Udden–Wentworth 标准（0.0625 / 0.25 / 1），
   * 因测量有效区间为 0.01–10 mm，按四档合并为：
   * 粉砂级 / 细砂级 / 中—粗砂级 / 粗砂—砾级。
   * 区间均为左闭右开，最后一档右闭。
   */
  const GRADES = [
    { key: "silt",   label: "粉砂级",     range: "0.01–0.063", min: 0.01,   max: 0.0625 },
    { key: "fine",   label: "细砂级",     range: "0.063–0.25", min: 0.0625, max: 0.25 },
    { key: "medium", label: "中—粗砂级",  range: "0.25–1",    min: 0.25,   max: 1 },
    { key: "coarse", label: "粗砂—砾级",  range: "1–10",      min: 1,      max: 10 }
  ];

  // 改动这三个身份字段后，旧统计失效并按当前测量重算
  const IDENTITY_FIELDS = ["code", "location", "polarization"];

  function normalizePoint(value) {
    return String(value == null ? "" : value).trim().replace(/\s+/g, " ");
  }

  function gradeIndexOf(size) {
    for (let i = 0; i < GRADES.length; i++) {
      const grade = GRADES[i];
      const afterMin = size >= grade.min;
      const beforeMax = i === GRADES.length - 1 ? size <= grade.max : size < grade.max;
      if (afterMin && beforeMax) return i;
    }
    return -1;
  }

  // 登记单颗颗粒：返回 { ok:true, grain } 或 { ok:false, error }
  function validateGrain(input, existingGrains) {
    const rawSize = input && input.size;
    const size = Number(rawSize);
    const roundness = String((input && input.roundness) || "").trim();
    const point = normalizePoint(input && input.point);

    if (rawSize === "" || rawSize == null || !Number.isFinite(size)) {
      return { ok: false, error: "请输入数字粒径（mm）。" };
    }
    if (size < MIN_SIZE || size > MAX_SIZE) {
      return {
        ok: false,
        error: `粒径 ${size} mm 超出允许范围 ${MIN_SIZE}–${MAX_SIZE} mm，本颗不保存。`
      };
    }
    if (!ROUNDNESS.includes(roundness)) {
      return { ok: false, error: "请选择圆度。" };
    }
    if (!point) {
      return { ok: false, error: "请填写测点说明。" };
    }
    const duplicated = existingGrains.some(
      (grain) => normalizePoint(grain.point) === point
    );
    if (duplicated) {
      return {
        ok: false,
        error: `测点“${point}”已经登记过，同一测点不允许重复输入，请核对后换一个测点。`
      };
    }

    return {
      ok: true,
      grain: {
        id: crypto.randomUUID(),
        size,
        roundness,
        point,
        measuredAt: new Date().toISOString()
      }
    };
  }

  // 线性插值分位数（p 取 0–1）
  function quantile(sorted, p) {
    if (!sorted.length) return NaN;
    const pos = (sorted.length - 1) * p;
    const low = Math.floor(pos);
    const high = Math.ceil(pos);
    if (low === high) return sorted[low];
    return sorted[low] + (sorted[high] - sorted[low]) * (pos - low);
  }

  // Trask 分选系数定性：So≈1 为分选好，越大越差
  function sortingLabel(so) {
    if (so <= 1.2) return "分选好";
    if (so <= 1.5) return "分选中等";
    return "分选差";
  }

  /*
   * 按当前全部颗粒计算统计结果。
   * 不足 20 颗或含异常值（越界粒径 / 重复或缺失测点）时：
   *   { ready:false, status:"待补测", reasons, anomalies }
   * 合格时：
   *   { ready:true, status:"合格", mean, q1, q3, sorting, sortingLabel, grades }
   */
  function analyze(grains) {
    const list = Array.isArray(grains) ? grains : [];
    const n = list.length;
    const anomalies = [];

    list.forEach((grain, i) => {
      if (!(Number.isFinite(grain.size) && grain.size >= MIN_SIZE && grain.size <= MAX_SIZE)) {
        anomalies.push(`第 ${i + 1} 颗粒径 ${grain.size} mm 超出 ${MIN_SIZE}–${MAX_SIZE} mm`);
      }
    });

    const seen = new Set();
    list.forEach((grain) => {
      const point = normalizePoint(grain.point);
      if (!point) {
        anomalies.push("存在未填写测点说明的颗粒");
        return;
      }
      if (seen.has(point)) anomalies.push(`测点“${point}”重复登记`);
      seen.add(point);
    });

    const base = { n, anomalies };

    if (n < MIN_GRAINS) {
      return {
        ...base,
        ready: false,
        status: "待补测",
        reasons: [`有效颗粒不足 ${MIN_GRAINS} 颗（当前 ${n} 颗），暂不计算统计结果。`]
      };
    }
    if (anomalies.length) {
      return {
        ...base,
        ready: false,
        status: "待补测",
        reasons: ["测量数据含异常值，请删除问题颗粒或补测后再统计。"]
      };
    }

    const sizes = list.map((grain) => grain.size).sort((a, b) => a - b);
    const mean = sizes.reduce((sum, value) => sum + value, 0) / n;
    const q1 = quantile(sizes, 0.25);
    const q3 = quantile(sizes, 0.75);
    const sorting = Math.sqrt(q3 / q1); // Trask 分选系数 So = √(Q3/Q1)

    const grades = GRADES.map((grade, i) => {
      const count = sizes.reduce(
        (acc, size) => acc + (gradeIndexOf(size) === i ? 1 : 0),
        0
      );
      return {
        key: grade.key,
        label: grade.label,
        range: grade.range,
        count,
        percent: (count / n) * 100
      };
    });

    return {
      ...base,
      ready: true,
      status: "合格",
      reasons: [],
      mean,
      q1,
      q3,
      sorting,
      sortingLabel: sortingLabel(sorting),
      grades
    };
  }

  return {
    MIN_SIZE,
    MAX_SIZE,
    MIN_GRAINS,
    ROUNDNESS,
    GRADES,
    IDENTITY_FIELDS,
    normalizePoint,
    validateGrain,
    analyze
  };
})();
