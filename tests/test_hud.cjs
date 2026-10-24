const SRC=require('path').resolve(__dirname,'../src');
const fs=require('fs');
const {lua,lauxlib,lualib,to_luastring,to_jsstring}=require('fengari');
const L=lauxlib.luaL_newstate();lualib.luaL_openlibs(L);
function run(s){if(lauxlib.luaL_dostring(L,to_luastring(s))!==lua.LUA_OK)throw Error(to_jsstring(lua.lua_tostring(L,-1)));}
run('HUD=(function()\n'+fs.readFileSync(SRC+'/hud.lua','utf8')+'\nend)()');
run(`
local address=0
local function object()
 address=address+1;local o={alive=true,address=address,visibility=4,opacity=.85}
 function o:get_address()return self.address end
 function o:GetVisibility()return self.visibility end
 function o:SetVisibility(v)self.visibility=v end
 function o:GetRenderOpacity()return self.opacity end
 function o:SetRenderOpacity(v)self.opacity=v end
 return o
end
local a,b=object(),object();b.visibility=3;b.opacity=.6
local view=object();view.refInputList=a
-- Any access to the meter fails: only input-list suppression is permitted.
setmetatable(view,{__index=function(_,name)error('Unexpected HUD access '..name)end})
local controller=object();function controller:GetHUD()return view end
local adapter=HUD.new({valid=function(o)return o and o.alive end,
 call=function(o,name,...)assert(o.alive);return o[name](o,...)end})
adapter:update(controller);assert(a.visibility==1 and a.opacity==0)
adapter:update(controller);adapter:pause();assert(a.visibility==4 and a.opacity==.85,'repeated updates lost original prompt state')
adapter:update(controller);view.refInputList=b;adapter:update(controller)
assert(a.visibility==4 and a.opacity==.85 and b.visibility==1 and b.opacity==0,'HUD replacement did not transfer ownership')
adapter:cleanup();assert(b.visibility==3 and b.opacity==.6,'replacement HUD failed restoration')
adapter:update(controller);b.alive=false;adapter:pause()
view.refInputList=nil;adapter:update(controller)
print('PASS: only mouse prompts hidden; native meter never accessed; repeated update, pause, replacement HUD, destroyed widget and cleanup handled.')
`);
