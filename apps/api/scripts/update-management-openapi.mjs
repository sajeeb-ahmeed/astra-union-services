import fs from 'node:fs';
const path='apps/api/openapi.json',doc=JSON.parse(fs.readFileSync(path,'utf8'));
doc.info.version='0.2.0';
doc.info.description='Independently authored DEMO contracts for all 47 services. These are not reference-site server contracts. Mutation routes require session and CSRF except public signup/login/support subscriptions and signed sandbox webhook. Real identity, legal issuance and commercial payment providers are not configured.';
const text={type:'string'},id={type:'string',format:'uuid'},bool={type:'boolean'},integer={type:'integer'},role={type:'string',enum:['admin','approver','reviewer','staff','finance','citizen']};
const office={slug:{type:'string',pattern:'^[a-z][a-z0-9-]{2,49}$'},nameBn:text,nameEn:text,division:text,district:text,upazila:text,officeType:{type:'string',enum:['UNION','MUNICIPALITY','CITY_CORPORATION']}};
const user={email:{type:'string',format:'email'},displayName:text,password:{type:'string',minLength:12,maxLength:200},role};
const notices={titleBn:text,titleEn:text,bodyBn:text,bodyEn:text,published:bool};
function operation(path,method,summary,{publicAccess=false,properties,required,query=[],description}={}) {
 const parameters=[...(path.match(/\{(\w+)\}/g)??[]).map(name=>({name:name.slice(1,-1),in:'path',required:true,schema:text})),...query.map(name=>({name,in:'query',required:false,schema:['page','pageSize','serviceNo','version'].includes(name)?integer:text}))];
 const entry={summary,description,security:publicAccess?[]:method==='get'?[{session:[]}]:[{session:[],csrf:[]}],parameters,responses:{[method==='post'&&!path.includes('password')?'201':'200']:{description:'Successful response; persistent mutation where applicable.'},'401':{description:'Session missing or inactive.'},'403':{description:'Role, CSRF or Origin denied.'},'404':{description:'Record unavailable in this scope.'},'409':{description:'Duplicate or workflow conflict.'},'422':{description:'Validated request failed.'}}};
 if(properties) entry.requestBody={required:true,content:{'application/json':{schema:{type:'object',additionalProperties:false,properties,required:required??Object.keys(properties)}}}};
 doc.paths[path]??={};doc.paths[path][method]=entry;
}
operation('/api/v1/offices','get','Public active office directory',{publicAccess:true,query:['q','division','district','upazila','type','page','pageSize'],description:'Returns {items,total,page,pageSize}; pageSize 1–100, default12. Only active demo tenants; no citizen records.'});
operation('/api/v1/offices/{slug}','get','Office details, enabled services and published notices',{publicAccess:true});
operation('/api/v1/notices','get','Published notices for active offices',{publicAccess:true,query:['office','q','page','pageSize'],description:'Search matches bilingual title/body before pagination.'});
operation('/api/v1/auth/signup','post','Create synthetic citizen account and profile',{publicAccess:true,properties:{...doc.components.schemas.CitizenInput.properties,email:user.email,password:user.password,displayName:text,tenantId:id},description:'Local DEMO account; no OTP or identity verification. Returns {registered:true,verificationState:SYNTHETIC_DEMO}; sign in separately.'});
operation('/api/v1/auth/password','post','Change own password and invalidate other sessions',{properties:{currentPassword:text,newPassword:user.password},description:'Keeps current session; verifies current password under row lock.'});
operation('/api/v1/admin/users/{id}/recovery','post','Issue a one-use manual account recovery link',{properties:{},required:[],description:'Tenant admin only, active non-admin non-owner account in same office with no other memberships. Returns token,recoveryUrl,expiresAt. Hash stored for15minutes; administrator must convey through a trusted channel. No message is automatically delivered.'});
operation('/api/v1/auth/recover','post','Consume manual recovery token and replace password',{publicAccess:true,properties:{token:{type:'string',pattern:'^[a-f0-9]{64}$'},newPassword:user.password},description:'Consumes once under transaction locks; validates account/tenant eligibility again and expires all prior sessions.'});
doc.paths['/api/v1/auth/recover'].post.responses['200']=doc.paths['/api/v1/auth/recover'].post.responses['201'];delete doc.paths['/api/v1/auth/recover'].post.responses['201'];
operation('/api/v1/admin/office','get','Tenant admin reads own office profile');
const {slug,...officePatch}=office;
operation('/api/v1/admin/office','patch','Tenant admin updates office profile',{properties:officePatch,required:[]});
operation('/api/v1/admin/users','get','Tenant admin lists own office memberships');
operation('/api/v1/admin/users','post','Tenant admin creates user and scoped membership',{properties:user});
operation('/api/v1/admin/users/{id}','patch','Tenant admin changes role or activity',{properties:{role,active:bool},required:[],description:'Cannot remove own administration; unavailable foreign membership returns404. Activity/role rechecked every session request.'});
operation('/api/v1/admin/authorizations','get','List office service-specific demo approval grants');
operation('/api/v1/admin/authorizations/{userId}/{serviceNo}','put','Grant or revoke demo service approval authority',{properties:{active:bool,authorityNote:{type:'string',minLength:12,maxLength:500}},description:'Active approver membership in same office required; all grants explicitly DEMO ONLY and audited. This is not official appointment evidence.'});
operation('/api/v1/admin/services','get','Read enabled status and cost of every office service');
operation('/api/v1/admin/services/{no}','patch','Change enabled status or integer credit cost',{properties:{enabled:bool,creditCost:{type:'integer',minimum:1,maximum:10000}},required:[]});
operation('/api/v1/admin/notices','get','List own office draft and published notices');
operation('/api/v1/admin/notices','post','Create an office notice',{properties:notices});
operation('/api/v1/admin/notices/{id}','patch','Update or unpublish an office notice',{properties:notices,required:[]});
operation('/api/v1/owner/tenants','post','Owner provisions independent demo office and administrator',{properties:{...office,adminEmail:user.email,adminName:text,adminPassword:user.password},description:'Creates zero-credit wallet, EXPIRED subscription,47 service settings and admin membership. Owner receives no citizen or issuing authority.'});
operation('/api/v1/owner/tenants/{id}','patch','Owner suspends or reactivates tenant',{properties:{status:{type:'string',enum:['ACTIVE','SUSPENDED']}},description:'Existing sessions become inactive while suspended; records preserved.'});
operation('/api/v1/applications/{id}/renew','post','Create versioned renewal draft from issued certificate',{properties:{payload:{type:'object'}},required:[],description:'Citizen own/staff/admin tenant only; same service/citizen/tenant DB-enforced. All47 services allowed. One active successor per source; canceled/rejected successor allows replacement. Trade previous number is server pinned. Revoked source blocks issue; renewed document needs normal review/approval and one new charge.'});
const apps=doc.paths['/api/v1/applications']?.get;if(apps){apps.parameters??=[];for(const name of ['q','page','pageSize'])if(!apps.parameters.some(p=>p.name===name))apps.parameters.push({name,in:'query',schema:name==='q'?text:integer});apps.description='Tenant/own search by application UUID, citizen name or synthetic reference; state/serviceNo filters. Returns items,total,page,pageSize; default/max pageSize100.';}
const schema=doc.paths['/api/v1/services/{no}/schema']?.get;if(schema){schema.parameters??=[];for(const name of ['view','version'])if(!schema.parameters.some(p=>p.name===name))schema.parameters.push({name,in:'query',schema:name==='version'?integer:text});schema.description='Default latest operational DEMO schema. view=reference returns observed read-only initial controls. version selects immutable historical schema.';}
doc.components.schemas.ApplicationInput.properties.serviceNo={type:'integer',minimum:1,maximum:47};doc.components.schemas.ApplicationInput.properties.payload.description='Validated against the latest published operational schema on creation; exact immutable application-pinned version on edits. GET services/{no}/schema.';
fs.writeFileSync(path,JSON.stringify(doc,null,2)+'\n');
console.log('Updated management/renewal OpenAPI paths.');
