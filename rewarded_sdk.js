/**
 * RW_SDK v0.3 —— App 激励视频 SDK（VAST 4.0 + 服务端完播校验）
 *
 * 【协议】ADX 返回 VAST 4.0 XML（行业标准），不是 HTML 片段：
 *   <VAST version="4.0"><Ad><InLine>
 *     <Impression/> <Creatives><Creative><Linear>
 *       <Duration/> <TrackingEvents>(start/firstQuartile/midpoint/thirdQuartile/complete)</TrackingEvents>
 *       <MediaFiles><MediaFile delivery="progressive" type="video/mp4">
 *   SDK 解析出 MediaFile 播放，并按 TrackingEvents 回调 ADX 上报观看进度（imp.ext.protocol='html' 时可回退 HTML 创意）
 *
 * 【安全】客户端不可自证完播：上报观看证据 + 服务端签名令牌，由 ADX 裁决是否发奖。
 *
 * 回调 hooks：onRequest / onBid / onRender(bid,rw,meta) / onVastEvent(ev) / onClaim / onComplete / onRejected / onSkip / onError
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
  function ping(url) { if (url) { fetch(url).catch(function () {}); } }

  function isXml(adm) { return /^\s*(<\?xml|<VAST)/i.test(String(adm || '')); }

  /** 解析 VAST XML → { mediaUrl, tracking:{event:url}, duration } */
  function parseVast(adm) {
    var doc;
    try { doc = new DOMParser().parseFromString(adm, 'text/xml'); } catch (e) { return null; }
    if (!doc) return null;
    try { if (doc.getElementsByTagName('parsererror') && doc.getElementsByTagName('parsererror').length) return null; } catch (e) {}
    if (!doc.querySelector('Linear')) return null;
    var mf = doc.querySelector('MediaFile');
    var mediaUrl = mf ? (mf.textContent || '').trim() : '';
    var tracking = {};
    var imps = doc.getElementsByTagName('Impression');
    if (imps && imps.length) tracking.impression = (imps[0].textContent || '').trim();
    var trs = doc.getElementsByTagName('Tracking') || [];
    for (var i = 0; i < trs.length; i++) {
      var ev = trs[i].getAttribute('event');
      if (ev) tracking[ev] = (trs[i].textContent || '').trim();
    }
    var d = doc.querySelector('Duration');
    return { mediaUrl: mediaUrl, tracking: tracking, duration: d ? (d.textContent || '').trim() : '' };
  }

  /** 上报完播证据，由服务端裁决发奖 */
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
        if (cid) fetch(cfg.base + '/ssp/click?cid=' + cid + '&imp=' + imp + '&pub=' + encodeURIComponent(cfg.site)).catch(function () {});

        var video = null, tracking = {};
        var vastMeta = null;

        if (isXml(bid.adm)) {
          // ===== VAST 4.0 分支 =====
          vastMeta = parseVast(bid.adm);
          if (vastMeta && vastMeta.mediaUrl) {
            tracking = vastMeta.tracking || {};
            slotEl.innerHTML = '';
            var wrap = document.createElement('div');
            wrap.style.cssText = "width:320px;font-family:'Microsoft YaHei',sans-serif;background:#0f172a;color:#fff;border-radius:12px;padding:12px";
            var t = document.createElement('div');
            t.style.cssText = 'font-size:12px;opacity:.8';
            t.textContent = '激励视频广告 - VAST 4.0';
            var tip = document.createElement('div');
            tip.style.cssText = 'margin-top:8px;font-size:12px;color:#fbbf24';
            tip.textContent = '看完视频即可领取奖励';
            video = document.createElement('video');
            video.src = vastMeta.mediaUrl;
            video.controls = true;
            video.playsInline = true;
            video.style.cssText = 'width:100%;border-radius:8px;background:#000';
            var cap = document.createElement('div');
            cap.style.cssText = 'font-size:15px;font-weight:700;margin:6px 0';
            cap.textContent = (h.title) || '激励视频';
            wrap.appendChild(t); wrap.appendChild(cap); wrap.appendChild(video); wrap.appendChild(tip);
            slotEl.appendChild(wrap);
          }
        }
        if (!video) {
          // ===== HTML 创意回退分支 =====
          slotEl.innerHTML = bid.adm;
          video = slotEl.querySelector('video');
        }
        if (h.onRender) h.onRender(bid, rw, { admType: vastMeta ? 'vast4' : 'html', duration: vastMeta && vastMeta.duration });

        if (!video) { if (h.onError) h.onError('NO_VIDEO'); return { ok: false, reason: 'NO_VIDEO' }; }

        var fired = {};
        function fire(ev) { if (fired[ev]) return; fired[ev] = 1; ping(tracking[ev]); if (h.onVastEvent) h.onVastEvent(ev); }
        var claimed = false;
        function tryClaim() { if (claimed) return; claimed = true; claim(cfg, cid, imp, rw, video, h); }

        fire('impression');
        video.addEventListener('play', function () { fire('start'); if (h.onStart) h.onStart(video); });
        video.addEventListener('pause', function () { if (!claimed && h.onSkip) h.onSkip(video); });
        video.addEventListener('timeupdate', function () {
          if (!video.duration) return;
          var r = video.currentTime / video.duration;
          if (r >= 0.25) fire('firstQuartile');
          if (r >= 0.50) fire('midpoint');
          if (r >= 0.75) fire('thirdQuartile');
          if (r >= 0.95) tryClaim();
        });
        video.addEventListener('ended', function () { fire('complete'); tryClaim(); });

        return { ok: true, cid: cid, imp: imp, rw: rw, video: video, admType: vastMeta ? 'vast4' : 'html' };
      })
      .catch(function (e) {
        slotEl.innerHTML = '<div style="padding:10px;color:#b91c1c">竞价请求失败：' + (e && e.message) + '</div>';
        if (h.onError) h.onError('NETWORK');
        return { ok: false, reason: 'NETWORK' };
      });
  }

  window.RW_SDK = { show: show, version: '0.3.0' };
})();
