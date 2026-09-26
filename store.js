"use strict";

/*
 * 本地保存业务
 * 负责 localStorage 读写、样本与颗粒增删、并排对比名单维护，
 * 以及粒度统计的重算与旧结果归档。
 * 规则判断全部委托 GrainRules，本文件不定义测量口径。
 */
var GrainStore = (() => {
  const storageKey = "wxyy-2-thin-section-index";

  function normalizeGrain(grain) {
    return {
      id: grain.id || crypto.randomUUID(),
      size: Number(grain.size),
      roundness: grain.roundness || "",
      point: GrainRules.normalizePoint(grain.point),
      measuredAt: grain.measuredAt || new Date().toISOString()
    };
  }

  function recompute(sample) {
    const grains = (sample.grains || []).map(normalizeGrain);
    return GrainRules.analyze(grains);
  }

  function normalizeSample(sample) {
    const grains = (sample.grains || []).map(normalizeGrain);
    const restored = {
      id: sample.id || crypto.randomUUID(),
      photo: sample.photo || "",
      code: sample.code || "",
      location: sample.location || "",
      magnification: sample.magnification || "",
      polarization: sample.polarization || "单偏光",
      minerals: sample.minerals || "",
      texture: sample.texture || "",
      comment: sample.comment || "",
      grains,
      statsHistory: Array.isArray(sample.statsHistory) ? sample.statsHistory : [],
      createdAt: sample.createdAt || new Date().toISOString()
    };
    // 旧版本数据没有 stats：加载时统一按当前颗粒补算一次（不算旧结果）
    restored.stats = sample.stats || recompute(restored);
    return restored;
  }

  let state;
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey) || "{}");
    state = {
      samples: (raw.samples || []).map(normalizeSample),
      compare: Array.isArray(raw.compare) ? raw.compare : []
    };
  } catch {
    state = { samples: [], compare: [] };
  }

  // 清理对比名单：样本被删或统计不合格都不能参加并排对比
  function pruneCompare() {
    const allowed = new Set(
      state.samples.filter((sample) => sample.stats && sample.stats.ready).map((sample) => sample.id)
    );
    state.compare = state.compare.filter((id) => allowed.has(id));
  }
  pruneCompare();

  function persist() {
    localStorage.setItem(storageKey, JSON.stringify(state));
  }

  function findSample(id) {
    return state.samples.find((sample) => sample.id === id);
  }

  function addSample(data) {
    const sample = normalizeSample({ ...data, grains: [], statsHistory: [] });
    state.samples.unshift(sample);
    persist();
    return sample;
  }

  function deleteSample(id) {
    state.samples = state.samples.filter((sample) => sample.id !== id);
    state.compare = state.compare.filter((item) => item !== id);
    persist();
  }

  /*
   * 修改样本。
   * 身份字段（编号 / 采样地点 / 偏光类型）一旦变化：
   * 把现有统计快照连同旧身份归档到 statsHistory（旧结果仍可查），
   * 再按当前颗粒重算。
   */
  function updateSample(id, patch) {
    const sample = findSample(id);
    if (!sample) return null;
    const identityChanged = GrainRules.IDENTITY_FIELDS.some(
      (field) => patch[field] !== undefined && String(patch[field]).trim() !== String(sample[field] || "").trim()
    );
    if (identityChanged && sample.stats) {
      sample.statsHistory.unshift({
        archivedAt: new Date().toISOString(),
        code: sample.code,
        location: sample.location,
        polarization: sample.polarization,
        reason: "样本编号、采样地点或偏光类型改动，旧统计已失效",
        stats: sample.stats
      });
    }
    Object.assign(sample, patch);
    if (identityChanged) sample.stats = recompute(sample);
    pruneCompare();
    persist();
    return sample;
  }

  function addGrain(id, input) {
    const sample = findSample(id);
    if (!sample) return { ok: false, error: "样本不存在。" };
    const result = GrainRules.validateGrain(input, sample.grains);
    if (!result.ok) return result;
    sample.grains.push(result.grain);
    sample.stats = recompute(sample);
    if (!(sample.stats && sample.stats.ready)) {
      state.compare = state.compare.filter((item) => item !== id);
    }
    persist();
    return { ok: true, grain: result.grain, stats: sample.stats };
  }

  // 删除颗粒后按当前测量重算（不足 20 颗自动回到待补测，并退出对比）
  function deleteGrain(id, grainId) {
    const sample = findSample(id);
    if (!sample) return null;
    sample.grains = sample.grains.filter((grain) => grain.id !== grainId);
    sample.stats = recompute(sample);
    if (!sample.stats.ready) {
      state.compare = state.compare.filter((item) => item !== id);
    }
    persist();
    return sample;
  }

  function setCompare(id, checked) {
    const sample = findSample(id);
    if (!sample || !(sample.stats && sample.stats.ready)) return false;
    if (checked) {
      state.compare = [id, ...state.compare.filter((item) => item !== id)].slice(0, 2);
    } else {
      state.compare = state.compare.filter((item) => item !== id);
    }
    persist();
    return true;
  }

  return {
    state,
    findSample,
    addSample,
    updateSample,
    deleteSample,
    addGrain,
    deleteGrain,
    setCompare,
    persist
  };
})();
