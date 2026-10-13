(function(){
function boot(){
  try{
    (window.workbuddyDesktop && window.workbuddyDesktop.getBranding
      ? window.workbuddyDesktop.getBranding().then(function(data){return {data:data}})
      : fetch('/api/panel/branding').then(function(r){return r.ok?r.json():null})).then(function(env){
      var b=env&&env.data;if(!b)return;
      var title=b.title||null,logo=b.logo||null;
      if(!title&&!logo)return;
      if(logo){
        var link=document.querySelector('link[rel*="icon"]')||document.createElement('link');
        link.rel='icon';link.href=logo;document.head.appendChild(link);
      }
      var tries=0;
      var tick=setInterval(function(){
        tries++;var pending=false;
        if(title){
          if(window.__aibuddyTitleBase)window.__aibuddyTitleBase.brand=title;
          document.title=title;
          document.querySelector('title').removeAttribute('data-i18n');
          var bh=document.querySelector('.brand-text h1');
          if(bh){bh.removeAttribute('data-i18n');bh.textContent=title}else{pending=true}
          var crumb=document.querySelector('.crumb > span');
          if(crumb&&crumb.nextElementSibling&&crumb.nextElementSibling.classList&&crumb.nextElementSibling.classList.contains('sep')){crumb.textContent=title}
          var lh=document.querySelector('#login-app h1');
          if(lh){lh.hidden=false;lh.textContent=title;var horizontal=document.querySelector('#login-app img[src="brand/logo-horizontal.svg"]');if(horizontal)horizontal.hidden=true;}else if(document.getElementById('login-app')){pending=true}
        }
        if(logo){
          var slots=document.querySelectorAll('.brand-logo');
          if(slots.length){
            slots.forEach(function(el){
              if(el.getAttribute('data-brand-applied'))return;
              el.setAttribute('data-brand-applied','1');
              el.textContent='';
              var img=document.createElement('img');
              img.src=logo;img.alt='logo';
              img.style.cssText='width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block';
              el.appendChild(img);
            });
          }else{pending=true}
          var lsvg=document.querySelector('#login-app svg[role="img"], #login-app img[src="brand/logo-horizontal.svg"]');
          if(lsvg){
            var img=document.createElement('img');
            img.src=logo;img.alt='';
            img.style.cssText='width:52px;height:52px;border-radius:12px;display:block;box-shadow:0 6px 18px rgba(0,0,0,0.35)';
            lsvg.replaceWith(img);
          }else if(document.getElementById('login-app')){pending=true}
        }
        if(!pending||tries>20){clearInterval(tick)}
      },200);
    }).catch(function(){});
  }catch(e){}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
