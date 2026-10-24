const SRC=require('path').resolve(__dirname,'../src');
const fs=require('fs');const path=require('path');
const {lua,lauxlib,lualib,to_luastring,to_jsstring}=require('fengari');
const L=lauxlib.luaL_newstate();lualib.luaL_openlibs(L);
function run(s){if(lauxlib.luaL_dostring(L,to_luastring(s))!==lua.LUA_OK)throw Error(to_jsstring(lua.lua_tostring(L,-1)));}
run('Turning=(function()\n'+fs.readFileSync(path.join(SRC,'turning.lua'),'utf8')+'\nend)()');
run(`
local mode='false';local calls=0
local vr={get_mod_value=function(_,key)assert(key=='VR_SnapTurn');return mode end}
local env={uevr={params={vr=vr}},valid=function(o)return o and o.alive end}
local turn=Turning.new(env)
local function controller(id,initial)
 return setmetatable({alive=true,id=id,bUsingGamepad=initial,get_address=function(self)return self.id end},
  {__index=function(_,k)error('Unexpected reflected call '..k)end})
end
local c=controller(1,false)
local pawn={alive=true,targetMouseInputAxisXValue=15,targetMouseInputAxisYValue=2}
assert(turn:update(c) and c.bUsingGamepad==true)
-- Simulate a MouseX event in the same frame, after the engine-tick update.
c.bUsingGamepad=false
assert(turn:guard(pawn) and c.bUsingGamepad==true)
assert(pawn.targetMouseInputAxisXValue==15 and pawn.targetMouseInputAxisYValue==0)
local nativeYaw=pawn.targetMouseInputAxisXValue/(c.bUsingGamepad and 15 or 1)
assert(nativeYaw==1,'native smooth yaw must use the gamepad divisor')
local packet={Gamepad={sThumbRX=32767,sThumbRY=21000,bRightTrigger=42,wButtons=123}}
turn:filter_xinput(packet)
assert(packet.Gamepad.sThumbRX==32767 and packet.Gamepad.sThumbRY==0)
assert(packet.Gamepad.bRightTrigger==42 and packet.Gamepad.wButtons==123)
-- The first snap packet still contains RX after UEVR schedules its snap.
mode='true'..string.char(0)..'ignored'
turn:filter_xinput(packet)
assert(packet.Gamepad.sThumbRX==0)
pawn.targetMouseInputAxisXValue=15;turn:guard(pawn)
assert(pawn.targetMouseInputAxisXValue==0,'snap must have no extra native yaw')
-- Switching the native UEVR option back takes effect without script reset.
mode='false';packet.Gamepad.sThumbRX=-24000;turn:filter_xinput(packet)
assert(packet.Gamepad.sThumbRX==-24000)
for _,value in ipairs({0/0,math.huge,-math.huge,'unexpected'}) do
 pawn.targetMouseInputAxisXValue=value;turn:guard(pawn);assert(pawn.targetMouseInputAxisXValue==0)
end
pawn.targetMouseInputAxisXValue=-30;turn:guard(pawn)
assert(pawn.targetMouseInputAxisXValue==-30,'native sensitivity must remain intact')
turn:pause();assert(c.bUsingGamepad==false and not turn.active)
packet.Gamepad.sThumbRX=100;packet.Gamepad.sThumbRY=200;turn:filter_xinput(packet)
assert(packet.Gamepad.sThumbRX==100 and packet.Gamepad.sThumbRY==200)
pawn.targetMouseInputAxisYValue=10;assert(not turn:guard(pawn));assert(pawn.targetMouseInputAxisYValue==10)
-- Each controller gets its own snapshot; no old-pawn write on a level change.
local c2=controller(2,true);turn:update(c);turn:update(c2)
assert(c.bUsingGamepad==false and c2.bUsingGamepad==true)
c2.bUsingGamepad=false;turn:guard(pawn);assert(c2.bUsingGamepad==true)
turn:cleanup();assert(c2.bUsingGamepad==true)
turn:update(c);c.alive=false;turn:update(c2);turn:pause();assert(c2.bUsingGamepad==true)
local unknown={alive=true,get_address=function()return 3 end}
assert(not turn:update(unknown) and unknown.bUsingGamepad==nil)
-- Read failure never forces snap mode or changes any UEVR setting.
vr.get_mod_value=function()error('unavailable')end
c.alive=true;turn:update(c);pawn.targetMouseInputAxisXValue=15;turn:guard(pawn)
assert(pawn.targetMouseInputAxisXValue==15);turn:pause()
`);
console.log('Turning: same-frame input reclassification, UEVR snap ownership, invalid axes, sensitivity preservation, controller replacement, and restoration passed.');
