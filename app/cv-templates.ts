import type {Profile} from './profile';

// The CV as a printable page, built in the browser from the owner's saved details. Nothing is fetched and no script runs in the page; "Download PDF" is the browser printing it to a file, so the CV never leaves the owner's computer.
export type TemplateId='classic'|'sidebar'|'band'|'compact';
export const templates:{id:TemplateId;name:string;about:string;photo:boolean}[]=[
  {id:'classic',name:'Classic',about:'One column, plain headings. The safest choice for automated CV scanners.',photo:false},
  {id:'sidebar',name:'Sidebar',about:'Coloured side column for contact, skills and languages; experience in the main column.',photo:true},
  {id:'band',name:'Header band',about:'A coloured band with your name and photo on top, one column below.',photo:true},
  {id:'compact',name:'Compact',about:'Small type and two columns of skills, to fit one page.',photo:false},
];
export const accents=['#1f4e79','#0f766e','#7c3aed','#b4232a','#374151'];
const esc=(value:string)=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const safeColour=(value:string)=>/^#[0-9a-fA-F]{6}$/.test(value)?value:accents[0];
// Only a picture the page itself loaded is embedded; anything else is left out.
const safePhoto=(value:string)=>/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(value)?value:'';
const span=(start:string,end:string)=>[start,end].filter(Boolean).map(esc).join(' – ');
const linkText=(value:string)=>esc(value.replace(/^https?:\/\/(www\.)?/,'').replace(/\/$/,''));
// A section moves to the next page as a whole when it does not fit. A list of entries may run over pages, but never splits an entry and never leaves its heading behind alone.
const section=(title:string,body:string)=>body?'<section class="whole"><h2>'+esc(title)+'</h2>'+body+'</section>':'';
const entries=(title:string,items:string[])=>items.length?'<section><div class="whole"><h2>'+esc(title)+'</h2>'+items[0]+'</div>'+items.slice(1).join('')+'</section>':'';
// The body sits in a one-cell table whose header and footer rows are empty spacers: the browser repeats them on every printed page, which gives each page a top and bottom margin while a coloured band or column can still reach the paper's edge.
const flow=(body:string)=>'<table class="flow"><thead><tr><td><div class="gap"></div></td></tr></thead><tfoot><tr><td><div class="gap"></div></td></tr></tfoot><tbody><tr><td>'+body+'</td></tr></tbody></table>';
function parts(p:Profile){
  const contact=[p.email,p.phone,p.location].filter(Boolean).map(esc),links=p.links.filter(Boolean).map(linkText);
  return {
    contact,links,
    about:p.about?p.about.split(/\n{2,}/).map(t=>'<p>'+esc(t).replace(/\n/g,'<br>')+'</p>').join(''):'',
    skills:p.skills.length?'<ul class="tags">'+p.skills.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul>':'',
    languages:p.languages.length?'<ul class="plain">'+p.languages.map(l=>'<li><strong>'+esc(l.name)+'</strong>'+(l.level?' · '+esc(l.level):'')+'</li>').join('')+'</ul>':'',
    experience:p.experience.map(x=>'<article><header><div><h3>'+esc(x.title)+'</h3><p class="where">'+[x.employer,x.location].filter(Boolean).map(esc).join(' · ')+'</p></div><time>'+span(x.start,x.end)+'</time></header>'+(x.points.length?'<ul>'+x.points.map(t=>'<li>'+esc(t)+'</li>').join('')+'</ul>':'')+'</article>'),
    education:p.education.map(x=>'<article><header><div><h3>'+esc(x.degree)+'</h3><p class="where">'+esc(x.school)+'</p></div><time>'+span(x.start,x.end)+'</time></header>'+(x.notes?'<p>'+esc(x.notes).replace(/\n/g,'<br>')+'</p>':'')+'</article>'),
    certificates:p.certificates.length?'<ul>'+p.certificates.map(c=>'<li>'+esc(c)+'</li>').join('')+'</ul>':'',
  };
}
const base=(accent:string)=>`@page{size:A4;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0}body{font-family:"Segoe UI",Calibri,Arial,Helvetica,sans-serif;color:#1f2933;font-size:10.5pt;line-height:1.42;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:210mm;min-height:297mm;margin:0 auto;background:#fff}h1{margin:0;font-size:24pt;line-height:1.1;letter-spacing:.01em}h2{margin:0 0 6pt;font-size:10pt;letter-spacing:.12em;text-transform:uppercase;color:${accent}}h3{margin:0;font-size:11pt}
p{margin:0 0 5pt;orphans:3;widows:3}ul{margin:3pt 0 0;padding-left:14pt}li{margin-bottom:2pt;break-inside:avoid}section{margin-bottom:13pt}article{margin-bottom:9pt;break-inside:avoid;page-break-inside:avoid}.whole{break-inside:avoid;page-break-inside:avoid}h2,h3{break-after:avoid;page-break-after:avoid}
table.flow{width:100%;border-collapse:collapse;border-spacing:0}table.flow td{padding:0;vertical-align:top}.gap{height:13mm}article header{display:flex;justify-content:space-between;gap:12pt;align-items:baseline}
time{white-space:nowrap;font-size:9pt;color:#52606d}.where{margin:0;color:#52606d;font-size:9.5pt}.headline{margin:3pt 0 0;font-size:12pt;color:#3e4c59}.contact{margin:6pt 0 0;font-size:9.5pt;color:#3e4c59}
ul.plain{list-style:none;padding:0}ul.tags{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:4pt}ul.tags li{margin:0;padding:1.5pt 7pt;border:.75pt solid #cbd2d9;border-radius:9pt;font-size:9pt}
img.photo{display:block;object-fit:cover;border-radius:50%}`;
const styles:Record<TemplateId,(accent:string)=>string>={
  classic:a=>base(a)+`.page{padding:0 18mm}.top{padding-bottom:9pt;margin-bottom:13pt;border-bottom:1.5pt solid ${a}}h2{padding-bottom:2pt;border-bottom:.5pt solid #cbd2d9}`,
  sidebar:a=>base(a)+`.page{display:grid;grid-template-columns:66mm 1fr}.sidebg{position:fixed;top:0;bottom:0;left:0;width:66mm;background:${a}}.side{position:relative;color:#fff;padding:16mm 8mm 14mm 10mm}.side h2{color:#fff;opacity:.85}.side .contact,.side time,.side .where{color:#fff}.side p,.side li{font-size:9.5pt;overflow-wrap:anywhere}.side ul.tags li{border-color:rgba(255,255,255,.55)}.side img.photo{width:36mm;height:36mm;margin:0 auto 11pt;border:1.5pt solid rgba(255,255,255,.7)}.main{position:relative;padding:0 14mm 0 11mm}.main .top{margin-bottom:14pt;padding-top:3mm}`,
  band:a=>base(a)+`.top{display:flex;gap:14pt;align-items:center;background:${a};color:#fff;padding:13mm 18mm;break-inside:avoid}.top .headline,.top .contact{color:#fff}.top img.photo{width:30mm;height:30mm;border:1.5pt solid rgba(255,255,255,.75);flex:none}.body{padding:0 18mm}.body .gap{height:11mm}`,
  compact:a=>base(a)+`body{font-size:9.3pt;line-height:1.34}.page{padding:0 14mm}.gap{height:11mm}h1{font-size:19pt}.headline{font-size:10.5pt}.top{margin-bottom:9pt;padding-bottom:6pt;border-bottom:1pt solid ${a}}section{margin-bottom:9pt}article{margin-bottom:6pt}h2{font-size:9pt;margin-bottom:4pt}.cols{display:grid;grid-template-columns:1fr 1fr;gap:0 14pt}ul.tags li{font-size:8.3pt;padding:1pt 6pt}`,
};
export function renderCv(profile:Profile,template:TemplateId,options:{accent?:string;photo?:string}={}){
  const id=templates.some(t=>t.id===template)?template:'classic',accent=safeColour(options.accent||accents[0]),p=parts(profile),photo=templates.find(t=>t.id===id)!.photo?safePhoto(options.photo||''):'';
  const picture=photo?'<img class="photo" alt="" src="'+photo+'">':'',name='<h1>'+esc(profile.name||'Your name')+'</h1>'+(profile.headline?'<p class="headline">'+esc(profile.headline)+'</p>':'');
  const contactLine=[...p.contact,...p.links].join(' · '),main=section('Profile',p.about)+entries('Experience',p.experience)+entries('Education',p.education)+section('Certificates',p.certificates);
  let body:string;
  if(id==='sidebar')body='<div class="sidebg"></div><aside class="side">'+picture+section('Contact','<ul class="plain">'+[...p.contact,...p.links].map(c=>'<li>'+c+'</li>').join('')+'</ul>')+section('Skills',p.skills)+section('Languages',p.languages)+'</aside><div class="main">'+flow('<div class="top">'+name+'</div>'+main)+'</div>';
  else if(id==='band')body='<div class="top">'+picture+'<div>'+name+(contactLine?'<p class="contact">'+contactLine+'</p>':'')+'</div></div><div class="body">'+flow(section('Profile',p.about)+section('Skills',p.skills)+entries('Experience',p.experience)+entries('Education',p.education)+section('Languages',p.languages)+section('Certificates',p.certificates))+'</div>';
  else if(id==='compact')body=flow('<div class="top">'+name+(contactLine?'<p class="contact">'+contactLine+'</p>':'')+'</div>'+section('Profile',p.about)+entries('Experience',p.experience)+'<div class="cols whole"><div>'+entries('Education',p.education)+section('Certificates',p.certificates)+'</div><div>'+section('Skills',p.skills)+section('Languages',p.languages)+'</div></div>');
  else body=flow('<div class="top">'+name+(contactLine?'<p class="contact">'+contactLine+'</p>':'')+'</div>'+section('Profile',p.about)+section('Skills',p.skills)+entries('Experience',p.experience)+entries('Education',p.education)+section('Languages',p.languages)+section('Certificates',p.certificates));
  // The page may load nothing and run nothing: its own inline styles and an embedded picture only.
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:"><title>'+esc((profile.name||'CV')+' – CV')+'</title><style>'+styles[id](accent)+'</style></head><body><div class="page">'+body+'</div></body></html>';
}
