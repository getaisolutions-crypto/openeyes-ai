import{c as n,C as m,l as x,j as e}from"./index-CoXPpbp9.js";/**
 * @license lucide-react v1.63.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const r={name:"info",size:24,node:[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 16v-4",key:"1dtifu"}],["path",{d:"M12 8h.01",key:"e9boi3"}]]};r.node;const h=n(r);/**
 * @license lucide-react v1.63.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const s={name:"triangle-alert",size:24,node:[["path",{d:"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",key:"wmoenq"}],["path",{d:"M12 9v4",key:"juzpu7"}],["path",{d:"M12 17h.01",key:"p32p05"}]],aliases:["alert-triangle"]};s.node;const p=n(s),g={info:{box:"border-primary/50 bg-primary/10",icon:h,label:"Note"},warning:{box:"border-warning/60 bg-warning/10",icon:p,label:"Not available yet"},error:{box:"border-danger/60 bg-danger/10",icon:x,label:"Error"},success:{box:"border-success/60 bg-success/10",icon:m,label:"Done"}};function f({variant:o="info",title:i,children:c,role:l,action:a}){const{box:t,icon:d,label:b}=g[o];return e.jsx("div",{role:l,className:`rounded-2xl border p-4 animate-fade-up ${t}`,children:e.jsxs("div",{className:"flex gap-3",children:[e.jsx(d,{"aria-hidden":"true",className:"mt-0.5 h-6 w-6 shrink-0"}),e.jsxs("div",{className:"min-w-0 flex-1",children:[e.jsx("p",{className:"font-bold",children:i??b}),e.jsx("div",{className:"mt-1 text-ink/90",children:c}),a&&e.jsx("div",{className:"mt-3",children:a})]})]})})}export{f as N};
