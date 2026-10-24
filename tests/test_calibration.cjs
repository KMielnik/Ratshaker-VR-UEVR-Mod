const SRC=require('path').resolve(__dirname,'../src');
const fs=require('fs');
const {lua,lauxlib,lualib,to_luastring,to_jsstring}=require('fengari');
const L=lauxlib.luaL_newstate();lualib.luaL_openlibs(L);
function run(s){if(lauxlib.luaL_dostring(L,to_luastring(s))!==lua.LUA_OK)throw Error(to_jsstring(lua.lua_tostring(L,-1)));}
for(const[n,f]of[['IK','ik_math.lua'],['Gestures','gestures.lua'],['Calibration','calibration.lua']])run(n+'=(function()\n'+fs.readFileSync(SRC+'/'+f,'utf8')+'\nend)()');
run(`
local V,Q=IK.vector,IK.quaternion
local function near(a,b)assert(math.abs(a-b)<1e-5)end
local files={};local codec={load_file=function(p)return files[p]end,dump_file=function(p,v)files[p]=v;return true end}
local c=Calibration.new({IK=IK,json=codec});local offsets={}
c:load(offsets);assert(not offsets.left)
files.ratshaker_calibration_request={}
files['ratshaker_calibration_request.json']={id='first',delay=3}
c:poll(1,.1,false);assert(c.remaining==3)
for i=1,40 do c:poll(1+i*.1,.1,false)end;assert(c.remaining==3 and not c.due)
for i=1,31 do c:poll(5+i*.1,.1,true)end;assert(c.due)
local physical={left={Rotation=Q.normalize({x=.2,y=.3,z=.1,w=.9})},right={Rotation=Q.normalize({x=-.3,y=.2,z=-.4,w=.8})}}
local h=math.sqrt(.5)
assert(c:apply(physical,{x=0,y=0,z=h,w=h},Gestures.reference,offsets))
for _,side in ipairs({'left','right'})do
 local world=Q.multiply(physical[side].Rotation,offsets[side])
 local forward=Q.rotate(world,Gestures.reference[side].forward)
 local thumb=Q.rotate(world,Gestures.reference[side].radial)
 near(forward.x,0);near(forward.y,1);near(forward.z,0)
 near(thumb.x,0);near(thumb.y,0);near(thumb.z,1)
end
assert(not c:apply(physical,{x=0,y=0,z=0,w=1},Gestures.reference,offsets),'reapplied calibration')
local again=Calibration.new({IK=IK,json=codec});local restored={};again:load(restored)
near(restored.left.x,offsets.left.x);again:poll(100,.1,true);assert(not again.remaining,'replayed stale request')
files['ratshaker_wrist_calibration.json'].wrists.left.x=0/0
local bad=Calibration.new({IK=IK,json=codec});local rejected={};bad:load(rejected);assert(not rejected.left)
local unavailable=Calibration.new({IK=IK});unavailable:load({});unavailable:poll(1,.1,true)
print('PASS: saved calibration maps independent controller rotations to palms-facing neutral pose; paused countdown, one-shot request, no stale replay, persistence, invalid-data rejection and missing JSON fallback.')
`);
