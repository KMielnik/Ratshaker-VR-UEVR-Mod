const fs=require('fs'),path=require('path'),assert=require('assert/strict');
// Small public contracts: no copied OpenXR registry or upstream source fixture.
for(const profile of ['oculus_touch_controller','valve_index_controller']) {
  const config=JSON.parse(fs.readFileSync(path.join(__dirname,'../profile/_interaction_profiles_'+profile+'.json')));
  const bindings=config.bindings;
  for(const side of ['left','right']) {
    const root='/user/hand/'+side;
    const has=(action,suffix)=>bindings.some(b=>b.action===action&&b.path===root+suffix);
    assert(has('pose','/input/aim/pose'));
    assert(has('grippose','/input/grip/pose'));
    assert(has('grip','/input/squeeze/value'));
    assert(has('trigger','/input/trigger/'+(profile.startsWith('valve')?'click':'value')));
    assert(has('joystick','/input/thumbstick'));
    assert(has('joystickclick','/input/thumbstick/click'));
    assert(has('haptic','/output/haptic'));
    assert(has('abuttontouch'+side,'/input/trigger/touch'));
    assert(has('bbuttontouch'+side,'/input/thumbstick/touch'));
    assert(!bindings.some(b=>b.action==='abuttontouch'+side&&!b.path.endsWith('/trigger/touch')));
  }
  if(profile.startsWith('valve'))assert(!bindings.some(b=>b.path.endsWith('/trackpad/click')));
  const unique=new Set(bindings.map(b=>b.action+' '+b.path));assert.equal(unique.size,bindings.length);
}
console.log('PASS: both profile mappings retain poses, gameplay controls and isolated passive touch aliases');
