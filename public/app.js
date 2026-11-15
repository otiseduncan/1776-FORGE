const views=[...document.querySelectorAll(".view")];
const nav=[...document.querySelectorAll("[data-nav]")];
const menu=document.getElementById("primaryNav");
const toggle=document.getElementById("menuToggle");
const dialog=document.getElementById("membershipDialog");
let map=null;
function navigate(){
 const target=(location.hash||"#home").slice(1);
 const route=views.some(v=>v.id===target)?target:"home";
 for(const v of views)v.classList.toggle("active",v.id===route);
 for(const a of nav){const active=a.dataset.nav===route;a.classList.toggle("active",active);if(active)a.setAttribute("aria-current","page");else a.removeAttribute("aria-current");}
 menu.classList.remove("open");toggle.setAttribute("aria-expanded","false");
 document.title=(route==="home"?"The Records Speak":document.getElementById(route).querySelector("h1")?.textContent||"1776 FORGE")+" | 1776 FORGE";
 if(route==="map")setTimeout(initMap,0);
 window.scrollTo({top:0,behavior:"instant"});
}
function initMap(){
 if(!window.L){document.getElementById("forgeMap").textContent="Map unavailable. Check the network connection.";return;}
 if(!map){map=L.map("forgeMap",{scrollWheelZoom:false}).setView([33.0801,-83.2321],12);L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);map.zoomControl.setPosition("bottomright");}
 map.invalidateSize();
}
toggle.addEventListener("click",()=>{const open=menu.classList.toggle("open");toggle.setAttribute("aria-expanded",String(open));});
for(const id of ["joinBtn","forumJoin"])document.getElementById(id).addEventListener("click",()=>dialog.showModal());
document.getElementById("year").textContent=new Date().getFullYear();
window.addEventListener("hashchange",navigate);navigate();
let level="All",query="",resources=[];
const container=document.getElementById("resourceResults");
function renderResources(){
 const matches=resources.filter(r=>(level==="All"||r.category===level)&&[r.name,r.summary,r.topic].join(" ").toLowerCase().includes(query));
 container.replaceChildren();
 if(!matches.length){const p=document.createElement("p");p.textContent="No matching curated resources yet.";container.append(p);return;}
 for(const r of matches){
  const card=document.createElement("article");card.className="resource";
  const meta=document.createElement("span");meta.className="meta";meta.textContent=r.category+" · "+r.topic;
  const title=document.createElement("h3");title.textContent=r.name;
  const desc=document.createElement("p");desc.textContent=r.summary;
  const link=document.createElement("a");link.href=r.url;link.target="_blank";link.rel="noopener noreferrer";link.textContent="Visit official source ↗";
  card.append(meta,title,desc,link);container.append(card);
 }
}
document.getElementById("resourceSearch").addEventListener("input",e=>{query=e.target.value.toLowerCase().trim();renderResources();});
for(const filter of document.querySelectorAll(".filter"))filter.addEventListener("click",()=>{level=filter.dataset.level;for(const f of document.querySelectorAll(".filter"))f.classList.toggle("selected",f===filter);renderResources();});
fetch("/api/resources").then(r=>{if(!r.ok)throw new Error("Resources unavailable");return r.json();}).then(data=>{resources=data.items||[];renderResources();}).catch(()=>{container.textContent="Resource directory is temporarily unavailable.";});
