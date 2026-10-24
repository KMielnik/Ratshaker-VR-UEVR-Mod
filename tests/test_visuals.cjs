const SRC=require('path').resolve(__dirname,'../src');
const fs=require('fs');
const assert=require('assert/strict');
const {lua,lauxlib,lualib,to_luastring,to_jsstring}=require('fengari');
const source=fs.readFileSync(SRC+'/visuals.lua','utf8');
for(const removed of ['build_meter','hide_native_meter','refShakeMeter','Fillbar','SetRenderOpacity','SetColorAndOpacity','currentShakeMeterValue','PoseableMeshComponent','CopyPoseFromSkeletalComponent','ShowMaterialSection'])
 assert(!source.includes(removed),'Removed native HUD/rat mutation returned: '+removed);
const L=lauxlib.luaL_newstate();lualib.luaL_openlibs(L);
function run(s){if(lauxlib.luaL_dostring(L,to_luastring(s))!==lua.LUA_OK)throw Error(to_jsstring(lua.lua_tostring(L,-1)));}
run('IK=(function()\n'+fs.readFileSync(SRC+'/ik_math.lua','utf8')+'\nend)()');
run('Visuals=(function()\n'+source+'\nend)()');
run(`
local V,Q=IK.vector,IK.quaternion
local function cp(t)if type(t)~='table'then return t end;local r={};for k,v in pairs(t)do r[k]=cp(v)end;return r end
local function T(x,y,z)return {Translation=V.new(x,y,z),Rotation={x=0,y=0,z=0,w=1},Scale3D=V.new(1,1,1)}end
local cube_path='/Engine/BasicShapes/Cube.Cube'
local overlay_path='/Engine/EngineDebugMaterials/M_SimpleUnlitTranslucent.M_SimpleUnlitTranslucent'
local collection_path='/Game/Test/MPC_Render.MPC_Render'
local address,objects,created,last_created=0,{},0,nil
local fail_method,fail_final_visibility,dyn_nil,fail_destroy=nil,false,false,false
local function object(kind,path)
 address=address+1
 local o={kind=kind,address=address,alive=true,visible=true,world=T(0,0,0),materials={},writes=0,
  full_name=path and kind..' '..path or kind..'_'..address}
 function o:get_address()return self.address end
 function o:get_full_name()return self.full_name end
 function o:get_class()return {find_function=function(_,n)return type(self[n])=='function' and {} or nil end,
  find_property=function(_,k)return rawget(self,k)~=nil and {} or nil end}end
 function o:K2_GetComponentToWorld()return cp(self.world)end
 function o:K2_SetWorldTransform(t)self.writes=self.writes+1;self.world=cp(t)end
 function o:K2_SetRelativeTransform(t)self.writes=self.writes+1;self.relative=cp(t)end
 function o:K2_AttachToComponent(p)self.writes=self.writes+1;self.parent=p end
 function o:K2_DestroyComponent()self.writes=self.writes+1;self.alive=false end
 function o:SetVisibility(b)self.writes=self.writes+1;self.visible=b end
 function o:SetStaticMesh(m)self.writes=self.writes+1;self.mesh=m end
 function o:CreateDynamicMaterialInstance(i,base)
  assert(base.bDisableDepthTest,'depth flag must precede MID creation')
  if dyn_nil then return nil end
  self.base=base;local dyn=object('MaterialInstanceDynamic');self.materials[i+1]=dyn;return dyn
 end
 function o:SetVectorParameterValue(key,val)self[key]=cp(val)end
 function o:SetTranslucentSortPriority(n)self.sort=n end
 for _,n in ipairs({'SetCollisionEnabled','SetGenerateOverlapEvents','SetCastShadow','SetReceivesDecals','SetOnlyOwnerSee'})do o[n]=function()end end
 objects[#objects+1]=o;return o
end
local function new_material()
 local m=object('Material',overlay_path);m.bDisableDepthTest=false;m.BlendMode=2;m.ShadingModel=0;return m
end
local material,cube,collection=new_material(),object('StaticMesh',cube_path),object('MaterialParameterCollection',collection_path)
local asset=object('SkeletalMesh','/Game/Ratshaker/CA/TheRat2D/SKM_Rat2D.SKM_Rat2D')
local mathlib=object('Math');function mathlib:MakeColor(r,g,b,a)return {R=r,G=g,B=b,A=a}end
local sys=object('System');function sys:MakeSoftObjectPath()error('unnecessary soft object conversion')end
local registry,helpers=object('AssetRegistry'),object('AssetRegistryHelpers')
local loads,lookups,finds=0,0,0
local discovery_fault=false
local assets={[cube_path]=cube,[overlay_path]=material,[collection_path]=collection}
local discovered={}
function helpers:GetAssetRegistry()return registry end
function helpers:GetAsset(data)loads=loads+1;assert(data.native=='AssetData');return assets[data.path]end
local function registry_lookup(context,path,on_disk)
 assert(context==registry and type(path)=='string' and on_disk==false);lookups=lookups+1
 return {native='AssetData',path=path}
end
local interface={find_function=function(_,n)
 if n=='GetAssetByObjectPath'then return setmetatable({},{__call=function(_,context,...)return registry_lookup(context,...)end})end
end}
local function klass(s)
 if s=='Class /Script/AssetRegistry.AssetRegistry'then return interface end
 return {kind=s,get_class_default_object=function()
  return s:find('AssetRegistryHelpers') and helpers or(s:find('KismetMath') and mathlib or sys)end}
end
local api={find_uobject=function(_,s)if s:find('Class ')then return klass(s)end;finds=finds+1
 if discovery_fault then error('native discovery exception after travel') end
 return discovered[s]end}
local function make_pawn()
 local pawn=object('Pawn');pawn.RootComponent=object('Root');pawn.FirstPersonMesh=object('Arms')
 local rat=object('Rat');rat.SkeletalMesh=asset;rat.bones={RatTop1=T(1,2,3)};rat.materials={object('AnimatedMID'),object('TailMID')}
 pawn.Rat2D=rat
 function pawn:AddComponentByClass(c)created=created+1;last_created=object(c.kind);return last_created end
 -- Any access would reintroduce native meter coupling, even if no write occurs.
 setmetatable(pawn,{__index=function(_,key)if key=='ACOMP_ShakeMeter'then error('native meter accessed')end end})
 return pawn,rat
end
local pawn,rat=make_pawn()
local controller=object('Controller');function controller:GetHUD()error('Visuals must not access UMG/HUD')end
local function valid(o)return o and o.alive end
local function write(target,pose)for k,v in pairs(pose)do target[k]=cp(v)end end
local env={uevr={api=api},valid=valid,call=function(o,n,...)
 assert(type(o[n])=='function','Missing reflected '..n)
 if n==fail_method or (fail_final_visibility and n=='SetVisibility' and select(1,...)==true) or
  (fail_destroy and n=='K2_DestroyComponent')then error('injected '..n)end
 return o[n](o,...)
end,snapshot=cp,write_transform=write,IK=IK,log=function()end}
local v=Visuals.new(env)
v:update(pawn,controller,.02)
assert(v.back==rat and #v.backs==0 and #v.parts==0 and #v.owned==0 and created==0,'update created replacement geometry')
assert(v.fill==nil and v.percent==nil and v.widget==nil and loads==0,'native-only update retained meter state/assets')
assert(v.diagnostics.rat.mode=='native front only' and not v.diagnostics.rat.two_sided_complete)
-- Loader supports the real registry interface, direct lookup and rendering MPCs.
assert(v:load_asset(cube_path,'StaticMesh')==cube and loads==1 and lookups==1)
assert(v:load_asset(cube_path,'StaticMesh')==cube and loads==1,'valid identity was not cached')
assert(v:load_asset(collection_path,'MaterialParameterCollection')==collection)
local lookups_before=lookups
function registry:GetAssetByObjectPath(path,on_disk)return registry_lookup(self,path,on_disk)end
local direct=Visuals.new(env);assert(direct:load_asset(cube_path,'StaticMesh')==cube);direct:cleanup()
assert(lookups==lookups_before+1);registry.GetAssetByObjectPath=nil
-- Dead cache, then live alien at the same address: neither is an owned asset.
local stale=cube;stale.alive=false;cube=object('StaticMesh',cube_path);assets[cube_path]=cube
local before_finds=finds
assert(v:load_asset(cube_path,'StaticMesh')==cube and finds==before_finds,'invalid cache did not force registry reload')
local reused=cube;local reused_address=reused.address;reused.full_name='StaticMesh /Game/Other.Alien'
cube=object('StaticMesh',cube_path);cube.address=reused_address;assets[cube_path]=cube
assert(v:load_asset(cube_path,'StaticMesh')==cube and v.assets[cube_path]~=reused,'same-address alien cache survived')
-- find_uobject and AssetRegistry must both return the exact requested type/path.
local wrong=object('Material',cube_path);discovered['StaticMesh '..cube_path]=wrong
local reject=Visuals.new(env);assets[cube_path]=wrong
local ok,err=pcall(reject.load_asset,reject,cube_path,'StaticMesh')
assert(not ok and tostring(err):find('identity mismatch') and reject.assets[cube_path]==nil)
assets[cube_path]=cube;before_finds=finds
assert(reject:load_asset(cube_path,'StaticMesh')==cube and finds==before_finds,'rejected lookup did not force registry reload')
reject:cleanup();discovered={}
-- Native asset lookup itself can throw before a UObject is returned. Recovery
-- must bypass that discovery path, not just retry the same failed call.
local after_travel=Visuals.new(env);discovery_fault=true;before_finds=finds
assert(after_travel:load_asset(cube_path,'StaticMesh')==cube and finds==before_finds+1)
assert(after_travel:load_asset(cube_path,'StaticMesh')==cube and finds==before_finds+1)
discovery_fault=false;after_travel:cleanup()
local name_fault=object('StaticMesh',cube_path);function name_fault:get_full_name()error('stale native wrapper')end
v.assets[cube_path]=name_fault;assert(v:load_asset(cube_path,'StaticMesh')==cube,'full_name failure was accepted')
-- First successful overlay, then early/streaming BlendMode=0 on a cached object.
assert(v:get_overlay_material()==material and material.bDisableDepthTest)
material.BlendMode=0
ok,err=pcall(v.get_overlay_material,v)
assert(not ok and tostring(err):find('BlendMode=0') and v.assets[overlay_path]==nil and v.diagnostics.overlay==nil)
assert(material.BlendMode==0 and material.ShadingModel==0,'cooked shader properties were forced')
local early=material;material=new_material();assets[overlay_path]=material
-- Direct discovery still returns the failed object; registry reload must bypass it.
discovered['Material '..overlay_path]=early;before_finds=finds
assert(v:get_overlay_material()==material and finds==before_finds and material.bDisableDepthTest,'overlay retry did not recover')
-- Readiness must not be inferred when the reflected shader enum is absent.
material.ShadingModel=nil;ok=pcall(v.get_overlay_material,v)
assert(not ok and v.assets[overlay_path]==nil);material.ShadingModel=0
assert(v:get_overlay_material()==material)
-- Every post-allocation failure must destroy/untrack the partial native object.
local pose=T(2,3,4)
for _,method in ipairs({'SetStaticMesh','SetCollisionEnabled','CreateDynamicMaterialInstance','MakeColor',
 'SetVectorParameterValue','K2_AttachToComponent','K2_SetRelativeTransform','K2_SetWorldTransform'})do
 fail_method=method
 local parent=method=='K2_SetWorldTransform' and nil or pawn.RootComponent
 -- Lua's and/or expression cannot produce nil when the fallback is non-nil.
 if method=='K2_SetWorldTransform'then parent=nil end
 ok=pcall(v.make_part,v,pawn,parent,cube,material,'failed part',pose,{.1,.2,.3,1})
 assert(not ok and not last_created.alive and #v.owned==0 and #v.parts==0,'partial component leaked: '..method)
 fail_method=nil
end
dyn_nil=true;ok=pcall(v.make_part,v,pawn,nil,cube,material,'nil MID',pose,{1,1,1,1});dyn_nil=false
assert(not ok and not last_created.alive and #v.owned==0)
fail_final_visibility=true;ok=pcall(v.make_part,v,pawn,nil,cube,material,'final visibility',pose,{1,1,1,1});fail_final_visibility=false
assert(not ok and not last_created.alive and #v.parts==0)
local interrupted=Visuals.new(env)
fail_method='SetStaticMesh';fail_destroy=true
ok=pcall(interrupted.make_part,interrupted,pawn,nil,cube,material,'delayed cleanup',pose,{1,1,1,1})
fail_method=nil;fail_destroy=false
assert(not ok and last_created.alive and not last_created.visible and #interrupted.owned==1,'failed destroy lost ownership')
interrupted:cleanup();assert(not last_created.alive,'lifecycle cleanup did not retry failed destruction')
local part=v:make_part(pawn,pawn.RootComponent,cube,material,'pointer part',pose,{r=.1,g=.2,b=.3,a=0})
assert(part.alive and part.parent==pawn.RootComponent and part.relative.Translation.y==3 and part.materials[1].Color.A==0)
assert(#v.owned==1 and #v.parts==1)
assert(v:part_healthy(part))
local saved_material=part.materials[1]
saved_material.alive=false;assert(not v:part_healthy(part),'lost render material passed health check')
saved_material.alive=true
function part:GetMaterial(index)return self.materials[index+1]end
part.materials[1]=object('MaterialInstanceDynamic');assert(not v:part_healthy(part),'replacement material passed health check')
part.materials[1]=saved_material
fail_method='GetMaterial';assert(not v:part_healthy(part),'unreadable material passed health check');fail_method=nil
function part:IsRegistered()return false end
assert(not v:part_healthy(part),'unregistered component passed health check')
part.IsRegistered=nil;assert(v:part_healthy(part))
v:set_visible(false);assert(not part.visible and rat.visible and rat.writes==0)
v:set_visible(true);assert(part.visible)
-- Preserve actual native pose, skins, physics, transforms and visibility.
rat.SkeletalMesh=nil;local getter_calls=0
function rat:GetSkeletalMeshAsset()getter_calls=getter_calls+1;return asset end
function rat:GetSkinnedAsset()error('unnecessary legacy getter')end
v:build_back(pawn)
for i=1,200 do
 rat.world=T(i*.5,math.sin(i)*70,80+math.cos(i)*20)
 rat.world.Rotation=Q.normalize({x=math.sin(i*.3),y=math.cos(i*.7),z=math.sin(i*.19),w=.6})
 rat.world.Scale3D=V.new(.3+i*.003,(i%2==0 and -1 or 1)*(.5+i*.002),.8+i*.004)
 rat.final_physics_tail={x=i,y=math.cos(i)*10,z=i*2};rat.bones.RatTop1.Translation.z=i;rat.visible=i%2==0
 rat.materials[1]=object('AnimatedMID');local skin=rat.materials[1];local before=cp(rat.world)
 v:update(pawn,controller,.02);v:post_update()
 for _,axis in ipairs({'x','y','z'})do
  assert(rat.world.Translation[axis]==before.Translation[axis] and rat.world.Scale3D[axis]==before.Scale3D[axis] and
   rat.world.Rotation[axis]==before.Rotation[axis],'native rat transform changed')
 end
 assert(rat.writes==0 and rat.final_physics_tail.z==i*2 and rat.bones.RatTop1.Translation.z==i and
  rat.materials[1]==skin and rat.visible==(i%2==0) and #v.backs==0,'native rat was modified')
end
assert(getter_calls>0 and v.diagnostics.rat.source_frames==200)
-- Address reuse on a tracked material must never restore a flag on an alien.
local alien=material;alien.full_name='Material /Game/Other.Alien';alien.bDisableDepthTest=true
local next_pawn,next_rat=make_pawn();v:update(next_pawn,controller,.02)
assert(not part.alive and alien.bDisableDepthTest==true and early.bDisableDepthTest==false,'pawn cleanup leaked parts or wrote alien material')
assert(next(v.assets)==nil and next(v.materials)==nil and #v.parts==0 and v.back==next_rat,'pawn cleanup retained stale cache')
-- New pawn can recover independently, including a recycled material address.
material=new_material();material.address=alien.address;assets[overlay_path]=material;discovered={}
assert(v:get_overlay_material()==material and material.bDisableDepthTest)
v:cleanup();assert(material.bDisableDepthTest==false and alien.bDisableDepthTest==true)
assert(rat.alive and next_rat.alive and rat.writes==0 and next_rat.writes==0)
for i=1,3 do v:update(pawn,controller,.02);v:post_update();v:cleanup();assert(rat.alive and rat.writes==0)end
for _,o in ipairs(objects)do if o.kind=='Class /Script/Engine.StaticMeshComponent'then assert(not o.alive,'owned component survived cleanup')end end
print('PASS: native HUD untouched, no meter construction/state, zero rat clones/mutations under 200 poses; exact asset identities, invalid/alien/same-address caches, registry reload after early overlay rejection, new-pawn recovery, shader enums unchanged, partial factory rollback, and owned-pointer cleanup. Offline simulation only.')
`);
