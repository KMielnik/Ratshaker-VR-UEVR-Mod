const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {lua,lauxlib,lualib,to_luastring,to_jsstring}=require('fengari');
const runtime=fs.readFileSync(path.join(__dirname,'../src/runtime.lua'),'utf8');
const nativeGate=runtime.match(/local function native_gate\([\s\S]*?(?=\nlocal function rat_parent)/)[0];
const L=lauxlib.luaL_newstate();lualib.luaL_openlibs(L);
function run(code){if(lauxlib.luaL_dostring(L,to_luastring(code))!==lua.LUA_OK)throw Error(to_jsstring(lua.lua_tostring(L,-1)));}
run(`local S={pawn={}};local function valid(o)return o~=nil end\n${nativeGate}\n
for _,strength in ipairs({0,.1,.5,1})do
 native_gate(true,strength)
 local x,y=S.pawn.targetMouseInputAxisXValue,S.pawn.targetMouseInputAxisYValue
 assert(x>0 and y==0 and S.pawn.NewVar<0,'native shake/audio bridge must select exactly one axis')
end
native_gate(false,1)
assert(S.pawn.targetMouseInputAxisXValue==0 and S.pawn.targetMouseInputAxisYValue==0 and S.pawn.NewVar>0,'inactive bridge enables shaking')
`);
assert(runtime.includes('IncrementShakeCounterAndDetectIfShaking'));
assert(!/currentShakeMeterValue\s*=/.test(runtime),'native meter must not be written directly');
console.log('PASS: actual native shake bridge gates motion and selects one nonzero audio axis');
