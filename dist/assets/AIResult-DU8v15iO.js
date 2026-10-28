import{c as t,j as e,L as d,b as l}from"./index-CUlGjYkp.js";import{u}from"./useSpeechSynthesis-CxOOtgGh.js";import{X as m}from"./x-v-TfGncy.js";import{S as p}from"./square-DviZFgoR.js";/**
 * @license lucide-react v1.63.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const o={name:"pause",size:24,node:[["rect",{x:"14",y:"3",width:"5",height:"18",rx:"1",key:"kaeet6"}],["rect",{x:"5",y:"3",width:"5",height:"18",rx:"1",key:"1wsw3u"}]]};o.node;const h=t(o);/**
 * @license lucide-react v1.63.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const i={name:"play",size:24,node:[["path",{d:"M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z",key:"10ikf1"}]]};i.node;const n=t(i);/**
 * @license lucide-react v1.63.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const r={name:"shield-alert",size:24,node:[["path",{d:"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",key:"oel41y"}],["path",{d:"M12 8v4",key:"1got3b"}],["path",{d:"M12 16h.01",key:"1drbdi"}]]};r.node;const x=t(r);function k({label:a,onCancel:s}){return e.jsxs("div",{className:"card mt-4 flex flex-wrap items-center justify-between gap-3 p-4",children:[e.jsxs("p",{role:"status",className:"flex items-center gap-2 font-bold",children:[e.jsx(d,{"aria-hidden":"true",className:"h-6 w-6 text-primary motion-safe:animate-spin"}),a]}),e.jsxs("button",{type:"button",className:"btn-secondary",onClick:s,children:[e.jsx(m,{"aria-hidden":"true",className:"h-5 w-5"})," Cancel"]})]})}function N({text:a}){const s=u(),{announce:c}=l();return s.supported?e.jsxs("div",{className:"mt-4 flex flex-wrap gap-3",children:[s.state==="speaking"?e.jsxs("button",{type:"button",className:"btn-secondary",onClick:s.pause,children:[e.jsx(h,{"aria-hidden":"true",className:"h-5 w-5"})," Pause"]}):s.state==="paused"?e.jsxs("button",{type:"button",className:"btn-secondary",onClick:s.resume,children:[e.jsx(n,{"aria-hidden":"true",className:"h-5 w-5"})," Resume"]}):e.jsxs("button",{type:"button",className:"btn-secondary",onClick:()=>{s.speak(a),c("Reading aloud.")},children:[e.jsx(n,{"aria-hidden":"true",className:"h-5 w-5"})," Read aloud"]}),e.jsxs("button",{type:"button",className:"btn-secondary",disabled:s.state==="idle",onClick:s.stop,children:[e.jsx(p,{"aria-hidden":"true",className:"h-5 w-5"})," Stop"]})]}):null}function g(){return e.jsxs("p",{className:"mt-4 flex gap-2 text-sm text-muted",children:[e.jsx(x,{"aria-hidden":"true",className:"mt-0.5 h-5 w-5 shrink-0"}),e.jsx("span",{children:"AI descriptions can be wrong and come from a single photo. Do not use them to judge traffic, steps, drop-offs or obstacles. Keep using your cane, guide dog or mobility skills."})]})}export{k as A,h as P,N as S,g as a,n as b};
