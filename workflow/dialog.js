/* Shared dialogs: confirmations, long operations and final receipts. */
(() => {
  let dlg;
  function ensure(){
    if(dlg)return dlg;
    dlg=document.createElement('dialog');dlg.className='av-dialog';dlg.setAttribute('aria-labelledby','av-dialog-title');
    dlg.innerHTML='<div class="av-dialog-body"><div class="av-dialog-spinner" hidden aria-hidden="true"></div><h2 id="av-dialog-title"></h2><p class="av-dialog-text"></p><div class="av-dialog-actions"></div></div>';
    document.body.append(dlg);dlg.addEventListener('cancel',e=>{if(dlg.dataset.locked==='true')e.preventDefault();});
    dlg.addEventListener('click',e=>{if(e.target===dlg&&dlg.dataset.locked==='true')e.preventDefault();});
    return dlg;
  }
  function render(title,body,buttons,locked=false){
    const d=ensure();d.dataset.locked=String(locked);d.querySelector('h2').textContent=title;
    d.querySelector('.av-dialog-text').textContent=body;
    d.querySelector('.av-dialog-spinner').hidden=!locked;
    const area=d.querySelector('.av-dialog-actions');area.replaceChildren();
    buttons.forEach(({label,action,primary})=>{const b=document.createElement('button');b.type='button';b.className=primary?'av-dialog-primary':'av-dialog-secondary';b.textContent=label;b.addEventListener('click',action);area.append(b);});
    if(!d.open)d.showModal();return d;
  }
  window.AvaliaDialog={
    confirm(title,body,ok='Continuar',cancel='Voltar'){
      return new Promise(resolve=>{
        const done=v=>{ensure().close();resolve(v);};
        const d=render(title,body,[{label:cancel,action:()=>done(false)},{label:ok,primary:true,action:()=>done(true)}]);
        const esc=()=>{d.removeEventListener('close',esc);resolve(false);};d.addEventListener('close',esc,{once:true});
      });
    },
    progress(title,body){render(title,body,[],true);},
    update(body){const d=ensure();if(d.open)d.querySelector('.av-dialog-text').textContent=body;},
    result(title,body,success=true){render(title,body,[{label:'OK',primary:true,action:()=>ensure().close()}]);ensure().querySelector('.av-dialog-spinner').hidden=true;},
    close(){if(dlg?.open)dlg.close();}
  };
})();
