const a=new Intl.DateTimeFormat(void 0,{dateStyle:"medium",timeStyle:"short"});function m(e){const t=new Date(e);return Number.isNaN(t.getTime())?"":a.format(t)}export{m as f};
