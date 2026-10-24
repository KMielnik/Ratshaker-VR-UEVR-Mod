const SRC=require('path').resolve(__dirname,'../src');
const fs=require('fs');
const {lua,lauxlib,lualib,to_luastring,to_jsstring}=require('fengari');
const L=lauxlib.luaL_newstate();lualib.luaL_openlibs(L);
function run(s){if(lauxlib.luaL_dostring(L,to_luastring(s))!==lua.LUA_OK)throw Error(to_jsstring(lua.lua_tostring(L,-1)));}
for(const [name,file]of [['IK','ik_math.lua'],['Rendering','rendering.lua']])run(name+'=(function()\n'+fs.readFileSync(SRC+'/'+file,'utf8')+'\nend)()');
run(`
local V=IK.vector
local id=0
local made={}
local classes={}
local meshes={}
local world
local discovery_calls=0
local function obj(kind)
 id=id+1
 local o={id=id,alive=true,kind=kind,LightingChannels={bChannel0=true,bChannel1=false,bChannel2=false}}
 function o:get_address()return self.id end
 function o:get_full_name()return self.full_name or self.kind end
 function o:get_outer()return self.outer end
 function o:get_class()return {find_property=function(_,n)return self[n]~=nil and {} or nil end,
  find_function=function(_,n)return type(self[n])=='function' and {} or nil end}end
 function o:SetLightingChannels(a,b,c)self.LightingChannels={bChannel0=a,bChannel1=b,bChannel2=c}end
 function o:K2_GetComponentToWorld()return {Translation={x=10,y=10,z=10},Rotation={x=0,y=0,z=0,w=1},Scale3D={x=1,y=1,z=1}}end
 function o:K2_AttachToComponent(p)self.parent=p end
 function o:K2_SetRelativeTransform(t)self.transform=t end
 function o:K2_DestroyComponent()self.alive=false end
 function o:SetVisibility(v)self.visible=v end
 for _,n in ipairs({'SetMobility','SetCastShadows','SetLightColor','SetUseInverseSquaredFalloff','SetLightFalloffExponent','SetAttenuationRadius','SetInverseExposureBlend','SetIndirectLightingIntensity','SetVolumetricScatteringIntensity','SetIntensity'}) do
  o[n]=function(self,v)self[n..'_value']=v end
 end
 function o:AddComponentByClass(c)
  assert(c.name=='Engine.PointLightComponent','attempted other component')
  local c=obj('light');made[#made+1]=c
  if self.fail_light and #made%2==0 then c.SetLightingChannels=nil end
  return c
 end
 return o
end
local collections={}
for _,p in ipairs(Rendering.parameters)do collections[p.path]=obj('collection') end
local global=collections[Rendering.parameters[1].path]
global.values={PixelSize=512,GridSize=.5}
local vhs=collections[Rendering.parameters[2].path]
vhs.values={Pixelate_Scale=256,Noise_Strength=.1,On=1}
local lib=obj('materiallib')
function lib:GetScalarParameterValue(world,asset,name)return assert(asset.values[name])end
function lib:SetScalarParameterValue(world,asset,name,value)
 assert(name=='PixelSize' or name=='Pixelate_Scale' or name=='GridSize','unrelated parameter changed')
 asset.values[name]=value
end
local mathlib=obj('mathlib');function mathlib:MakeColor(r,g,b,a)return {r=r,g=g,b=b,a=a}end
for _,name in ipairs({'Engine.PointLightComponent','Engine.KismetMaterialLibrary','Engine.KismetMathLibrary','Engine.MeshComponent','Engine.World'})do
 local c=obj('class');c.name=name
 function c:get_class_default_object()return name=='Engine.KismetMaterialLibrary' and lib or mathlib end
 classes['Class /Script/'..name]=c
end
local function material(path,grid,dynamic)
 local m=obj(dynamic and 'mid' or 'material');m.values={CustomGridSize=grid}
 m.full_name=path
 function m:K2_GetScalarParameterValue(n)return self.values[n] or self.Parent:K2_GetScalarParameterValue(n)end
 if dynamic then function m:SetScalarParameterValue(n,v)
  assert(n=='CustomGridSize','unrelated material parameter changed');self.values[n]=v
  if self.fail_set then self.fail_set=false;error('setter failed after write')end
 end end
 return m
end
local bodybase=material('Material /Game/Ratshaker/CA/TheRat2D/SupporterPack/MT_Rat2D_V2.MT_Rat2D_V2',.5)
local psm=material('Material /Game/Ratshaker/MAT/PSM/MT_PSM.MT_PSM',2.5)
local tailbase=material('Material /Game/Ratshaker/CA/TheRat2D/MT_Rat2D_Tail.MT_Rat2D_Tail',.01)
local body=material('MaterialInstanceDynamic RatBody',.5,true);body.Parent=bodybase
local tail=material('MaterialInstanceDynamic RatTail',.01,true);tail.Parent=tailbase
body.values.frame=7;body.values.choke=.4;body.values.skin='native'
local function mesh(materials)
 local m=obj('mesh');m.outer=world;m.materials=materials
 function m:GetNumMaterials()return #self.materials end
 function m:GetMaterial(i)return self.materials[i+1]end
 function m:SetMaterial(i,v)self.materials[i+1]=v end
 function m:CreateDynamicMaterialInstance(i,source)
  assert(not source.SetScalarParameterValue,'replaced existing native MID')
  local child=material('MaterialInstanceDynamic VRChild',source:K2_GetScalarParameterValue('CustomGridSize'),true)
  child.Parent=source;self.materials[i+1]=child
  if self.fail_child then child.fail_set=true end
  return child
 end
 return m
end
world=obj('world');function world:get_class()return classes['Class /Script/Engine.World']end
local house_source=material('MaterialInstanceConstant House',2.5);house_source.Parent=psm
local house=mesh({house_source})
local unrelated=material('Material /Game/Unrelated.Unrelated',10)
local unrelated_mesh=mesh({unrelated})
local foreign=mesh({house_source});foreign.outer=obj('other-world')
function foreign.outer:get_class()return classes['Class /Script/Engine.World']end
meshes={house,unrelated_mesh,foreign}
local load_fail=false
local logs={}
local env={uevr={api={find_uobject=function(_,name)return classes[name]end},sdk={UObjectHook={get_objects_by_class=function(cls,defaults)
 discovery_calls=discovery_calls+1;assert(cls==classes['Class /Script/Engine.MeshComponent']and defaults==false);return meshes
 end}}},IK=IK,
 valid=function(o)return o and o.alive end,
 call=function(o,n,...)assert(o and o.alive,'invalid object');assert(type(o[n])=='function','missing '..n);return o[n](o,...)end,
 visuals={load_asset=function(_,path)if load_fail and path==Rendering.parameters[2].path then error('asset unavailable')end;return assert(collections[path])end},
 write_transform=function(t,v)for k,x in pairs(v)do t[k]=x end end,
 log=function(s)logs[#logs+1]=s end}
local pawn=obj('pawn');pawn.outer=world;pawn.Rat2D=mesh({body,tail});pawn.Rat2D.native_material={frame=7,choke=.4,texture='original'}
local original=pawn.Rat2D.native_material
local r=Rendering.new(env);r:update(pawn,nil,.016)
assert(global.values.PixelSize==8192 and vhs.values.Pixelate_Scale==8192,'pixel overrides missing')
assert(global.values.GridSize==Rendering.vertex_grid and vhs.values.Noise_Strength==.1 and vhs.values.On==1,'unrelated PP changed')
assert(#r.lights==2 and pawn.Rat2D.LightingChannels.bChannel2)
assert(body.values.CustomGridSize==Rendering.vertex_grid and tail.values.CustomGridSize==Rendering.vertex_grid)
assert(pawn.Rat2D:GetMaterial(0)==body and pawn.Rat2D:GetMaterial(1)==tail,'native rat MID replaced')
assert(house:GetMaterial(0)~=house_source and house:GetMaterial(0).Parent==house_source)
assert(house:GetMaterial(0).values.CustomGridSize==Rendering.vertex_grid)
assert(unrelated_mesh:GetMaterial(0)==unrelated and unrelated.values.CustomGridSize==10)
assert(foreign:GetMaterial(0)==house_source,'foreign world changed')
assert(pawn.Rat2D.native_material==original and original.frame==7 and original.choke==.4)
for _,light in ipairs(r.lights)do
 assert(light.visible and light.parent==pawn.Rat2D)
 assert(light.LightingChannels.bChannel2 and not light.LightingChannels.bChannel0 and not light.LightingChannels.bChannel1)
 assert(light.SetAttenuationRadius_value==80 and light.SetCastShadows_value==false)
 assert(light.SetUseInverseSquaredFalloff_value==false and light.SetIntensity_value==2)
 assert(math.abs(V.length(V.sub(light.transform.Translation,V.new(-9.99711799621582,5.67260479927063,-2.886479377746582)))-35)<1e-7)
end
-- Repeated updates reuse lights and reassert only the requested collection values.
global.values.PixelSize=400;r:update(pawn,nil,1.1);assert(global.values.PixelSize==8192 and #made==2)
r:set_pixel_resolution(4096);r:update(pawn,nil,.01);assert(global.values.PixelSize==4096 and global.values.GridSize==Rendering.vertex_grid)
assert(not pcall(function()r:set_pixel_resolution(0)end))
local lights={table.unpack(r.lights)};r:pause();r:pause()
assert(global.values.PixelSize==512 and vhs.values.Pixelate_Scale==256 and global.values.GridSize==.5,'pause did not restore originals')
assert(house:GetMaterial(0)==house_source and body.values.CustomGridSize==.5 and tail.values.CustomGridSize==.01)
assert(body.values.frame==7 and body.values.choke==.4 and body.values.skin=='native')
assert(not pawn.Rat2D.LightingChannels.bChannel2 and pawn.Rat2D.LightingChannels.bChannel0)
for _,light in ipairs(lights)do assert(not light.alive and not light.visible)end
-- Recapture changed native settings on reentry; cleanup is idempotent.
global.values.PixelSize=1024;r:update(pawn,nil,.01);assert(global.values.PixelSize==4096)
r:cleanup();r:cleanup();assert(global.values.PixelSize==1024)
-- Failure to resolve second collection restores the first, without blocking lights.
load_fail=true;r:update(pawn,nil,.01)
assert(global.values.PixelSize==1024 and #r.parameters==0 and #r.lights==2)
assert(r.diagnostics.pixelation=='unavailable');r:cleanup();load_fail=false
-- Partial light creation failure destroys owned parts and restores native channels.
pawn.fail_light=true;r:update(pawn,nil,.01)
assert(#r.lights==0 and not pawn.Rat2D.LightingChannels.bChannel2)
assert(r.diagnostics.rat_lighting=='unavailable' and global.values.PixelSize==4096)
for _,light in ipairs(made)do assert(not light.alive,'partial creation leaked light')end
r:cleanup();pawn.fail_light=false
-- Missing reflected channel snapshot preserves native lighting, no blind writes.
pawn.Rat2D.LightingChannels=nil;r:update(pawn,nil,.01)
assert(#r.lights==0 and pawn.Rat2D.LightingChannels==nil)
r:cleanup()
-- Late material replacement wins; native live frame/choke updates survive cleanup.
pawn.Rat2D.LightingChannels={bChannel0=true,bChannel1=false,bChannel2=false}
r:update(pawn,nil,6)
local installed=house:GetMaterial(0)
local replacement=material('Material /Game/NewEffect.NewEffect',7)
house:SetMaterial(0,replacement);body.values.frame=9;body.values.choke=.7
r:cleanup()
assert(house:GetMaterial(0)==replacement,'cleanup overwrote game material replacement')
assert(body.values.frame==9 and body.values.choke==.7 and body.values.CustomGridSize==.5)
house:SetMaterial(0,house_source)
-- Partial instance setter failure restores local changes while the global grid, pixels and lights work.
house.fail_child=true;r:update(pawn,nil,6)
assert(global.values.GridSize==Rendering.vertex_grid and house:GetMaterial(0)==house_source)
assert(body.values.CustomGridSize==.5 and tail.values.CustomGridSize==.01)
assert(r.diagnostics.vertex_instances=='unavailable' and global.values.PixelSize==4096 and #r.lights==2)
r:cleanup();house.fail_child=false
-- Reassert global once per second and material controls on the next bounded sweep.
r:update(pawn,nil,6);local snapshots=discovery_calls
body.values.CustomGridSize=3;global.values.GridSize=2;r:update(pawn,nil,1.1)
assert(global.values.GridSize==Rendering.vertex_grid and body.values.CustomGridSize==3)
assert(discovery_calls==snapshots,'mesh discovery occurred faster than five seconds')
r:update(pawn,nil,4);assert(body.values.CustomGridSize==Rendering.vertex_grid)
r:cleanup()
-- The runtime's global hook works without an env.uevr.sdk namespace.
UEVR_UObjectHook=env.uevr.sdk.UObjectHook;env.uevr.sdk=nil
r:update(pawn,nil,6);assert(body.values.CustomGridSize==Rendering.vertex_grid);r:cleanup()
-- Discovery missing leaves the independently verified global control in place.
local saved_hook=UEVR_UObjectHook;UEVR_UObjectHook=nil
r:update(pawn,nil,6);assert(global.values.GridSize==Rendering.vertex_grid)
assert(r.diagnostics.vertex_instances=='unavailable' and body.values.CustomGridSize==.5)
r:cleanup();UEVR_UObjectHook=saved_hook
-- Shared native MID is captured once, so restoration never saves the already-overridden value.
local shared=mesh({body});meshes={house,shared}
r:update(pawn,nil,6);assert(r.grid_count==3);r:cleanup();assert(body.values.CustomGridSize==.5)
-- A finite component budget prevents per-frame unbounded material calls.
meshes={};for i=1,24 do meshes[i]=mesh({house_source})end
r:update(pawn,nil,6)
assert(r.grid_cursor==9 and meshes[7]:GetMaterial(0)~=house_source and meshes[8]:GetMaterial(0)==house_source)
r:update(pawn,nil,.016);assert(r.grid_cursor==17)
r:cleanup();for _,m in ipairs(meshes)do assert(m:GetMaterial(0)==house_source)end
-- Pawn/world transition restores the old world before applying the new one.
meshes={house};local other=obj('pawn');other.outer=world;other.Rat2D=mesh({body,tail})
r:update(pawn,nil,6);r:update(other,nil,.016);assert(r.pawn==other)
r:cleanup();assert(global.values.GridSize==.5 and house:GetMaterial(0)==house_source)
-- Photographs keep their original shaders/textures/shimmer and native scene channels.
local photo_names={};for name in pairs(Rendering.photo_meshes)do photo_names[#photo_names+1]=name end
table.sort(photo_names)
local function photo(which)
 local native=material('MaterialInstanceDynamic NativePhoto',1,true);native.Parent=psm
 native.values.texture='original photo';native.values.shimmer='native'
 local m=mesh({native});m.StaticMesh=obj('asset');m.StaticMesh.full_name=photo_names[which or 1]
 m.visible=true
 function m:IsVisible()return self.visible end
 function m:K2_GetComponentToWorld()
  return {Translation={x=self.x or 10,y=10,z=10},Rotation={x=0,y=0,z=0,w=1},Scale3D={x=1,y=1,z=1}}
 end
 return m,native
end
local p1,p1mat=photo(1);local p2,p2mat=photo(2);local hidden=photo(3);hidden.visible=false
local far=photo(4);far.outer=foreign.outer
local impostor=photo(1);impostor.StaticMesh.full_name=photo_names[1]..'_Unrelated'
meshes={p1,p2,hidden,far,impostor};pawn.SM_PhotoPart1=p1;pawn.SM_PhotoPart2=p2
r:update(pawn,nil,6)
assert(r.cfg.fill_strength==.5 and r.cfg.fill_intensity==2 and r.photo_count==2)
assert(p1.LightingChannels.bChannel0 and p1.LightingChannels.bChannel1 and not p1.LightingChannels.bChannel2)
assert(pawn.Rat2D.LightingChannels.bChannel2 and not pawn.Rat2D.LightingChannels.bChannel1,'photo fill would relight rat')
assert(not hidden.LightingChannels.bChannel1 and not far.LightingChannels.bChannel1 and not impostor.LightingChannels.bChannel1)
assert(p1:GetMaterial(0)==p1mat and p2:GetMaterial(0)==p2mat and p1mat.values.texture=='original photo' and p1mat.values.shimmer=='native')
for _,entry in pairs(r.photo_targets)do
 assert(#entry.lights==2 and entry.overlapping==2)
 for _,light in ipairs(entry.lights)do
  assert(light.parent==entry.component and light.LightingChannels.bChannel1 and not light.LightingChannels.bChannel2)
  assert(light.SetAttenuationRadius_value==50 and light.SetIntensity_value==1,'overlapping fragments doubled fill')
  assert(math.abs(math.abs(light.transform.Translation.x)-35)<1e-7)
 end
end
-- Separation gets independent fill again; return to one plane shares it.
p2.x=100;r:update(pawn,nil,.3)
assert(r.photo_targets[p1.id].lights[1].SetIntensity_value==2 and r.photo_targets[p2.id].lights[1].SetIntensity_value==2)
p2.x=10;r:update(pawn,nil,.3);assert(r.photo_targets[p1.id].lights[1].SetIntensity_value==1)
-- Configuration writes from the UI make no native calls until the game tick.
local old_rat=r.lights[1];local old_photo=r.photo_targets[p1.id].lights[1]
r:set_fill_strength(.25)
assert(old_rat.SetIntensity_value==2 and old_photo.SetIntensity_value==1,'UI setter made native calls')
r:update(pawn,nil,.01)
assert(old_rat.SetIntensity_value==1 and old_photo.SetIntensity_value==.5)
assert(not pcall(r.set_fill_strength,r,-.1) and not pcall(r.set_fill_strength,r,1.1) and not pcall(r.set_fill_strength,r,0/0))
-- A missing/unregistered light recovers while the same pawn survives.
local partner=r.lights[2];old_rat.alive=false;r:update(pawn,nil,.01)
assert(r.lights[1]~=old_rat and r.lights[1].alive and not partner.alive and r.pawn==pawn)
local photo_partner=r.photo_targets[p1.id].lights[2]
function old_photo:IsRegistered()return false end
r:update(pawn,nil,.01)
assert(r.photo_targets[p1.id].lights[1]~=old_photo and not old_photo.alive and not photo_partner.alive)
-- Hidden fragments immediately release their fill/channel; siblings rebalance.
p2.visible=false;r:update(pawn,nil,.01)
assert(r.photo_count==1 and not p2.LightingChannels.bChannel1 and r.photo_targets[p1.id].lights[1].SetIntensity_value==1)
-- Zero means native lighting: remove all owned light/channel changes and remain off.
r:set_fill_strength(0);assert(#r.lights==2,'configuration setter destroyed lights from UI')
r:update(pawn,nil,.01)
assert(#r.lights==0 and r.photo_count==0 and not pawn.Rat2D.LightingChannels.bChannel2 and not p1.LightingChannels.bChannel1)
local made_at_zero=#made;r:update(pawn,nil,6);assert(#made==made_at_zero and r.diagnostics.rat_lighting=='native scene lighting')
r:set_fill_strength(.5);r:update(pawn,nil,.01);assert(#r.lights==2 and r.photo_count==1)
-- Preserve native changes to channels we did not add, and existing channel1.
p1:SetLightingChannels(false,true,true)
r:cleanup();assert(not p1.LightingChannels.bChannel0 and not p1.LightingChannels.bChannel1 and p1.LightingChannels.bChannel2)
p1:SetLightingChannels(true,true,false);r:update(pawn,nil,6);r:cleanup();assert(p1.LightingChannels.bChannel1)
p1:SetLightingChannels(true,false,false)
-- A photo-specific partial failure rolls back and waits five seconds; rat works.
local original_channels=p1.SetLightingChannels
function p1:SetLightingChannels(a,b,c)
 original_channels(self,a,b,c)
 if self.fail_channels then self.fail_channels=false;error('photo channel failed after write')end
end
p1.fail_channels=true;r:update(pawn,nil,6)
assert(r.photo_count==0 and not p1.LightingChannels.bChannel1 and #r.lights==2)
local before_retry=#made;r:update(pawn,nil,.1);assert(#made==before_retry)
r:update(pawn,nil,5.1);assert(r.photo_count==1)
r:cleanup()
-- Exact mesh replacement retires the old lights without replacing its material.
r:update(pawn,nil,6);local old_pair={table.unpack(r.photo_targets[p1.id].lights)}
p1.StaticMesh.full_name='StaticMesh /Game/Unrelated.Unrelated';r:update(pawn,nil,.01)
assert(r.photo_count==0 and not p1.LightingChannels.bChannel1 and p1:GetMaterial(0)==p1mat)
for _,light in ipairs(old_pair)do assert(not light.alive)end
r:cleanup();pawn.SM_PhotoPart1=nil;pawn.SM_PhotoPart2=nil
-- World component sweep stays bounded and visible-photo targets have a hard cap.
meshes={};for i=1,12 do meshes[i]=photo((i-1)%4+1);meshes[i].x=i*100 end
r:update(pawn,nil,6);assert(r.photo_count==8 and r.photo_cursor==9)
r:update(pawn,nil,.01);assert(r.photo_count==8 and r.diagnostics.photo_limit_reached)
local first=meshes[1];local first_light=r.photo_targets[first.id].lights[1];first_light.alive=false
r:update(pawn,nil,.01);assert(r.photo_targets[first.id] and r.photo_targets[first.id].lights[1]~=first_light,'world photo light loss waited for a sweep')
r:cleanup();for _,m in ipairs(meshes)do assert(not m.LightingChannels.bChannel1)end
print('PASS rendering: preserved pixel/grid/native material controls; half-strength rat/photo fill, exact mesh/world/visibility scope, co-located brightness sharing, UI-safe strength control and zero/native mode, surviving-pawn light recovery, bounded targets/scans, channel ownership, retries and cleanup')
`);
