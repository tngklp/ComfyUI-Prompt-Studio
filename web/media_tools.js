export function createLazyMediaTool(root, load, notify) {
  let instance=null, pending=null, epoch=0;
  return {
    async open(...args) {
      if(pending)return;
      const current=++epoch;
      try {
        if(!instance){
          const children=new Set(root.children);
          pending=Promise.resolve().then(load).catch(error=>{
            for(const child of [...root.children])if(!children.has(child))child.remove();
            throw error;
          });
          instance=await pending;
        }
        if(current===epoch)await instance.open(...args);
      } catch(error) {
        try{instance?.close(true);}catch{}
        const modal=root.querySelector('.ps-modal');
        if(modal){modal.inert=false;if(root.classList.contains('is-open'))modal.setAttribute('aria-modal','true');}
        notify(error.message||String(error));
      } finally {pending=null;}
    },
    close(){epoch++;try{return instance?.close();}catch(error){notify(error.message);return false;}},
  };
}
