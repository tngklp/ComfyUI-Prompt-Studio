import test from 'node:test';
import assert from 'node:assert/strict';
import {createLazyMediaTool} from '../web/media_tools.js';

test('lazy media tool init failure is local and a later click can retry',async()=>{
  const modal={inert:true,setAttribute(){}},children=[],messages=[];
  const root={children,classList:{contains:()=>true},querySelector:()=>modal};
  let attempts=0,opens=0;
  const tool=createLazyMediaTool(root,async()=>{
    attempts++;
    if(attempts===1){const child={remove:()=>children.pop()};children.push(child);throw new Error('Failed import');}
    return {open(){opens++;},close(){return true;}};
  },m=>messages.push(m));
  await tool.open();
  assert.equal(modal.inert,false);assert.equal(children.length,0);assert.equal(messages.length,1);
  await tool.open();assert.equal(opens,1);
  assert.equal(tool.close(),true);
});

test('closing Prompt Studio while importing does not open a tool after it closes',async()=>{
  let resolve,opens=0;
  const root={children:[]};
  const tool=createLazyMediaTool(root,()=>new Promise(r=>{resolve=r;}),assert.fail);
  const pending=tool.open();await Promise.resolve();
  tool.close();resolve({open(){opens++;},close(){}});
  await pending;assert.equal(opens,0);
});
