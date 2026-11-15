const resources = [
  { id:"archives", name:"National Archives", category:"Federal", topic:"Founding documents", summary:"Official historical records and original founding documents.", url:"https://www.archives.gov/founding-docs" },
  { id:"constitution", name:"Constitution Annotated", category:"Federal", topic:"Constitutional law", summary:"Congressional Research Service explanations and Supreme Court interpretations.", url:"https://constitution.congress.gov/" },
  { id:"congress", name:"Congress.gov", category:"Federal", topic:"Legislation", summary:"Federal bills, resolutions, members, and legislative actions.", url:"https://www.congress.gov/" },
  { id:"govinfo", name:"GovInfo", category:"Federal", topic:"Official publications", summary:"Official federal legal and government publications.", url:"https://www.govinfo.gov/" },
  { id:"scotus", name:"U.S. Supreme Court Opinions", category:"Federal", topic:"Judicial decisions", summary:"Published opinions issued by the Supreme Court of the United States.", url:"https://www.supremecourt.gov/opinions/opinions.aspx" },
  { id:"galegis", name:"Georgia General Assembly", category:"State", topic:"State legislation", summary:"Bills, members, session materials, and legislative activity in Georgia.", url:"https://www.legis.ga.gov/" },
  { id:"gaopen", name:"Georgia Open Government Law", category:"State", topic:"Public access", summary:"Georgia Attorney General resources on open records and open meetings laws.", url:"https://law.georgia.gov/key-issues/open-government/law" }
];
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
export default {async fetch(request,env){
 const u=new URL(request.url);
 if(u.pathname==="/api/health")return json({ok:true,databaseConfigured:!!env.DB});
 if(u.pathname==="/api/resources"&&request.method==="GET"){
  if(!env.DB)return json({items:resources,source:"starter",databaseConfigured:false});
  try{const q=await env.DB.prepare("SELECT id,name,description AS summary,url,category AS topic FROM resource_links WHERE status!='disabled' ORDER BY name LIMIT 250").all();const items=q.results.map(x=>({...x,category:resources.find(r=>r.id===x.id)?.category||"Other"}));return json({items:items.length?items:resources,source:items.length?"D1":"starter",databaseConfigured:true});}catch{return json({items:resources,source:"fallback",databaseConfigured:true});}
 }
 if(u.pathname==="/api/documents"&&request.method==="GET"){
  if(!env.DB)return json({error:"New D1 database not configured"},503);
  try{const q=String(u.searchParams.get("q")||"").slice(0,120);let sql="SELECT d.id,d.title,d.document_type,d.record_date,d.source_url,j.name AS jurisdiction_name FROM documents d LEFT JOIN jurisdictions j ON j.id=d.jurisdiction_id WHERE d.visibility='public'";const stmt=q?env.DB.prepare(sql+" AND (d.title LIKE ? OR d.document_type LIKE ? OR j.name LIKE ?) ORDER BY d.record_date DESC LIMIT 50").bind("%"+q+"%","%"+q+"%","%"+q+"%"):env.DB.prepare(sql+" ORDER BY d.record_date DESC LIMIT 50");const data=await stmt.all();return json({items:data.results});}catch{return json({error:"Archive query failed"},500);}
 }
 if(u.pathname==="/api/map/features"&&request.method==="GET"){
  if(!env.DB)return json({error:"New D1 database not configured"},503);
  try{const data=await env.DB.prepare("SELECT id,kind,title,geometry_geojson,condition_state,status FROM map_features LIMIT 500").all();return json({items:data.results});}catch{return json({error:"Map query failed"},500);}
 }
 if(u.pathname.startsWith("/api/"))return json({error:"Write operations unavailable until authenticated and moderated"},501);
 return env.ASSETS.fetch(request);
}};
