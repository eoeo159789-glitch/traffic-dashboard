(function(){
  'use strict';
  function fire(sel){ sel.dispatchEvent(new Event('change', { bubbles: true })); }
  function short(t){ return (t || '').replace(/[（(].*$/, '').trim() || t; }

  // 1. 快速篩選晶片：依對應下拉選單的選項自動產生，選單內容或狀態變動時同步
  var boxes = [];
  document.querySelectorAll('.qchips').forEach(function(box){
    var sel = document.getElementById(box.getAttribute('data-for'));
    var row = box.querySelector('.qchips-row');
    if(!sel || !row){ box.hidden = true; return; }
    function sync(){
      row.querySelectorAll('.qchip').forEach(function(b){
        b.setAttribute('aria-pressed', b.getAttribute('data-value') === sel.value ? 'true' : 'false');
        b.disabled = sel.disabled;
      });
    }
    function build(){
      row.textContent = '';
      Array.prototype.forEach.call(sel.options, function(o){
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'qchip';
        b.textContent = short(o.text); b.title = o.text;
        b.setAttribute('data-value', o.value);
        b.addEventListener('click', function(){
          if(sel.disabled || sel.value === o.value) return;
          sel.value = o.value; fire(sel); sync();
        });
        row.appendChild(b);
      });
      box.hidden = sel.options.length < 2;
      sync();
    }
    build();
    sel.addEventListener('change', sync);
    new MutationObserver(build).observe(sel, { childList: true });
    new MutationObserver(sync).observe(sel, { attributes: true, attributeFilter: ['disabled'] });
    boxes.push(sync);
  });
  // 其他程式直接改選單值（未觸發 change）時，於下一次點擊後同步
  document.addEventListener('click', function(){ setTimeout(function(){ boxes.forEach(function(f){ f(); }); }, 0); });

  // 2. 跳到被「領域篩選」隱藏的區塊時，自動恢復顯示全部領域
  document.addEventListener('click', function(e){
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if(!a) return;
    var id = decodeURIComponent(a.getAttribute('href').slice(1));
    var el = id && document.getElementById(id);
    if(!el) return;
    if(el.closest('[hidden]')){
      var df = document.getElementById('domainFilter');
      if(df && df.value !== 'all'){ df.value = 'all'; fire(df); }
    }
  }, true);

  // 3. 長表格：限制高度並固定表頭
  document.querySelectorAll('.table-scroll').forEach(function(w){
    if(w.querySelector('table.domain-table')) w.classList.add('tall');
  });

  // 4. 側邊導覽：捲動時標示目前位置
  var links = Array.prototype.slice.call(document.querySelectorAll('#sidenav .sn-list a[href^="#"]'));
  var targets = links.map(function(a){ return { a: a, el: document.getElementById(a.getAttribute('href').slice(1)) }; })
                     .filter(function(t){ return t.el; });
  var nav = document.getElementById('sidenav');
  var toTop = document.querySelector('.to-top');
  var ticking = false, lastActive = null;
  function update(){
    ticking = false;
    var y = 90, best = null;
    targets.forEach(function(t){
      if(t.el.closest('[hidden]')) return;
      var top = t.el.getBoundingClientRect().top;
      if(top - y <= 0 && (!best || top >= best.top)) best = { t: t, top: top };
    });
    var active = best ? best.t.a : null;
    if(active !== lastActive){
      links.forEach(function(a){ a.classList.remove('is-active'); a.removeAttribute('aria-current'); });
      if(active){
        active.classList.add('is-active'); active.setAttribute('aria-current', 'true');
        var parentLi = active.closest('.sn-sub') && active.closest('.sn-sub').parentElement;
        var main = parentLi && parentLi.querySelector('.sn-main');
        if(main) main.classList.add('is-active');
        // 行動版：讓目前項目捲入可視範圍
        var mainLink = main || active;
        if(nav && getComputedStyle(nav).position === 'sticky' && window.innerWidth <= 1060){
          var list = nav.querySelector('.sn-list');
          if(list) list.scrollTo({ left: mainLink.offsetLeft - 16, behavior: 'smooth' });
        } else if(nav){
          var r = active.getBoundingClientRect(), nr = nav.getBoundingClientRect();
          if(r.top < nr.top + 60 || r.bottom > nr.bottom - 20) nav.scrollTop += (r.top - nr.top) - nav.clientHeight / 2;
        }
      }
      lastActive = active;
    }
    if(toTop) toTop.classList.toggle('show', window.scrollY > 700);
  }
  window.addEventListener('scroll', function(){ if(!ticking){ ticking = true; requestAnimationFrame(update); } }, { passive: true });
  window.addEventListener('resize', update);
  update();
})();
