const views=[...document.querySelectorAll(".view")];
const nav=[...document.querySelectorAll("[data-nav]")];
const menu=document.getElementById("primaryNav");
const toggle=document.getElementById("menuToggle");
const dialog=document.getElementById("membershipDialog");
let map=null,resizeObserver=null,features=null;
function navigate(){
 const target=(location.hash||"#home").slice(1);
 const route=views.some(v=>v.id===target)?target:"home";
 for(const v of views)v.classList.toggle("active",v.id===route);
 for(const a of nav){const active=a.dataset.nav===route;a.classList.toggle("active",active);if(active)a.setAttribute("aria-current","page");else a.removeAttribute("aria-current");}
 menu.classList.remove("open");toggle.setAttribute("aria-expanded","false");
 document.title=(route==="home"?"The Records Speak":document.getElementById(route).querySelector("h1")?.textContent||"1776 FORGE")+" | 1776 FORGE";
 if(route==="map")requestAnimationFrame(()=>requestAnimationFrame(initMap));
 if(route==="records")loadRecords();
 window.scrollTo({top:0,behavior:"instant"});
}
function initMap(){
 if(!window.L){document.getElementById("forgeMap").textContent="Map unavailable. Check the network connection.";return;}
 if(!map){map=L.map("forgeMap",{scrollWheelZoom:false}).setView([33.0801,-83.2321],12);L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);map.zoomControl.setPosition("bottomright");resizeObserver=new ResizeObserver(()=>map.invalidateSize({pan:false}));resizeObserver.observe(document.getElementById("forgeMap"));loadFeatures();}
 requestAnimationFrame(()=>{map.invalidateSize({pan:false});setTimeout(()=>map.invalidateSize({pan:false}),250);});
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

async function loadRecords(){
 const target=document.getElementById("recordResults");if(!target)return;
 const q=document.getElementById("recordSearch").value.trim();
 try{
  const r=await fetch("/api/documents?q="+encodeURIComponent(q));if(!r.ok)throw Error();
  const data=await r.json();target.replaceChildren();
  const summary=document.createElement("p");summary.className="hint";summary.textContent=data.items.length+" results in the new archive (legacy migration pending).";target.append(summary);
  for(const d of data.items){const item=document.createElement("article");item.className="resource";const title=document.createElement("h3");title.textContent=d.title;const meta=document.createElement("span");meta.className="meta";meta.textContent=[d.document_type,d.record_date,d.jurisdiction_name].filter(Boolean).join(" · ");item.append(meta,title);if(d.source_url&&d.source_url.startsWith("https://")){const a=document.createElement("a");a.href=d.source_url;a.target="_blank";a.rel="noopener noreferrer";a.textContent="Official source ↗";item.append(a);}target.append(item);}
  if(!data.items.length){const p=document.createElement("p");p.textContent="No records found in the new database yet.";target.append(p);}
 }catch{target.textContent="Independent D1 archive not connected. The original archive remains untouched.";}
}
let searchTimeout;document.getElementById("recordSearch").addEventListener("input",()=>{clearTimeout(searchTimeout);searchTimeout=setTimeout(loadRecords,250);});
async function loadFeatures(){
 try{
  const r=await fetch("/api/map/features");if(!r.ok)return;const data=await r.json();
  const raw=(data.items||[]).map(x=>({type:"Feature",geometry:JSON.parse(x.geometry_geojson),properties:x}));
  const selected=new Set(["road","project","report"]);
  const colors={green:"#27844b",yellow:"#e5aa34",red:"#bc4040",gray:"#718096"};
  function draw(){if(features)map.removeLayer(features);features=L.geoJSON(raw.filter(f=>selected.has(f.properties.kind)),{style:f=>({color:colors[f.properties.condition_state]||"#c8a46c",weight:5}),onEachFeature:(f,layer)=>{const node=document.createElement("strong");node.textContent=f.properties.title;layer.bindPopup(node);}}).addTo(map);}
  for(const [id,kind] of [["roadsToggle","road"],["projectsToggle","project"],["reportsToggle","report"]]){const el=document.getElementById(id);el.disabled=false;el.checked=true;el.onchange=()=>{el.checked?selected.add(kind):selected.delete(kind);draw();};}
  draw();
 }catch{/* Map base layer remains available when D1 is not connected. */}
}
