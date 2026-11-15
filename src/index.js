const resources = [
  { id:"archives", name:"National Archives", category:"Federal", topic:"Founding documents", summary:"Official historical records and original founding documents.", url:"https://www.archives.gov/founding-docs" },
  { id:"constitution", name:"Constitution Annotated", category:"Federal", topic:"Constitutional law", summary:"Congressional Research Service explanations and Supreme Court interpretations.", url:"https://constitution.congress.gov/" },
  { id:"congress", name:"Congress.gov", category:"Federal", topic:"Legislation", summary:"Federal bills, resolutions, members, and legislative actions.", url:"https://www.congress.gov/" },
  { id:"govinfo", name:"GovInfo", category:"Federal", topic:"Official publications", summary:"Official federal legal and government publications.", url:"https://www.govinfo.gov/" },
  { id:"scotus", name:"U.S. Supreme Court Opinions", category:"Federal", topic:"Judicial decisions", summary:"Published opinions issued by the Supreme Court of the United States.", url:"https://www.supremecourt.gov/opinions/opinions.aspx" },
  { id:"galegis", name:"Georgia General Assembly", category:"State", topic:"State legislation", summary:"Bills, members, session materials, and legislative activity in Georgia.", url:"https://www.legis.ga.gov/" },
  { id:"gaopen", name:"Georgia Open Government Law", category:"State", topic:"Public access", summary:"Georgia Attorney General resources on open records and open meetings laws.", url:"https://law.georgia.gov/key-issues/open-government/law" }
];
const json = (data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}});
export default {
 async fetch(request,env) {
  const url=new URL(request.url);
  if(url.pathname==="/api/health") return json({ok:true,app:"1776 FORGE",databaseConfigured:!!env.DB});
  if(url.pathname==="/api/resources" && request.method==="GET") return json({items:resources,source:"curated starter list",databaseConfigured:!!env.DB});
  if(url.pathname.startsWith("/api/")) return json({error:"Endpoint not implemented. Sign-in, community writing, and record imports are not enabled yet."},501);
  return env.ASSETS.fetch(request);
 }
};
