const SRC=require('path').resolve(__dirname,'../src');
const fs=require('fs'),assert=require('assert/strict');
const {lua,lauxlib,lualib,to_luastring,to_jsstring}=require('fengari');
const L=lauxlib.luaL_newstate();lualib.luaL_openlibs(L);
function run(s){if(lauxlib.luaL_dostring(L,to_luastring(s))!==lua.LUA_OK)throw Error(to_jsstring(lua.lua_tostring(L,-1)));}
run('Squeeze=(function()\n'+fs.readFileSync(SRC+'/squeeze.lua','utf8')+'\nend)()');
run(`
local pawn={alive=true,timer=true};local trace=false;local calls=0;local clears=0
local bridge=Squeeze.new({valid=function(p)return p and p.alive end,
 initial_delay=function()return 0 end,
 clear_timer=function(p)p.timer=false;clears=clears+1 end,
 trace=function()pawn.target='hand';trace=true end,
 call=function(p,n)
  assert(n=='DrainShakeMeterWhenSqueezing' and p==pawn and trace and p.target=='hand' and not p.timer)
  calls=calls+1;trace=false
 end})
bridge:start(pawn);assert(not pawn.timer and calls==0,'start must cancel native timer without dispatching on an unsafe thread')
pawn.target='camera';assert(bridge:step(1/90) and calls==1,'zero start-delay must dispatch on next engine callback')
for i=1,269 do pawn.target='camera';bridge:step(1/90)end
assert(calls==10,'0.3-second cadence drifted '..calls)
pawn.target='camera';bridge:step(1/90);assert(calls==11)
local before=calls;pawn.timer=true;bridge:step(1.4)
assert(calls==before+1 and not pawn.timer,'hitch replayed missed ticks or native timer stayed armed')
bridge:step(.09);assert(calls==before+1);bridge:step(.02);assert(calls==before+2,'post-hitch cadence lost phase')
before=calls;bridge:step(0/0);bridge:step(-1);assert(calls==before,'invalid frame dispatched')
bridge:stop();bridge:step(10);assert(calls==before)
bridge:start(pawn);pawn.alive=false;assert(not bridge:step(.3) and not bridge.active,'destroyed pawn dispatch')
local delayed=Squeeze.new({valid=function(p)return p.alive end,clear_timer=function()end,
 initial_delay=function()return .3 end,trace=function()end,call=function()calls=calls+1 end})
pawn.alive=true;delayed:start(pawn);before=calls
delayed:step(.29);assert(calls==before);delayed:step(.01);assert(calls==before+1,'native first delay was discarded')
pawn.bRatSqueeze=false;delayed:step(.3);assert(calls==before+1 and not delayed.active,'game-exited squeeze kept draining')
print('PASS: exact native dispatcher immediately follows fresh hand trace; 0.3s cadence, first tick, native timer cancellation, at-most-once hitch handling, release, invalid time and lost pawn.')
`);
const source=fs.readFileSync(SRC+'/squeeze.lua','utf8');
assert(!source.includes('InteractWithUI')&&!source.includes('currentShakeMeterValue='));
