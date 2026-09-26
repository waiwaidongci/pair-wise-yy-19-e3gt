"use strict";

/*
 * 本地保存层
 * 只负责 localStorage 的读写与数据迁移，不含业务判断与页面逻辑。
 */
const Store = (() => {
  const STORAGE_KEY = "wxyy-2-thin-section-index";

  function migrateSample(sample) {
    // 旧版本样本没有粒度数据，补齐空结构
    if (!Array.isArray(sample.grains)) sample.grains = [];
    if (!Array.isArray(sample.statsHistory)) sample.statsHistory = [];

    // 规则双保险：越界粒径（<0.01 或 >10 mm）属于不予保存的数据
    sample.grains = sample.grains.filter((grain) => {
      const d = Number(grain && grain.diameter);
      return Number.isFinite(d) &&
        d >= GrainRules.MIN_DIAMETER &&
        d <= GrainRules.MAX_DIAMETER;
    });
    return sample;
  }

  function load() {
    let parsed = {};
    try {
      parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
      parsed = {};
    }
    const state = {
      samples: Array.isArray(parsed.samples) ? parsed.samples : [],
      compare: Array.isArray(parsed.compare) ? parsed.compare : []
    };
    state.samples.forEach(migrateSample);
    return state;
  }

  function save(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      samples: state.samples,
      compare: state.compare
    }));
  }

  return { STORAGE_KEY, load, save };
})();
