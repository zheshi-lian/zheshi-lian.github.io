/**
 * RW_SDK —— App 激励视频广告 SDK（H5 / 小程序演示版）
 *
 * 链路：App 触发奖励点 → SDK 请求 ADX /ssp/bid(ad_type=rewarded)
 *      → ADX 竞价返回 VAST/video 创意 → SDK 渲染播放
 *      → 用户完播 → SDK 发奖励回调 + 转化回传(/api/track/conversion) → ADX 预算扣减
 *
 * 用法（页面上放广告位容器）：
 *   <div class="rw-slot"
 *        data-base="https://calendar.dellai.xyz"
 *        data-site="dellai.xyz"
 *        data-kw="休闲游戏,激励视频,rewarded"
 *        data-reward="复活道具×1"></div>
 *   <button onclick="RW_SDK.show(document.querySelector('.rw-slot'))">看视频领奖励</button>
 *
 * 回调：RW_SDK.show(slot, { onRequest, onBid, onRender, onStart, onComplete, onSkip, onError })
 */
(function () {
  'use strict';

  function cfgFrom(slot, script) {
    var q = new URLSearchParams(location.search);
    return {
      base: slot.dataset.base || (script && script.dataset.base) || 'https://calendar.dellai.xyz',
      site: slot.dataset.site || (script && script.dataset.site) || 'dellai.xyz',
      kw: slot.dataset.kw || (script && script.dataset.kw) || '休闲游戏,激励视频,rewarded',
      chan: slot.dataset.chan || q.get('utm_source') || 'rewarded',
      reward: slot.dataset.reward || '奖励'
    };
  }

  function rid() { return Math.random().toString(36).slice(2, 10); }

  /**
   * 请求激励视频广告并渲染；完播后自动发奖 + 回传转化
   */
  function show(slotEl, hooks) {
    var h = hooks || {};
    var script = document.getElementById('rw-sdk') || document.querySelector('script[src*="rewarded_sdk"]');
    var cfg = cfgFrom(slotEl, script);
    var imp = 'rw_' + cfg.chan + '_' + rid();

    slotEl.dataset.imp = imp;
    slotEl.dataset.reward = cfg.reward;
    var req = {
      id: imp,
      site: { domain: cfg.site, keywords: cfg.kw },
      imp: [{ id: imp, bidfloor: 2.0, ext: { cat: 'gaming', ad_type: 'rewarded' } }],
      device: { geo: { country: 'CN' } }
    };
    if (h.onRequest) h.onRequest(req);

    return fetch(cfg.base + '/ssp/bid', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req)
    })
      .then(function (r) { return r.json(); })
      .then(function (ssp) {
        if (h.onBid) h.onBid(ssp);
        var bid = ssp.seatbid && ssp.seatbid[0] && ssp.seatbid[0].bid && ssp.seatbid[0].bid[0];
        if (!bid || !bid.adm) {
          slotEl.innerHTML = '<div style="padding:10px;color:#94a3b8">本次无广告填充</div>';
          if (h.onError) h.onError('NO_FILL');
          return { ok: false, reason: 'NO_FILL' };
        }
        var cid = bid.ext && bid.ext.cid;
        slotEl.dataset.cid = cid || '';
        slotEl.innerHTML = bid.adm;
        if (h.onRender) h.onRender(bid);

        // 点击归因
        if (cid) {
          fetch(cfg.base + '/ssp/click?cid=' + cid + '&imp=' + imp + '&pub=' + encodeURIComponent(cfg.site)).catch(function () {});
        }

        var video = slotEl.querySelector('video');
        if (!video) {
          if (h.onError) h.onError('NO_VIDEO');
          return { ok: false, reason: 'NO_VIDEO' };
        }

        var completed = false;

        video.addEventListener('play', function () {
          if (h.onStart) h.onStart(video);
        });

        // 完播 = 激励达成：发奖 + 回传转化
        video.addEventListener('ended', function () {
          completed = true;
          grant(cfg, cid, imp, cfg.reward);
          if (h.onComplete) h.onComplete(cfg.reward, video);
        });

        // 提前关闭/暂停视为放弃（演示里不拦截，仅标记）
        video.addEventListener('pause', function () {
          if (!completed && h.onSkip) h.onSkip(video);
        });

        // 兜底：某些浏览器 ended 不触发时，进度到 95% 即判定完播
        video.addEventListener('timeupdate', function () {
          if (!completed && video.duration && video.currentTime / video.duration >= 0.95) {
            completed = true;
            grant(cfg, cid, imp, cfg.reward);
            if (h.onComplete) h.onComplete(cfg.reward, video);
          }
        });

        return { ok: true, cid: cid, imp: imp, video: video };
      })
      .catch(function (e) {
        slotEl.innerHTML = '<div style="padding:10px;color:#b91c1c">竞价请求失败：' + (e && e.message) + '</div>';
        if (h.onError) h.onError('NETWORK');
        return { ok: false, reason: 'NETWORK' };
      });
  }

  // 发放奖励 + 记转化（conv_log 落库 → 分渠道归因 + ADX 侧结算依据）
  function grant(cfg, cid, imp, reward) {
    if (!cid) return;
    fetch(cfg.base + '/api/track/conversion', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cid: cid, publisher: cfg.site, impid: imp, reward: reward, ad_type: 'rewarded' })
    }).catch(function () {});
  }

  window.RW_SDK = { show: show, version: '0.1.0' };
})();
