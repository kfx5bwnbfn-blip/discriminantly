// Plugin submission audit: adversarial privacy, revocation, leakage and
// provenance checks run through the real OAuth path, as ChatGPT uses it.
//
// Needs a running local server with two members, set up exactly as in the
// "Reviewer / audit setup" section of docs/plugin-submission.md. Reads session
// cookies from /tmp/cjA and /tmp/cjB and legacy tokens from /tmp/legA and
// /tmp/legB. Run:  CID=<client_id> node test/plugin-audit.js
const fs=require('fs'), crypto=require('crypto');
const B='http://localhost:3000', CID=process.env.CID, RURI='http://127.0.0.1:6274/oauth/callback';
const sid=(f)=>{const l=fs.readFileSync(f,'utf8').split('\n').find(x=>x.includes('\tsid\t'));return l.split('\t').pop().trim();};
const SA=sid('/tmp/cjA'), SB=sid('/tmp/cjB');
const LEGA=fs.readFileSync('/tmp/legA','utf8').trim(), LEGB=fs.readFileSync('/tmp/legB','utf8').trim();
const results=[]; const ok=(n,c,extra='')=>{results.push([n,!!c]);console.log((c?'  ok  ':'  FAIL')+'  '+n+(extra?'  '+extra:''));};
const outputs=[]; // every tool response, for the secret scan
async function oauthToken(s){
  const v=crypto.randomBytes(48).toString('base64url'), ch=crypto.createHash('sha256').update(v).digest('base64url');
  const body=new URLSearchParams({client_id:CID,redirect_uri:RURI,code_challenge:ch,code_challenge_method:'S256',state:'s',resource:B+'/mcp',approve:'1'});
  const r=await fetch(B+'/oauth/authorize',{method:'POST',headers:{cookie:'sid='+s,'content-type':'application/x-www-form-urlencoded'},body,redirect:'manual'});
  const code=new URL(r.headers.get('location')).searchParams.get('code');
  const t=await (await fetch(B+'/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code,client_id:CID,redirect_uri:RURI,code_verifier:v})})).json();
  return t;
}
const mk=(auth)=>async(name,args={})=>{
  const url=auth.bearer?B+'/mcp':B+'/mcp/'+auth.legacy;
  const h={'content-type':'application/json'}; if(auth.bearer) h.authorization='Bearer '+auth.bearer;
  const r=await fetch(url,{method:'POST',headers:h,body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});
  const status=r.status; const j=await r.json().catch(()=>({})); const res=j.result||{};
  const text=(res.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');
  outputs.push({name,status,raw:JSON.stringify(j)}); return {status,text,sc:res.structuredContent||{},err:j.error,isError:res.isError||(res.structuredContent&&res.structuredContent.ok===false)};
};
const PNG='data:image/png;base64,'+'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
(async()=>{
 const tA=await oauthToken(SA), tB=await oauthToken(SB);
 const A=mk({bearer:tA.access_token}), Bc=mk({bearer:tB.access_token}), AL=mk({legacy:LEGA});
 // ---- B builds a corpus with private and public things -------------------
 const img=(await Bc('upload_image',{image:PNG,what:'test'})).sc.ref;
 const imgA=(await A('upload_image',{image:PNG,what:'test'})).sc.ref;
 const bPrivNote=(await Bc('note_object',{headline:'BEA SECRET NOTE',description:'private',image:img,private:true})).sc;
 const bPubNote=(await Bc('note_object',{headline:'Bea public note',description:'public',image:img,private:false})).sc;
 const bPrivMark=(await Bc('add_travel_mark',{place:'BEA SECRET PLACE',locality:'Oslo',country:'Norway',why:'x',private:true})).sc;
 const bPubMark=(await Bc('add_travel_mark',{place:'Bea public place',locality:'Oslo',country:'Norway',why:'x'})).sc;
 const bItin=(await Bc('create_itinerary',{title:'BEA SECRET PLAN'})).sc;
 const idOf=(o)=>o.id||o.uid||(o.item&&(o.item.id||o.item.uid))||(o.created&&(o.created.id||o.created.uid));
 console.log('B corpus ids:', JSON.stringify({privNote:idOf(bPrivNote),pubNote:idOf(bPubNote),privMark:idOf(bPrivMark),pubMark:idOf(bPubMark),itin:idOf(bItin)}));
 fs.writeFileSync('/tmp/bcorpus.json',JSON.stringify({bPrivNote,bPubNote,bPrivMark,bPubMark,bItin},null,1));
 // ---- isolation -----------------------------------------------------------
 const aNotes=(await A('my_notes',{limit:100})).text, aSearch=(await A('search_catalogue',{query:'BEA SECRET'})).text;
 const aMarks=(await A('my_travel_marks',{})).text, aRecent=(await A('recent_notes',{})).text;
 ok('A cannot read B private note (my_notes, search, recent)', !/BEA SECRET NOTE/.test(aNotes+aSearch+aRecent));
 ok('A cannot read B private mark', !/BEA SECRET PLACE/.test(aMarks+aSearch));
 ok('A cannot see B private itinerary', !/BEA SECRET PLAN/.test((await A('my_itineraries',{})).text));
 ok('B sees her own private note', /BEA SECRET NOTE/.test((await Bc('my_notes',{limit:100})).text));
 const pn=idOf(bPrivNote), pm=idOf(bPrivMark), it=bItin.uid;
 const e1=await A('edit_note',{id:pn,headline:'PWNED'}), d1=await A('delete_note',{id:pn});
 const e2=await A('edit_travel_mark',{id:pm,place:'PWNED'}), d2=await A('delete_travel_mark',{id:pm});
 const e3=await A('update_itinerary',{itinerary_uid:it,title:'PWNED'});
 const stillB=(await Bc('my_notes',{limit:100})).text+(await Bc('my_travel_marks',{})).text+(await Bc('my_itineraries',{})).text;
 ok('knowing B record ids does not let A edit or delete them', !/PWNED/.test(stillB) && /BEA SECRET NOTE/.test(stillB) && /BEA SECRET PLACE/.test(stillB) && /BEA SECRET PLAN/.test(stillB));
 ok('  and each attempt reports failure, not success', [e1,d1,e2,d2,e3].every(r=>r.isError||/not found|not yours|can.t|cannot|no such|isn.t/i.test(r.text)), [e1,d1,e2,d2,e3].map(r=>r.text.slice(0,40).replace(/\n/g,' ')).join(' | '));
 const lv=await A('log_visit',{id:pm}); ok('A cannot log a visit on B private mark', lv.isError||/not found|isn.t|no such|can.t/i.test(lv.text), lv.text.slice(0,60));
 const aIt=(await A('create_itinerary',{title:'A plan'})).sc; const ai=aIt.uid;
 const st=await A('add_itinerary_stops',{itinerary_uid:ai,stops:[{label:'x',mark_uid:(bPrivMark.uid||bPrivMark.item&&bPrivMark.item.uid||pm)}]});
 const aItView=(await A('my_itineraries',{uid:ai})).text;
 ok('itinerary membership does not reveal B private mark', !/BEA SECRET PLACE/.test(aItView+st.text), st.text.slice(0,70).replace(/\n/g,' '));
 const bEns=await A('get_ensemble',{id:'00000000-0000-0000-0000-000000000000'});
 ok('unknown ensemble id is refused cleanly', bEns.isError||/not found|no such|isn.t/i.test(bEns.text));
 const steal=await A('note_object',{headline:'STOLEN IMAGE NOTE',description:'d',image:img});
 ok("A cannot attach B's stored image to his own note", steal.isError && !/STOLEN IMAGE NOTE/.test((await A('my_notes',{limit:100})).text), steal.text.slice(0,70).replace(/\n/g,' '));
 const own=await Bc('note_object',{headline:'Bea own-image note',description:'d',image:img});
 ok('B can attach her own stored image by its /i/ reference', !own.isError && own.sc.ok!==false, own.text.slice(0,60).replace(/\n/g,' '));
 // ---- legacy credentials stay user-bound ------------------------------------
 ok('legacy token is bound to its own user', !/BEA SECRET NOTE|BEA SECRET PLACE/.test((await AL('my_notes',{limit:100})).text+(await AL('search_catalogue',{query:'BEA SECRET'})).text));
 // ---- anonymous web access ----------------------------------------------------
 const st1=(await fetch(B+'/o/'+idOf(bPubNote))).status, st2=(await fetch(B+'/o/'+pn)).status, st3=(await fetch(B+'/m/'+pm)).status;
 ok('anonymous: public note visible, private note and mark not', st1===200 && st2!==200 && st3!==200, `pub ${st1} privNote ${st2} privMark ${st3}`);
 // ---- provenance -----------------------------------------------------------
 const nA=(await A('note_object',{headline:'Prov note',description:'d',image:imgA})).sc;
 const mA=(await A('add_travel_mark',{place:'Prov place',locality:'L',country:'C',why:'x'})).sc;
 const vA=await A('log_visit',{id:idOf(mA)});
 await A('add_itinerary_stops',{itinerary_uid:ai,stops:[{label:'Prov stop'}]});
 await A('edit_note',{id:idOf(nA),headline:'Prov note edited'});
 const legN=(await AL('note_object',{headline:'Legacy note',description:'d',image:imgA})).sc;
 fs.writeFileSync('/tmp/prov.json',JSON.stringify({nA:idOf(nA),mA:idOf(mA),legN:idOf(legN)}));
 // ---- revocation ------------------------------------------------------------
 const conn=require('node:sqlite'); const db=new conn.DatabaseSync('data/discriminantly.db');
 const cu=db.prepare("select uid from connections where user_id=1 and auth_kind='oauth' and revoked_at is null").get().uid;
 await fetch(B+'/settings/connections/'+cu+'/revoke',{method:'POST',headers:{cookie:'sid='+SA},redirect:'manual'});
 const after=await A('my_notes',{});
 ok('revoked connection cannot keep operating', after.status===401, 'status '+after.status);
 const rf=await (await fetch(B+'/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:tA.refresh_token})})).json();
 ok('  and cannot refresh its way back', rf.error==='invalid_grant');
 ok('B unaffected by A revoking', /BEA SECRET NOTE/.test((await Bc('my_notes',{limit:100})).text));
 // ---- secret / leakage scan over every response ---------------------------
 const all=outputs.map(o=>o.raw).join('\n');
 const secrets=[tA.access_token,tA.refresh_token,tB.access_token,tB.refresh_token,LEGA,LEGB,SA,SB].filter(Boolean);
 ok('no bearer, refresh, legacy token or session id in any response', !secrets.some(x=>all.includes(x)), `${outputs.length} responses scanned`);
 ok('no password, hash or token fields in any response', !/password|token_hash|api_token|scrypt|refresh_token|access_token/i.test(all));
 ok('no stack traces, file paths or SQL in any response', !/\bat [A-Za-z_.]+ \(|\/home\/|\/app\/|node:internal|SQLITE|SELECT |INSERT INTO|constraint failed/.test(all));
 ok('no email address of any member in any response', !/@example\.com|admin@discriminant/.test(all));
 fs.writeFileSync('/tmp/audit-results.json',JSON.stringify(results));
 console.log(`\n${results.filter(r=>r[1]).length}/${results.length} passed`);
})().catch(e=>{console.error('SCRIPT ERROR',e);process.exit(1);});
