import test from 'node:test';
import assert from 'node:assert/strict';
import { submitVerifiedApplication,validateAgentDocuments } from './agentOnboarding.js';
const file={ name:'test.pdf',type:'application/pdf',size:100 };
const form={ applicationId:'application',businessDocument:file,brokerLicenseDocument:file,officeName:'test' };
function mock({uploadFailure=false,rpcFailure=false,saved=null,readError=null}={}) {
  const calls=[];
  const client={auth:{getSession:async()=>({data:{session:{user:{id:'applicant'}}}})},
    storage:{from:()=>({upload:async path=>{calls.push(['upload',path]);return {error:uploadFailure&&calls.filter(x=>x[0]==='upload').length===2?{message:'offline'}:null};},
      remove:async paths=>{calls.push(['remove',paths]);return {};}})},
    rpc:async(name,args)=>{calls.push([name,args]);return {data:{id:'application',status:'pending'},error:rpcFailure?{message:'lost response'}:null};},
    from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:saved,error:readError})})};
  return {client,calls};
}
test('validates both documents before any upload or registration',()=>{
  assert.doesNotThrow(()=>validateAgentDocuments(form));
  for(const invalid of [null,{...file,type:'text/html'},{...file,size:11*1024*1024},{...file,size:0}])
    assert.throws(()=>validateAgentDocuments({...form,brokerLicenseDocument:invalid}),/10MB/);
});
test('documents are uploaded under applicant identity and approval fields never leave client',async()=>{
  const {client,calls}=mock();await submitVerifiedApplication(client,{...form,status:'approved',contactEmail:'spoof@example.invalid'});
  assert.ok(calls.filter(c=>c[0]==='upload').every(c=>c[1].startsWith('applicant/application/')));
  const args=calls.find(c=>c[0]==='submit_agent_application')[1];
  assert.equal(args.p_details.status,undefined);assert.equal(args.p_details.contact_email,undefined);
});
test('partial upload failure is reported and removes only newly uploaded files',async()=>{
  const {client,calls}=mock({uploadFailure:true});
  await assert.rejects(submitVerifiedApplication(client,form),/업로드 실패/);
  assert.equal(calls.find(c=>c[0]==='remove')[1].length,1);
  assert.equal(calls.some(c=>c[0]==='submit_agent_application'),false);
});
test('lost response after save preserves attached files and reports success',async()=>{
  const {client,calls}=mock({rpcFailure:true,saved:{id:'application',status:'pending'}});
  assert.equal((await submitVerifiedApplication(client,form)).id,'application');
  assert.equal(calls.some(c=>c[0]==='remove'),false);
});
test('unknown save outcome never deletes possibly attached documents',async()=>{
  const {client,calls}=mock({rpcFailure:true,readError:{message:'offline'}});
  await assert.rejects(submitVerifiedApplication(client,form),/lost response/);
  assert.equal(calls.some(c=>c[0]==='remove'),false);
});
