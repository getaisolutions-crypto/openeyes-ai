import{c as o,r as e}from"./index-CJ6YCCb1.js";/**
 * @license lucide-react v1.63.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const l={name:"pencil",size:24,node:[["path",{d:"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",key:"1a8usu"}],["path",{d:"m15 5 4 4",key:"1mk7zo"}]]};l.node;const C=o(l);/**
 * @license lucide-react v1.63.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const u={name:"plus",size:24,node:[["path",{d:"M5 12h14",key:"1ays0h"}],["path",{d:"M12 5v14",key:"s699le"}]]};u.node;const p=o(u);function z(t){const[i,r]=e.useState([]),[d,m]=e.useState(!0),[y,c]=e.useState(null),a=e.useCallback(async()=>{try{r(await t.list()),c(null)}catch{c("Your saved items could not be loaded from this device.")}finally{m(!1)}},[t]);e.useEffect(()=>{a()},[a]);const h=e.useCallback(async s=>{const n=await t.create(s);return await a(),n},[t,a]),k=e.useCallback(async(s,n)=>{const w=await t.update(s,n);return await a(),w},[t,a]),f=e.useCallback(async s=>{await t.remove(s),await a()},[t,a]);return{items:i,loading:d,loadError:y,create:h,update:k,remove:f,refresh:a}}export{p as P,C as a,z as u};
