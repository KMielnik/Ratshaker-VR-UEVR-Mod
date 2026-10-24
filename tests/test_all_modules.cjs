const SRC=require('path').resolve(__dirname,'../src');
// Execute the exact bundled artifact with every real Lua module. The host is a
// strict reflected-call fixture, not Unreal or evidence of headset rendering.
const fs=require('fs'),path=require('path'),assert=require('assert');
const {lua,lauxlib,lualib,to_luastring,to_jsstring}=require('fengari');
const L=lauxlib.luaL_newstate();lualib.luaL_openlibs(L);
function run(s){if(lauxlib.luaL_dostring(L,to_luastring(s))!==lua.LUA_OK)throw Error(to_jsstring(lua.lua_tostring(L,-1)));}
const base=fs.readFileSync(path.join(__dirname,'test_runtime.cjs'),'utf8');
const start=base.indexOf('run(`')+6,end=base.indexOf('`);',start);
assert(start>5&&end>start);
run(base.slice(start,end));
run(`
local cp=function(t)if type(t)~='table'then return t end;local r={};for k,v in pairs(t)do r[k]=_G.deepcopy(v)end;return r end
deepcopy=cp
hooks={};native_head_traces=0
local original_object=object
function object(kind)
 local o=original_object(kind);local cls=o:get_class()
 function cls:find_property(n)return o[n]~=nil and {} or nil end
 function cls:get_full_name()return o.kind end
 function cls:find_function(n)
  if type(o[n])~='function'then return nil end
  return {hook_ptr=function(_,pre,post)
   hooks[n]={pre=pre,post=post}
   if n=='UpdateMouseAxisInputValues'then axis_hook=post elseif n=='StartRatShakingMouseInput'then start_hook=post elseif n=='TriggerHeadBobCameraShake'then bob_hook=pre end
  end}
 end
 o.materials={};o.bDisableDepthTest=false
 o.RenderTransform={Scale={X=1,Y=1},Translation={X=0,Y=0},Shear={X=0,Y=0},Angle=0}
 o.RenderTransformPivot={X=.5,Y=.5}
 function o:get_full_name()return self.full_name or self.kind..'_'..self.address end
 function o:get_outer()return self.outer or fixture_world end
 if kind:find('MID',1,true)then
  o.values={CustomGridSize=.25}
  function o:K2_GetScalarParameterValue(n)return self.values[n]or(self.Parent and self.Parent.values and self.Parent.values[n])or 0 end
  function o:SetScalarParameterValue(n,v)self.values[n]=v end
 end
 function o:SetStaticMesh(a)self.mesh=a end
 function o:GetNumMaterials()return #self.materials end
 function o:GetMaterial(i)return self.materials[i+1]end
 function o:SetMaterial(i,m)self.materials[i+1]=m end
 function o:CreateDynamicMaterialInstance(i,m)
  if m==overlay then assert(m.bDisableDepthTest,'overlay depth flag ordering')end
  local d=object('MID');d.Parent=m;self.materials[i+1]=d;return d
 end
 function o:SetVectorParameterValue(n,v)assert(v.native=='Color');self[n]=deepcopy(v)end
 function o:SetTranslucentSortPriority(v)self.sort=v end
 function o:GetRenderOpacity()return self.opacity end
 function o:SetRenderOpacity(v)self.opacity=v end
 function o:SetColorAndOpacity(v)assert(v.native=='Color');self.ColorAndOpacity=deepcopy(v)end
 function o:RemoveFromParent()self.removed=true end
 function o:SetLightingChannels(a,b,c)self.LightingChannels={bChannel0=a,bChannel1=b,bChannel2=c}end
 function o:GetVisibility()return self.widget_visibility or 0 end
 function o:ShowMaterialSection(m,s,on,lod)self.sections=self.sections or {};self.sections[s]=on end
 function o:GetSkinnedAsset()return self.asset end
 function o:GetSkeletalMeshAsset()return self.asset or self end
 function o:SetReceivesDecals()end
 for _,n in ipairs({'SetMobility','SetCastShadows','SetLightColor','SetUseInverseSquaredFalloff','SetLightFalloffExponent','SetAttenuationRadius','SetInverseExposureBlend','SetIndirectLightingIntensity','SetVolumetricScatteringIntensity','SetIntensity'})do
  o[n]=function(self,v)self[n..'_value']=v end
 end
 return o
end
-- Existing pawn objects need strict class metadata as well.
for _,o in ipairs(objects)do
 function o:get_outer()return self.outer or fixture_world end
 local cls=o:get_class()
 function cls:find_property(n)return o[n]~=nil and {} or nil end
 function cls:find_function(n)
  if type(o[n])~='function'then return nil end
  return {hook_ptr=function(_,pre,post)
   hooks[n]={pre=pre,post=post}
   if n=='UpdateMouseAxisInputValues'then axis_hook=post elseif n=='StartRatShakingMouseInput'then start_hook=post elseif n=='TriggerHeadBobCameraShake'then bob_hook=pre end
  end}
 end
end
source.materials={object('Skin')}
function source:GetNumMaterials()return 1 end;function source:GetMaterial(i)return self.materials[i+1]end
player.RootComponent=object('Root');player.RootComponent.world=T(0,0,90)
function player:InteractTrace()native_head_traces=native_head_traces+1 end
function player:UpdateMouseAxisInputValues()end
function player:TriggerHeadBobCameraShake()end
local old_add=player.AddComponentByClass
function player:AddComponentByClass(c)return object(c.kind)end
rat_asset=object('SkeletalMesh');rat_asset.full_name='SkeletalMesh /Game/Ratshaker/CA/TheRat2D/SKM_Rat2D.SKM_Rat2D'
function rat_asset:GetImportedBounds()return {Origin={X=-9.99711799621582,Y=5.67260479927063,Z=-2.886479377746582},BoxExtent={X=1.8857450485229492,Y=11.195210218429565,Z=23.73595142364502}}end
rat.asset=rat_asset;rat.materials={object('RatAnimatedMID'),object('RatTailMID')}
rat_base=object('Material');rat_base.full_name='Material /Game/Ratshaker/CA/TheRat2D/SupporterPack/MT_Rat2D_V2.MT_Rat2D_V2'
tail_base=object('Material');tail_base.full_name='Material /Game/Ratshaker/CA/TheRat2D/MT_Rat2D_Tail.MT_Rat2D_Tail'
rat.materials[1].Parent=rat_base;rat.materials[2].Parent=tail_base
original_rat_mid,original_tail_mid=rat.materials[1],rat.materials[2]
function rat:GetSkeletalMeshAsset()return self.asset end
function rat:GetNumMaterials()return #self.materials end;function rat:GetMaterial(i)return self.materials[i+1]end
overlay=object('Material');overlay.full_name='Material /Engine/EngineDebugMaterials/M_SimpleUnlitTranslucent.M_SimpleUnlitTranslucent';overlay.BlendMode=2;overlay.ShadingModel=0;overlay.bDisableDepthTest=false
cube=object('StaticMesh');cube.full_name='StaticMesh /Engine/BasicShapes/Cube.Cube'
sphere=object('StaticMesh');sphere.full_name='StaticMesh /Engine/BasicShapes/Sphere.Sphere'
mathlib=object('Math')
function mathlib:MakeVector(x,y,z)return {X=x,Y=y,Z=z,native='Vector'}end
function mathlib:MakeVector2D(x,y)return {X=x,Y=y,native='Vector2D'}end
function mathlib:MakeColor(r,g,b,a)return {R=r,G=g,B=b,A=a,native='Color'}end
soft_property_calls=0;registry_asset_loads=0;registry_interface_lookups=0
function system:MakeSoftObjectPath(s)error('preferred AssetRegistry path should not need soft path')end
function system:Conv_SoftObjPathToSoftObjRef()soft_property_calls=soft_property_calls+1;error('unsupported SoftObjectProperty used')end
function system:LoadAsset_Blocking()soft_property_calls=soft_property_calls+1;error('unsupported SoftObjectProperty used')end
asset_registry=object('AssetRegistry');asset_helpers=object('AssetRegistryHelpers')
pixel_global=object('MaterialParameterCollection');pixel_global.values={PixelSize=512,GridSize=.5};pixel_global.full_name='MaterialParameterCollection /Game/Ratshaker/MAT/PP/VHSFilter/MPC_GlobalParams.MPC_GlobalParams'
pixel_vhs=object('MaterialParameterCollection');pixel_vhs.values={Pixelate_Scale=256,Noise_Strength=.1};pixel_vhs.full_name='MaterialParameterCollection /Game/Ratshaker/MAT/PP/VHSFilter/MPC_VHSFilter.MPC_VHSFilter'
widget_material=object('OriginalWidget3DPassThrough')
materiallib=object('MaterialLibrary')
function materiallib:GetScalarParameterValue(world,asset,n)assert(world==player);return assert(asset.values[n])end
function materiallib:SetScalarParameterValue(world,asset,n,v)
 assert(world==player and (n=='PixelSize' or n=='Pixelate_Scale' or n=='GridSize'));asset.values[n]=v
end
rat.LightingChannels={bChannel0=true,bChannel1=false,bChannel2=false}
function rat:SetLightingChannels(a,b,c)self.LightingChannels={bChannel0=a,bChannel1=b,bChannel2=c}end
function asset_helpers:GetAssetRegistry()return asset_registry end
local function registry_lookup(context,path,on_disk)
 assert(context==asset_registry,'interface lookup lost concrete registry instance')
 registry_interface_lookups=registry_interface_lookups+1
 assert(type(path)=='string'and on_disk==false,'AssetRegistry object-path contract')
 return {native='AssetData',path=path}
end
function asset_helpers:GetAsset(data)
 assert(data and data.native=='AssetData','GetAsset requires native AssetData')
 registry_asset_loads=registry_asset_loads+1
 if data.path:find('MPC_GlobalParams',1,true)then return pixel_global end
 if data.path:find('MPC_VHSFilter',1,true)then return pixel_vhs end
 if data.path:find('Widget3DPassThrough_Translucent',1,true)then return widget_material end
 return data.path:find('Cube')and cube or(data.path:find('Sphere')and sphere or overlay)
end
interface=object('Interface');door=object('Door')
function door:IsInteractable(out)out.result=true end
function door:InteractWithUI()self.interactions=(self.interactions or 0)+1 end
function system:DoesImplementInterface(a,i)assert(i==interface);return a==door end
function system:LineTraceSingle(p,start,finish,channel,complex,ignored,debug,out,ignoreSelf,c1,c2,time)
 assert(not inside_native_hook,'ProcessEvent trace must not run inside InteractTrace hook')
 assert(p==player and start.native=='Vector'and finish.native=='Vector'and channel==2 and complex and ignoreSelf)
 last_trace={start=start,finish=finish};out.result={native='HitResult'};return true
end
function gameplay:BreakHitResult(hit,...)
 assert(hit.native=='HitResult');local out={...};assert(#out==18);out[6].result={X=110,Y=-10,Z=80};out[10].result=door
end
bar=object('ProgressBar');bar.Percent=.25
meter_widget=object('WBP_ShakeMeter_C');meter_widget.Fillbar=bar;meter_widget.opacity=.75
meter_widget.ColorAndOpacity={R=1,G=1,B=1,A=.6}
function meter_widget:GetColorAndOpacity()return deepcopy(self.ColorAndOpacity)end
function meter_widget:SetColorAndOpacity(c)self.ColorAndOpacity=deepcopy(c)end
crosshair=object('Crosshair');crosshair.opacity=.5;crosshair.widget_visibility=4
function crosshair:SetVisibility(v)self.widget_visibility=v end
hud_widget=object('HUD');hud_widget.refShakeMeter=meter_widget;hud_widget.refCrosshair=crosshair
input_widget=object('WBP_InputList_C');input_widget.opacity=.85;input_widget.ColorAndOpacity={R=1,G=1,B=1,A=.9};hud_widget.refInputList=input_widget
function widgets:Create()error('Native HUD must not create a replacement widget')end
function hud_widget:ShowInteractPrompt(t)self.target=t end;function hud_widget:HideInteractPrompt()self.target=nil end
player.refHUD=hud_widget;function controller:GetHUD()return hud_widget end
player.ACOMP_ShakeMeter.ShakeMeterMinValue=0;player.ACOMP_ShakeMeter.ShakeMeterShakesToFill=25
player.ACOMP_ShakeMeter.TimeSqueezedUnits=0;player.bRatSqueeze=false;player.bRatDead=false
native_camera=object('CameraShake');native_camera.ShakeScale=.7;player.refShakeShake=native_camera
function player:InitRatShakeShake()end
function player:UpdateRakShakeRageTimeline()end
function player:EnterRatSqueeze()
 squeeze_enters=squeeze_enters+1;self.bRatSqueeze=true;self.th_DrainWhenHeld.active=true
end
function player:DrainShakeMeterWhenSqueezing()
 assert(not self.th_DrainWhenHeld.active,'native timer would race hand-owned dispatch')
 squeeze_drains=squeeze_drains+1
 local m=self.ACOMP_ShakeMeter
 m.currentShakeMeterValue=math.max(0,m.currentShakeMeterValue-1);m.TimeSqueezedUnits=m.TimeSqueezedUnits+1
 if m.currentShakeMeterValue<=0 or m.TimeSqueezedUnits/m.ShakeMeterShakesToFill<=.2 then self.dispatch_closed=false;return end
 if self.dispatch_closed then return end
 self.dispatch_closed=true
 if not self.bRatDead and self.refValidInteractActor then self.refValidInteractActor:InteractWithUI('',false)end
end
function player:ExitRatSqueeze()squeeze_exits=squeeze_exits+1;self.bRatSqueeze=false;self.ACOMP_ShakeMeter.TimeSqueezedUnits=0 end
registry_interface={find_function=function(_,n)
 if n=='GetAssetByObjectPath'then return setmetatable({},{__call=function(_,context,...)
  return registry_lookup(context,...)end})end
end}
local old_find=uevr.api.find_uobject
local fixture_classes={}
local function fixture_class(n,default)
 if fixture_classes[n]then return fixture_classes[n]end
 local c=object('UClass');c.kind=n;c.is_fixture_class=true
 function c:get_class_default_object()assert(default,'class has no fixture default '..n);return default end
 fixture_classes[n]=c;return c
end
gameplay_character_ready=false
function uevr.api:get_local_pawn()return gameplay_character_ready and player or nil end
function uevr.api:find_uobject(n)
 if n=='Class /Script/Engine.World'then return fixture_class('Engine.World')end
 if n:find('BP_INT_InteractionInterface_C',1,true)then return interface end
 if n=='Class /Script/AssetRegistry.AssetRegistry'then return registry_interface end
 if n:find('AssetRegistryHelpers',1,true)then return fixture_class('AssetRegistry.AssetRegistryHelpers',asset_helpers)end
 if n:find('KismetMathLibrary',1,true)then return fixture_class('Engine.KismetMathLibrary',mathlib)end
 if n:find('KismetMaterialLibrary',1,true)then return fixture_class('Engine.KismetMaterialLibrary',materiallib)end
 if n:find('WidgetBlueprintLibrary',1,true)then return fixture_class('UMG.WidgetBlueprintLibrary',widgets)end
 local component=n:match('^Class /Script/(Engine%.[%w]+Component)$')or n:match('^Class /Script/(UMG%.WidgetComponent)$')
 if component then return fixture_class(component)end
 return old_find(self,n)
end
fixture_world=object('World')
function fixture_world:get_class()return fixture_class('Engine.World')end
function UEVR_UObjectHook.get_objects_by_class(c,defaults)
 assert(c.kind=='Engine.MeshComponent' and defaults==false)
 return {rat}
end
function uevr.params.vr.is_action_active(n,s)
 if n:find('/Trigger')then return s==0 and lt or(s==1 and rt)end
 if n:find('/Grip')then return s==0 and lg or(s==1 and rg)end
 if n:find('AButtonTouch')then return false end -- lifted index
 if n:find('BButtonTouch')or n:find('ThumbrestTouch')then return touch end
 return false
end
function real_tick(dt)
 callbacks.on_pre_engine_tick(nil,dt or 1/90)
 for _,o in ipairs(objects)do if o.alive and o.hand~=nil then
  local p=o.hand==0 and left or(o.hand==1 and right or head);o.world=T(p.x,p.y,p.z)
 end end
 callbacks.on_post_calculate_stereo_view_offset(nil,1,100,head,{x=0,y=0,z=0})
 -- Simulate an optimized Blueprint camera trace bypassing hook_ptr inside
 -- the world tick. The adjacent hand trace must repair this before dispatch.
 if runtime and hmd and controls and not menu then player.refValidInteractActor=nil end
 if callbacks.on_post_engine_tick then callbacks.on_post_engine_tick()end
 local hook=hooks.InteractTrace
 inside_native_hook=true
 if hook and hook.pre then if hook.pre(nil,player)~=false then player:InteractTrace()end end
 inside_native_hook=false
end
function components(kind)local list={};for _,o in ipairs(objects)do if o.alive and not o.is_fixture_class and o.kind==kind then list[#list+1]=o end end;return list end
`);
const entry=path.resolve(__dirname,'../profile/scripts/main.lua');
run(fs.readFileSync(entry,'utf8'));
run(`
runtime=false;hmd=false;controls=false
real_tick();assert(loaded_house==0,'mod hijacked native menu/story startup')
gameplay_character_ready=true;real_tick()
assert(source.visible and rat.parent==source,'flat fallback changed native arms/rat attachment')
assert(#components('Engine.StaticMeshComponent')==0 and #components('Engine.PoseableMeshComponent')==0,'flat fallback must not create fake meter meshes or cloned rat')
assert(#components('UMG.WidgetComponent')==0 and meter_widget.opacity==.75,'flat native HUD was replaced or hidden')
assert(pixel_global.values.PixelSize==512 and pixel_vhs.values.Pixelate_Scale==256 and #components('Engine.PointLightComponent')==0,'VR rendering overrides changed flat view')
runtime=true;hmd=true;controls=true;real_tick()
assert(RATSHAKER_VR_MOD_ACTIVE and source.visible==false,'bundle activation')
assert(registry_asset_loads>0 and soft_property_calls==0 and registry_interface_lookups>0,'asset loading missed supported AssetRegistry interface route')
assert(asset_registry:get_class():find_function('GetAssetByObjectPath')==nil and asset_registry:get_class():find_function('K2_GetAssetByObjectPath')==nil,'concrete registry fixture incorrectly inherits interface methods')
assert(#components('Engine.StaticMeshComponent')==5,'pointer needs five components, native HUD needs no replacement components')
assert(#components('UMG.WidgetComponent')==0,'native meter replacement remains installed')
assert(#components('Engine.PointLightComponent')==2 and rat.LightingChannels.bChannel2,'isolated native-rat fill lights missing')
assert(pixel_global.values.PixelSize==8192 and pixel_vhs.values.Pixelate_Scale==8192 and pixel_global.values.GridSize==1/1024 and pixel_vhs.values.Noise_Strength==.1,'targeted pixel/grid overrides missing or unrelated effects changed')
assert(rat.materials[1]==original_rat_mid and rat.materials[2]==original_tail_mid,'wobble correction replaced native animated rat material')
near(original_rat_mid.values.CustomGridSize,1/1024);near(original_tail_mid.values.CustomGridSize,1/1024)
assert(#components('Engine.PoseableMeshComponent')==1,'only independent arm rig, with no cloned rat')
assert(meter_widget.opacity==.75 and meter_widget.ColorAndOpacity.A==.6 and crosshair.opacity==0,'native meter was changed or crosshair stayed visible')
assert(input_widget.opacity==0 and input_widget.visible==1,'mouse prompts were not hidden independently of native meter')
assert(crosshair.widget_visibility==1,'native head crosshair not collapsed')
assert(native_camera.ShakeScale==0,'native shake camera still active')
native_camera.ShakeScale=1.5;callbacks.on_post_engine_tick()
assert(native_camera.ShakeScale==0,'native rage timeline reintroduced camera shake')
assert(player.refValidInteractActor==door and native_head_traces==0,'left pointer did not replace camera trace')
-- Isolate pre-tick: the shared factory must not show hidden pointer pieces
-- before post-tick/stereo corrects them (which could cause a visible flash).
callbacks.on_pre_engine_tick(nil,1/90)
for _,part in ipairs(components('Engine.StaticMeshComponent'))do
 local c=part.materials[1]and part.materials[1].Color
 if c and c.G==.82 then assert(not part.visible,'factory overrode accepted-target marker visibility')end
end
local rayx=last_trace.start.X;head.x=head.x+20;real_tick();near(last_trace.start.X,rayx+20)
assert(player.refValidInteractActor==door,'head-origin projected ray lost the stationary hand landing target')
rt=true;for i=1,90 do real_tick()end;assert(tick_counter==0,'still hold filled meter')
for i=1,270 do raw.x=.08*math.sin(i/90*math.pi*6);real_tick()end
assert(tick_counter>=6 and tick_counter<=18 and timer_clears>0,'full bundle did not dispatch bounded native shake ticks')
rg=true;real_tick();assert(squeeze_enters==1 and squeeze_drains==1 and not door.interactions,'squeeze bypassed native charged gate')
for i=1,135 do real_tick()end
assert(door.interactions==1,'charged squeeze lost hand target to in-tick camera overwrite')
player.ACOMP_ShakeMeter.TimeSqueezedUnits=5;player.ACOMP_ShakeMeter.currentShakeMeterValue=15;real_tick()
local native_progress_part
for _,part in ipairs(components('Engine.StaticMeshComponent'))do
 local c=part.materials[1]and part.materials[1].Color
 if c and c.R==1 and c.G==.43 and c.B==.055 then native_progress_part=part end
end
assert(native_progress_part and native_progress_part.visible,'valid native squeeze did not display progress')
near(native_progress_part.world.Scale3D.Y,.08)
assert(player.ACOMP_ShakeMeter.TimeSqueezedUnits==5 and door.interactions==1,'progress renderer changed charge or dispatched interaction')
rt=false;rg=false;real_tick()
lt=true;rt=true;rg=true;real_tick()
assert(player.refValidInteractActor==nil and door.interactions==1 and squeeze_enters==2,'same-tick left fist retained a stale squeeze target')
menu=true;real_tick();assert(meter_widget.opacity==.75 and crosshair.opacity==.5 and native_camera.ShakeScale==.7,'pause failed to restore HUD/camera')
assert(input_widget.opacity==.85 and input_widget.ColorAndOpacity.A==.9,'pause failed to restore mouse prompts')
assert(pixel_global.values.PixelSize==512 and pixel_vhs.values.Pixelate_Scale==256 and #components('Engine.PointLightComponent')==0 and not rat.LightingChannels.bChannel2,'pause failed to restore pixelation and rat lighting')
near(pixel_global.values.GridSize,.5);near(original_rat_mid.values.CustomGridSize,.25);near(original_tail_mid.values.CustomGridSize,.25)
assert(crosshair.widget_visibility==4,'pause did not restore crosshair visibility')
menu=false;real_tick();assert(meter_widget.opacity==.75,'resume hid native meter')
-- Original meter data remains wholly native; no replacement output is synthesized.
bar.Percent=.66;meter_widget.authored_angle=7;real_tick(.2)
assert(bar.Percent==.66 and meter_widget.authored_angle==7 and meter_widget.opacity==.75,'adapter changed original meter')
assert(#components('Engine.StaticMeshComponent')==5,'legacy meter primitives were created')
runtime=false;hmd=false;controls=false;real_tick()
player.NewVar=77;source.VisibilityBasedAnimTickOption=2;player.refValidInteractActor=door;real_tick()
assert(player.NewVar==77 and player.refValidInteractActor==door,'paused rig overrode native desktop state')
local pad={Gamepad={bRightTrigger=200,bLeftTrigger=180}};callbacks.on_xinput_get_state(nil,0,pad)
real_tick();pad.Gamepad.bRightTrigger=200;pad.Gamepad.bLeftTrigger=180;callbacks.on_xinput_get_state(nil,0,pad)
assert(pad.Gamepad.bRightTrigger==200 and pad.Gamepad.bLeftTrigger==180,'flat fallback suppressed native controls repeatedly')
callbacks_before=callbacks.on_pre_engine_tick
`);
run(fs.readFileSync(entry,'utf8'));
run(`assert(callbacks_before==callbacks.on_pre_engine_tick,'duplicate bundle loaded twice')
callbacks.on_script_reset()
assert(not RATSHAKER_VR_MOD_ACTIVE and source.visible and rat.parent==source,'script reset restoration')
assert(meter_widget.opacity==.75 and crosshair.opacity==.5 and not overlay.bDisableDepthTest,'original HUD/material not restored')
assert(meter_widget.ColorAndOpacity.A==.6,'native color opacity not restored')
assert(input_widget.opacity==.85 and input_widget.ColorAndOpacity.A==.9 and not meter_widget.removed,'native widget restoration/lifetime damaged')
assert(pixel_global.values.PixelSize==512 and pixel_vhs.values.Pixelate_Scale==256 and not rat.LightingChannels.bChannel2,'rendering originals not restored')
assert(native_camera.ShakeScale==.7,'native camera shake scale not restored')
assert(player.NewVar==77 and source.VisibilityBasedAnimTickOption==2,'reset overwrote native state changed while rig was paused')
for _,kind in ipairs({'Engine.StaticMeshComponent','Engine.PoseableMeshComponent','Engine.SceneComponent','Engine.PointLightComponent','UMG.WidgetComponent','poseable','proxy'})do
 assert(#components(kind)==0,'owned component leak: '..kind)
end
print('PASS: exact bundled entry with all actual modules; independent wrists, head-projected left target consumed by squeeze, untouched native HUD meter, separate mouse-prompt suppression, targeted pixelation and isolated fill lights, native-only rat, AssetRegistry loading, engine-tick traces, bounded motion bridge, duplicate guard, pause/resume and owned-component cleanup. Rendered HUD/appearance is not simulated or claimed.')
`);
