/**
 * RW_SDK v0.2 —— App 激励视频 SDK（服务端完播校验版）
 *
 * 【核心安全模型】客户端不可自证完播
 *   1. ADX 竞价胜出时下发「一次性签名令牌」rw(HMAC-SHA256)，绑定 impid + cid + publisher + 时间戳
 *   2. 用户看完视频，SDK 只上报「观看证据」（watchedMs / durationMs）+ 令牌
 *   3. 是否发放奖励由 ADX 服务端裁决：
 *      令牌签名 → 是否过期 → 是否被兑换过(防重放) → 观看比例是否达标 → 是否对应真实曝光
 *   4. 客户端伪造调用会被拒绝，并记入 reward_log 审计表（status=REJECT_*）
 *
 * 用法：
 *   <div class="rw-slot" data-base="https://calendar.dellai.xyz" data-site="dellai.xyz"
 *        data-kw="休闲游戏,激励视频,rewarded" data-reward="复活道具×1"></div>
 *   RW_SDK.show(slot, { onRequest, onBid, onRender, onClaim, onComplete, onRejected, onSkip, onError })
 */
(function () {
  'use strict';

  function rid() { return Math.random().toString(36).slice(2, 10); }

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

  function post(url, body) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  /** 向 ADX 服务端上报完播证据，由服务端裁决是否发奖 */
  function claim(cfg, cid, imp, rw, video, h) {
    var watchedMs = Math.round((video.currentTime || 0) * 1000);
    var durationMs = Math.round((video.duration || 0) * 1000);
    if (h.onClaim) h.onClaim({ watchedMs: watchedMs, durationMs: durationMs });
    return post(cfg.base + '/ssp/reward', {
      impid: imp, cid: cid, publisher: cfg.site, rw: rw, watchedMs: watchedMs, durationMs: durationMs
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.ok) { if (h.onComplete) h.onComplete(cfg.reward, res); return res; }
        if (h.onRejected) h.onRejected((res && res.why) || 'UNKNOWN', res);
        return res;
      })
      .catch(function () { if (h.onError) h.onError('REWARD_NETWORK'); });
  }

  /** 请求激励视频广告 → 渲染 → 完播上报（奖励由服务端决定） */
  function show(slotEl, hooks) {
    var h = hooks || {};
    var script = document.querySelector('script[src*="rewarded_sdk"]');
    var cfg = cfgFrom(slotEl, script);
    var imp = 'rw_' + cfg.chan + '_' + rid();
    slotEl.dataset.imp = imp;

    var req = {
      id: imp,
      site: { domain: cfg.site, keywords: cfg.kw },
      imp: [{ id: imp, bidfloor: 2.0, ext: { cat: 'gaming', ad_type: 'rewarded', reward: cfg.reward } }],
      device: { geo: { country: 'CN' } }
    };
    if (h.onRequest) h.onRequest(req);

    return post(cfg.base + '/ssp/bid', req)
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
        var rw = bid.ext && bid.ext.rw; // ★ 服务端签名令牌
        slotEl.dataset.cid = cid || '';
        slotEl.innerHTML = bid.adm;
        if (h.onRender) h.onRender(bid, rw);
        if (cid) { fetch(cfg.base + '/ssp/click?cid=' + cid + '&imp=' + imp + '&pub=' + encodeURIComponent(cfg.site)).catch(function () {}); }

        var video = slotEl.querySelector('video');
        if (!video) { if (h.onError) h.onError('NO_VIDEO'); return { ok: false, reason: 'NO_VIDEO' }; }

        var claimed = false;
        function tryClaim() { if (claimed) return; claimed = true; claim(cfg, cid, imp, rw, video, h); }

        video.addEventListener('play', function () { if (h.onStart) h.onStart(video); });
        video.addEventListener('ended', tryClaim);
        video.addEventListener('pause', function () { if (!claimed && h.onSkip) h.onSkip(video); });
        video.addEventListener('timeupdate', function () {
          if (!claimed && video.duration && video.currentTime / video.duration >= 0.95) tryClaim();
        });
        return { ok: true, cid: cid, imp: imp, rw: rw, video: video };
      })
      .catch(function (e) {
        slotEl.innerHTML = '<div style="padding:10px;color:#b91c1c">竞价请求失败：' + (e && e.message) + '</div>';
        if (h.onError) h.onError('NETWORK');
        return { ok: false, reason: 'NETWORK' };
      });
  }

  window.RW_SDK = { show: show, version: '0.2.0' };
})();
