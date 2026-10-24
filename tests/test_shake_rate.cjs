const SRC=require('path').resolve(__dirname,'../src');
const fs=require('fs');
const {lua,lauxlib,lualib,to_luastring,to_jsstring}=require('fengari');
const L=lauxlib.luaL_newstate();lualib.luaL_openlibs(L);
function run(s){if(lauxlib.luaL_dostring(L,to_luastring(s))!==lua.LUA_OK)throw Error(to_jsstring(lua.lua_tostring(L,-1)));}
for(const [name,file] of [['Motion','motion.lua'],['Rate','shake_rate.lua']])run(name+'=(function()\n'+fs.readFileSync(SRC+'/'+file,'utf8')+'\nend)()');
run(`
local function trial(freq,amp,trigger,grip,fps)
 local d=Rate.new(Motion);local credits=0
 for i=1,8*fps do local t=i/fps
  local r=d:step({x=amp*math.sin(t*2*math.pi*freq),y=0,z=0},1/fps,trigger,grip,true)
  credits=credits+r.count
 end
 return credits
end
local slow=trial(1,.06,true,false,90)
local medium=trial(2,.06,true,false,90)
local fast=trial(4,.06,true,false,90)
assert(slow>0 and medium>slow*1.4 and fast>medium*1.4,'motion does not scale native tick rate: '..slow..'/'..medium..'/'..fast)
assert(trial(4,.06,false,false,90)==0,'unarmed shake')
assert(trial(4,.06,true,true,90)==0,'squeeze also shaking')
assert(trial(0,0,true,false,90)==0,'stationary fills meter')
assert(Rate.new(Motion).units_per_meter==4.5 and Rate.new(Motion).max_rate==9,'requested 1.5x defaults missing')
-- Same sampled motion and detector, including saturation: the credit rate
-- must be exactly 1.5x the previous release, before integer quantization.
for _,amplitude in ipairs({.03,.08,.16})do
 local old=Rate.new(Motion,{units_per_meter=3,max_rate=6});local revised=Rate.new(Motion)
 local before,after=0,0
 for i=1,720 do
  local p={x=amplitude*math.sin(i/90*math.pi*8),y=0,z=0}
  local a=old:step(p,1/90,true,false,true);local b=revised:step(p,1/90,true,false,true)
  assert(a.active==b.active and math.abs(b.rate-1.5*a.rate)<1e-9,'gain changed detector or pacing ratio')
  before=before+a.count;after=after+b.count
 end
 assert(math.abs(after-1.5*before)<=1.5,'integer credits differ beyond rounding tolerance')
end
for _,fps in ipairs({60,72,90,120})do
 local d=Rate.new(Motion);local credits=0
 for i=1,8*fps do
  local r=d:step({x=.16*math.sin(i/fps*2*math.pi*4),y=0,z=0},1/fps,true,false,true)
  credits=credits+r.count
  assert(r.rate<=9,'fast motion exceeds hard rate cap')
  assert(credits<=math.floor(i/fps*9+1e-6),'frame cadence bypasses capped rate')
 end
 assert(credits>=48 and credits<=72,'strong motion should approach but never exceed nine credits/s: '..credits)
end
for _,fps in ipairs({60,72,120})do local n=trial(2,.06,true,false,fps);assert(math.abs(n-medium)<medium*.25,'frame-rate dependent '..fps..':'..n)end
local d=Rate.new(Motion);local count=0
for i=1,720 do count=count+d:step({x=i/90*.8,y=0,z=0},1/90,true,false,true).count end
assert(count==0,'one-way translation fills meter')
local r=d:step({x=0,y=0,z=0},1/90,true,false,false);assert(r.count==0,'tracking loss credit')
assert(d:step({x=0,y=0,z=0},0/0,true,false,true).count==0,'NaN frame credit')
print('PASS: native credits increase with 1/2/4 Hz physical reciprocation ('..slow..'/'..medium..'/'..fast..'), scale across 60/72/90/120 Hz, and remain zero for stationary, unarmed, grip+trigger, one-way drift and invalid tracking.')
`);
