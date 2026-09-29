/**
 * PUB_SDK —— 媒体端广告位 SDK（SSP/ADX 供给方）
 * 媒体站长一行引入即可让网页自动出现广告位，并向你的 bidder 请求竞价。
 *
 * 用法（媒体网页）：
 *   <script
 *     src="https://cdn.jsdelivr.net/gh/zheshi-lian/你的仓库/pub_sdk.js"
 *     data-base="https://你的bidder地址"
 *     data-site="媒体域名"
 *     data-kw="页面关键词"
 *     data-chan="xhs"></script>
 *   <div class="ad-slot" data-floor="2.0" data-cat="social">广告位</div>
 *
 * 配置（script 标签 data-*）：
 *   data-base   bidder 公网地址（必填）
 *   data-site   媒体域名（归因用）
 *   data-kw     页面关键词（匹配 campaign intent_tags）
 *   data-chan   渠道标签 xhs/zhihu/xianyu/direct；不填则自动读 ?utm_source=
 */
(function () {
  'use strict';
  var SCRIPT = document.currentScript;
  var CFG = {
    base: (SCRIPT && SCRIPT.dataset.base) || new URLSearchParams(location.search).get('tunnel') || location.origin,
    site: (SCRIPT && SCRIPT.dataset.site) || location.hostname,
    kw: (SCRIPT && SCRIPT.dataset.kw) || '',
    chanOverride: (SCRIPT && SCRIPT.dataset.chan) || null
  };

  var CHAN_MAP = { xhs: 'xhs', xiaohongshu: 'xhs', zhihu: 'zhihu', xianyu: 'xianyu', direct: 'direct' };
  function getChan() {
    if (CFG.chanOverride) return CFG.chanOverride;
    var raw = new URLSearchParams(location.search).get('utm_source') || 'direct';
    return CHAN_MAP[raw.toLowerCase()] || 'direct';
  }
  function rand() { return Math.random().toString(36).slice(2, 10); }

  // 媒体可用的全局 API（如转化回传）
  window.PUB_SDK = {
    config: CFG,
    trackConversion: function (cid, impid, extra) {
      var body = Object.assign({ cid: cid, publisher: CFG.site, impid: impid }, extra || {});
      return fetch(CFG.base + '/api/track/conversion', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      }).catch(function () {});
    }
  };

  function fillSlot(slotEl) {
    var slotId = slotEl.id || ('slot_' + rand());
    slotEl.id = slotId;
    var chan = getChan();
    var imp = chan + '_' + rand();
    var ctx = {
      id: imp,
      site: { domain: CFG.site, keywords: CFG.kw },
      imp: [{ id: imp, bidfloor: parseFloat(slotEl.dataset.floor || '2.0'), ext: { cat: slotEl.dataset.cat || 'social' } }],
      device: { geo: { country: 'CN' } }
    };
    fetch(CFG.base + '/ssp/bid', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ctx)
    })
      .then(function (r) { return r.json(); })
      .then(function (ssp) {
        var bid = ssp.seatbid && ssp.seatbid[0] && ssp.seatbid[0].bid && ssp.seatbid[0].bid[0];
        if (bid && bid.adm) {
          var cid = bid.ext && bid.ext.cid;
          slotEl.innerHTML = bid.adm;
          slotEl.dataset.cid = cid || '';
          slotEl.dataset.imp = imp;
          slotEl.onclick = function () {
            if (cid) fetch(CFG.base + '/ssp/click?cid=' + cid + '&imp=' + imp + '&pub=' + encodeURIComponent(CFG.site)).catch(function () {});
          };
        } else if (slotEl.dataset.fallback) {
          slotEl.innerHTML = slotEl.dataset.fallback;
        }
      })
      .catch(function () {
        if (slotEl.dataset.fallback) slotEl.innerHTML = slotEl.dataset.fallback;
      });
  }

  function init() {
    var slots = document.querySelectorAll('.ad-slot');
    for (var i = 0; i < slots.length; i++) fillSlot(slots[i]);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
